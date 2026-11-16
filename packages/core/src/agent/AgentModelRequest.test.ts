import { describe, expect, it, vi } from "vitest";
import {
  ProviderError,
  type ModelChatInput,
  type ModelEvent,
} from "@orbit-build/model-providers";
import { SessionUsageLedger } from "./SessionUsageLedger.js";
import { runAgentModelRequest } from "./AgentModelRequest.js";

const input: ModelChatInput = {
  model: "fixture",
  messages: [],
  maxTokens: 1000,
};
const usage = { inputTokens: 100, outputTokens: 20, totalTokens: 120 };
const pricing = { inputCostPer1M: 1, outputCostPer1M: 10 };
const consume = async (stream: AsyncIterable<ModelEvent>) => {
  for await (const event of stream) {
    void event;
  }
};
function policy(budgetLimit = 1) {
  return {
    ledger: new SessionUsageLedger(),
    pricing,
    budgetLimit,
    publishCost: vi.fn(),
  };
}

describe("model request admission", () => {
  it("caps output before dispatch, reserves durably, and settles cumulative usage once", async () => {
    const state = policy(0.003);
    const snapshots: ReturnType<SessionUsageLedger["snapshot"]>[] = [];
    state.publishCost.mockImplementation(() => {
      snapshots.push(state.ledger.snapshot());
    });
    const chat = vi.fn(async function* (
      request: ModelChatInput,
    ): AsyncIterable<ModelEvent> {
      expect(request.maxTokens).toBeLessThan(1000);
      expect(request.retryBudget).toBe(0);
      expect(state.ledger.pendingCostUsd).toBeGreaterThan(0);
      yield { type: "usage", usage: { ...usage, outputTokens: 10 } };
      yield { type: "usage", usage };
      yield { type: "done" };
    });
    await consume(runAgentModelRequest({ chat }, input, state));
    expect(state.ledger.snapshot()).toMatchObject({
      totalInputTokens: 100,
      totalOutputTokens: 20,
      pendingCostEstimate: 0,
      costEstimateKnown: true,
    });
    expect(state.ledger.costUsd).toBeCloseTo(0.0003);
    expect(snapshots[0].pendingCostEstimate).toBeGreaterThan(0);
    expect(snapshots.at(-1)?.pendingCostEstimate).toBe(0);
  });

  it("prevents concurrent requests from reusing an outstanding reservation", async () => {
    const state = policy(0.003);
    let finish!: () => void;
    const wait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const chat = vi.fn(async function* (): AsyncIterable<ModelEvent> {
      await wait;
      yield { type: "usage", usage };
    });
    const first = consume(runAgentModelRequest({ chat }, input, state));
    await expect(
      consume(runAgentModelRequest({ chat }, input, state)),
    ).rejects.toMatchObject({ code: "budget_exceeded" });
    finish();
    await first;
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("retains ambiguous charges after interruption and session restoration", async () => {
    const state = policy();
    const chat = async function* (): AsyncIterable<ModelEvent> {
      yield { type: "text_delta", text: "partial" };
      throw new ProviderError("TRANSPORT", "lost connection");
    };
    await expect(
      consume(runAgentModelRequest({ chat }, input, state)),
    ).rejects.toThrow("lost connection");
    const restored = new SessionUsageLedger();
    restored.restore(JSON.parse(JSON.stringify(state.ledger.snapshot())));
    expect(restored.pendingCostUsd).toBeGreaterThan(0);
    expect(restored.costKnown).toBe(false);
    expect(restored.remainingBudget(1)).toBeLessThan(1);
  });

  it("releases definitely rejected requests and never dispatches an already cancelled request", async () => {
    const state = policy();
    const chat = vi.fn(async function* (): AsyncIterable<ModelEvent> {
      yield { type: "error", error: new ProviderError("RATE_LIMIT", "busy") };
    });
    await expect(
      consume(runAgentModelRequest({ chat }, input, state)),
    ).rejects.toThrow("busy");
    expect(state.ledger.pendingCostUsd).toBe(0);
    expect(state.ledger.costKnown).toBe(true);
    const controller = new AbortController();
    controller.abort();
    await expect(
      consume(
        runAgentModelRequest(
          { chat },
          { ...input, abortSignal: controller.signal },
          state,
        ),
      ),
    ).rejects.toThrow();
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("accounts received usage even when the consumer stops reading early", async () => {
    const state = policy();
    const chat = async function* (): AsyncIterable<ModelEvent> {
      yield { type: "usage", usage };
      yield { type: "done" };
    };
    for await (const event of runAgentModelRequest({ chat }, input, state)) {
      expect(event.type).toBe("usage");
      break;
    }
    expect(state.ledger.outputTokens).toBe(20);
    expect(state.ledger.pendingCostUsd).toBe(0);
  });

  it("blocks auxiliary requests even without known prices once the budget is exhausted", async () => {
    const state = { ...policy(), pricing: undefined };
    state.ledger.recordCharge(1, true);
    const chat = vi.fn(async function* (): AsyncIterable<ModelEvent> {
      yield { type: "done" };
    });
    await expect(
      consume(runAgentModelRequest({ chat }, input, state)),
    ).rejects.toMatchObject({ code: "budget_exceeded" });
    expect(chat).not.toHaveBeenCalled();
  });
});
