import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, ModelPriceSchema } from "@orbit-build/config";
import { resolveScheduledModelPrice } from "./ModelPricing.js";

describe("model pricing schedules", () => {
  const price = DEFAULT_CONFIG.pricing["deepseek-flash"];
  it.each([
    ["2026-09-21T00:59:59Z", false],
    ["2026-09-21T01:00:00Z", true],
    ["2026-09-21T03:59:59Z", true],
    ["2026-09-21T04:00:00Z", false],
    ["2026-09-21T06:00:00Z", true],
    ["2026-09-21T10:00:00Z", false],
    ["2026-09-19T02:00:00Z", false],
    ["2026-09-20T07:00:00Z", false],
  ] as const)("uses the correct UTC tariff at %s", (timestamp, peak) => {
    expect(resolveScheduledModelPrice(price, new Date(timestamp))).toEqual(
      peak ? price.scheduled!.peak : price.scheduled!.offPeak,
    );
  });
  it("preserves pre-effective and unscheduled rates", () => {
    expect(
      resolveScheduledModelPrice(price, new Date("2026-09-18T02:00:00Z")),
    ).toBe(price);
    const rate = { inputCostPer1M: 1, outputCostPer1M: 2 };
    expect(resolveScheduledModelPrice(rate)).toBe(rate);
  });
  it("preserves daily custom schedules when weekdays are omitted", () => {
    const daily = {
      ...price,
      scheduled: { ...price.scheduled!, peakDaysUtc: undefined },
    };
    expect(
      resolveScheduledModelPrice(daily, new Date("2026-09-19T02:00:00Z")),
    ).toEqual(price.scheduled!.peak);
  });
  it("validates external weekday boundaries", () => {
    for (const peakDaysUtc of [[-1], [7], [1.5], Array(8).fill(1)]) {
      expect(
        ModelPriceSchema.safeParse({
          ...price,
          scheduled: { ...price.scheduled, peakDaysUtc },
        }).success,
      ).toBe(false);
    }
  });
});
