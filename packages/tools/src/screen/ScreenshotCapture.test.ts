import { describe, expect, it } from "vitest";
import { captureScreenshot } from "./ScreenshotCapture.js";

describe("ScreenshotCapture", () => {
  it("fails clearly on platforms without a supported native backend", async () => {
    const result = await captureScreenshot({
      platform: "aix",
      output: "C:/does-not-exist/capture.png",
      cwd: process.cwd(),
      env: {},
      timeoutMs: 1_000,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("dependency_missing");
  });

  it("uses an explicit Linux backend path without constructing a shell command", async () => {
    const result = await captureScreenshot({
      platform: "linux",
      output: "C:/does-not-exist/capture.png",
      cwd: process.cwd(),
      env: { ORBIT_GNOME_SCREENSHOT_PATH: "C:/missing/gnome-screenshot" },
      timeoutMs: 1_000,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("linux-gnome-screenshot");
  });
});
