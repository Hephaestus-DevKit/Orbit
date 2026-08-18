import { createHash, createPublicKey, verify as verifySignature } from "crypto";
import { existsSync, lstatSync, readFileSync } from "fs";
import { dirname, resolve, win32 } from "path";
import { z } from "zod";
import { resolveSafePath } from "@orbit-build/shared";
import { createMacOsSeatbeltProfile } from "./MacOsSeatbeltPolicy.js";

/** Process-level isolation policy. `required` never silently degrades. */
export const ProcessSandboxModeSchema = z.enum(["off", "auto", "required"]);
export type ProcessSandboxMode = z.infer<typeof ProcessSandboxModeSchema>;

export const ProcessSandboxNetworkSchema = z.enum(["inherit", "deny", "allow"]);
export type ProcessSandboxNetwork = z.infer<typeof ProcessSandboxNetworkSchema>;

export const ProcessSandboxBackendSchema = z.enum([
  "macos-sandbox-exec",
  "linux-bubblewrap",
  "linux-firejail",
  "windows-appcontainer-helper",
  "none",
]);
export type ProcessSandboxBackend = z.infer<typeof ProcessSandboxBackendSchema>;

export interface ProcessSandboxCapabilities {
  platform: NodeJS.Platform;
  backends: ProcessSandboxBackend[];
  selectedBackend: ProcessSandboxBackend;
  native: boolean;
  networkIsolation: boolean;
  helperDigest?: string;
  helperKeyId?: string;
  reason?: string;
}

export interface ProcessSandboxRequest {
  cwd: string;
  mode: ProcessSandboxMode;
  network: ProcessSandboxNetwork;
  /** Additional paths that may be read but never written. */
  readOnlyRoots?: string[];
  /** Additional paths that may be written; defaults to cwd only. */
  writableRoots?: string[];
  /** Explicit trusted boundaries for disjoint extension/workspace roots. */
  boundaryRoots?: string[];
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  pathExists?: (candidate: string) => boolean;
  /** Separate trust domain for the signed Windows helper. */
  trustRoots?: Record<string, string>;
  /** Test seam for deterministic helper digest verification. */
  fileDigest?: (candidate: string) => string | undefined;
}

export interface SandboxedInvocation {
  file: string;
  args: string[];
  backend: ProcessSandboxBackend;
  networkIsolation: boolean;
  degraded: boolean;
  helperDigest?: string;
  helperKeyId?: string;
  reason?: string;
}

export interface ProcessInvocation {
  file: string;
  args: string[];
}

/** Detect installed native backends without spawning or mutating the host. */
export function detectProcessSandbox(
  options: Pick<
    ProcessSandboxRequest,
    "platform" | "environment" | "pathExists" | "trustRoots" | "fileDigest"
  > = {},
): ProcessSandboxCapabilities {
  const platform = options.platform ?? process.platform;
  // Helper discovery may be requested with a sanitized child environment. The
  // parent process still owns the explicit helper contract variables; merging
  // them here never forwards credentials to the child process.
  const environment = { ...process.env, ...(options.environment ?? {}) };
  const pathExists = options.pathExists ?? existsSync;
  if (platform === "darwin") {
    const executable =
      environment.ORBIT_SANDBOX_EXEC_PATH ?? "/usr/bin/sandbox-exec";
    const available = pathExists(executable);
    return {
      platform,
      backends: available ? ["macos-sandbox-exec"] : ["none"],
      selectedBackend: available ? "macos-sandbox-exec" : "none",
      native: available,
      networkIsolation: available,
      ...(available
        ? {}
        : { reason: `Native sandbox backend not found: ${executable}.` }),
    };
  }
  if (platform === "linux") {
    const bubblewrap = environment.ORBIT_BWRAP_PATH ?? "bwrap";
    const firejail = environment.ORBIT_FIREJAIL_PATH ?? "firejail";
    const bubblewrapAvailable = pathExists(bubblewrap);
    const firejailAvailable = pathExists(firejail);
    const backends: ProcessSandboxBackend[] = [];
    if (bubblewrapAvailable) backends.push("linux-bubblewrap");
    if (firejailAvailable) backends.push("linux-firejail");
    if (backends.length === 0) backends.push("none");
    return {
      platform,
      backends,
      selectedBackend: backends[0],
      native: backends[0] !== "none",
      networkIsolation: backends[0] !== "none",
      ...(backends[0] === "none"
        ? { reason: "Neither bubblewrap nor firejail is installed." }
        : {}),
    };
  }
  if (platform === "win32") {
    const helper = verifyWindowsSandboxHelper({
      environment,
      trustRoots: options.trustRoots ?? {},
      fileDigest: options.fileDigest,
      pathExists,
    });
    if (helper) {
      return {
        platform,
        backends: ["windows-appcontainer-helper"],
        selectedBackend: "windows-appcontainer-helper",
        native: true,
        networkIsolation: true,
        helperDigest: helper.digest,
        helperKeyId: helper.keyId,
      };
    }
    return {
      platform,
      backends: ["none"],
      selectedBackend: "none",
      native: false,
      networkIsolation: false,
      reason:
        "Orbit does not claim a Windows OS sandbox without a valid signed native helper contract.",
    };
  }
  return {
    platform,
    backends: ["none"],
    selectedBackend: "none",
    native: false,
    networkIsolation: false,
    reason: `No supported native sandbox backend for ${platform}.`,
  };
}

/**
 * Wrap one already-resolved shell invocation with a native backend.
 *
 * The wrapper never broadens the workspace: roots are canonicalized through
 * Orbit's existing path boundary before they enter a profile or bwrap args.
 */
export function sandboxInvocation(
  invocation: ProcessInvocation,
  request: ProcessSandboxRequest,
): SandboxedInvocation {
  const mode = ProcessSandboxModeSchema.parse(request.mode);
  const network = ProcessSandboxNetworkSchema.parse(request.network);
  if (mode === "off") {
    return {
      ...invocation,
      backend: "none",
      networkIsolation: false,
      degraded: false,
    };
  }
  const capabilities = detectProcessSandbox(request);
  if (!capabilities.native) {
    if (mode === "required") {
      throw new Error(
        `Required process sandbox is unavailable: ${capabilities.reason ?? "no native backend"}`,
      );
    }
    return {
      ...invocation,
      backend: "none",
      networkIsolation: false,
      degraded: true,
      reason: capabilities.reason ?? "No native sandbox backend is available.",
    };
  }

  const cwd = resolve(request.cwd);
  const boundaryRoots = [cwd, ...(request.boundaryRoots ?? [])];
  const writableRoots = normalizeRoots(
    cwd,
    request.writableRoots ?? [cwd],
    boundaryRoots,
  );
  const readOnlyRoots = normalizeRoots(
    cwd,
    request.readOnlyRoots ?? [],
    boundaryRoots,
  );
  const selected = capabilities.selectedBackend;
  if (selected === "macos-sandbox-exec") {
    const executable =
      request.environment?.ORBIT_SANDBOX_EXEC_PATH ?? "/usr/bin/sandbox-exec";
    const profile = createMacOsSeatbeltProfile({
      invocation,
      cwd,
      writableRoots,
      readOnlyRoots,
      network,
      environment: request.environment ?? process.env,
    });
    return {
      file: executable,
      args: ["-p", profile, invocation.file, ...invocation.args],
      backend: selected,
      networkIsolation: network === "deny",
      degraded: false,
    };
  }
  if (selected === "linux-bubblewrap") {
    const executable = request.environment?.ORBIT_BWRAP_PATH ?? "bwrap";
    return {
      file: executable,
      args: createBubblewrapArgs(
        invocation,
        cwd,
        writableRoots,
        readOnlyRoots,
        network,
      ),
      backend: selected,
      networkIsolation: network === "deny",
      degraded: false,
    };
  }
  if (selected === "windows-appcontainer-helper") {
    const executable =
      request.environment?.ORBIT_WINDOWS_SANDBOX_HELPER ??
      process.env.ORBIT_WINDOWS_SANDBOX_HELPER;
    if (
      !executable ||
      !capabilities.helperDigest ||
      !capabilities.helperKeyId
    ) {
      throw new Error(
        "Windows sandbox helper verification state is incomplete.",
      );
    }
    return {
      file: executable,
      args: createWindowsHelperArgs(
        invocation,
        cwd,
        writableRoots,
        readOnlyRoots,
        network,
      ),
      backend: selected,
      networkIsolation: network === "deny",
      degraded: false,
      helperDigest: capabilities.helperDigest,
      helperKeyId: capabilities.helperKeyId,
    };
  }
  const executable = request.environment?.ORBIT_FIREJAIL_PATH ?? "firejail";
  return {
    file: executable,
    args: createFirejailArgs(
      invocation,
      cwd,
      writableRoots,
      readOnlyRoots,
      network,
    ),
    backend: selected,
    networkIsolation: network === "deny",
    degraded: false,
  };
}

function normalizeRoots(
  cwd: string,
  roots: string[],
  boundaries: string[],
): string[] {
  const normalized = new Set<string>();
  for (const root of roots) {
    const candidate = resolve(cwd, root);
    let safe: string | undefined;
    for (const boundary of boundaries) {
      try {
        safe = resolveSafePath(boundary, candidate);
        break;
      } catch {
        // Try the next explicitly authorized boundary.
      }
    }
    if (!safe) {
      throw new Error(
        `Process sandbox root is outside every authorized boundary: ${root}`,
      );
    }
    normalized.add(safe);
  }
  return [...normalized];
}

function createWindowsHelperArgs(
  invocation: ProcessInvocation,
  cwd: string,
  writableRoots: string[],
  readOnlyRoots: string[],
  network: ProcessSandboxNetwork,
): string[] {
  for (const writable of writableRoots) {
    if (readOnlyRoots.some((readOnly) => pathsOverlap(writable, readOnly))) {
      throw new Error(
        `Windows sandbox roots overlap with conflicting permissions: ${writable}`,
      );
    }
  }
  const args = [
    "--orbit-sandbox-protocol",
    "1",
    "--cwd",
    cwd,
    "--network",
    network,
  ];
  for (const root of readOnlyRoots) args.push("--read-only", root);
  for (const root of writableRoots) args.push("--writable", root);
  args.push("--", invocation.file, ...invocation.args);
  return args;
}

function pathsOverlap(left: string, right: string): boolean {
  const normalize = (value: string) =>
    resolve(value).replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
  const a = normalize(left);
  const b = normalize(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

interface WindowsSandboxHelper {
  digest: string;
  keyId: string;
}

function verifyWindowsSandboxHelper(options: {
  environment: NodeJS.ProcessEnv;
  trustRoots: Record<string, string>;
  fileDigest?: (candidate: string) => string | undefined;
  pathExists: (candidate: string) => boolean;
}): WindowsSandboxHelper | undefined {
  const helperPath = options.environment.ORBIT_WINDOWS_SANDBOX_HELPER;
  const expectedDigest =
    options.environment.ORBIT_WINDOWS_SANDBOX_HELPER_SHA256;
  const keyId = options.environment.ORBIT_WINDOWS_SANDBOX_HELPER_KEY_ID;
  const signature = options.environment.ORBIT_WINDOWS_SANDBOX_HELPER_SIGNATURE;
  if (!helperPath || !expectedDigest || !keyId || !signature) return undefined;
  // The helper is a Windows binary, so validate using Windows path rules even
  // when a cross-platform test or doctor snapshot simulates `platform: win32`.
  if (!win32.isAbsolute(helperPath)) return undefined;
  if (!/^[a-f0-9]{64}$/i.test(expectedDigest)) return undefined;
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(keyId)) return undefined;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) return undefined;
  if (!options.pathExists(helperPath)) return undefined;

  let actualDigest: string;
  try {
    const stat = lstatSync(helperPath);
    if (!stat.isFile() || stat.isSymbolicLink()) return undefined;
    actualDigest =
      options.fileDigest?.(helperPath) ??
      createHash("sha256").update(readFileSync(helperPath)).digest("hex");
  } catch {
    return undefined;
  }
  if (actualDigest.toLowerCase() !== expectedDigest.toLowerCase())
    return undefined;
  const trustRoot = options.trustRoots[keyId];
  if (!trustRoot) return undefined;
  const payload = JSON.stringify({
    schemaVersion: 1,
    protocol: "orbit-process-sandbox-v1",
    digest: actualDigest.toLowerCase(),
  });
  try {
    const valid = verifySignature(
      null,
      Buffer.from(payload, "utf8"),
      createPublicKey(trustRoot),
      Buffer.from(signature, "base64"),
    );
    return valid ? { digest: actualDigest.toLowerCase(), keyId } : undefined;
  } catch {
    return undefined;
  }
}

function createBubblewrapArgs(
  invocation: ProcessInvocation,
  cwd: string,
  writableRoots: string[],
  readOnlyRoots: string[],
  network: ProcessSandboxNetwork,
): string[] {
  const args = [
    "--die-with-parent",
    "--new-session",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
  ];
  if (network === "deny") args.push("--unshare-net");
  for (const root of runtimeReadOnlyRoots(invocation.file)) {
    args.push("--ro-bind", root, root);
  }
  for (const root of readOnlyRoots) args.push("--ro-bind", root, root);
  for (const root of writableRoots) args.push("--bind", root, root);
  args.push("--chdir", cwd, "--", invocation.file, ...invocation.args);
  return args;
}

function createFirejailArgs(
  invocation: ProcessInvocation,
  cwd: string,
  writableRoots: string[],
  readOnlyRoots: string[],
  network: ProcessSandboxNetwork,
): string[] {
  const args = ["--quiet", "--private=.", `--whitelist=${cwd}`];
  if (network === "deny") args.push("--net=none");
  for (const root of readOnlyRoots) {
    args.push(`--whitelist=${root}`, `--read-only=${root}`);
  }
  for (const root of writableRoots) args.push(`--whitelist=${root}`);
  args.push("--cwd", cwd, "--", invocation.file, ...invocation.args);
  return args;
}

function runtimeReadOnlyRoots(command: string): string[] {
  const roots = [dirname(resolve(command))];
  for (const root of ["/usr", "/bin", "/lib", "/lib64", "/etc"]) {
    if (!roots.includes(root)) roots.push(root);
  }
  return roots;
}
