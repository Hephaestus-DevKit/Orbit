import { execa } from "execa";
import { mkdtempSync, readFileSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { z } from "zod";
import {
  HIDDEN_CHILD_PROCESS_OPTIONS,
  redactSecrets,
} from "@orbit-build/shared";
import type { OrbitTool, ToolContext, ToolResult } from "../types.js";

const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
const SCREENSHOT_TIMEOUT_MS = 30_000;

export const ScreenshotCaptureInputSchema = z.object({
  display: z.string().trim().min(1).max(128).optional(),
});

export type ScreenshotCaptureInput = z.infer<
  typeof ScreenshotCaptureInputSchema
>;

export interface ScreenshotCaptureOutput {
  mediaType: "image/png";
  data: string;
  size: number;
  backend: string;
}

export class ScreenshotCaptureTool implements OrbitTool<
  ScreenshotCaptureInput,
  ScreenshotCaptureOutput
> {
  name = "capture_screenshot";
  description =
    "Capture the current desktop into a bounded PNG attachment using a detected native backend. This is a privacy-sensitive execute operation: it never uploads the image itself, does not accept arbitrary shell commands, and fails clearly when the host has no supported capture backend.";
  inputSchema = ScreenshotCaptureInputSchema;
  risk = "execute" as const;

  async execute(
    input: ScreenshotCaptureInput,
    ctx: ToolContext,
  ): Promise<ToolResult<ScreenshotCaptureOutput>> {
    const directory = mkdtempSync(join(tmpdir(), "orbit-screenshot-"));
    const output = join(directory, "capture.png");
    try {
      const result = await captureScreenshot({
        platform: process.platform,
        output,
        display: input.display,
        env: process.env,
        cwd: ctx.cwd,
        signal: ctx.abortSignal,
        timeoutMs: Math.min(
          ctx.config?.tools.bash.timeoutMs ?? SCREENSHOT_TIMEOUT_MS,
          SCREENSHOT_TIMEOUT_MS,
        ),
      });
      if (!result.ok) return { ok: false, error: result.error };
      const bytes = readFileSync(output);
      if (bytes.byteLength > MAX_SCREENSHOT_BYTES) {
        return {
          ok: false,
          error: `Screenshot exceeded the ${MAX_SCREENSHOT_BYTES / (1024 * 1024)} MiB attachment limit.`,
        };
      }
      const data = bytes.toString("base64");
      return {
        ok: true,
        data: {
          mediaType: "image/png",
          data,
          size: bytes.byteLength,
          backend: result.backend,
        },
        display: `Captured a ${bytes.byteLength}-byte PNG screenshot with ${result.backend}.`,
        metadata: {
          backend: result.backend,
          mediaType: "image/png",
          size: bytes.byteLength,
        },
      };
    } catch (error: unknown) {
      return {
        ok: false,
        error: redactSecrets(
          error instanceof Error ? error.message : String(error),
        ),
      };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}

export interface ScreenshotCaptureRequest {
  platform: NodeJS.Platform;
  output: string;
  display?: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
  signal?: AbortSignal;
  timeoutMs: number;
}

export async function captureScreenshot(
  request: ScreenshotCaptureRequest,
): Promise<{ ok: true; backend: string } | { ok: false; error: string }> {
  const command = resolveBackend(request);
  if (!command) {
    return {
      ok: false,
      error:
        "Screenshot capture dependency_missing: no supported native backend was detected (PowerShell/.NET, screencapture, gnome-screenshot, grim, or ImageMagick).",
    };
  }
  const result = await execa(command.file, command.args, {
    ...HIDDEN_CHILD_PROCESS_OPTIONS,
    cwd: request.cwd,
    env: sanitizedEnvironment(request.env),
    extendEnv: false,
    timeout: request.timeoutMs,
    signal: request.signal,
    reject: false,
    maxBuffer: 256 * 1024,
  });
  if (result.isCanceled || request.signal?.aborted) {
    return { ok: false, error: "Screenshot capture was canceled." };
  }
  if (result.failed || result.exitCode !== 0) {
    return {
      ok: false,
      error: `Screenshot backend ${command.backend} failed: ${redactSecrets(result.stderr || "unknown capture error").slice(0, 2_000)}`,
    };
  }
  const stats = statSync(request.output);
  if (!stats.isFile() || stats.size === 0) {
    return {
      ok: false,
      error: "Screenshot backend produced no regular PNG file.",
    };
  }
  return { ok: true, backend: command.backend };
}

interface ScreenshotCommand {
  backend: string;
  file: string;
  args: string[];
}

function resolveBackend(
  request: ScreenshotCaptureRequest,
): ScreenshotCommand | undefined {
  if (request.platform === "darwin") {
    const display = request.display ? ["-D", request.display] : [];
    return {
      backend: "macos-screencapture",
      file: request.env.ORBIT_SCREEN_CAPTURE_PATH ?? "/usr/sbin/screencapture",
      args: ["-x", "-t", "png", ...display, request.output],
    };
  }
  if (request.platform === "win32") {
    const powershell = request.env.ORBIT_POWERSHELL_PATH ?? "powershell.exe";
    const outputLiteral = request.output.replaceAll("'", "''");
    const script = [
      "param([string]$OutputPath)",
      "Add-Type -AssemblyName System.Windows.Forms",
      "Add-Type -AssemblyName System.Drawing",
      "$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen",
      "$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)",
      "$graphics = [System.Drawing.Graphics]::FromImage($bitmap)",
      "$graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)",
      `$bitmap.Save('${outputLiteral}', [System.Drawing.Imaging.ImageFormat]::Png)`,
      "$graphics.Dispose(); $bitmap.Dispose()",
    ].join("; ");
    return {
      backend: "windows-powershell-dotnet",
      file: powershell,
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        script,
        request.output,
      ],
    };
  }
  if (request.platform !== "linux") return undefined;
  if (request.env.ORBIT_GNOME_SCREENSHOT_PATH) {
    return {
      backend: "linux-gnome-screenshot",
      file: request.env.ORBIT_GNOME_SCREENSHOT_PATH,
      args: ["-f", request.output],
    };
  }
  if (request.env.ORBIT_GRIM_PATH) {
    return {
      backend: "linux-grim",
      file: request.env.ORBIT_GRIM_PATH,
      args: [request.output],
    };
  }
  if (request.env.ORBIT_IMPORT_PATH) {
    return {
      backend: "linux-imagemagick-import",
      file: request.env.ORBIT_IMPORT_PATH,
      args: ["-window", "root", request.output],
    };
  }
  return {
    backend: "linux-gnome-screenshot",
    file: "gnome-screenshot",
    args: ["-f", request.output],
  };
}

function sanitizedEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries({
      PATH: source.PATH,
      PATHEXT: source.PATHEXT,
      TEMP: source.TEMP,
      TMP: source.TMP,
      TMPDIR: source.TMPDIR,
      DISPLAY: source.DISPLAY,
      WAYLAND_DISPLAY: source.WAYLAND_DISPLAY,
      XDG_RUNTIME_DIR: source.XDG_RUNTIME_DIR,
      LANG: source.LANG,
      LC_ALL: source.LC_ALL,
      ORBIT_CHILD_PROCESS: "1",
    }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}
