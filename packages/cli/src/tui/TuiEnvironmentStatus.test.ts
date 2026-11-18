import { describe, expect, it } from "../../../../scripts/testing/support.mjs";
import { TuiEnvironmentStatus } from "./TuiEnvironmentStatus.js";

describe("TuiEnvironmentStatus", () => {
  it("owns model, mode, attempt and usage without mutating old snapshots", () => {
    const status = new TuiEnvironmentStatus();
    const initial = status.snapshot();

    status.setPermissionsMode("strict");
    status.setActiveModelName("deepseek-v4-pro");
    status.setAttempt(2);
    status.setUsage(0.25, 10_000, 6_000, 1_000);

    expect(initial.permissionsMode).toBe("normal");
    expect(status.snapshot()).toMatchObject({
      permissionsMode: "strict",
      activeModelName: "deepseek-v4-pro",
      currentAttempt: 2,
      sessionCost: 0.25,
      totalInputTokens: 10_000,
      totalCacheReadTokens: 6_000,
      totalOutputTokens: 1_000,
    });
  });

  it("stores provider cache telemetry as a separate measured source", () => {
    const status = new TuiEnvironmentStatus();
    status.setCacheTelemetry({
      slabHash: "abc123",
      slabTokenEstimate: 100,
      hitTokens: 80,
      missTokens: 20,
      inputTokens: 100,
      hitRate: 0.8,
      degraded: false,
    });

    expect(status.snapshot().cacheTelemetry?.hitRate).toBe(0.8);
  });
});
