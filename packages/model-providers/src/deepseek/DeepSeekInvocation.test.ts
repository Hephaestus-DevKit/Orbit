import { getEventListeners } from "node:events";
import {
  afterEach,
  describe,
  expect,
  it,
  mockTools as vi,
} from "../../../../scripts/testing/support.mjs";
import { z } from "zod";
import type { ModelApiFormat, ModelChatInput, ModelEvent, OrbitToolCall } from "../types.js";
import { DeepSeekProvider } from "./DeepSeekProvider.js";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});
const formats: ModelApiFormat[] = [
  "chat-completions",
  "responses",
  "anthropic",
];
const calls: OrbitToolCall[] = [
  { id: "call-first", name: "read_file", arguments: "{}" },
];
const request = (stream: boolean): ModelChatInput => ({
  model: "deepseek-flash",
  stream,
  messages: [
    {
      id: "question",
      role: "user",
      createdAt: "2026-10-10T00:00:00.000Z",
      content: [{ type: "text", text: "Read the fixture" }],
    },
  ],
  tools: [
    {
      name: "read_file",
      description: "Read a fixture",
      inputSchema: z.object({}),
    },
  ],
  thinking: { enabled: true, effort: "low" },
});
const sse = (events: unknown[]) =>
  events
    .map(
      (event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`,
    )
    .join("");

function wireResponse(
  format: ModelApiFormat,
  stream: boolean,
  batch: OrbitToolCall[],
  truncated = false,
  omitTerminal = false,
): Response {
  let json: unknown;
  let frames: unknown[];
  if (format === "chat-completions") {
    const tool_calls = batch.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.arguments },
    }));
    const finish_reason = truncated ? "length" : "tool_calls";
    json = {
      choices: [
        { finish_reason, message: { content: "Visible answer", tool_calls } },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
    };
    frames = [
      { choices: [{ delta: { content: "Visible answer" } }] },
      {
        choices: [
          {
            delta: {
              tool_calls: tool_calls.map((call, index) => ({ ...call, index })),
            },
          },
        ],
      },
      {
        choices: [{ delta: {}, finish_reason }],
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      },
      "[DONE]",
    ];
  } else if (format === "responses") {
    const output = batch.map((call, index) => ({
      id: `item-${index}`,
      type: "function_call",
      call_id: call.id,
      name: call.name,
      arguments: call.arguments,
    }));
    json = {
      id: "response-fixture",
      status: truncated ? "incomplete" : "completed",
      output: [
        {
          id: "answer",
          type: "message",
          content: [{ type: "output_text", text: "Visible answer" }],
        },
        ...output,
      ],
      ...(truncated
        ? { incomplete_details: { reason: "max_output_tokens" } }
        : {}),
      usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
    };
    frames = [
      {
        type: "response.output_text.delta",
        output_index: 0,
        item_id: "answer",
        delta: "Visible answer",
      },
      ...output.map((item, index) => ({
        type: "response.output_item.added",
        output_index: index + 1,
        item,
      })),
      {
        type: truncated ? "response.incomplete" : "response.completed",
        response: json,
      },
    ];
  } else {
    const content = batch.map((call) => ({
      type: "tool_use",
      id: call.id,
      name: call.name,
      input: {},
    }));
    const stop_reason = truncated ? "max_tokens" : "tool_use";
    json = {
      id: "message-fixture",
      content: [{ type: "text", text: "Visible answer" }, ...content],
      stop_reason,
      usage: { input_tokens: 10, output_tokens: 4 },
    };
    frames = [
      {
        type: "message_start",
        message: { id: "message-fixture", usage: { input_tokens: 10 } },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Visible answer" },
      },
      { type: "content_block_stop", index: 0 },
      ...batch.flatMap((call, index) => [
        {
          type: "content_block_start",
          index: index + 1,
          content_block: {
            type: "tool_use",
            id: call.id,
            name: call.name,
            input: {},
          },
        },
        {
          type: "content_block_delta",
          index: index + 1,
          delta: { type: "input_json_delta", partial_json: call.arguments },
        },
        { type: "content_block_stop", index: index + 1 },
      ]),
      {
        type: "message_delta",
        delta: { stop_reason },
        usage: { output_tokens: 4 },
      },
      { type: "message_stop" },
    ];
  }
  if (!stream) return Response.json(json);
  if (omitTerminal) frames.pop();
  return new Response(sse(frames), {
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function invoke(
  format: ModelApiFormat,
  input: ModelChatInput,
  response: Response,
  extraBody?: Record<string, unknown>,
) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  global.fetch = fetchMock;
  const provider = new DeepSeekProvider(
    "test-key",
    "https://api.deepseek.com",
    {
      disablePreheat: true,
      maxRetries: 0,
      deepSeekApiFormat: format,
      extraBody,
    },
  );
  const events: ModelEvent[] = [];
  for await (const event of provider.chat(input)) events.push(event);
  return { events, fetchMock };
}

for (const format of formats)
  describe(`DeepSeek ${format} invocation`, () => {
    for (const stream of [true, false]) {
      it(`settles a successful tool batch before delivery (stream=${stream})`, async () => {
        const { events } = await invoke(
          format,
          request(stream),
          wireResponse(format, stream, calls),
        );
        expect(events.filter((event) => event.type === "tool_call")).toEqual([
          { type: "tool_call", toolCall: calls[0] },
        ]);
        expect(events.at(-1)).toEqual({ type: "done" });
        expect(events).toContainEqual(
          expect.objectContaining({
            type: "usage",
            usage: expect.objectContaining({
              inputTokens: 10,
              outputTokens: 4,
            }),
          }),
        );
      });
      it(`retains output and billing but delivers no tools after truncation (stream=${stream})`, async () => {
        const { events, fetchMock } = await invoke(
          format,
          request(stream),
          wireResponse(format, stream, calls, true),
        );
        expect(
          events.some(
            (event) => event.type === "tool_call" || event.type === "done",
          ),
        ).toBe(false);
        expect(events).toContainEqual({
          type: "text_delta",
          text: "Visible answer",
        });
        expect(events).toContainEqual(
          expect.objectContaining({ type: "usage" }),
        );
        expect(events.at(-1)).toMatchObject({
          type: "error",
          error: { code: "OUTPUT_LIMIT", partialOutput: true },
        });
        expect(fetchMock).toHaveBeenCalledOnce();
      });
      it(`rejects every tool in a duplicate-ID batch (stream=${stream})`, async () => {
        const { events } = await invoke(
          format,
          request(stream),
          wireResponse(format, stream, [...calls, ...calls]),
        );
        expect(
          events.some(
            (event) => event.type === "tool_call" || event.type === "done",
          ),
        ).toBe(false);
        expect(events.at(-1)).toMatchObject({ type: "error" });
      });
    }
    it("rejects a stream that omits its terminal event without exposing pending tools", async () => {
      const { events, fetchMock } = await invoke(
        format,
        request(true),
        wireResponse(format, true, calls, false, true),
      );
      expect(
        events.some(
          (event) => event.type === "tool_call" || event.type === "done",
        ),
      ).toBe(false);
      expect(events.at(-1)).toMatchObject({
        type: "error",
        error: { partialOutput: true },
      });
      expect(fetchMock).toHaveBeenCalledOnce();
    });
    it("cancels the upstream body and removes listeners when the consumer stops early", async () => {
      const source = await wireResponse(format, true, calls).text();
      const cancel = vi.fn();
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(source));
          },
          cancel,
        }),
      );
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
      global.fetch = fetchMock;
      const signal = new AbortController();
      const provider = new DeepSeekProvider(
        "test-key",
        "https://api.deepseek.com",
        { disablePreheat: true, maxRetries: 0, deepSeekApiFormat: format },
      );
      const stream = provider.chat({
        ...request(true),
        abortSignal: signal.signal,
      });
      const iterator = stream[Symbol.asyncIterator]();
      let observedText = false;
      while (!observedText) {
        const result = await iterator.next();
        expect(result.done).toBe(false);
        if (!result.done && result.value.type === "text_delta")
          observedText = true;
        if (!result.done) expect(result.value.type).not.toBe("tool_call");
      }
      await iterator.return?.();
      expect(cancel).toHaveBeenCalledOnce();
      expect(getEventListeners(signal.signal, "abort")).toHaveLength(0);
      expect(fetchMock).toHaveBeenCalledOnce();
    });
    it("does not submit an already cancelled request", async () => {
      const controller = new AbortController();
      controller.abort();
      const { events, fetchMock } = await invoke(
        format,
        { ...request(true), abortSignal: controller.signal },
        wireResponse(format, true, calls),
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(events.at(-1)).toMatchObject({
        type: "error",
        error: { name: "AbortError" },
      });
    });
    it("handles CRLF and multibyte UTF-8 split into one-byte reads", async () => {
      const source = (await wireResponse(format, true, calls).text())
        .replaceAll("Visible answer", "结果✓")
        .replaceAll("\n", "\r\n");
      const bytes = new TextEncoder().encode(source);
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (let index = 0; index < bytes.length; index++)
              controller.enqueue(bytes.subarray(index, index + 1));
            controller.close();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
      const { events } = await invoke(format, request(true), response);
      expect(
        events
          .filter((event) => event.type === "text_delta")
          .map((event) => event.text)
          .join(""),
      ).toBe("结果✓");
      expect(events.filter((event) => event.type === "tool_call")).toHaveLength(
        1,
      );
      expect(events.at(-1)).toEqual({ type: "done" });
    });
    it("does not promote an unterminated EOF tail to a terminal event", async () => {
      const source = (await wireResponse(format, true, calls).text()).trimEnd();
      const { events } = await invoke(
        format,
        request(true),
        new Response(source, {
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
      expect(
        events.some(
          (event) => event.type === "tool_call" || event.type === "done",
        ),
      ).toBe(false);
      expect(events.at(-1)).toMatchObject({ type: "error" });
    });
    it("retains supported sampling settings and removes ineffective parameters", async () => {
      const { events, fetchMock } = await invoke(
        format,
        request(false),
        wireResponse(format, false, calls),
        {
          top_p: 0.98,
          temperature: 0.2,
          presence_penalty: 1,
          frequency_penalty: 1,
        },
      );
      const body: unknown = JSON.parse(
        String(fetchMock.mock.calls[0]?.[1]?.body),
      );
      expect(body).toMatchObject({ top_p: 0.98 });
      expect(body).not.toHaveProperty("temperature");
      expect(body).not.toHaveProperty("presence_penalty");
      expect(body).not.toHaveProperty("frequency_penalty");
      expect(events.at(-1)).toEqual({ type: "done" });
    });
  });

for (const format of ["chat-completions", "anthropic"] as const) {
  if (format === "chat-completions") {
    it(`${format} rejects forced tools with thinking before fetching`, async () => {
      const { events, fetchMock } = await invoke(
        format,
        { ...request(false), toolChoice: "required" },
        wireResponse(format, false, calls),
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(events.at(-1)).toMatchObject({
        type: "error",
        error: { code: "INVALID_REQUEST" },
      });
    });
  } else {
    it("Messages preserves supported forced tool choices with thinking enabled", async () => {
      const { events, fetchMock } = await invoke(
        format,
        { ...request(false), toolChoice: "required" },
        wireResponse(format, false, calls),
      );
      expect(fetchMock).toHaveBeenCalledOnce();
      const body: unknown = JSON.parse(
        String(fetchMock.mock.calls[0]?.[1]?.body),
      );
      expect(body).toMatchObject({
        thinking: { type: "enabled" },
        tool_choice: { type: "any" },
      });
      expect(events.at(-1)).toEqual({ type: "done" });
    });
  }
  it(`${format} honors forced tools when thinking is explicitly disabled`, async () => {
    const { events, fetchMock } = await invoke(
      format,
      {
        ...request(false),
        toolChoice: "required",
        thinking: { enabled: false },
      },
      wireResponse(format, false, calls),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(events.at(-1)).toEqual({ type: "done" });
  });
}
