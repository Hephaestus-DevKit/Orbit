import { describe, expect, it, mockTools as vi } from "../../../../scripts/testing/support.mjs";
import { DEFAULT_CONFIG } from "@orbit-build/config";
import type { ToolResult } from "@orbit-build/tools";
import { runAgentToolRequest } from "./AgentToolRequest.js";
import { SessionUsageLedger } from "./SessionUsageLedger.js";

const call = {
  id: "search",
  name: "web_search",
  arguments: '{"query":"test"}',
};
const receipt: ToolResult = {
  ok: true,
  metadata: {
    externalUsage: {
      provider: "deepseek",
      operation: "search",
      successfulRequests: 1,
      estimatedCostUsd: 0.00075,
      pricingAsOf: "2026-11-16",
    },
  },
};
function policy() {
  const config = structuredClone(DEFAULT_CONFIG);
  config.tools.webSearch.provider = "deepseek";
  config.budgetLimit = 0.001;
  return {
    config,
    ledger: new SessionUsageLedger(),
    publishCost: vi.fn(),
    recordUsage: vi.fn(),
  };
}
describe("paid tool admission", () => {
  it("reserves before execution and settles the receipt exactly once", async () => {
    const p = policy();
    const runner = {
      run: vi.fn(async () => {
        expect(p.ledger.pendingCostUsd).toBe(0.00075);
        expect(p.publishCost).toHaveBeenCalledWith(0);
        return receipt;
      }),
    };
    await runAgentToolRequest(runner, call, p);
    expect(p.ledger.costUsd).toBe(0.00075);
    expect(p.ledger.pendingCostUsd).toBe(0);
    await expect(runAgentToolRequest(runner, call, p)).rejects.toMatchObject({
      code: "budget_exceeded",
    });
    expect(runner.run).toHaveBeenCalledOnce();
  });
  it("prevents concurrent paid tools from reusing the same money", async () => {
    const p = policy();
    let finish!: (result: ToolResult) => void;
    const runner = {
      run: vi.fn(
        () =>
          new Promise<ToolResult>((resolve) => {
            finish = resolve;
          }),
      ),
    };
    const running = runAgentToolRequest(runner, call, p);
    await expect(
      runAgentToolRequest(runner, { ...call, id: "second" }, p),
    ).rejects.toMatchObject({ code: "budget_exceeded" });
    finish(receipt);
    await running;
    expect(p.ledger.costUsd).toBe(0.00075);
  });
  it("retains ambiguous holds and releases pre-dispatch failures", async () => {
    const ambiguous = policy();
    await runAgentToolRequest(
      {
        run: async () => ({
          ok: false,
          metadata: { externalUsageUnknown: true },
        }),
      },
      call,
      ambiguous,
    );
    expect(ambiguous.ledger.pendingCostUsd).toBe(0.00075);
    expect(ambiguous.ledger.costKnown).toBe(false);
    const invalid = policy();
    await runAgentToolRequest(
      { run: async () => ({ ok: false, error: "Invalid input" }) },
      call,
      invalid,
    );
    expect(invalid.ledger.pendingCostUsd).toBe(0);
    expect(invalid.ledger.costKnown).toBe(true);
  });
  it("does not reserve or dispatch already cancelled work", async () => {
    const p = policy();
    const runner = { run: vi.fn() };
    await expect(
      runAgentToolRequest(runner, call, {
        ...p,
        abortSignal: AbortSignal.abort(),
      }),
    ).rejects.toThrow();
    expect(runner.run).not.toHaveBeenCalled();
    expect(p.ledger.pendingCostUsd).toBe(0);
  });
});
