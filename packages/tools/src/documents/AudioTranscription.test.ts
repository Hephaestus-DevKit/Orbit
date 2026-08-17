import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioTranscriptionTool } from "./AudioTranscription.js";

describe("AudioTranscriptionTool", () => {
  const roots: string[] = [];
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const root of roots.splice(0))
      rmSync(root, { recursive: true, force: true });
  });

  it("reports an explicit local dependency failure", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-transcription-"));
    roots.push(cwd);
    writeFileSync(join(cwd, "voice.wav"), Buffer.from("RIFFfake"));
    vi.stubEnv("ORBIT_WHISPER_PATH", "C:/missing/whisper.exe");
    const result = await new AudioTranscriptionTool().execute(
      { path: "voice.wav" },
      { cwd, sessionId: "test" },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Whisper");
  });

  it("rejects unsupported formats before invoking a backend", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-transcription-"));
    roots.push(cwd);
    writeFileSync(join(cwd, "notes.txt"), "hello");
    const result = await new AudioTranscriptionTool().execute(
      { path: "notes.txt" },
      { cwd, sessionId: "test" },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unsupported audio format");
  });
});
