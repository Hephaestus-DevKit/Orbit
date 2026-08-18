import { posix } from "path";
import type {
  ProcessInvocation,
  ProcessSandboxNetwork,
} from "./ProcessSandbox.js";

export interface MacOsSeatbeltProfileOptions {
  invocation: ProcessInvocation;
  cwd: string;
  writableRoots: string[];
  readOnlyRoots: string[];
  network: ProcessSandboxNetwork;
  environment: NodeJS.ProcessEnv;
}

/**
 * Runtime rules required by current macOS Seatbelt hosts.
 *
 * The baseline follows the same deny-by-default design as the current Codex
 * Seatbelt policy, but Orbit keeps file reads scoped to explicit system,
 * workspace, toolchain, and scratch roots instead of enabling full-disk reads.
 */
const MACOS_RUNTIME_BASE_POLICY = String.raw`
(version 1)
(deny default)

(allow process-exec)
(allow process-fork)
(allow signal (target same-sandbox))
(allow process-info* (target same-sandbox))

(allow sysctl-read)
(allow sysctl-write (sysctl-name "kern.grade_cputype"))
(allow system-mac-syscall (mac-policy-name "vnguard"))
(allow system-mac-syscall
  (require-all
    (mac-policy-name "Sandbox")
    (mac-syscall-number 67)))

(allow iokit-open
  (iokit-registry-entry-class "RootDomainUserClient"))

(allow ipc-posix-sem)
(allow ipc-posix-shm-read-data
  ipc-posix-shm-write-create
  ipc-posix-shm-write-unlink
  (ipc-posix-name-regex #"^/__KMP_REGISTERED_LIB_[0-9]+$"))
(allow ipc-posix-shm-read*
  (ipc-posix-name-prefix "apple.cfprefs."))
(allow ipc-posix-shm-read*
  (ipc-posix-name "apple.shm.notification_center"))

(allow mach-lookup
  (global-name "com.apple.PowerManagement.control")
  (global-name "com.apple.analyticsd")
  (global-name "com.apple.analyticsd.messagetracer")
  (global-name "com.apple.appsleep")
  (global-name "com.apple.bsd.dirhelper")
  (global-name "com.apple.cfprefsd.agent")
  (global-name "com.apple.cfprefsd.daemon")
  (global-name "com.apple.diagnosticd")
  (global-name "com.apple.dt.automationmode.reader")
  (global-name "com.apple.espd")
  (global-name "com.apple.logd")
  (global-name "com.apple.logd.events")
  (global-name "com.apple.runningboard")
  (global-name "com.apple.secinitd")
  (global-name "com.apple.system.DirectoryService.libinfo_v1")
  (global-name "com.apple.system.logger")
  (global-name "com.apple.system.notification_center")
  (global-name "com.apple.system.opendirectoryd.libinfo")
  (global-name "com.apple.system.opendirectoryd.membership")
  (global-name "com.apple.trustd")
  (global-name "com.apple.trustd.agent")
  (global-name "com.apple.xpc.activity.unmanaged")
  (local-name "com.apple.cfprefsd.agent"))
(allow user-preference-read)

(allow pseudo-tty)
(allow file-read* file-write* file-ioctl (literal "/dev/ptmx"))
(allow file-read* file-write*
  (require-all
    (regex #"^/dev/ttys[0-9]+")
    (extension "com.apple.sandbox.pty")))
(allow file-ioctl (regex #"^/dev/ttys[0-9]+"))
`;

const MACOS_PLATFORM_FILESYSTEM_POLICY = String.raw`
(allow file-read* file-test-existence
  (subpath "/Library/Apple")
  (subpath "/Library/Filesystems/NetFSPlugins")
  (subpath "/Library/Preferences")
  (subpath "/Library/Preferences/Logging")
  (subpath "/private/var/db")
  (subpath "/usr/lib")
  (subpath "/usr/share")
  (subpath "/var/db"))

(allow file-map-executable
  (subpath "/Library/Apple/System/Library/Frameworks")
  (subpath "/Library/Apple/System/Library/PrivateFrameworks")
  (subpath "/Library/Apple/usr/lib")
  (subpath "/System/Library/Extensions")
  (subpath "/System/Library/Frameworks")
  (subpath "/System/Library/PrivateFrameworks")
  (subpath "/System/Library/SubFrameworks")
  (subpath "/System/iOSSupport/System/Library/Frameworks")
  (subpath "/System/iOSSupport/System/Library/PrivateFrameworks")
  (subpath "/System/iOSSupport/System/Library/SubFrameworks")
  (subpath "/usr/lib"))

(allow file-read-metadata file-test-existence
  (literal "/etc")
  (literal "/tmp")
  (literal "/var")
  (literal "/private/etc/localtime"))
(allow file-read-metadata file-test-existence
  (path-ancestors "/System/Volumes/Data/private"))
(allow file-read* file-test-existence (literal "/"))

(allow file-read* file-test-existence
  (literal "/dev/autofs_nowait")
  (literal "/dev/random")
  (literal "/dev/urandom")
  (literal "/private/etc/master.passwd")
  (literal "/private/etc/passwd")
  (literal "/private/etc/protocols")
  (literal "/private/etc/services"))
(allow file-read* file-test-existence file-write-data
  (literal "/dev/null")
  (literal "/dev/zero"))
(allow file-read-data file-test-existence file-write-data
  (subpath "/dev/fd"))
(allow file-read* file-test-existence file-write-data file-ioctl
  (literal "/dev/dtracehelper"))

(allow file-read* file-test-existence file-write* (subpath "/tmp"))
(allow file-read* file-test-existence file-write* (subpath "/private/tmp"))
(allow file-read* file-test-existence file-write* (subpath "/var/tmp"))
(allow file-read* file-test-existence file-write* (subpath "/private/var/tmp"))

(allow file-read* (subpath "/etc"))
(allow file-read* (subpath "/private/etc"))
(allow file-read-metadata (subpath "/var"))
(allow file-read-metadata (subpath "/private/var"))

(allow file-read-data file-read-metadata (subpath "/bin"))
(allow file-read-data file-read-metadata (subpath "/sbin"))
(allow file-read-data file-read-metadata (subpath "/usr/bin"))
(allow file-read-data file-read-metadata (subpath "/usr/sbin"))
(allow file-read-data file-read-metadata (subpath "/usr/libexec"))
(allow file-read* (subpath "/opt/homebrew/lib"))
(allow file-read* (subpath "/usr/local/lib"))

(allow file-read* (regex #"^/dev/fd/(0|1|2)$"))
(allow file-write* (regex #"^/dev/fd/(1|2)$"))
(allow file-read* file-write* (literal "/dev/tty"))
(allow file-read-metadata (literal "/dev"))
(allow file-read-metadata (regex #"^/dev/.*$"))
(allow file-read-metadata (literal "/dev/stdin"))
(allow file-read-metadata (literal "/dev/stdout"))
(allow file-read-metadata (literal "/dev/stderr"))
(allow file-read-metadata (regex #"^/dev/tty[^/]*$"))
(allow file-read-metadata (regex #"^/dev/pty[^/]*$"))

(allow file-read-metadata (literal "/System/Volumes") (vnode-type DIRECTORY))
(allow file-read-metadata (literal "/System/Volumes/Data") (vnode-type DIRECTORY))
(allow file-read-metadata (literal "/System/Volumes/Data/Users") (vnode-type DIRECTORY))

(allow file-read* (extension "com.apple.app-sandbox.read"))
(allow file-read* file-write* (extension "com.apple.app-sandbox.read-write"))
`;

const SYSTEM_READABLE_ROOTS = ["/System", "/usr", "/bin", "/sbin", "/dev"];

/** Build one deny-by-default Seatbelt profile without shell interpolation. */
export function createMacOsSeatbeltProfile(
  options: MacOsSeatbeltProfileOptions,
): string {
  const runtimeRoots = macOsRuntimeReadOnlyRoots(
    options.invocation.file,
    options.environment,
  );
  const readableRoots = new Set([
    ...SYSTEM_READABLE_ROOTS,
    options.cwd,
    ...options.writableRoots,
    ...options.readOnlyRoots,
    ...runtimeRoots,
  ]);
  const lines = [
    MACOS_RUNTIME_BASE_POLICY.trim(),
    MACOS_PLATFORM_FILESYSTEM_POLICY.trim(),
    options.network === "deny" ? "(deny network*)" : "(allow network*)",
  ];

  for (const root of readableRoots) {
    const value = profileString(root);
    lines.push(
      `(allow file-read* file-test-existence (subpath ${value}))`,
      `(allow file-read-metadata file-test-existence (path-ancestors ${value}))`,
    );
  }
  for (const root of runtimeRoots) {
    lines.push(`(allow file-map-executable (subpath ${profileString(root)}))`);
  }
  for (const root of options.writableRoots) {
    lines.push(`(allow file-write* (subpath ${profileString(root)}))`);
  }
  return lines.join("\n");
}

function macOsRuntimeReadOnlyRoots(
  command: string,
  environment: NodeJS.ProcessEnv,
): string[] {
  const roots: string[] = [];
  if (posix.isAbsolute(command)) roots.push(posix.dirname(command));
  for (const candidate of (environment.PATH ?? "").split(":")) {
    if (!candidate || !posix.isAbsolute(candidate)) continue;
    if (!roots.includes(candidate)) roots.push(candidate);
  }
  return roots;
}

function profileString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
