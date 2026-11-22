import { execFile } from "node:child_process";
import { release } from "node:os";
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
  ) => Promise<void>;
}

/** A local Aqua session on macOS 14+ can run the packaged WebKit host. */
export function supportsOrbitBrowser(
  platform = process.platform,
  kernel = release(),
  env = process.env,
): boolean {
  return platform === "darwin" && Number.parseInt(kernel, 10) >= 23
    && !(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY);
}

/** Request a browser launch for an authenticated loopback URL, without a shell or credential logs. */
export async function openAuthenticatedWebUi(
  value: string,
  options: WebUiBrowserLauncherOptions = {},
): Promise<boolean> {
  const parsed = LaunchUrlSchema.safeParse(value);
  if (!parsed.success) return false;
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") return false;
  const execute = options.execute
    ?? (async (executable, args) => {
      await execFileAsync(executable, args, {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        timeout: 5000,
        maxBuffer: 16 * 1024,
      });
    });
  try {
    await execute("/usr/bin/open", ["-b", "com.apple.Safari", parsed.data]);
    return true;
  } catch {
    // Optional desktop launchers may be unavailable. Never surface their
    // error text: native process errors can include the authentication URL.
    return false;
  }
}
