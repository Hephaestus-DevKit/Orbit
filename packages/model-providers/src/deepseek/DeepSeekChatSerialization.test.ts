import { describe, expect, it } from "../../../../scripts/testing/support.mjs";
import { buildDeepSeekChatMessages } from "./DeepSeekChatSerialization.js";
import type { ModelChatInput } from "../types.js";

const input: ModelChatInput = {
  model: "deepseek-flash",
  messages: [
    {
      id: "answer",
      role: "assistant",
      createdAt: "2026-10-10T00:00:00.000Z",
      content: [
        { type: "thinking", text: "First streamed " },
        { type: "thinking", text: "reasoning chunk.\nSecond line." },
        { type: "text", text: "Earlier answer" },
      ],
    },
    {
      id: "question",
      role: "user",
      createdAt: "2026-10-10T00:00:00.000Z",
      content: [{ type: "text", text: "Continue with tools" }],
    },
  ],
};

describe("DeepSeek durable reasoning replay", () => {
  it("replays all assistant reasoning with exact chunk boundaries when tools are present", () => {
    const original = structuredClone(input);
    expect(buildDeepSeekChatMessages(input, true, false, true)[0]).toEqual({
      role: "assistant",
      content: "Earlier answer",
      reasoning_content: "First streamed reasoning chunk.\nSecond line.",
    });
    expect(input).toEqual(original);
  });
  it("omits unused reasoning in a tool-free request", () => {
    expect(buildDeepSeekChatMessages(input, true)[0]).toEqual({
      role: "assistant",
      content: "Earlier answer",
    });
  });
});
