import { existsSync } from "fs";
import { join } from "path";

export interface CommandShellInvocation {
  file: string;
  args: string[];
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
 * Resolve the shell used by agent-authored commands.
 *
 * The public tool is named `bash`, so Windows must not silently pass Bash
 * syntax to `cmd.exe`. Prefer Git Bash when available and retain a safe cmd
 * fallback for minimal Windows installations.
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
      };
    }
    return {
      file: "/bin/sh",
      args: ["-c", command],
    };
  }

  const bash = firstExistingPath(
    [
      environment.ORBIT_BASH_PATH,
      environment.ProgramFiles
        ? join(environment.ProgramFiles, "Git", "bin", "bash.exe")
        : undefined,
      environment["ProgramFiles(x86)"]
        ? join(environment["ProgramFiles(x86)"], "Git", "bin", "bash.exe")
        : undefined,
      environment.LOCALAPPDATA
        ? join(environment.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe")
        : undefined,
      environment.LOCALAPPDATA
        ? join(environment.LOCALAPPDATA, "hermes", "git", "bin", "bash.exe")
        : undefined,
    ],
    pathExists,
  );

  if (bash) {
    return {
      file: bash,
      args: ["--noprofile", "--norc", "-lc", command],
    };
  }

  return {
    file: environment.ComSpec?.trim() || "cmd.exe",
    args: ["/d", "/s", "/c", command],
  };
}
