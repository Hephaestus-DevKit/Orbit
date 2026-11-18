import { describe, expect, it } from "../../../../scripts/testing/support.mjs";
import type { ModelChatInput, OrbitMessage } from "../types.js";
import {
  applyDeepSeekSamplingPolicy,
  validateDeepSeekChatToolChoice,
  validateDeepSeekToolHistory,
} from "./DeepSeekRequestPolicy.js";
import { z } from "zod";

function message(
  role: OrbitMessage["role"],
  content: OrbitMessage["content"],
): OrbitMessage {
  return {
    role,
    content,
    id: "fixture",
    createdAt: "2026-10-10T00:00:00.000Z",
  };
}
const call = (id: string) =>
  message("assistant", [
    { type: "thinking", text: "unchanged reasoning" },
    { type: "tool_call", toolCall: { id, name: "read_file", arguments: "{}" } },
  ]);
const result = (id: string) =>
  message("tool", [
    {
      type: "tool_result",
      toolResult: { toolCallId: id, name: "read_file", content: "result" },
    },
  ]);
const user = message("user", [{ type: "text", text: "continue" }]);

describe("DeepSeek native request policy", () => {
  it("allows automatic tools while rejecting forced tools with thinking enabled", () => {
    const input: ModelChatInput = {
      model: "deepseek-flash",
      messages: [],
      tools: [
        { name: "read_file", description: "Read", inputSchema: z.object({}) },
      ],
    };
    for (
      const toolChoice of [
        "required",
        { type: "tool", name: "read_file" },
      ] as const
    ) {
      expect(() => validateDeepSeekChatToolChoice({ ...input, toolChoice }, true)).toThrow(
        "disable thinking",
      );
      expect(() => validateDeepSeekChatToolChoice({ ...input, toolChoice }, false)).not.toThrow();
    }
    expect(() => validateDeepSeekChatToolChoice({ ...input, toolChoice: "auto" }, true)).not
      .toThrow();
    expect(() =>
      validateDeepSeekChatToolChoice(
        { ...input, tools: [], toolChoice: "required" },
        true,
      )
    ).not.toThrow();
  });
  it("keeps supported top_p, clamps the effective range and removes ignored controls", () => {
    const body = {
      top_p: 0.7,
      temperature: 0.4,
      presence_penalty: 1,
      frequency_penalty: 1,
    };
    applyDeepSeekSamplingPolicy(body, true);
    expect(body).toEqual({ top_p: 0.95 });
    const off = { top_p: 0.98, temperature: 0.4 };
    applyDeepSeekSamplingPolicy(off, false);
    expect(off).toEqual({ temperature: 0.4 });
    expect(() => applyDeepSeekSamplingPolicy({}, true)).not.toThrow();
  });
  it.each([0, -1, 2, Infinity, NaN, "0.98"])(
    "rejects invalid top_p %s before transport",
    (top_p) => {
      expect(() => applyDeepSeekSamplingPolicy({ top_p }, true)).toThrow(
        "top_p",
      );
    },
  );
  it("preserves Pro non-thinking top_p and removes its ignored thinking value", () => {
    const off = { top_p: 0.3, temperature: 0.2 };
    applyDeepSeekSamplingPolicy(off, false, "pro");
    expect(off).toEqual({ top_p: 0.3, temperature: 0.2 });
    const on = { top_p: 0.3, temperature: 0.2 };
    applyDeepSeekSamplingPolicy(on, true, "pro");
    expect(on).toEqual({});
    expect(() => applyDeepSeekSamplingPolicy({ top_p: -1 }, false, "pro")).toThrow("top_p");
  });
  it("accepts parallel results in either order and preserves durable messages", () => {
    const assistant = call("first");
    assistant.content.push({
      type: "tool_call",
      toolCall: { id: "second", name: "read_file", arguments: "{}" },
    });
    const messages = [user, assistant, result("second"), result("first"), user];
    const snapshot = structuredClone(messages);
    expect(() => validateDeepSeekToolHistory(messages)).not.toThrow();
    expect(messages).toEqual(snapshot);
  });
  it.each([
    [result("unknown")],
    [call("first")],
    [call("first"), user],
    [call("first"), result("first"), result("first")],
    [
      message("assistant", [
        ...call("first").content,
        ...call("first").content,
      ]),
    ],
    [message("user", call("first").content)],
    [message("user", result("first").content)],
    [message("tool", [{ type: "text", text: "not a reply" }])],
    [call("")],
  ])("rejects orphan, duplicate and unresolved tool history", (...messages) => {
    expect(() => validateDeepSeekToolHistory(messages)).toThrow(
      "Invalid DeepSeek tool history",
    );
  });
});
