import { randomUUID } from "node:crypto";
import type { StoredHistoryMessage } from "./types.js";

/** Repair missing replies at each exchange boundary; never replay a tool or invent success. */
export function recoverToolHistory(
  source: readonly StoredHistoryMessage[],
  recoveredAt: string,
): { history: StoredHistoryMessage[]; repairedToolCalls: number } {
  const history: StoredHistoryMessage[] = [];
  const pending = new Map<string, string>();
  let repairedToolCalls = 0;
  const closePending = () => {
    if (pending.size === 0) return;
    repairedToolCalls += pending.size;
    history.push({
      id: `msg_recovery_${randomUUID()}`,
      role: "tool",
      createdAt: recoveredAt,
      content: Array.from(pending, ([toolCallId, name]) => ({
        type: "tool_result" as const,
        toolResult: {
          toolCallId,
          name,
          content:
            "Orbit was interrupted before this tool result was durably recorded. The tool was not replayed because it may have had side effects. Inspect the workspace before retrying.",
          isError: true,
        },
      })),
      metadata: { kind: "crash_recovery" },
    });
    pending.clear();
  };
  for (const message of source) {
    if (message.role !== "tool") closePending();
    history.push(message);
    for (const block of message.content) {
      if (message.role === "assistant" && block.type === "tool_call")
        pending.set(block.toolCall.id, block.toolCall.name);
      else if (message.role === "tool" && block.type === "tool_result")
        pending.delete(block.toolResult.toolCallId);
    }
  }
  closePending();
  return { history, repairedToolCalls };
}
