import { execa } from "execa";
import { mkdirSync, rmSync, statSync } from "fs";
import { randomUUID } from "crypto";
import { dirname } from "path";
import { z } from "zod";
import {
  HIDDEN_CHILD_PROCESS_OPTIONS,
  redactSecrets,
  resolveSafePath,
} from "@orbit-build/shared";
import type { OrbitTool, ToolContext, ToolResult } from "../types.js";

const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const MAX_DURATION_SECONDS = 120;
const CAPTURE_TIMEOUT_MS = 150_000;

export const AudioCaptureInputSchema = z
  .object({
    durationSeconds: z.number().finite().min(1).max(MAX_DURATION_SECONDS),
    format: z.enum(["wav", "flac", "mp3"]).default("wav"),
    /** Required on Windows unless ORBIT_AUDIO_DEVICE is configured. */
    device: z.string().trim().min(1).max(256).optional(),
    outputPath: z.string().trim().min(1).max(4_096).optional(),
  })
  .strict();

export type AudioCaptureInput = z.input<typeof AudioCaptureInputSchema>;

export interface AudioCaptureOutput {
  path: string;
  mediaType: "audio/wav" | "audio/flac" | "audio/mpeg";
  format: "wav" | "flac" | "mp3";
  size: number;
  durationSeconds: number;
  backend: string;
}

export class AudioCaptureTool implements OrbitTool<
  AudioCaptureInput,
  AudioCaptureOutput
> {
  name = "capture_audio";
  description =
    "Record a bounded microphone clip through an explicitly detected native ffmpeg backend. This privacy-sensitive execute operation requires a user-approved duration, never uploads audio, and stores the result only inside the workspace.";
  inputSchema = AudioCaptureInputSchema;
  risk = "execute" as const;

  async execute(
    input: AudioCaptureInput,
    ctx: ToolContext,
  ): Promise<ToolResult<AudioCaptureOutput>> {
    const format = input.format ?? "wav";
    const relativeOutput =
      input.outputPath ??
      `.orbit/recordings/recording-${randomUUID()}.${format}`;
    let output: string;
    try {
      output = resolveSafePath(ctx.cwd, relativeOutput);
      mkdirSync(dirname(output), { recursive: true });
    } catch (error: unknown) {
      return {
        ok: false,
        error: redactSecrets(
          error instanceof Error ? error.message : String(error),
        ),
      };
    }
    const result = await captureAudio({
      platform: process.platform,
      output,
      format,
      durationSeconds: input.durationSeconds,
      device: input.device,
      cwd: ctx.cwd,
      env: process.env,
      signal: ctx.abortSignal,
      timeoutMs: Math.min(
        ctx.config?.tools.bash.timeoutMs ?? CAPTURE_TIMEOUT_MS,
        CAPTURE_TIMEOUT_MS,
      ),
    });
    if (!result.ok) return { ok: false, error: result.error };
    try {
      const stats = statSync(output);
      if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_AUDIO_BYTES) {
        rmSync(output, { force: true });
        return {
          ok: false,
          error: `Audio capture exceeded the ${MAX_AUDIO_BYTES / (1024 * 1024)} MiB attachment limit or produced no regular file.`,
        };
      }
      const mediaType =
        format === "wav"
          ? "audio/wav"
          : format === "flac"
            ? "audio/flac"
            : "audio/mpeg";
      return {
        ok: true,
        data: {
          path: output,
          mediaType,
          format,
          size: stats.size,
          durationSeconds: input.durationSeconds,
          backend: result.backend,
        },
        display: `Recorded ${input.durationSeconds.toFixed(1)} seconds of audio to ${output} with ${result.backend}.`,
        metadata: {
          backend: result.backend,
          format,
          size: stats.size,
          durationSeconds: input.durationSeconds,
        },
      };
    } catch (error: unknown) {
      return {
        ok: false,
        error: redactSecrets(
          error instanceof Error ? error.message : String(error),
        ),
      };
    }
  }
}

export interface AudioCaptureRequest {
  platform: NodeJS.Platform;
  output: string;
  format: "wav" | "flac" | "mp3";
  durationSeconds: number;
  device?: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs: number;
}

export async function captureAudio(
  request: AudioCaptureRequest,
): Promise<{ ok: true; backend: string } | { ok: false; error: string }> {
  const command = resolveAudioBackend(request);
  if (!command) {
    return {
      ok: false,
      error:
        "Audio capture dependency_missing: install ffmpeg and grant microphone permission, or configure ORBIT_FFMPEG_PATH.",
    };
  }
  try {
    const result = await execa(command.file, command.args, {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      cwd: request.cwd,
      env: sanitizedAudioEnvironment(request.env),
      extendEnv: false,
      timeout: request.timeoutMs,
      signal: request.signal,
      reject: false,
      maxBuffer: 256 * 1024,
    });
    if (result.isCanceled || request.signal?.aborted)
      return { ok: false, error: "Audio capture was canceled." };
    if (result.failed || result.exitCode !== 0) {
      return {
        ok: false,
        error: `Audio backend ${command.backend} failed: ${redactSecrets(result.stderr || "unknown capture error").slice(0, 2_000)}`,
      };
    }
    return { ok: true, backend: command.backend };
  } catch (error: unknown) {
    return {
      ok: false,
      error: redactSecrets(
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
}

interface AudioCommand {
  backend: string;
  file: string;
  args: string[];
}

function resolveAudioBackend(
  request: AudioCaptureRequest,
): AudioCommand | undefined {
  const ffmpeg = request.env.ORBIT_FFMPEG_PATH ?? "ffmpeg";
  const device = request.device ?? request.env.ORBIT_AUDIO_DEVICE;
  if (request.platform === "win32") {
    if (!device) return undefined;
    return {
      backend: "windows-ffmpeg-dshow",
      file: ffmpeg,
      args: [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "dshow",
        "-i",
        device,
        "-t",
        String(request.durationSeconds),
        ...encodeOutput(request),
      ],
    };
  }
  if (request.platform === "darwin") {
    return {
      backend: "macos-ffmpeg-avfoundation",
      file: ffmpeg,
      args: [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "avfoundation",
        "-i",
        device ?? ":0",
        "-t",
        String(request.durationSeconds),
        ...encodeOutput(request),
      ],
    };
  }
  if (request.platform === "linux") {
    return {
      backend: "linux-ffmpeg-pulse",
      file: ffmpeg,
      args: [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "pulse",
        "-i",
        device ?? "default",
        "-t",
        String(request.durationSeconds),
        ...encodeOutput(request),
      ],
    };
  }
  return undefined;
}

function encodeOutput(request: AudioCaptureRequest): string[] {
  const codec =
    request.format === "wav"
      ? ["-acodec", "pcm_s16le"]
      : request.format === "flac"
        ? ["-acodec", "flac"]
        : ["-codec:a", "libmp3lame", "-b:a", "128k"];
  return [...codec, "-y", request.output];
}

function sanitizedAudioEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries({
      PATH: source.PATH,
      PATHEXT: source.PATHEXT,
      TEMP: source.TEMP,
      TMP: source.TMP,
      TMPDIR: source.TMPDIR,
      LANG: source.LANG,
      LC_ALL: source.LC_ALL,
      ORBIT_FFMPEG_PATH: source.ORBIT_FFMPEG_PATH,
      ORBIT_CHILD_PROCESS: "1",
    }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}
