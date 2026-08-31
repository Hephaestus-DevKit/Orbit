import type { OrbitConfig } from "@orbit-build/config";
import type {
  OrbitContentBlock,
  OrbitToolCall,
} from "@orbit-build/model-providers";
import type { PermissionEngine } from "@orbit-build/permissions";
import type { SessionManager } from "@orbit-build/session";
import {
  isParallelTool,
  type OrbitTool,
  type ToolRegistry,
  type ToolResult,
} from "@orbit-build/tools";
import { redactSecrets, redactSensitiveValue } from "@orbit-build/shared";
import picocolors from "picocolors";
import { eventBus } from "../events/EventBus.js";
import type { UserInteraction } from "./AgentInteraction.js";
import type { LoopProgressGuard } from "./LoopProgressGuard.js";
import type { StepRunner } from "./StepRunner.js";
import {
  selectLifecycleHooks,
  type LifecycleHookContext,
} from "./LifecycleHooks.js";
import {
  buildToolResultContent,
  TOOL_STATUS_MAX_CHARS,
  truncateToolText,
} from "./ToolResultContent.js";

const MAX_PARALLEL_TOOL_CALLS = 4;

export interface ParallelToolBatchOptions {
  toolCalls: OrbitToolCall[];
  protocolErrors: ReadonlyMap<string, string>;
  finalResponseLocked: boolean;
  abortSignal?: AbortSignal;
  registry: ToolRegistry;
  permissionEngine: PermissionEngine;
  hooks: OrbitConfig["hooks"];
  sessionId: string;
  attempt: number;
  stepRunner: StepRunner;
  interaction: UserInteraction;
  sessionManager: SessionManager;
  progressGuard: LoopProgressGuard;
  sessionCostLabel: string;
}

export interface ParallelToolBatchResult {
  blocks: OrbitContentBlock[];
  interrupted: boolean;
}

/**
 * Execute an entirely safe read batch concurrently.
 *
 * This path is deliberately all-or-nothing. Mixed or ambiguous batches fall
 * back to AgentLoop's established serial transaction.
 */
export async function executeParallelToolBatch(
  options: ParallelToolBatchOptions,
): Promise<ParallelToolBatchResult | undefined> {
  if (
    options.toolCalls.length < 2 ||
    options.finalResponseLocked ||
    options.abortSignal?.aborted
  ) {
    return undefined;
  }

  const prepared: Array<{
    call: OrbitToolCall;
    tool: OrbitTool<unknown, unknown>;
    input: unknown;
    startedAt: string;
  }> = [];
  for (const call of options.toolCalls) {
    if (options.protocolErrors.has(call.id)) return undefined;
    const tool = options.registry.get(call.name);
    if (!tool || tool.risk !== "read" || !isParallelTool(tool)) {
      return undefined;
    }
    let input: unknown;
    try {
      input = JSON.parse(call.arguments) as unknown;
    } catch {
      return undefined;
    }
    const validation = tool.inputSchema.safeParse(input);
    if (!validation.success) return undefined;
    const decision = options.permissionEngine.evaluate(
      call.name,
      validation.data,
      tool.risk,
    );
    if (decision.action !== "allow" || decision.risk !== "read") {
      return undefined;
    }
    const baseContext: LifecycleHookContext = {
      sessionId: options.sessionId,
      attempt: options.attempt,
      toolName: call.name,
    };
    if (hasApplicableToolHook(options.hooks, baseContext)) return undefined;
    prepared.push({
      call,
      tool,
      input: validation.data,
      startedAt: new Date().toISOString(),
    });
  }

  for (const item of prepared) {
    options.interaction.showText(
      `\n  ${picocolors.cyan("✦")} ${picocolors.bold(picocolors.white(item.call.name))} ${picocolors.gray(summarizeToolArguments(item.call))}`,
    );
    eventBus.emitEvent("tool_proposal", {
      toolCallId: item.call.id,
      toolName: item.call.name,
      arguments: item.input,
    });
    eventBus.emitEvent("tool_approval", {
      toolCallId: item.call.id,
      approved: true,
      reason: "Auto-approved by policy for a parallel read batch",
    });
  }
  options.sessionManager.setRunState("running", "tool:parallel-read", {
    attempt: options.attempt,
    activeToolCallId: prepared[0]?.call.id,
  });
  options.interaction.progress?.start(
    `Executing ${prepared.length} independent read tools... | Cost: ${options.sessionCostLabel}`,
  );
  let results: ToolResult<unknown>[];
  try {
    results = [];
    for (
      let offset = 0;
      offset < prepared.length;
      offset += MAX_PARALLEL_TOOL_CALLS
    ) {
      const chunk = prepared.slice(offset, offset + MAX_PARALLEL_TOOL_CALLS);
      results.push(
        ...(await Promise.all(
          chunk.map((item) =>
            options.stepRunner.run(item.call, options.abortSignal),
          ),
        )),
      );
    }
  } finally {
    options.interaction.progress?.stop();
  }

  const blocks: OrbitContentBlock[] = [];
  for (let index = 0; index < prepared.length; index += 1) {
    const item = prepared[index];
    const result = results[index];
    options.sessionManager.recordToolExecution(
      item.call.name,
      item.call,
      result,
      "read",
      "allow",
      result.ok ? "success" : "failed",
      { startedAt: item.startedAt },
    );
    const modelVisibleToolResult = buildToolResultContent(
      item.call.name,
      result,
    );
    reportResult(options.interaction, result, modelVisibleToolResult);
    eventBus.emitEvent("tool_result", {
      toolCallId: item.call.id,
      toolName: item.call.name,
      result: result.ok ? redactSensitiveValue(result.data) : undefined,
      display: result.ok ? redactSecrets(result.display || "") : undefined,
      error: result.ok ? undefined : modelVisibleToolResult,
    });
    const guardNudge = options.progressGuard.record({
      name: item.call.name,
      arguments: item.call.arguments,
      ok: result.ok,
    });
    if (guardNudge) {
      options.interaction.showText(
        picocolors.yellow(
          `⚠ Loop guard: "${item.call.name}" repeated ${guardNudge.repeatCount}× with identical arguments.`,
        ),
      );
      options.sessionManager.logEvent("loop_guard_nudge", {
        toolName: item.call.name,
        reason: guardNudge.reason,
        repeatCount: guardNudge.repeatCount,
      });
    }
    blocks.push({
      type: "tool_result",
      toolResult: {
        toolCallId: item.call.id,
        name: item.call.name,
        content:
          modelVisibleToolResult +
          (guardNudge ? `\n\n${guardNudge.message}` : ""),
        isError: !result.ok,
      },
    });
  }
  options.sessionManager.logEvent("parallel_tool_batch_completed", {
    toolNames: prepared.map((item) => item.call.name),
    toolCallIds: prepared.map((item) => item.call.id),
    count: prepared.length,
  });
  return { blocks, interrupted: Boolean(options.abortSignal?.aborted) };
}

function hasApplicableToolHook(
  hooks: OrbitConfig["hooks"],
  context: LifecycleHookContext,
): boolean {
  return (
    selectLifecycleHooks(hooks, "preToolUse", context).length > 0 ||
    selectLifecycleHooks(hooks, "postToolUse", {
      ...context,
      status: "success",
    }).length > 0 ||
    selectLifecycleHooks(hooks, "postToolFailure", {
      ...context,
      status: "failure",
    }).length > 0
  );
}

function reportResult(
  interaction: UserInteraction,
  result: ToolResult<unknown>,
  modelVisibleResult: string,
): void {
  if (result.ok) {
    const statusText = truncateToolText(
      redactSecrets(result.display || "Done"),
      TOOL_STATUS_MAX_CHARS,
    );
    interaction.showText(
      `  ${picocolors.green("✔")} Success: ${picocolors.gray(statusText)}`,
    );
    return;
  }
  const statusError = truncateToolText(
    modelVisibleResult,
    TOOL_STATUS_MAX_CHARS,
  );
  interaction.showText(
    `  ${picocolors.red("✖")} Failed: ${picocolors.red(statusError)}`,
  );
}

export function summarizeToolArguments(toolCall: OrbitToolCall): string {
  let summary = toolCall.arguments;
  try {
    const parsed = JSON.parse(toolCall.arguments) as Record<string, unknown>;
    const pathValue =
      firstString(
        parsed.path,
        parsed.TargetFile,
        parsed.filePath,
        parsed.file,
        parsed.AbsolutePath,
      ) ?? "";
    if (toolCall.name === "grep") {
      const query =
        firstString(parsed.pattern, parsed.query, parsed.Query) ?? "";
      const searchPath = firstString(parsed.path, parsed.SearchPath) ?? "";
      summary = `"${query}" in ${searchPath}`;
    } else if (toolCall.name === "glob") {
      const pattern = firstString(parsed.pattern, parsed.Pattern) ?? "";
      const directory = firstString(parsed.path, parsed.DirectoryPath) ?? "";
      summary = `"${pattern}" in ${directory}`;
    } else {
      summary =
        pathValue ||
        firstString(
          parsed.command,
          parsed.CommandLine,
          parsed.query,
          parsed.pattern,
        ) ||
        toolCall.arguments;
    }
  } catch {
    // The serial path reports malformed JSON with its established detail.
  }
  const redacted = redactSecrets(summary).replace(
    /[\u0000-\u001f\u007f-\u009f]/g,
    " ",
  );
  return redacted.length > 80 ? `${redacted.slice(0, 77)}...` : redacted;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string");
}
