import { execa } from "execa";
import { lstatSync, mkdtempSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { basename, extname, join } from "path";
import { z } from "zod";
import {
  HIDDEN_CHILD_PROCESS_OPTIONS,
  readBoundedRegularFile,
  redactSecrets,
} from "@orbit-build/shared";
import type { OrbitTool, ToolContext, ToolResult } from "../types.js";
import { resolveReadableFile } from "../fs/skillPaths.js";
import { hasFullHostAccess } from "../fs/toolPaths.js";

const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARS = 160_000;
const TRANSCRIPTION_TIMEOUT_MS = 10 * 60_000;

export const AudioTranscriptionInputSchema = z
  .object({
    path: z.string().trim().min(1).max(4_096),
    language: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{1,32}$/)
      .optional(),
    maxChars: z.number().int().min(1_000).max(MAX_TRANSCRIPT_CHARS).optional(),
  })
  .strict();
export type AudioTranscriptionInput = z.infer<
  typeof AudioTranscriptionInputSchema
>;

export interface AudioTranscriptionOutput {
  path: string;
  text: string;
  truncated: boolean;
  backend: string;
  language?: string;
}

/** Transcribe a local audio file through a bounded, explicitly local Whisper CLI. */
export class AudioTranscriptionTool implements OrbitTool<
  AudioTranscriptionInput,
  AudioTranscriptionOutput
> {
  name = "transcribe_audio";
  description =
    "Transcribe a workspace-local audio file through an installed Whisper CLI. Input, output, timeout, and transcript size are bounded; audio is never uploaded by Orbit and missing Whisper dependencies return an actionable failure.";
  inputSchema = AudioTranscriptionInputSchema;
  risk = "execute" as const;

  async execute(
    input: AudioTranscriptionInput,
    ctx: ToolContext,
  ): Promise<ToolResult<AudioTranscriptionOutput>> {
    try {
      const path = resolveReadableFile(ctx, input.path);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() && !hasFullHostAccess(ctx))
        throw new Error(
          "Audio transcription rejects symbolic links in normal mode.",
        );
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_AUDIO_BYTES)
        throw new Error(
          "Audio file is missing, not regular, or exceeds the 64 MiB limit.",
        );
      const extension = extname(path).toLowerCase();
      if (
        ![".wav", ".mp3", ".flac", ".m4a", ".ogg", ".opus"].includes(extension)
      )
        throw new Error(
          "Unsupported audio format; use WAV, MP3, FLAC, M4A, OGG, or Opus.",
        );
      const directory = mkdtempSync(join(tmpdir(), "orbit-whisper-"));
      try {
        const result = await runWhisper({
          path,
          outputDirectory: directory,
          language: input.language,
          cwd: ctx.cwd,
          signal: ctx.abortSignal,
          timeoutMs: Math.min(
            ctx.config?.tools.bash.timeoutMs ?? TRANSCRIPTION_TIMEOUT_MS,
            TRANSCRIPTION_TIMEOUT_MS,
          ),
        });
        if (!result.ok) return { ok: false, error: result.error };
        const maxChars = input.maxChars ?? MAX_TRANSCRIPT_CHARS;
        const truncated = result.text.length > maxChars;
        const text = truncated
          ? `${result.text.slice(0, maxChars - 40)}\n… [transcript truncated]`
          : result.text;
        return {
          ok: true,
          data: {
            path: input.path,
            text,
            truncated,
            backend: result.backend,
            ...(input.language ? { language: input.language } : {}),
          },
          display: `Transcribed ${basename(input.path)} with ${result.backend}${truncated ? "; transcript truncated" : ""}.`,
          metadata: { backend: result.backend, chars: text.length, truncated },
        };
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
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

interface WhisperRequest {
  path: string;
  outputDirectory: string;
  language?: string;
  cwd: string;
  signal?: AbortSignal;
  timeoutMs: number;
}

async function runWhisper(
  request: WhisperRequest,
): Promise<
  { ok: true; text: string; backend: string } | { ok: false; error: string }
> {
  const command = request.language
    ? [
        request.path,
        "--output_format",
        "txt",
        "--output_dir",
        request.outputDirectory,
        "--task",
        "transcribe",
        "--language",
        request.language,
      ]
    : [
        request.path,
        "--output_format",
        "txt",
        "--output_dir",
        request.outputDirectory,
        "--task",
        "transcribe",
      ];
  try {
    const result = await execa(
      process.env.ORBIT_WHISPER_PATH ?? "whisper",
      command,
      {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        cwd: request.cwd,
        env: sanitizedEnvironment(),
        extendEnv: false,
        timeout: request.timeoutMs,
        signal: request.signal,
        reject: false,
        maxBuffer: 512 * 1024,
      },
    );
    if (result.isCanceled || request.signal?.aborted)
      return { ok: false, error: "Audio transcription was canceled." };
    if (result.failed || result.exitCode !== 0)
      return {
        ok: false,
        error: `Whisper dependency_missing or failed: ${redactSecrets(result.stderr || "install Whisper or configure ORBIT_WHISPER_PATH").slice(0, 2_000)}`,
      };
    const output = readdirSync(request.outputDirectory).find((entry) =>
      entry.toLowerCase().endsWith(".txt"),
    );
    if (!output)
      return {
        ok: false,
        error: "Whisper produced no bounded text transcript.",
      };
    const text = readBoundedRegularFile(
      join(request.outputDirectory, output),
      MAX_TRANSCRIPT_CHARS,
    );
    if (text === undefined)
      return { ok: false, error: "Whisper transcript was not a regular file." };
    return {
      ok: true,
      text: text.replaceAll("\u0000", "").trim(),
      backend: "whisper-cli",
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

function sanitizedEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries({
      PATH: process.env.PATH,
      PATHEXT: process.env.PATHEXT,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      TMPDIR: process.env.TMPDIR,
      LANG: process.env.LANG,
      LC_ALL: process.env.LC_ALL,
      ORBIT_CHILD_PROCESS: "1",
    }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}
