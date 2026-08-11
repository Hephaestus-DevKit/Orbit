import { describe, expect, it } from "vitest";
import { buildReviewPrompt, parseReviewCommand } from "./ReviewCommand.js";

describe("ReviewCommand", () => {
  it("defaults to a comprehensive working-tree review", () => {
    expect(parseReviewCommand("")).toEqual({
      preset: "comprehensive",
      scope: { kind: "working-tree" },
    });
  });

  it("parses presets and bounded git scopes", () => {
    expect(parseReviewCommand("security")).toMatchObject({
      preset: "security",
      scope: { kind: "working-tree" },
    });
    expect(parseReviewCommand("branch origin/main performance")).toEqual({
      preset: "performance",
      scope: { kind: "branch", ref: "origin/main" },
    });
    expect(parseReviewCommand("commit HEAD~2 tests")).toEqual({
      preset: "tests",
      scope: { kind: "commit", ref: "HEAD~2" },
    });
  });

  it("rejects unsafe refs and bounds custom policy", () => {
    expect(() => parseReviewCommand("commit HEAD;calc")).toThrow(
      "standard Git ref",
    );
    expect(() => parseReviewCommand("security unexpected")).toThrow(
      "Too many /review arguments",
    );
    expect(() => parseReviewCommand("custom ")).toThrow(
      "Custom review instructions",
    );
  });

  it("builds a non-mutating evidence-first prompt", () => {
    const prompt = buildReviewPrompt(parseReviewCommand("security"));
    expect(prompt).toContain("dedicated security code review");
    expect(prompt).toContain("Report only actionable findings");
    expect(prompt).toContain("Do not modify files");
  });
});
