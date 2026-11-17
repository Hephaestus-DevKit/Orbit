import type { OrbitConfig } from "@orbit-build/config";
import {
  isProviderError,
  projectModelInputTokens,
  type ModelChatInput,
  type ModelEvent,
  type ModelProvider,
  type TokenUsage,
} from "@orbit-build/model-providers";
import { AgentLoopExecutionError } from "./AgentRunOutcome.js";
import type { SessionUsageLedger } from "./SessionUsageLedger.js";

interface ModelRequestPolicy {
  ledger: SessionUsageLedger;
  budgetLimit: number;
  pricing: OrbitConfig["pricing"][string] | undefined;
  publishCost: (cost: number) => void;
}

/** One admission and accounting boundary for primary and auxiliary model calls. */
export async function* runAgentModelRequest(
  provider: Pick<ModelProvider, "chat" | "estimateImageTokens">,
  input: ModelChatInput,
  policy: ModelRequestPolicy,
): AsyncIterable<ModelEvent> {
  input.abortSignal?.throwIfAborted();
  const { ledger, pricing, budgetLimit, publishCost } = policy;
  const remaining = ledger.remainingBudget(budgetLimit);
  if (remaining <= 0) throw budgetExceeded();

  let maxTokens = input.maxTokens ?? 1024;
  let reservedCost = 0;
  if (pricing) {
    const inputTokens = projectModelInputTokens(input, provider);
    const inputCost = (inputTokens * pricing.inputCostPer1M) / 1_000_000;
    if (inputCost >= remaining) throw budgetExceeded();
    if (pricing.outputCostPer1M > 0)
      maxTokens = Math.min(
        maxTokens,
        Math.floor(
          ((remaining - inputCost) * 1_000_000) / pricing.outputCostPer1M,
        ),
      );
    if (maxTokens < 1) throw budgetExceeded();
    reservedCost =
      inputCost + (maxTokens * pricing.outputCostPer1M) / 1_000_000;
    // A single synchronous reserve closes the gap between concurrent admissions.
    ledger.reserve(Math.min(remaining, reservedCost), budgetLimit);
    reservedCost = Math.min(remaining, reservedCost);
    publishCost(0);
  }

  let usage: TokenUsage | undefined;
  let definitelyRejected = false;
  try {
    // The owning harness decides whether another request is safe to retry.
    for await (const event of provider.chat({
      ...input,
      maxTokens,
      retryBudget: 0,
    })) {
      if (event.type === "usage") usage = event.usage;
      if (event.type === "error") throw event.error;
      yield event;
    }
  } catch (error: unknown) {
    definitelyRejected =
      isProviderError(error) &&
      !error.partialOutput &&
      [
        "AUTH",
        "QUOTA",
        "RATE_LIMIT",
        "INVALID_REQUEST",
        "CONTEXT_WINDOW_EXCEEDED",
      ].includes(error.code);
    throw error;
  } finally {
    // On cancellation, transport loss, or missing usage, a remote charge may
    // still exist. Keep the durable hold instead of granting that budget again.
    if (usage || definitelyRejected) ledger.release(reservedCost);
    const cost = usage
      ? ledger.recordModel(usage, pricing)
      : definitelyRejected
        ? 0
        : ledger.recordCharge(0, false);
    publishCost(cost);
  }
}

function budgetExceeded(): AgentLoopExecutionError {
  return new AgentLoopExecutionError(
    "budget_exceeded",
    "The remaining session budget cannot cover this model request, including pending charges.",
  );
}
