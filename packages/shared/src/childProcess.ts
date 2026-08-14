/**
 * Prevent console-subsystem child processes from creating visible windows.
 *
 * Node ignores this option on non-Windows platforms, so every runtime child
 * process can apply it consistently without platform branches.
 */
export const HIDDEN_CHILD_PROCESS_OPTIONS = Object.freeze({
  windowsHide: true,
});

const SAFE_CHILD_ENV_NAMES = new Set(
  [
    "ALLUSERSPROFILE",
    "APPDATA",
    "CI",
    "COLORTERM",
    "COMSPEC",
    "HOME",
    "HOMEDRIVE",
    "HOMEPATH",
    "LANG",
    "LOCALAPPDATA",
    "LOGNAME",
    "NUMBER_OF_PROCESSORS",
    "OS",
    "PATH",
    "PATHEXT",
    "PROCESSOR_ARCHITECTURE",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMW6432",
    "PUBLIC",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TERM",
    "TMP",
    "TMPDIR",
    "USER",
    "USERDOMAIN",
    "USERNAME",
    "USERPROFILE",
    "WINDIR",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
  ].map((name) => name.toUpperCase()),
);

export interface SanitizedChildEnvironmentOptions {
  source?: NodeJS.ProcessEnv;
  extra?: NodeJS.ProcessEnv;
  mode?: "workspace" | "minimal";
}

export interface InheritedChildEnvironmentOptions {
  source?: NodeJS.ProcessEnv;
  extra?: NodeJS.ProcessEnv;
}

const SENSITIVE_CHILD_ENV_NAME =
  /(?:^|_)(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|PRIVATE_?KEY|ACCESS_?KEY|AUTH(?:ORIZATION)?|COOKIE|SESSION_?ID)(?:$|_)/i;
const SENSITIVE_CHILD_ENV_EXACT = new Set([
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AZURE_CONFIG_DIR",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GIT_ASKPASS",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "KUBECONFIG",
  "SSH_AGENT_PID",
  "SSH_AUTH_SOCK",
]);

function containsUrlCredential(name: string, value: string): boolean {
  if (!/(?:^|_)(?:HTTP|HTTPS|ALL)_PROXY$/i.test(name)) return false;
  try {
    const url = new URL(value);
    return Boolean(url.username || url.password);
  } catch {
    return true;
  }
}

/**
 * Build the environment exposed to workspace-owned child processes.
 *
 * Provider credentials, MCP OAuth secrets, cloud tokens, and arbitrary Orbit
 * configuration are deliberately excluded. Callers may add narrowly scoped,
 * non-secret values through `extra`.
 */
export function buildSanitizedChildEnvironment(
  options: SanitizedChildEnvironmentOptions = {},
): NodeJS.ProcessEnv {
  const source = options.source ?? process.env;
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    const upperName = name.toUpperCase();
    if (
      value !== undefined &&
      !upperName.startsWith("ORBIT_") &&
      !SENSITIVE_CHILD_ENV_NAME.test(upperName) &&
      !SENSITIVE_CHILD_ENV_EXACT.has(upperName) &&
      !containsUrlCredential(upperName, value) &&
      (options.mode !== "minimal" ||
        SAFE_CHILD_ENV_NAMES.has(upperName) ||
        upperName.startsWith("LC_"))
    ) {
      environment[name] = value;
    }
  }
  for (const [name, value] of Object.entries(options.extra ?? {})) {
    if (value !== undefined) environment[name] = value;
  }
  environment.ORBIT_CHILD_PROCESS = "1";
  return environment;
}

/**
 * Preserve the caller's complete process environment for an explicitly
 * unrestricted child process. The returned object is detached from
 * `process.env`, so callers cannot mutate the parent environment accidentally.
 */
export function buildInheritedChildEnvironment(
  options: InheritedChildEnvironmentOptions = {},
): NodeJS.ProcessEnv {
  return {
    ...(options.source ?? process.env),
    ...options.extra,
    ORBIT_CHILD_PROCESS: "1",
  };
}
