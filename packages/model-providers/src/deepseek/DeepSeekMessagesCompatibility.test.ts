import { afterEach, describe, expect, it, mockTools as vi } from "../../../../scripts/testing/support.mjs";
import { DeepSeekProvider } from "./DeepSeekProvider.js";
import type { OrbitMessage } from "../types.js";

afterEach(() => {
  vi.unstubAllGlobals();
});
const message = (
  role: OrbitMessage["role"],
  content: OrbitMessage["content"],
): OrbitMessage => ({
  id: role,
  role,
  content,
  createdAt: "2026-10-21T00:00:00Z",
});
function setup() {
  const fetch = vi.fn().mockImplementation(() =>
    Promise.resolve(
      Response.json({
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 2, output_tokens: 1 },
        stop_reason: "end_turn",
      }),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const provider = new DeepSeekProvider(
    "fixture-key",
    "https://api.deepseek.com",
    { deepSeekApiFormat: "anthropic", disablePreheat: true, maxRetries: 0 },
  );
  return { fetch, provider };
}

describe("DeepSeek Messages compatibility", () => {
  it.each(["deepseek-flash", "deepseek-v4-pro"])(
    "honors image capabilities for %s",
    async (model) => {
      const { provider, fetch } = setup();
      const events = [];
      for await (const event of provider.chat({
        model,
        stream: false,
        messages: [
          message("user", [
            { type: "image", mediaType: "image/png", data: "aW1hZ2U=" },
          ]),
        ],
      }))
        events.push(event);
      if (model === "deepseek-flash") {
        expect(events.some((event) => event.type === "error")).toBe(false);
        expect(
          JSON.parse(fetch.mock.calls[0][1].body).messages[0].content[0],
        ).toEqual({
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "aW1hZ2U=" },
        });
      } else {
        expect(fetch).not.toHaveBeenCalled();
        expect(events.some((event) => event.type === "error")).toBe(true);
      }
    },
  );
  it("omits empty turns without dropping reasoning or empty tool replies", async () => {
    const { provider, fetch } = setup();
    const history = [
      message("user", []),
      message("user", [{ type: "text", text: "go" }]),
      message("assistant", [{ type: "text", text: "" }]),
      message("assistant", [
        { type: "thinking", text: "reasoning", signature: "sig" },
        { type: "text", text: "" },
        {
          type: "tool_call",
          toolCall: { id: "call", name: "read", arguments: "{}" },
        },
      ]),
      message("tool", [
        {
          type: "tool_result",
          toolResult: { toolCallId: "call", name: "read", content: "" },
        },
      ]),
    ];
    const snapshot = structuredClone(history);
    for await (const event of provider.chat({
      model: "deepseek-flash",
      messages: history,
      stream: false,
    }))
      void event;
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.messages).toHaveLength(3);
    expect(
      body.messages[1].content.map((block: { type: string }) => block.type),
    ).toEqual(["thinking", "tool_use"]);
    expect(body.messages[2].content[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "call",
      content: "",
    });
    expect(history).toEqual(snapshot);
  });
});
