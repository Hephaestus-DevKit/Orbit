import type { OrbitMessage } from "@orbit-build/model-providers";
import type { SessionEvent, TaskPlan } from "@orbit-build/session";
import { resolveSafePath } from "@orbit-build/shared";
import { isFileMutationTool } from "./AgentAudit.js";
import type { AgentRunReceipt } from "./AgentRunOutcome.js";

export interface AgentRunEvidenceInput {
  events: readonly SessionEvent[];
  taskPlan?: TaskPlan;
  verification: AgentRunReceipt["verification"];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costKnown: boolean;
  costUsd: number;
}

/** Build a stable run receipt from persisted evidence without mutating session state. */
export function createAgentRunReceipt(
  input: AgentRunEvidenceInput,
): AgentRunReceipt {
  const modifiedFiles = Array.from(
    new Set(
      input.events
        .filter((event) => event.type === "file_modified")
        .flatMap((event) => {
          const payload = event.payload;
          return typeof payload === "object" &&
            payload !== null &&
            "path" in payload &&
            typeof payload.path === "string"
            ? [payload.path]
            : [];
        }),
    ),
  );
  const taskPlan = input.taskPlan;
  const plan = taskPlan
    ? {
        total: taskPlan.items.length,
        completed: taskPlan.items.filter((item) => item.status === "completed")
          .length,
        inProgress: taskPlan.items.filter(
          (item) => item.status === "in_progress",
        ).length,
        pending: taskPlan.items.filter((item) => item.status === "pending")
          .length,
      }
    : undefined;
  const verification = input.verification;
  return {
    modifiedFiles,
    verification: verification,
    usage: {
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      cacheReadTokens: input.cacheReadTokens,
    },
    cost: {
      known: input.costKnown,
      usd: input.costKnown ? Number(input.costUsd.toFixed(6)) : null,
    },
    ...(plan ? { plan } : {}),
  };
}

/** Only successful mutations inside the workspace enter the verification gate. */
export function hasSuccessfulWorkspaceFileMutations(
  history: OrbitMessage[],
  cwd: string,
): boolean {
  const mutationCallIds = new Set<string>();

  for (const message of history) {
    for (const block of message.content) {
      if (
        block.type === "tool_call" &&
        isFileMutationTool(block.toolCall.name)
      ) {
        try {
          const args = toUnknownRecord(JSON.parse(block.toolCall.arguments));
          const targetPath = firstStringValue(
            args.path,
            args.TargetFile,
            args.filePath,
            args.file,
          );
          if (!targetPath) continue;
          resolveSafePath(cwd, targetPath);
          mutationCallIds.add(block.toolCall.id);
        } catch {
          // Outside-workspace and malformed paths do not enter workspace gates.
        }
      }
    }
  }

  if (mutationCallIds.size === 0) return false;

  return history.some((message) =>
    message.content.some(
      (block) =>
        block.type === "tool_result" &&
        mutationCallIds.has(block.toolResult.toolCallId) &&
        block.toolResult.isError !== true,
    ),
  );
}

function toUnknownRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstStringValue(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string");
}
