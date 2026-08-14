import { existsSync } from "fs";
import { win32 } from "path";

export interface CommandShellInvocation {
  file: string;
  args: string[];
  dialect: "powershell" | "bash" | "sh" | "cmd";
}

function firstExistingPath(
  candidates: Array<string | undefined>,
  pathExists: (candidate: string) => boolean = existsSync,
): string | null {
  for (const candidate of candidates) {
    if (candidate && pathExists(candidate)) return candidate;
  }
  return null;
}

export interface CommandShellResolutionOptions {
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  pathExists?: (candidate: string) => boolean;
}

/**
 * PowerShell parses a quoted executable path as a string unless it is invoked
 * with the call operator. Accept the portable `"C:\\...\\tool.exe" args`
 * form models and cross-platform scripts commonly emit.
 */
function normalizePowerShellCommand(command: string): string {
  const leadingWhitespace = command.match(/^\s*/)?.[0] ?? "";
  const trimmed = command.slice(leadingWhitespace.length);
  if (/^&(?:\s|$)/.test(trimmed)) return command;

  const quotedExecutable = trimmed.match(/^(["'])([^"']+)\1(?=\s|$)/);
  const executablePath = quotedExecutable?.[2];
  if (
    !executablePath ||
    (!/[\\/]/.test(executablePath) &&
      !/\.(?:exe|cmd|bat|com|ps1)$/i.test(executablePath))
  ) {
    return command;
  }
  return `${leadingWhitespace}& ${trimmed}`;
}

/**
 * Resolve the shell used by agent-authored commands.
 *
 * Use the operating system's native non-interactive shell. This keeps the
 * model-facing platform guidance and the actual executor in sync: PowerShell
 * on Windows, Bash (or POSIX sh) on macOS/Linux. A cmd fallback remains for
 * minimal Windows installations without PowerShell.
 */
export function resolveCommandShellInvocation(
  command: string,
  options: CommandShellResolutionOptions = {},
): CommandShellInvocation {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const pathExists = options.pathExists ?? existsSync;

  if (platform !== "win32") {
    const bash = firstExistingPath(
      [environment.ORBIT_BASH_PATH, "/bin/bash", "/usr/bin/bash"],
      pathExists,
    );
    if (bash) {
      return {
        file: bash,
        args: ["--noprofile", "--norc", "-c", command],
        dialect: "bash",
      };
    }
    return {
      file: "/bin/sh",
      args: ["-c", command],
      dialect: "sh",
    };
  }

  const systemRoot = environment.SystemRoot || environment.WINDIR;
  const powershell = firstExistingPath(
    [
      environment.ORBIT_POWERSHELL_PATH,
      environment.ProgramFiles
        ? win32.join(environment.ProgramFiles, "PowerShell", "7", "pwsh.exe")
        : undefined,
      environment.ProgramW6432
        ? win32.join(environment.ProgramW6432, "PowerShell", "7", "pwsh.exe")
        : undefined,
      systemRoot
        ? win32.join(
            systemRoot,
            "System32",
            "WindowsPowerShell",
            "v1.0",
            "powershell.exe",
          )
        : undefined,
    ],
    pathExists,
  );

  if (powershell) {
    const normalizedCommand = normalizePowerShellCommand(command);
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$global:LASTEXITCODE = 0",
      `& { ${normalizedCommand} }`,
      "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
    ].join("; ");
    return {
      file: powershell,
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      dialect: "powershell",
    };
  }

  return {
    file: environment.ComSpec?.trim() || "cmd.exe",
    args: ["/d", "/s", "/c", command],
    dialect: "cmd",
  };
}
