import { describe, expect, it, vi } from "vitest";
import type {
  OrbitContentBlock,
  OrbitMessage,
} from "@orbit-build/model-providers";
import { AgentToolTurn } from "./AgentToolTurn.js";

describe("tool turn durability", () => {
  const calls = ["first", "second", "third"].map((id) => ({
    id,
    name: "read_file",
    arguments: "{}",
  }));
  const result = (id: string): OrbitContentBlock => ({
    type: "tool_result",
    toolResult: { toolCallId: id, name: "read_file", content: `result ${id}` },
  });

  it("persists each completion and fills only missing results on interruption", () => {
    const history: OrbitMessage[] = [];
    const snapshots: OrbitMessage[][] = [];
    const turn = new AgentToolTurn(calls, history, () =>
      snapshots.push(structuredClone(history)),
    );
    turn.record(result("second"));
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0][0].content).toEqual([result("second")]);
    turn.record(result("first"));
    turn.close();
    expect(history[0].content.slice(0, 2)).toEqual([
      result("first"),
      result("second"),
    ]);
    expect(history[0].content[2]).toMatchObject({
      toolResult: {
        toolCallId: "third",
        isError: true,
        content: expect.stringContaining("not replayed"),
      },
    });
    const saved = snapshots.length;
    turn.close();
    expect(snapshots).toHaveLength(saved);
  });

  it("does not overwrite completed results or invent a result for an unknown call", () => {
    const history: OrbitMessage[] = [];
    const turn = new AgentToolTurn(calls.slice(0, 1), history, vi.fn());
    turn.record(result("first"));
    turn.record({
      type: "tool_result",
      toolResult: {
        toolCallId: "first",
        name: "read_file",
        content: "interrupted",
        isError: true,
      },
    });
    turn.close();
    expect(history[0].content).toEqual([result("first")]);
    expect(() => turn.record(result("unexpected"))).toThrow();
  });
});
