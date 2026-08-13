import { getEventListeners } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnthropicCompatibleProvider } from "./AnthropicCompatibleProvider.js";

describe("AnthropicCompatibleProvider", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: "text", text: "ok" }],
            usage: { input_tokens: 10, output_tokens: 5 },
            stop_reason: "end_turn",
          }),
      }),
    ) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("does not retain abort listeners when a non-stream consumer stops early", async () => {
    const provider = new AnthropicCompatibleProvider(
      "test-key",
      "https://anthropic.example.com",
      { disablePreheat: true, maxRetries: 0 },
    );
    const controller = new AbortController();
    const stream = provider.chat({
      model: "compatible-model",
      messages: [],
      stream: false,
      abortSignal: controller.signal,
    });

    expect((await stream.next()).done).toBe(false);
    await stream.return(undefined);

    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("should support bearer-style auth and custom headers for compatible gateways", async () => {
    const provider = new AnthropicCompatibleProvider(
      undefined,
      "https://anthropic-gateway.example.com/v1",
      {
        id: "ciyuan-anthropic",
        apiKeyEnv: "CIYUAN_ANTHROPIC_KEY",
        apiKeyHeader: "Authorization",
        apiKeyPrefix: "Bearer",
        headers: { "X-Gateway": "orbit" },
        disablePreheat: true,
        maxRetries: 0,
      },
    );
    process.env.CIYUAN_ANTHROPIC_KEY = "test-anthropic-key";

    try {
      for await (const event of provider.chat({
        model: "claude-compatible",
        messages: [
          {
            id: "msg-1",
            role: "user",
            createdAt: new Date().toISOString(),
            content: [{ type: "text", text: "hi" }],
          },
        ],
        stream: false,
      })) {
        void event;
      }

      const postCall = (global.fetch as any).mock.calls.find(
        (call: any) => call[1]?.method === "POST",
      );
      expect(postCall[0]).toBe(
        "https://anthropic-gateway.example.com/v1/messages",
      );
      expect(postCall[1].headers.Authorization).toBe(
        "Bearer test-anthropic-key",
      );
      expect(postCall[1].headers["X-Gateway"]).toBe("orbit");
    } finally {
      delete process.env.CIYUAN_ANTHROPIC_KEY;
    }
  });

  it("maps image blocks to Anthropic base64 sources", async () => {
    const provider = new AnthropicCompatibleProvider(
      "test-key",
      "https://anthropic.example.com",
      { disablePreheat: true, maxRetries: 0 },
    );

    for await (const event of provider.chat({
      model: "claude-vision",
      messages: [
        {
          id: "msg-image",
          role: "user",
          createdAt: "2026-07-22T00:00:00.000Z",
          content: [
            { type: "text", text: "Describe this" },
            {
              type: "image",
              mediaType: "image/webp",
              name: "screen.webp",
              data: "aW1hZ2U=",
            },
          ],
        },
      ],
      stream: false,
    })) {
      void event;
    }

    const postCall = (global.fetch as any).mock.calls.find(
      (call: any) => call[1]?.method === "POST",
    );
    const body = JSON.parse(postCall[1].body);
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "Describe this" },
      {
        type: "image",
        cache_control: { type: "ephemeral" },
        source: {
          type: "base64",
          media_type: "image/webp",
          data: "aW1hZ2U=",
        },
      },
    ]);
  });

  it("uses adaptive thinking for newer Claude models without legacy temperature", async () => {
    const provider = new AnthropicCompatibleProvider(
      "test-key",
      "https://anthropic.example.com",
      {
        disablePreheat: true,
        maxRetries: 0,
      },
    );

    for await (const event of provider.chat({
      model: "claude-opus-4-8",
      messages: [
        {
          id: "msg-1",
          role: "user",
          createdAt: new Date().toISOString(),
          content: [{ type: "text", text: "think carefully" }],
        },
      ],
      stream: false,
      thinking: { enabled: true, budgetTokens: 8192 },
    })) {
      void event;
    }

    const postCall = (global.fetch as any).mock.calls.find(
      (call: any) => call[1]?.method === "POST",
    );
    const body = JSON.parse(postCall[1].body);
    expect(body.thinking).toEqual({
      type: "adaptive",
      display: "summarized",
    });
    expect(body.output_config).toEqual({ effort: "max" });
    expect(body.temperature).toBeUndefined();
  });

  it("emits non-stream Anthropic thinking blocks before final text", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [
            { type: "thinking", thinking: "reasoning", signature: "sig" },
            { type: "text", text: "answer" },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
    }) as any;
    const provider = new AnthropicCompatibleProvider(
      "test-key",
      "https://anthropic.example.com",
      {
        disablePreheat: true,
        maxRetries: 0,
      },
    );
    const events = [];

    for await (const event of provider.chat({
      model: "claude-sonnet-4-6",
      messages: [
        {
          id: "msg-1",
          role: "user",
          createdAt: new Date().toISOString(),
          content: [{ type: "text", text: "think" }],
        },
      ],
      stream: false,
    })) {
      events.push(event);
    }

    expect(events[0]).toEqual({
      type: "thinking_delta",
      text: "reasoning",
      signature: "sig",
    });
    expect(events[1]).toEqual({ type: "text_delta", text: "answer" });
  });

  it("splits Orbit volatile context into separate Anthropic cache blocks", async () => {
    const provider = new AnthropicCompatibleProvider(
      "test-key",
      "https://anthropic.example.com",
      {
        disablePreheat: true,
        maxRetries: 0,
      },
    );

    for await (const event of provider.chat({
      model: "claude-sonnet-4-6",
      system: "stable prompt\n<!-- VOLATILE_CONTEXT -->\nruntime context",
      messages: [
        {
          id: "msg-1",
          role: "user",
          createdAt: new Date().toISOString(),
          content: [{ type: "text", text: "hi" }],
        },
      ],
      stream: false,
    })) {
      void event;
    }

    const postCall = (global.fetch as any).mock.calls.find(
      (call: any) => call[1]?.method === "POST",
    );
    const body = JSON.parse(postCall[1].body);
    expect(body.system).toEqual([
      {
        type: "text",
        text: "stable prompt",
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: "\nruntime context",
        cache_control: { type: "ephemeral" },
      },
    ]);
  });

  it("flushes each Anthropic SSE frame without waiting for the read chunk", async () => {
    const encoder = new TextEncoder();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              [
                'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"a"}}',
                "",
                'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"b"}}',
                "",
                'data: {"type":"message_delta","usage":{"output_tokens":2}}',
                "",
              ].join("\n"),
            ),
          );
          controller.close();
        },
      }),
    }) as any;

    const provider = new AnthropicCompatibleProvider(
      "test-key",
      "https://anthropic.example.com",
      {
        disablePreheat: true,
        maxRetries: 0,
      },
    );
    const deltas: string[] = [];

    for await (const event of provider.chat({
      model: "claude-sonnet-4-6",
      messages: [
        {
          id: "msg-1",
          role: "user",
          createdAt: new Date().toISOString(),
          content: [{ type: "text", text: "hi" }],
        },
      ],
      stream: true,
    })) {
      if (event.type === "text_delta") {
        deltas.push(event.text);
      }
    }

    expect(deltas).toEqual(["a", "b"]);
  });

  it("rejects an oversized unterminated SSE frame", async () => {
    const encoder = new TextEncoder();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("x".repeat(4 * 1024 * 1024 + 1)));
          controller.close();
        },
      }),
    }) as any;
    const provider = new AnthropicCompatibleProvider(
      "test-key",
      "https://anthropic.example.com",
      { disablePreheat: true, maxRetries: 0 },
    );
    const errors: Error[] = [];

    for await (const event of provider.chat({
      model: "claude-sonnet-4-6",
      messages: [
        {
          id: "msg-oversized-frame",
          role: "user",
          createdAt: "2026-07-28T00:00:00.000Z",
          content: [{ type: "text", text: "hi" }],
        },
      ],
      stream: true,
    })) {
      if (event.type === "error") errors.push(event.error);
    }

    expect(errors.at(-1)?.message).toContain("safe streaming limit");
  });

  it("rejects a stream whose cumulative response exceeds the safe limit", async () => {
    const encoder = new TextEncoder();
    const frame = encoder.encode(
      `data: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "x".repeat(1024 * 1024) },
      })}\n`,
    );
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          for (let index = 0; index < 9; index += 1) {
            controller.enqueue(frame);
          }
          controller.close();
        },
      }),
    }) as any;
    const provider = new AnthropicCompatibleProvider(
      "test-key",
      "https://anthropic.example.com",
      { disablePreheat: true, maxRetries: 0 },
    );
    const errors: Error[] = [];

    for await (const event of provider.chat({
      model: "claude-sonnet-4-6",
      messages: [
        {
          id: "msg-oversized-stream",
          role: "user",
          createdAt: "2026-07-28T00:00:00.000Z",
          content: [{ type: "text", text: "hi" }],
        },
      ],
      stream: true,
    })) {
      if (event.type === "error") errors.push(event.error);
    }

    expect(errors.at(-1)?.message).toContain("total response limit");
  });

  it("accepts tool_use stops and emits split thinking signatures without loss", async () => {
    const encoder = new TextEncoder();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              [
                'data: {"type":"message_start","message":{"usage":{"input_tokens":8,"output_tokens":0}}}',
                "",
                'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
                "",
                'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"reason"}}',
                "",
                'data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig-"}}',
                "",
                'data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"part"}}',
                "",
                'data: {"type":"content_block_stop","index":0}',
                "",
                'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call-1","name":"read_file","input":{}}}',
                "",
                'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{}"}}',
                "",
                'data: {"type":"content_block_stop","index":1}',
                "",
                'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":6}}',
                "",
                'data: {"type":"message_stop"}',
                "",
              ].join("\n"),
            ),
          );
          controller.close();
        },
      }),
    }) as any;
    const provider = new AnthropicCompatibleProvider(
      "test-key",
      "https://anthropic.example.com",
      { disablePreheat: true, maxRetries: 0 },
    );
    const events = [];

    for await (const event of provider.chat({
      model: "claude-opus-4-8",
      messages: [
        {
          id: "msg-tool",
          role: "user",
          createdAt: new Date().toISOString(),
          content: [{ type: "text", text: "read" }],
        },
      ],
      stream: true,
    })) {
      events.push(event);
    }

    expect(
      events
        .filter((event) => event.type === "thinking_delta")
        .map((event: any) => event.signature)
        .filter(Boolean),
    ).toEqual(["sig-", "part"]);
    expect(events).toContainEqual({
      type: "tool_call",
      toolCall: {
        id: "call-1",
        name: "read_file",
        arguments: "{}",
      },
    });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("surfaces Anthropic error frames and premature stream EOF", async () => {
    const encoder = new TextEncoder();
    const provider = new AnthropicCompatibleProvider(
      "test-key",
      "https://anthropic.example.com",
      { disablePreheat: true, maxRetries: 0 },
    );

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"type":"error","error":{"type":"overloaded_error","message":"overloaded"}}\n\n',
            ),
          );
          controller.close();
        },
      }),
    }) as any;
    const errorEvents = [];
    for await (const event of provider.chat({
      model: "claude-sonnet-4-6",
      messages: [
        {
          id: "msg-error",
          role: "user",
          createdAt: new Date().toISOString(),
          content: [{ type: "text", text: "hello" }],
        },
      ],
      stream: true,
    })) {
      errorEvents.push(event);
    }
    expect(errorEvents.at(-1)).toMatchObject({ type: "error" });
    expect((errorEvents.at(-1) as any).error.message).toContain("overloaded");

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}}\n\n',
            ),
          );
          controller.close();
        },
      }),
    }) as any;
    const eofEvents = [];
    for await (const event of provider.chat({
      model: "claude-sonnet-4-6",
      messages: [
        {
          id: "msg-eof",
          role: "user",
          createdAt: new Date().toISOString(),
          content: [{ type: "text", text: "hello" }],
        },
      ],
      stream: true,
    })) {
      eofEvents.push(event);
    }
    expect(eofEvents.at(-1)).toMatchObject({ type: "error" });
    expect((eofEvents.at(-1) as any).error.message).toContain("stop reason");
    expect(eofEvents.some((event) => event.type === "done")).toBe(false);
  });

  it("replays signed thinking and tool turns in the Anthropic request", async () => {
    const provider = new AnthropicCompatibleProvider(
      "test-key",
      "https://anthropic.example.com",
      { disablePreheat: true, maxRetries: 0 },
    );

    for await (const event of provider.chat({
      model: "claude-opus-4-8",
      messages: [
        {
          id: "assistant-tool",
          role: "assistant",
          createdAt: new Date().toISOString(),
          content: [
            { type: "thinking", text: "reason", signature: "sig" },
            {
              type: "tool_call",
              toolCall: {
                id: "call-1",
                name: "read_file",
                arguments: '{"path":"README.md"}',
              },
            },
          ],
        },
        {
          id: "tool-result",
          role: "tool",
          createdAt: new Date().toISOString(),
          content: [
            {
              type: "tool_result",
              toolResult: {
                toolCallId: "call-1",
                name: "read_file",
                content: "contents",
              },
            },
          ],
        },
      ],
      stream: false,
    })) {
      void event;
    }

    const postCall = (global.fetch as any).mock.calls.find(
      (call: any) => call[1]?.method === "POST",
    );
    const body = JSON.parse(postCall[1].body);
    expect(body.messages).toEqual([
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "reason", signature: "sig" },
          {
            type: "tool_use",
            id: "call-1",
            name: "read_file",
            input: { path: "README.md" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call-1",
            content: "contents",
            cache_control: { type: "ephemeral" },
          },
        ],
      },
    ]);
  });

  it("turns malformed non-stream responses into a bounded error event", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ content: "not-an-array" }),
    }) as any;
    const provider = new AnthropicCompatibleProvider(
      "test-key",
      "https://anthropic.example.com",
      { disablePreheat: true, maxRetries: 0 },
    );
    const events = [];

    for await (const event of provider.chat({
      model: "claude-sonnet-4-6",
      messages: [
        {
          id: "msg-invalid-response",
          role: "user",
          createdAt: new Date().toISOString(),
          content: [{ type: "text", text: "hello" }],
        },
      ],
      stream: false,
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error" });
    expect((events[0] as any).error.message).toContain(
      "Invalid Anthropic-compatible response",
    );
  });

  it("rejects impossible provider token counters", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: "ok" }],
          usage: { input_tokens: 1_000_000_001, output_tokens: 1 },
          stop_reason: "end_turn",
        }),
    }) as any;
    const provider = new AnthropicCompatibleProvider(
      "test-key",
      "https://anthropic.example.com",
      { disablePreheat: true, maxRetries: 0 },
    );
    const events = [];

    for await (const event of provider.chat({
      model: "claude-sonnet-4-6",
      messages: [
        {
          id: "msg-invalid-usage",
          role: "user",
          createdAt: new Date().toISOString(),
          content: [{ type: "text", text: "hello" }],
        },
      ],
      stream: false,
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect(events.some((event) => event.type === "usage")).toBe(false);
  });

  it("releases the response body after connection preheating", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { cancel },
    }) as any;
    const provider = new AnthropicCompatibleProvider(
      "test-key",
      "https://anthropic.example.com",
      { maxRetries: 0 },
    );

    await provider.initialize();

    expect(global.fetch).toHaveBeenCalledWith(
      "https://anthropic.example.com",
      expect.objectContaining({ method: "HEAD" }),
    );
    expect(cancel).toHaveBeenCalledOnce();
  });
});
