import { describe, expect, it } from "vitest";
import {
  buildToolResultContent,
  TOOL_STATUS_MAX_CHARS,
} from "./ToolResultContent.js";

describe("tool result content", () => {
  it("redacts and bounds failed tool output", () => {
    const content = buildToolResultContent("bash", {
      ok: false,
      error: `API_KEY=secret-value ${"x".repeat(3_000)}`,
    });

    expect(content).not.toContain("secret-value");
    expect(content.length).toBeLessThanOrEqual(TOOL_STATUS_MAX_CHARS);
    expect(content).toContain("truncated for context budget");
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
