import { afterEach, describe, expect, it, vi } from "vitest";
import { Renderer } from "./Renderer.js";

describe("Renderer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats thought blocks without writing to stdout", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const output = Renderer.formatThought("first line\nsecond line");

    expect(output).toContain("Orbit Agent Thinking:");
    expect(output).toContain("🧠");
    expect(output).toContain("first line");
    expect(output).toContain("second line");
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("returns an empty string for blank thoughts", () => {
    expect(Renderer.formatThought("  \n ")).toBe("");
  });

  it("preserves the familiar direct-mode header", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    Renderer.printHeader(
      "session-123",
      "deepseek-flash",
      "/workspace",
      "0.1.3",
    );

    const output = consoleSpy.mock.calls.flat().join("\n");
    expect(output).toContain("⚡ Orbit AI Coding Runtime");
    expect(output).toContain("🤖");
    expect(output).toContain("📁");
  });
});
