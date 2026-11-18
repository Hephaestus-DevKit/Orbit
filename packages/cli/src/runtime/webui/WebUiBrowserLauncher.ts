import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { HIDDEN_CHILD_PROCESS_OPTIONS } from "@orbit-build/shared";
import { sanitizeLocalWebUiUrl } from "./WebUiSecurity.js";

const execFileAsync = promisify(execFile);
const LaunchUrlSchema = z
  .string()
  .max(2048)
  .transform(sanitizeLocalWebUiUrl)
  .pipe(z.string());

export interface WebUiBrowserLauncherOptions {
  platform?: NodeJS.Platform;
  execute?: (
    executable: string,
    args: string[],
    environment?: NodeJS.ProcessEnv,
  ) => Promise<void>;
}

/** Request a browser launch for an authenticated loopback URL, without a shell or credential logs. */
export async function openAuthenticatedWebUi(
  value: string,
  options: WebUiBrowserLauncherOptions = {},
): Promise<boolean> {
  const parsed = LaunchUrlSchema.safeParse(value);
  if (!parsed.success) return false;
  const platform = options.platform ?? process.platform;
  const execute = options.execute
    ?? (async (executable, args, environment) => {
      await execFileAsync(executable, args, {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        timeout: 5000,
        maxBuffer: 16 * 1024,
        ...(environment ? { env: environment } : {}),
      });
    });
  try {
    if (platform === "darwin") {
      await execute("/usr/bin/open", [parsed.data]);
    } else if (platform === "win32") {
      await execute(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Start-Process -FilePath $env:ORBIT_WEBUI_LAUNCH_URL",
        ],
        { ...process.env, ORBIT_WEBUI_LAUNCH_URL: parsed.data },
      );
    } else if (platform === "linux") {
      await execute("xdg-open", [parsed.data]);
    } else {
      return false;
    }
    return true;
  } catch {
    // Optional desktop launchers may be unavailable. Never surface their
    // error text: native process errors can include the authentication URL.
    return false;
  }
}
