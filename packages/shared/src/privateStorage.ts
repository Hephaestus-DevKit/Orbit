import { execFileSync } from "child_process";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  promises as fsPromises,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import type { FileHandle } from "fs/promises";
import { randomUUID } from "crypto";
import { dirname } from "path";
import { HIDDEN_CHILD_PROCESS_OPTIONS } from "./childProcess.js";

export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;
export const DEFAULT_PRIVATE_FILE_MAX_BYTES = 4 * 1024 * 1024;

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

/**
 * Read a regular file through a bounded descriptor. Symbolic-link leaves are
 * rejected by default and may be explicitly allowed for non-secret config.
 */
export function readBoundedRegularFile(
  filePath: string,
  maxBytes = DEFAULT_PRIVATE_FILE_MAX_BYTES,
  options: { allowSymbolicLink?: boolean } = {},
): string | undefined {
  return readBoundedRegularFileBuffer(filePath, maxBytes, options)?.toString(
    "utf8",
  );
}

/** Read a regular file as bounded bytes without following its leaf link. */
export function readBoundedRegularFileBuffer(
  filePath: string,
  maxBytes = DEFAULT_PRIVATE_FILE_MAX_BYTES,
  options: { allowSymbolicLink?: boolean } = {},
): Buffer | undefined {
  validateMaximumBytes(maxBytes);
  let descriptor: number | undefined;
  try {
    const leaf = lstatSync(filePath);
    if (
      (!options.allowSymbolicLink && leaf.isSymbolicLink()) ||
      (!leaf.isFile() && !leaf.isSymbolicLink())
    ) {
      throw new Error(`File path must be a regular file: ${filePath}`);
    }
    descriptor = openSync(
      filePath,
      constants.O_RDONLY |
        (options.allowSymbolicLink ? 0 : (constants.O_NOFOLLOW ?? 0)),
    );
    const stats = fstatSync(descriptor);
    if (!stats.isFile() || stats.size > maxBytes) {
      throw new Error(
        `File exceeds the ${maxBytes}-byte limit or is not regular: ${filePath}`,
      );
    }
    return readDescriptorWithinLimit(descriptor, maxBytes, filePath);
  } catch (error: unknown) {
    if (isFileSystemError(error, "ENOENT")) return undefined;
    throw error;
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Closing a read-only descriptor must not hide the validation result.
      }
    }
  }
}

/** Asynchronously read a bounded regular UTF-8 file without blocking the event loop. */
export async function readBoundedRegularFileAsync(
  filePath: string,
  maxBytes = DEFAULT_PRIVATE_FILE_MAX_BYTES,
  options: { allowSymbolicLink?: boolean } = {},
): Promise<string | undefined> {
  const data = await readBoundedRegularFileBufferAsync(
    filePath,
    maxBytes,
    options,
  );
  return data?.toString("utf8");
}

/** Asynchronously read bounded bytes while holding and validating one descriptor. */
export async function readBoundedRegularFileBufferAsync(
  filePath: string,
  maxBytes = DEFAULT_PRIVATE_FILE_MAX_BYTES,
  options: { allowSymbolicLink?: boolean } = {},
): Promise<Buffer | undefined> {
  validateMaximumBytes(maxBytes);
  let descriptor: FileHandle | undefined;
  try {
    const leaf = await fsPromises.lstat(filePath);
    if (
      (!options.allowSymbolicLink && leaf.isSymbolicLink()) ||
      (!leaf.isFile() && !leaf.isSymbolicLink())
    ) {
      throw new Error(`File path must be a regular file: ${filePath}`);
    }
    descriptor = await fsPromises.open(
      filePath,
      constants.O_RDONLY |
        (options.allowSymbolicLink ? 0 : (constants.O_NOFOLLOW ?? 0)),
    );
    const stats = await descriptor.stat();
    if (!stats.isFile() || stats.size > maxBytes) {
      throw new Error(
        `File exceeds the ${maxBytes}-byte limit or is not regular: ${filePath}`,
      );
    }
    return await readDescriptorWithinLimitAsync(descriptor, maxBytes, filePath);
  } catch (error: unknown) {
    if (isFileSystemError(error, "ENOENT")) return undefined;
    throw error;
  } finally {
    await descriptor?.close().catch(() => undefined);
  }
}

/**
 * Replace a private file from a complete same-directory temporary file.
 * Windows replacement rotates the old file and restores it on commit failure.
 */
export function replacePrivateFileAtomically(
  filePath: string,
  data: string | Buffer,
): void {
  assertRegularFileOrMissing(filePath);
  const directory = dirname(filePath);
  assertRealDirectoryOrMissing(directory);
  ensurePrivateDirectory(directory);
  assertRealDirectory(directory);
  const suffix = `${process.pid}-${randomUUID()}`;
  const temporaryPath = `${filePath}.${suffix}.tmp`;
  const rollbackPath = `${filePath}.${suffix}.bak`;
  let descriptor: number | undefined;
  let previousMoved = false;
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      PRIVATE_FILE_MODE,
    );
    writeFileSync(descriptor, data);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    try {
      renameSync(temporaryPath, filePath);
    } catch (error: unknown) {
      if (!isReplaceConflict(error)) throw error;
      assertRegularFileOrMissing(filePath);
      if (existsSync(filePath)) {
        renameSync(filePath, rollbackPath);
        previousMoved = true;
      }
      try {
        renameSync(temporaryPath, filePath);
      } catch (commitError) {
        if (previousMoved && !existsSync(filePath)) {
          try {
            renameSync(rollbackPath, filePath);
            previousMoved = false;
          } catch (rollbackError) {
            throw new AggregateError(
              [commitError, rollbackError],
              `Private file replacement failed and rollback was incomplete. Recovery data remains at ${rollbackPath}.`,
            );
          }
        }
        throw commitError;
      }
    }
    if (process.platform !== "win32") chmodSync(filePath, PRIVATE_FILE_MODE);
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the original persistence failure.
      }
    }
    removePrivateArtifact(temporaryPath);
    if (previousMoved && existsSync(filePath)) {
      removePrivateArtifact(rollbackPath);
    }
  }
}

function readDescriptorWithinLimit(
  descriptor: number,
  maxBytes: number,
  filePath: string,
): Buffer {
  const chunks: Buffer[] = [];
  let total = 0;
  while (total <= maxBytes) {
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - total));
    const bytesRead = readSync(descriptor, chunk, 0, chunk.length, null);
    if (bytesRead === 0) return Buffer.concat(chunks, total);
    chunks.push(chunk.subarray(0, bytesRead));
    total += bytesRead;
  }
  throw new Error(`File exceeds the ${maxBytes}-byte limit: ${filePath}`);
}

async function readDescriptorWithinLimitAsync(
  descriptor: FileHandle,
  maxBytes: number,
  filePath: string,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  while (total <= maxBytes) {
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - total));
    const { bytesRead } = await descriptor.read(chunk, 0, chunk.length, null);
    if (bytesRead === 0) return Buffer.concat(chunks, total);
    chunks.push(chunk.subarray(0, bytesRead));
    total += bytesRead;
  }
  throw new Error(`File exceeds the ${maxBytes}-byte limit: ${filePath}`);
}

function assertRegularFileOrMissing(filePath: string): void {
  try {
    const stats = lstatSync(filePath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(
        `Private storage path must be a regular file: ${filePath}`,
      );
    }
  } catch (error: unknown) {
    if (isFileSystemError(error, "ENOENT")) return;
    throw error;
  }
}

function assertRealDirectoryOrMissing(directory: string): void {
  try {
    assertRealDirectory(directory);
  } catch (error: unknown) {
    if (isFileSystemError(error, "ENOENT")) return;
    throw error;
  }
}

function assertRealDirectory(directory: string): void {
  const stats = lstatSync(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(
      `Private storage directory must be a real directory: ${directory}`,
    );
  }
}

function validateMaximumBytes(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("File byte limit must be a positive integer.");
  }
}

function isReplaceConflict(error: unknown): boolean {
  return (
    isFileSystemError(error, "EPERM") ||
    isFileSystemError(error, "EEXIST") ||
    isFileSystemError(error, "ENOTEMPTY")
  );
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function removePrivateArtifact(filePath: string): void {
  try {
    rmSync(filePath, { force: true });
  } catch {
    // A hidden same-directory artifact is safer than masking the real result.
  }
}

/** Test hook: forget memoized state so a fresh environment can be simulated. */
export function resetPrivateStorageCacheForTests(): void {
  restrictedDirectories.clear();
  cachedWindowsSid = undefined;
}
