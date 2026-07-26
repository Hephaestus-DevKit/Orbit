import type { OrbitMessage } from "@orbit-build/model-providers";

const VERIFICATION_FAILED_MARKER = "[Verification Failed]";

function messageText(message: OrbitMessage): string {
  return message.content
    .filter(
      (block): block is Extract<typeof block, { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("\n");
}

/**
 * Count auto-repair attempts for the CURRENT task only.
 *
 * Repair feedback is injected as plain user messages, so counting every
 * `[Verification Failed]` in the persistent history makes later tasks in a
 * long session inherit an already-exhausted budget. The current task starts
 * at the most recent real user prompt: a user message that is neither
 * bookkeeping (has a `metadata.kind`) nor itself repair feedback.
 */
export function countRepairAttemptsForCurrentTask(
  history: OrbitMessage[],
): number {
  let taskStartIndex = -1;
  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index];
    if (message.role !== "user") continue;
    if (message.metadata?.kind) continue;
    if (messageText(message).includes(VERIFICATION_FAILED_MARKER)) continue;
    taskStartIndex = index;
    break;
  }

  let attempts = 0;
  for (let index = taskStartIndex + 1; index < history.length; index++) {
    const message = history[index];
    if (
      message.role === "user" &&
      messageText(message).includes(VERIFICATION_FAILED_MARKER)
    ) {
      attempts++;
    }
  }
  return attempts;
}
