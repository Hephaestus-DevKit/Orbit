import { describe, expect, it } from "vitest";
import { resolveExternalToolUsage } from "./ExternalToolUsage.js";

describe("external tool usage", () => {
  const usage = {
    provider: "deepseek",
    operation: "search",
    successfulRequests: 1,
    estimatedCostUsd: 0.00075,
    pricingAsOf: "2026-11-16",
  };
  it("accounts for successful and empty results independently of model tokens", () => {
    expect(
      resolveExternalToolUsage("web_search", {
        ok: true,
        metadata: { externalUsage: usage },
      }),
    ).toMatchObject({ known: true, estimatedCostUsd: 0.00075 });
    expect(
      resolveExternalToolUsage("web_search", {
        ok: true,
        metadata: {
          externalUsage: {
            ...usage,
            successfulRequests: 0,
            estimatedCostUsd: 0,
          },
        },
      }),
    ).toMatchObject({ known: true, estimatedCostUsd: 0 });
  });
  it("does not accept malformed, mismatched or unbounded charges", () => {
    for (const change of [
      { estimatedCostUsd: -1 },
      { estimatedCostUsd: Infinity },
      { estimatedCostUsd: 0 },
      { successfulRequests: 10 },
      { operation: "fetch" },
    ]) {
      expect(
        resolveExternalToolUsage("web_search", {
          ok: true,
          metadata: { externalUsage: { ...usage, ...change } },
        }),
      ).toBeUndefined();
    }
    expect(
      resolveExternalToolUsage("custom_tool", {
        ok: true,
        metadata: { externalUsage: usage },
      }),
    ).toBeUndefined();
  });
  it("marks ambiguous dispatched failures as unknown", () => {
    expect(
      resolveExternalToolUsage("web_fetch", {
        ok: false,
        metadata: { externalUsageUnknown: true },
      }),
    ).toEqual({ known: false });
  });
});
