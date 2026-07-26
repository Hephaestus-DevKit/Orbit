import { execFileSync } from "child_process";
import { chmodSync, mkdirSync, writeFileSync } from "fs";
import { HIDDEN_CHILD_PROCESS_OPTIONS } from "./childProcess.js";

export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

/** Directories already restricted this process; icacls is not cheap. */
const restrictedDirectories = new Set<string>();

let cachedWindowsSid: string | null | undefined;

export interface PrivateStorageOptions {
  /** Overrides for tests. */
  platform?: NodeJS.Platform;
  runCommand?: (command: string, args: string[]) => string;
  /**
   * Apply an explicit owner-only ACL on Windows. Enabled by default for
   * workspace state, which often lives outside the user profile. Directories
   * under `%USERPROFILE%` already inherit user-scoped ACLs, so home-dir
   * stores pass false and avoid spawning `whoami`/`icacls`.
   */
  windowsAcl?: boolean;
}

function defaultRunCommand(command: string, args: string[]): string {
  return execFileSync(command, args, {
    ...HIDDEN_CHILD_PROCESS_OPTIONS,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Resolve the current user's SID so ACL grants survive localized group
 * names, renamed accounts, and usernames containing spaces.
 */
function currentWindowsSid(
  runCommand: (command: string, args: string[]) => string,
): string | null {
  if (cachedWindowsSid !== undefined) return cachedWindowsSid;
  try {
    const output = runCommand("whoami", ["/user", "/fo", "csv", "/nh"]);
    const match = /S-\d+(?:-\d+)+/.exec(output);
    cachedWindowsSid = match ? match[0] : null;
  } catch {
    cachedWindowsSid = null;
  }
  return cachedWindowsSid;
}

/**
 * Create `directory` (if needed) and restrict it to the current user:
 * mode 0700 on POSIX, an inheritable owner-only ACL on Windows. Windows
 * inheritance `(OI)(CI)` means files created later under this directory are
 * covered without per-file work. Best-effort by design — FAT32/exFAT and
 * network shares have no ACLs, and a failed lockdown must never block the
 * write that data integrity depends on.
 */
export function ensurePrivateDirectory(
  directory: string,
  options: PrivateStorageOptions = {},
): void {
  mkdirSync(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    try {
      chmodSync(directory, PRIVATE_DIRECTORY_MODE);
    } catch {
      // Best-effort on read-only or foreign filesystems.
    }
    return;
  }
  if (options.windowsAcl === false) return;
  if (restrictedDirectories.has(directory)) return;
  const runCommand = options.runCommand ?? defaultRunCommand;
  const sid = currentWindowsSid(runCommand);
  if (!sid) return;
  try {
    runCommand("icacls", [
      directory,
      "/inheritance:r",
      "/grant:r",
      `*${sid}:(OI)(CI)F`,
    ]);
    restrictedDirectories.add(directory);
  } catch {
    // Best-effort: never fail the caller because ACLs are unsupported here.
  }
}

/** Write a file that only the current user should be able to read. */
export function writePrivateFile(
  filePath: string,
  data: string | Buffer,
): void {
  writeFileSync(filePath, data, { mode: PRIVATE_FILE_MODE });
  if (process.platform !== "win32") {
    try {
      chmodSync(filePath, PRIVATE_FILE_MODE);
    } catch {
      // Best-effort on read-only or foreign filesystems.
    }
  }
}

/** Test hook: forget memoized state so a fresh environment can be simulated. */
export function resetPrivateStorageCacheForTests(): void {
  restrictedDirectories.clear();
  cachedWindowsSid = undefined;
}
