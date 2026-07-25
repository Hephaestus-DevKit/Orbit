import { spawn } from "child_process";
import type { WebUiHandle, WebUiOptions } from "./WebUiContracts.js";
import { OrbitWebUiRuntime } from "./WebUiRuntime.js";

export type {
  WebUiHandle,
  WebUiOptions,
  WebUiProjectAction,
  WebUiSettingsPatch,
} from "./WebUiContracts.js";

let activeRuntime: OrbitWebUiRuntime | undefined;

export function parseWebUiArgs(rawArgs: string): {
  port?: number;
  open: boolean;
} {
  const args = rawArgs
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  let port: number | undefined;
  let open = true;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--no-open") {
      open = false;
      continue;
    }
    if (arg === "--port") {
      const next = args[index + 1];
      if (/^\d+$/.test(next || "")) {
        const parsed = Number(next);
        if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535) {
          port = parsed;
        }
        index++;
      }
      continue;
    }
    const match = arg.match(/^--port=(\d+)$/);
    const rawPort = match?.[1] || (/^\d+$/.test(arg) ? arg : undefined);
    if (rawPort) {
      const parsed = Number(rawPort);
      if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535) {
        port = parsed;
      }
    }
  }

  return { port, open };
}

export async function openBrowser(url: string): Promise<boolean> {
  const { command, args } = resolveBrowserLaunch(url);
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    let settled = false;
    const finish = (opened: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(opened);
    };
    const timeout = setTimeout(() => finish(false), 2_000);
    child.once("spawn", () => finish(true));
    child.once("error", () => finish(false));
    child.unref();
  });
}

/** Resolve a shell-free browser launch command for the current platform. */
export function resolveBrowserLaunch(
  url: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  if (platform === "win32") {
    return { command: "explorer.exe", args: [url] };
  }
  return {
    command: platform === "darwin" ? "open" : "xdg-open",
    args: [url],
  };
}

/** Start or reuse the process-wide loopback Web UI runtime. */
export async function startOrbitWebUi(
  options: WebUiOptions,
): Promise<WebUiHandle> {
  const current = activeRuntime;
  if (current?.canReuse(options.port)) {
    current.updateOptions(options);
    const handle = current.getHandle();
    const browserOpened =
      options.open !== false ? await openBrowser(handle.url) : false;
    handle.browserOpened = browserOpened;
    return handle;
  }
  if (current?.hasActiveTurn) {
    throw new Error(
      "Wait for the active Web UI task to finish before restarting it.",
    );
  }
  if (current) {
    if (activeRuntime === current) activeRuntime = undefined;
    await current.stop();
  }

  const runtime = new OrbitWebUiRuntime(options);
  const handle = await runtime.start();
  activeRuntime = runtime;
  const browserOpened =
    options.open !== false ? await openBrowser(handle.url) : false;
  handle.browserOpened = browserOpened;
  return handle;
}

/** Stop the active runtime without affecting a subsequently started instance. */
export async function stopOrbitWebUi(): Promise<void> {
  const runtime = activeRuntime;
  if (activeRuntime === runtime) activeRuntime = undefined;
  await runtime?.stop();
}
