import { describe, expect, it } from "vitest";
import { inspectAccessibilityTree } from "./AccessibilityTree.js";

describe("AccessibilityTree", () => {
  it("fails clearly on unsupported hosts", async () => {
    const result = await inspectAccessibilityTree({
      platform: "aix",
      maxNodes: 10,
      cwd: process.cwd(),
      env: {},
      timeoutMs: 1_000,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("dependency_missing");
  });

  it("keeps a missing Windows backend explicit", async () => {
    const result = await inspectAccessibilityTree({
      platform: "win32",
      maxNodes: 10,
      cwd: process.cwd(),
      env: { ORBIT_POWERSHELL_PATH: "C:/missing/powershell.exe" },
      timeoutMs: 1_000,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("windows-uiautomation");
  });
});
