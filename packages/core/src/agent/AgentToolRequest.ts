import type { OrbitConfig } from "@orbit-build/config";
import type { OrbitToolCall } from "@orbit-build/model-providers";
import type { OrbitTool, ToolResult } from "@orbit-build/tools";
import { DEEPSEEK_WEB_REQUEST_COST_USD } from "@orbit-build/tools";
import { AgentLoopExecutionError } from "./AgentRunOutcome.js";
import { resolveExternalToolUsage } from "./ExternalToolUsage.js";
import type { SessionUsageLedger } from "./SessionUsageLedger.js";
import type { StepRunner } from "./StepRunner.js";

/** Admit and settle paid built-in tools before returning control to hooks or another call. */
export async function runAgentToolRequest(
  runner: Pick<StepRunner, "run">,
  call: OrbitToolCall,
  options: {
    config: OrbitConfig;
    ledger: SessionUsageLedger;
    publishCost: (cost: number) => void;
    recordUsage: (
      usage: NonNullable<ReturnType<typeof resolveExternalToolUsage>>,
    ) => void;
    abortSignal?: AbortSignal;
    admittedTool?: OrbitTool;
  },
): Promise<ToolResult> {
  const { config, ledger, publishCost } = options;
  options.abortSignal?.throwIfAborted();
  const paid = call.name === "web_search"
    ? (process.env.ORBIT_WEB_SEARCH_PROVIDER
      || config.tools.webSearch.provider) === "deepseek"
    : call.name === "web_fetch"
      && config.tools.webSearch.fetchProvider === "deepseek";
  const reserve = paid ? DEEPSEEK_WEB_REQUEST_COST_USD : 0;
  if (reserve > ledger.remainingBudget(config.budgetLimit))
    throw new AgentLoopExecutionError(
      "budget_exceeded",
      "The remaining budget cannot cover this paid tool request.",
    );
  if (reserve) {
    ledger.reserve(reserve, config.budgetLimit);
    publishCost(0);
  }
  let result: ToolResult | undefined;
  try {
    result = await runner.run(call, options.abortSignal, options.admittedTool);
    return result;
  } finally {
    const usage = result
      ? resolveExternalToolUsage(call.name, result)
      : paid
      ? { known: false as const }
      : undefined;
    if (usage?.known !== false) ledger.release(reserve);
    if (usage) {
      const cost = ledger.recordCharge(
        usage.known ? usage.estimatedCostUsd : 0,
        usage.known,
      );
      publishCost(cost);
      options.recordUsage(usage);
    } else if (reserve) publishCost(0);
  }
}
