import { describe, expect, it } from "vitest";
import type { OrbitMessage } from "@orbit-build/model-providers";
import { countRepairAttemptsForCurrentTask } from "./RepairBudget.js";

let counter = 0;
function userMessage(text: string, kind?: string): OrbitMessage {
  counter += 1;
  return {
    id: `msg_user_${counter}`,
    role: "user",
    createdAt: new Date(2026, 0, 1, 0, counter).toISOString(),
    content: [{ type: "text", text }],
    ...(kind ? { metadata: { kind } } : {}),
  };
}

function assistantMessage(text: string): OrbitMessage {
  counter += 1;
  return {
    id: `msg_asst_${counter}`,
    role: "assistant",
    createdAt: new Date(2026, 0, 1, 0, counter).toISOString(),
    content: [{ type: "text", text }],
  };
}

const repairFeedback = () =>
  userMessage("[Verification Failed] tests are failing, please fix.");

describe("countRepairAttemptsForCurrentTask", () => {
  it("counts repair feedback after the current task prompt", () => {
    const history = [
      userMessage("Fix the login bug"),
      assistantMessage("working on it"),
      repairFeedback(),
      assistantMessage("trying again"),
      repairFeedback(),
    ];

    expect(countRepairAttemptsForCurrentTask(history)).toBe(2);
  });

  it("does not inherit repair attempts from earlier tasks", () => {
    const history = [
      userMessage("Task one"),
      repairFeedback(),
      repairFeedback(),
      repairFeedback(),
      userMessage("Task two, unrelated"),
      assistantMessage("ok"),
    ];

    expect(countRepairAttemptsForCurrentTask(history)).toBe(0);
  });

  it("ignores bookkeeping user messages when locating the task start", () => {
    const history = [
      userMessage("Real task"),
      repairFeedback(),
      userMessage(
        "[Conversation Summary] compacted",
        "history_compaction_summary",
      ),
      userMessage("volatile context", "volatile_context"),
    ];

    expect(countRepairAttemptsForCurrentTask(history)).toBe(1);
  });

  it("counts all feedback when no real task prompt exists", () => {
    const history = [repairFeedback(), repairFeedback()];

    expect(countRepairAttemptsForCurrentTask(history)).toBe(2);
  });

  it("returns zero for an empty history", () => {
    expect(countRepairAttemptsForCurrentTask([])).toBe(0);
  });
});
