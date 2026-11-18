import { describe, expect, it } from "../../../scripts/testing/support.mjs";
import { recoverToolHistory } from "./ToolHistoryRecovery.js";
import type { StoredHistoryMessage } from "./types.js";

const now = "2026-11-17T00:00:00.000Z";
const call = (id: string): StoredHistoryMessage => ({
  id: `assistant-${id}`,
  role: "assistant",
  createdAt: now,
  content: [
    { type: "tool_call", toolCall: { id, name: "bash", arguments: "{}" } },
  ],
});
const reply = (id: string): StoredHistoryMessage => ({
  id: `tool-${id}`,
  role: "tool",
  createdAt: now,
  content: [
    {
      type: "tool_result",
      toolResult: { toolCallId: id, name: "bash", content: "done" },
    },
  ],
});

describe("tool history recovery", () => {
  it("handles repeated call IDs in distinct turns and remains idempotent", () => {
    const source = [call("same"), reply("same"), call("same")];
    const result = recoverToolHistory(source, now);
    expect(result.repairedToolCalls).toBe(1);
    expect(result.history.at(-1)).toMatchObject({
      role: "tool",
      metadata: { kind: "crash_recovery" },
    });
    expect(source).toHaveLength(3);
    expect(recoverToolHistory(result.history, now).repairedToolCalls).toBe(0);
  });

  it("repairs an old interrupted exchange before the following user turn", () => {
    const user: StoredHistoryMessage = {
      id: "user",
      role: "user",
      createdAt: now,
      content: [{ type: "text", text: "continue" }],
    };
    const result = recoverToolHistory(
      [call("old"), user, call("new"), reply("new")],
      now,
    );
    expect(result.repairedToolCalls).toBe(1);
    expect(result.history.map((message) => message.role)).toEqual([
      "assistant",
      "tool",
      "user",
      "assistant",
      "tool",
    ]);
    expect(result.history[1].content[0]).toMatchObject({
      toolResult: { toolCallId: "old", isError: true },
    });
  });
});
