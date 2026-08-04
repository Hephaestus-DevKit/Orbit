import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@orbit-build/config";
import { resolveAgentTeam } from "./AgentTeamPresets.js";

describe("resolveAgentTeam", () => {
  it("keeps the default team balanced and provider-neutral", () => {
    expect(resolveAgentTeam(DEFAULT_CONFIG)).toMatchObject({
      preset: "balanced",
      maxAttempts: 3,
      maxReviewConcurrency: 2,
      reviewers: [
        { perspective: "correctness", canRunCommands: true },
        { perspective: "security", canRunCommands: false },
      ],
    });
  });

  it("bounds concurrency by the selected reusable preset", () => {
    const fast = resolveAgentTeam({
      ...DEFAULT_CONFIG,
      agent: {
        ...DEFAULT_CONFIG.agent,
        teamPreset: "fast",
        maxReviewConcurrency: 8,
      },
    });
    expect(fast.reviewers).toHaveLength(1);
    expect(fast.maxReviewConcurrency).toBe(1);

    const thorough = resolveAgentTeam({
      ...DEFAULT_CONFIG,
      agent: {
        ...DEFAULT_CONFIG.agent,
        teamPreset: "thorough",
        maxReviewConcurrency: 3,
        maxReviewAttempts: 2,
      },
    });
    expect(thorough.reviewers.map(({ perspective }) => perspective)).toEqual([
      "correctness",
      "security",
      "testing",
      "performance",
    ]);
    expect(thorough.maxReviewConcurrency).toBe(3);
    expect(thorough.maxAttempts).toBe(2);
  });
});
