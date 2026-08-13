import { describe, expect, it } from "vitest";
import {
  buildCommitDiffForModel,
  normalizeCommitMessage,
} from "./CommitSafety.js";

describe("commit safety", () => {
  it("redacts tokens and omits protected file bodies", () => {
    const safe = buildCommitDiffForModel(
      "diff --git a/src/a.ts b/src/a.ts\n+Authorization: Bearer private-token\n" +
        "diff --git a/.env b/.env\n+DEEPSEEK_API_KEY=opaque-private-value",
    );
    expect(safe).not.toContain("private-token");
    expect(safe).not.toContain("opaque-private-value");
    expect(safe).toContain("omitted protected file contents");
  });

  it("returns one bounded conventional subject", () => {
    expect(normalizeCommitMessage("Add feature\nwith details")).toBe(
      "chore: Add feature with details",
    );
    expect(normalizeCommitMessage("feat(cli): improve output")).toBe(
      "feat(cli): improve output",
    );
  });
});
