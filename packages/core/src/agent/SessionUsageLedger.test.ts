import { describe, expect, it } from "../../../../scripts/testing/support.mjs";
import { SessionUsageLedger } from "./SessionUsageLedger.js";

describe("session usage ledger", () => {
  it("shares reservations and known charges across child sessions and restored run budgets", () => {
    const root = new SessionUsageLedger();
    const left = new SessionUsageLedger({ ledger: root, limit: 1 });
    const right = new SessionUsageLedger({ ledger: root, limit: 1 });
    left.reserve(0.7, 1);
    expect(() => right.reserve(0.4, 1)).toThrow("Insufficient");
    right.reserve(0.2, 1);
    left.release(0.7);
    left.recordModel(
      { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
      { inputCostPer1M: 1000, outputCostPer1M: 1000 },
    );
    expect(root.costUsd).toBeCloseTo(0.11);
    expect(right.remainingBudget(1)).toBeCloseTo(0.69);
    expect(root.inputTokens).toBe(100);
    expect(root.outputTokens).toBe(10);
    right.recordCharge(0, false);
    expect(root.costKnown).toBe(false);
    const restored = new SessionUsageLedger();
    restored.restore(root.snapshot());
    const next = new SessionUsageLedger({ ledger: restored, limit: 1 });
    expect(() => next.reserve(0.7, 1)).toThrow();
    expect(() => next.restore({ totalCostEstimate: 1 })).toThrow("owning run");
  });

  it("keeps in-flight reservations across crashes and releases only settled charges", () => {
    const ledger = new SessionUsageLedger();
    ledger.reserve(0.4, 1);
    ledger.reserve(0.5, 1);
    expect(() => ledger.reserve(0.2, 1)).toThrow();
    const resumed = new SessionUsageLedger();
    resumed.restore(ledger.snapshot());
    expect(resumed.remainingBudget(1)).toBeCloseTo(0.1);
    expect(resumed.costKnown).toBe(false);
    resumed.release(0.4);
    expect(resumed.pendingCostUsd).toBeCloseTo(0.5);
    expect(() => resumed.release(1)).toThrow();
  });

  it("enforces known charges after unknown usage, including after resume", () => {
    const ledger = new SessionUsageLedger();
    ledger.recordCharge(0, false);
    ledger.recordCharge(2, true);
    const resumed = new SessionUsageLedger();
    resumed.restore(JSON.parse(JSON.stringify(ledger.snapshot())));
    expect(resumed.costKnown).toBe(false);
    expect(resumed.costUsd).toBe(2);
    expect(resumed.reachesBudget(2)).toBe(true);
    resumed.recordCharge(1, true);
    expect(resumed.costUsd).toBe(3);
    resumed.restore();
    expect(resumed.costUsd).toBe(0);
    expect(resumed.costKnown).toBe(true);
  });

  it("bills cached tokens at input price unless a cache price is configured", () => {
    const ledger = new SessionUsageLedger();
    const usage = {
      inputTokens: 1000,
      cacheReadTokens: 500,
      outputTokens: 10,
      totalTokens: 1010,
    };
    expect(
      ledger.recordModel(usage, { inputCostPer1M: 2, outputCostPer1M: 10 }),
    ).toBeCloseTo(0.0021);
    expect(
      ledger.recordModel(usage, {
        inputCostPer1M: 2,
        outputCostPer1M: 10,
        cacheReadCostPer1M: 0,
      }),
    ).toBeCloseTo(0.0011);
    expect(ledger.inputTokens).toBe(2000);
    expect(ledger.cacheReadTokens).toBe(1000);
  });

  it("does not let malformed usage poison the ledger", () => {
    const ledger = new SessionUsageLedger();
    ledger.recordModel(
      {
        inputTokens: 10,
        outputTokens: NaN,
        cacheReadTokens: 100,
        totalTokens: 10,
      },
      undefined,
    );
    expect(ledger.snapshot()).toMatchObject({
      totalInputTokens: 10,
      totalOutputTokens: 0,
      totalCacheReadTokens: 10,
      costEstimateKnown: false,
    });
    for (const cost of [-1, NaN, Infinity])
      expect(() => ledger.recordCharge(cost, true)).toThrow();
    expect(ledger.costUsd).toBe(0);
  });
});
