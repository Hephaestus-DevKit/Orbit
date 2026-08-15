import { describe, expect, it } from "vitest";
import {
  buildToolResultContent,
  TOOL_ERROR_MAX_CHARS,
} from "./ToolResultContent.js";

describe("tool result content", () => {
  it("redacts and bounds failed tool output", () => {
    const content = buildToolResultContent("bash", {
      ok: false,
      error: `API_KEY=secret-value ${"x".repeat(12_000)}`,
    });

    expect(content).not.toContain("secret-value");
    expect(content.length).toBeLessThanOrEqual(TOOL_ERROR_MAX_CHARS);
    expect(content).toContain("truncated for context budget");
  });

  it("keeps bounded stdout and stderr with a failed command", () => {
    const content = buildToolResultContent("bash", {
      ok: false,
      error: "Command exited with non-zero status 1.",
      display:
        "Stdout:\npreflight started\n\nStderr:\nAssertionError: expected 2, got 3\n\nExit code: 1",
    });

    expect(content).toContain("non-zero status 1");
    expect(content).toContain("preflight started");
    expect(content).toContain("AssertionError: expected 2, got 3");
    expect(content).toContain("Exit code: 1");
  });

  it("keeps links while compacting structured search results", () => {
    const content = buildToolResultContent("web_search", {
      ok: true,
      data: [
        "[1] Title: Orbit release",
        "Link: https://example.com/release",
        "Summary: Verified release evidence.",
      ].join("\n"),
      display: "release query",
    });

    expect(content).toContain("web_search result: release query");
    expect(content).toContain("https://example.com/release");
    expect(content).toContain("Results kept for reasoning: 1/1");
  });
});
