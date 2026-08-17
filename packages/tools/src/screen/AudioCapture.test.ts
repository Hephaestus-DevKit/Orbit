import { describe, expect, it } from "vitest";
import { captureAudio } from "./AudioCapture.js";

describe("AudioCapture", () => {
  it("fails closed on unsupported hosts and when Windows has no explicit device", async () => {
    const unsupported = await captureAudio({
      platform: "aix",
      output: "C:/missing/recording.wav",
      format: "wav",
      durationSeconds: 1,
      cwd: process.cwd(),
      env: {},
      timeoutMs: 1_000,
    });
    expect(unsupported.ok).toBe(false);
    expect(unsupported.error).toContain("dependency_missing");

    const noDevice = await captureAudio({
      platform: "win32",
      output: "C:/missing/recording.wav",
      format: "wav",
      durationSeconds: 1,
      cwd: process.cwd(),
      env: { ORBIT_FFMPEG_PATH: "C:/missing/ffmpeg.exe" },
      timeoutMs: 1_000,
    });
    expect(noDevice.ok).toBe(false);
    expect(noDevice.error).toContain("dependency_missing");
  });
});
