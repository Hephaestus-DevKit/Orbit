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
  open: false;
} {
  const args = rawArgs
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  let port: number | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
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

  return { port, open: false };
}

/** Start or reuse the process-wide loopback Web UI runtime. */
export async function startOrbitWebUi(
  options: WebUiOptions,
): Promise<WebUiHandle> {
  const current = activeRuntime;
  if (current?.canReuse(options.port)) {
    current.updateOptions(options);
    return current.getHandle();
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
  return handle;
}

/** Stop the active runtime without affecting a subsequently started instance. */
export async function stopOrbitWebUi(): Promise<void> {
  const runtime = activeRuntime;
  if (activeRuntime === runtime) activeRuntime = undefined;
  await runtime?.stop();
}
