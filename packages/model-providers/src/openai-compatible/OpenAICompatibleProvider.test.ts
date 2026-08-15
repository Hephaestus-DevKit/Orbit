import { getEventListeners } from "events";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAICompatibleProvider } from "./OpenAICompatibleProvider.js";
import { z } from "zod";

describe("OpenAICompatibleProvider adaptive message mapping", () => {
  let originalFetch: any;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ finish_reason: "stop", message: { content: "ok" } }],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
          }),
      }),
    ) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("does not retain abort listeners when a non-stream consumer stops early", async () => {
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://gateway.example.com/v1",
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

  it("honors a caller-owned retry budget for agent-level recovery", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers(),
        body: { cancel: vi.fn() },
        text: () => Promise.resolve("busy"),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ finish_reason: "stop", message: { content: "ok" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
      });
    global.fetch = fetchMock as any;
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://gateway.example.com/v1",
      {
        disablePreheat: true,
        maxRetries: 2,
      },
    );

    const events = [];
    for await (const event of provider.chat({
      model: "compatible-model",
      messages: [],
      stream: false,
      retryBudget: 0,
    })) {
      events.push(event);
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events).toEqual([expect.objectContaining({ type: "error" })]);
  });

  it("should always provide the content field for all message roles", async () => {
    const provider = new OpenAICompatibleProvider("test-key");

    const input = {
      model: "deepseek-v4-flash",
      messages: [
        {
          id: "msg-user",
          role: "user" as const,
          createdAt: "2026-07-13T00:00:00.000Z",
          content: [{ type: "text" as const, text: "hi" }],
        },
        {
          id: "msg-assistant",
          role: "assistant" as const,
          createdAt: "2026-07-13T00:00:01.000Z",
          content: [
            {
              type: "tool_call" as const,
              toolCall: {
                id: "call-1",
                name: "test_tool",
                arguments: "{}",
              },
            },
          ],
        },
        {
          id: "msg-tool",
          role: "tool" as const,
          createdAt: "2026-07-13T00:00:02.000Z",
          content: [
            {
              type: "tool_result" as const,
              toolResult: {
                toolCallId: "call-1",
                name: "test_tool",
                content: "tool output text",
                isError: false,
              },
            },
          ],
        },
      ],
      stream: false,
    };

    const events = [];
    for await (const event of provider.chat(input)) {
      events.push(event);
    }

    expect(global.fetch).toHaveBeenCalled();
    const postCall = (global.fetch as any).mock.calls.find(
      (call: any) => call[1]?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const requestBody = JSON.parse(postCall[1].body);

    const messages = requestBody.messages;
    expect(messages.length).toBe(3);

    // Verify message 0 (user)
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("hi");

    // Verify message 1 (assistant with tool calls)
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("");
    expect(messages[1].reasoning_content).toBe("");
    expect(messages[1].tool_calls).toBeDefined();

    // Verify message 2 (tool result)
    expect(messages[2].role).toBe("tool");
    expect(messages[2].content).toBe("tool output text");
    expect(messages[2].tool_call_id).toBe("call-1");
  });

  it("replays a reasoning-only V4 assistant turn with non-null empty content", async () => {
    const provider = new OpenAICompatibleProvider("test-key");

    for await (const event of provider.chat({
      model: "deepseek-v4-flash",
      messages: [
        {
          id: "reasoning-only",
          role: "assistant",
          createdAt: "2026-08-14T00:00:00.000Z",
          content: [{ type: "thinking", text: "private reasoning" }],
        },
        {
          id: "follow-up",
          role: "user",
          createdAt: "2026-08-14T00:00:01.000Z",
          content: [{ type: "text", text: "continue" }],
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
    expect(body.messages[0]).toEqual({
      role: "assistant",
      content: "",
    });
  });

  it("maps image blocks for vision-capable OpenAI-compatible gateways", async () => {
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://gateway.example.com/v1",
      { disablePreheat: true, maxRetries: 0 },
    );

    for await (const event of provider.chat({
      model: "vision-model",
      messages: [
        {
          id: "msg-image",
          role: "user",
          createdAt: "2026-07-22T00:00:00.000Z",
          content: [
            { type: "text", text: "Describe this" },
            {
              type: "image",
              mediaType: "image/png",
              name: "screen.png",
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
        type: "image_url",
        image_url: { url: "data:image/png;base64,aW1hZ2U=" },
      },
    ]);
  });

  it("preserves a dynamic tool's provider-facing JSON Schema", async () => {
    const provider = new OpenAICompatibleProvider("test-key");
    const inputJsonSchema = {
      type: "object",
      properties: { query: { type: "string", minLength: 2 } },
      required: ["query"],
      additionalProperties: false,
    };

    const events = [];
    for await (const event of provider.chat({
      model: "deepseek-v4-flash",
      messages: [
        {
          id: "msg-user-schema",
          role: "user",
          createdAt: "2026-07-19T00:00:00.000Z",
          content: [{ type: "text", text: "search" }],
        },
      ],
      tools: [
        {
          name: "mcp__docs__search",
          description: "Search docs",
          inputSchema: z.record(z.unknown()),
          inputJsonSchema,
        },
      ],
      stream: false,
    })) {
      events.push(event);
    }
    expect(events.length).toBeGreaterThan(0);

    const postCall = (global.fetch as any).mock.calls.find(
      (call: any) => call[1]?.method === "POST",
    );
    const requestBody = JSON.parse(postCall[1].body);
    expect(requestBody.tools[0].function.parameters).toEqual(inputJsonSchema);
  });

  it("should prevent double /v1/v1 in endpoint URLs when base URL ends with /v1", async () => {
    // Instantiate provider with OpenAI base URL (ending in /v1)
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://api.openai.com/v1",
    );

    const input = {
      model: "gpt-4o",
      messages: [
        {
          id: "msg-openai",
          role: "user" as const,
          createdAt: "2026-07-13T00:00:00.000Z",
          content: [{ type: "text" as const, text: "hi" }],
        },
      ],
      stream: false,
    };

    for await (const event of provider.chat(input)) {
      void event;
    }

    expect(global.fetch).toHaveBeenCalled();
    const postCall = (global.fetch as any).mock.calls.find(
      (call: any) => call[1]?.method === "POST",
    );
    expect(postCall).toBeDefined();
    // Verify that /v1/chat/completions is appended correctly without double /v1
    expect(postCall[0]).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("routes official DeepSeek FIM to the beta endpoint and requested stable lane", async () => {
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://api.deepseek.com/v1",
    );

    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ text: "completed_code", finish_reason: "stop" }],
          }),
      }),
    ) as any;

    const result = await provider.complete("prefix_code", {
      suffix: "suffix_code",
      model: "deepseek-v4-flash",
    });

    expect(result).toBe("completed_code");
    expect(global.fetch).toHaveBeenCalled();
    const completionsCall = (global.fetch as any).mock.calls.find((call: any) =>
      call[0].includes("/completions"),
    );
    expect(completionsCall).toBeDefined();
    // URL should be rewritten to beta endpoint
    expect(completionsCall[0]).toBe(
      "https://api.deepseek.com/beta/completions",
    );

    // Request body should contain suffix
    const body = JSON.parse(completionsCall[1].body);
    expect(body.prompt).toBe("prefix_code");
    expect(body.suffix).toBe("suffix_code");
    expect(body.model).toBe("deepseek-v4-flash");
    expect(body.thinking).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();

    await provider.complete("prefix_code", {
      suffix: "suffix_code",
      model: "deepseek-v4-pro",
    });
    const proBody = JSON.parse((global.fetch as any).mock.calls.at(-1)[1].body);
    expect(proBody.model).toBe("deepseek-v4-pro");
  });

  it("should support custom auth headers and model capability overrides for compatible gateways", async () => {
    const provider = new OpenAICompatibleProvider(
      undefined,
      "https://gateway.example.com/v1",
      {
        id: "ciyuan",
        apiKeyEnv: "CIYUAN_API_KEY",
        apiKeyHeader: "X-API-Key",
        apiKeyPrefix: "",
        headers: { "X-Gateway": "orbit" },
        disablePreheat: true,
        maxRetries: 0,
        modelCapabilities: {
          "vendor/reasoner-*": {
            thinking: true,
            toolCalls: false,
            streaming: true,
          },
        },
      },
    );
    process.env.CIYUAN_API_KEY = "test-ciyuan-key";

    try {
      const input = {
        model: "vendor/reasoner-fast",
        messages: [
          {
            id: "msg-gateway",
            role: "user" as const,
            createdAt: "2026-07-13T00:00:00.000Z",
            content: [{ type: "text" as const, text: "hi" }],
          },
        ],
        stream: false,
      };

      for await (const event of provider.chat(input)) {
        void event;
      }

      const postCall = (global.fetch as any).mock.calls.find(
        (call: any) => call[1]?.method === "POST",
      );
      expect(postCall).toBeDefined();
      expect(postCall[1].headers["X-API-Key"]).toBe("test-ciyuan-key");
      expect(postCall[1].headers["X-Gateway"]).toBe("orbit");
      expect(
        provider.getModelCapabilities("vendor/reasoner-fast"),
      ).toMatchObject({
        thinking: true,
        toolCalls: false,
        streaming: true,
      });
    } finally {
      delete process.env.CIYUAN_API_KEY;
    }
  });

  it("uses OpenAI reasoning parameters for GPT-5 models", async () => {
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://api.openai.com/v1",
      {
        id: "openai",
        disablePreheat: true,
        maxRetries: 0,
      },
    );

    for await (const event of provider.chat({
      model: "gpt-5.5",
      messages: [
        {
          id: "msg-gpt5",
          role: "user" as const,
          createdAt: "2026-07-13T00:00:00.000Z",
          content: [{ type: "text" as const, text: "hi" }],
        },
      ],
      stream: false,
      maxTokens: 1234,
      thinking: { enabled: true, budgetTokens: 4096 },
    })) {
      void event;
    }

    const postCall = (global.fetch as any).mock.calls.find(
      (call: any) => call[1]?.method === "POST",
    );
    const body = JSON.parse(postCall[1].body);
    expect(body.max_completion_tokens).toBe(1234);
    expect(body.reasoning_effort).toBe("high");
    expect(body.max_tokens).toBeUndefined();
    expect(body.thinking).toBeUndefined();
    expect(body.temperature).toBeUndefined();
  });

  it("uses official DeepSeek thinking parameters for V4 Pro", async () => {
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://api.deepseek.com",
      {
        disablePreheat: true,
        maxRetries: 0,
      },
    );

    expect(provider.getModelCapabilities("deepseek-v4-pro")).toMatchObject({
      toolCalls: true,
      jsonMode: true,
      thinking: true,
      promptCaching: true,
      maxContextTokens: 1_000_000,
      maxOutputTokens: 384_000,
    });

    for await (const event of provider.chat({
      model: "deepseek-v4-pro",
      messages: [
        {
          id: "msg-v4-pro",
          role: "user" as const,
          createdAt: "2026-07-13T00:00:00.000Z",
          content: [{ type: "text" as const, text: "think carefully" }],
        },
      ],
      stream: false,
      maxTokens: 1234,
      thinking: { enabled: true, budgetTokens: 8192 },
    })) {
      void event;
    }

    const postCall = (global.fetch as any).mock.calls.find(
      (call: any) => call[1]?.method === "POST",
    );
    const body = JSON.parse(postCall[1].body);
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("max");
    expect(body.temperature).toBeUndefined();
  });

  it("automatically applies DeepSeek semantics while preserving a gateway model id", async () => {
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://gateway.example.com/v1",
      { disablePreheat: true, maxRetries: 0 },
    );

    for await (const event of provider.chat({
      model: "vendor/deepseek-v4-pro-0813",
      messages: [
        {
          id: "msg-gateway-v4",
          role: "user",
          createdAt: "2026-08-14T00:00:00.000Z",
          content: [{ type: "text", text: "think" }],
        },
      ],
      tools: [
        {
          name: "zeta",
          description: "Zeta tool",
          inputSchema: z.object({ z: z.string(), a: z.string() }),
        },
        {
          name: "alpha",
          description: "Alpha tool",
          inputSchema: z.object({ value: z.string() }),
        },
      ],
      stream: false,
      thinking: { enabled: true, effort: "max" },
    })) {
      void event;
    }

    const postCall = vi
      .mocked(global.fetch)
      .mock.calls.find((call) => call[1]?.method === "POST");
    const body = JSON.parse(String(postCall?.[1]?.body));
    expect(body.model).toBe("vendor/deepseek-v4-pro-0813");
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("max");
    expect(body.temperature).toBeUndefined();
    expect(
      body.tools.map(
        (tool: { function: { name: string } }) => tool.function.name,
      ),
    ).toEqual(["alpha", "zeta"]);
    expect(
      provider.getModelCapabilities("vendor/deepseek-v4-pro-0813"),
    ).toMatchObject({
      thinking: true,
      vision: false,
      maxContextTokens: 1_000_000,
      modelVersion: "DeepSeek-V4-Pro-0813",
    });
  });

  it("emits non-stream DeepSeek reasoning_content before final content", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              finish_reason: "stop",
              message: {
                reasoning_content: "hidden reasoning",
                content: "final answer",
              },
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        }),
    }) as any;
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://api.deepseek.com",
      {
        disablePreheat: true,
        maxRetries: 0,
      },
    );
    const events = [];

    for await (const event of provider.chat({
      model: "deepseek-v4-pro",
      messages: [
        {
          id: "msg-nonstream-reasoning",
          role: "user" as const,
          createdAt: "2026-07-13T00:00:00.000Z",
          content: [{ type: "text" as const, text: "think" }],
        },
      ],
      stream: false,
    })) {
      events.push(event);
    }

    expect(events[0]).toEqual({
      type: "thinking_delta",
      text: "hidden reasoning",
    });
    expect(events[1]).toEqual({ type: "text_delta", text: "final answer" });
  });

  it("reports requested and gateway-resolved model identity", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: vi.fn(() => "request-42") },
      json: vi.fn().mockResolvedValue({
        id: "completion-42",
        model: "deepseek-v4-pro-202607",
        choices: [
          {
            finish_reason: "stop",
            message: { content: "ok" },
          },
        ],
      }),
    }) as any;
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://gateway.example/v1",
      { disablePreheat: true, maxRetries: 0 },
    );
    const events = [];

    for await (const event of provider.chat({
      model: "deepseek-v4-pro",
      messages: [
        {
          id: "msg-identity",
          role: "user",
          createdAt: "2026-07-18T00:00:00.000Z",
          content: [{ type: "text", text: "identity" }],
        },
      ],
      stream: false,
    })) {
      events.push(event);
    }

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "response_metadata",
        requestedModel: "deepseek-v4-pro",
        resolvedModel: "deepseek-v4-pro-202607",
        providerRequestId: "completion-42",
        apiFormat: "chat-completions",
        modelVersion: "DeepSeek-V4-Pro-0813",
      }),
    );
  });

  it("flushes each OpenAI-compatible SSE frame without waiting for the read chunk", async () => {
    const encoder = new TextEncoder();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              [
                'data: {"choices":[{"delta":{"content":"a"}}]}',
                "",
                'data: {"choices":[{"delta":{"content":"b"}}]}',
                "",
                'data: {"choices":[{"finish_reason":"stop","delta":{}}]}',
                "",
                "data: [DONE]",
                "",
              ].join("\n"),
            ),
          );
          controller.close();
        },
      }),
    }) as any;

    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://api.deepseek.com",
      {
        disablePreheat: true,
        maxRetries: 0,
      },
    );
    const deltas: string[] = [];

    for await (const event of provider.chat({
      model: "deepseek-v4-flash",
      messages: [
        {
          id: "msg-stream-frames",
          role: "user" as const,
          createdAt: "2026-07-13T00:00:00.000Z",
          content: [{ type: "text" as const, text: "hi" }],
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
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://api.deepseek.com",
      { disablePreheat: true, maxRetries: 0 },
    );
    const errors: Error[] = [];

    for await (const event of provider.chat({
      model: "deepseek-v4-flash",
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
        choices: [{ delta: { content: "x".repeat(1024 * 1024) } }],
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
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://api.deepseek.com",
      { disablePreheat: true, maxRetries: 0 },
    );
    const errors: Error[] = [];

    for await (const event of provider.chat({
      model: "deepseek-v4-flash",
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

  it("treats both V4 lanes as thinking-capable and enables Flash thinking by default", async () => {
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://api.deepseek.com",
      { disablePreheat: true, maxRetries: 0 },
    );

    expect(provider.getModelCapabilities("deepseek-v4-flash")).toMatchObject({
      thinking: true,
      toolCalls: true,
      maxContextTokens: 1_000_000,
      maxOutputTokens: 384_000,
    });

    for await (const event of provider.chat({
      model: "deepseek-v4-flash",
      messages: [
        {
          id: "msg-flash",
          role: "user",
          createdAt: new Date().toISOString(),
          content: [{ type: "text", text: "fix this code" }],
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
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.temperature).toBeUndefined();
    expect(body.reasoning_effort).toBe("high");
  });

  it("preserves reasoning only for assistant tool-call turns", async () => {
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://api.deepseek.com",
      { disablePreheat: true, maxRetries: 0 },
    );

    for await (const event of provider.chat({
      model: "deepseek-v4-pro",
      messages: [
        {
          id: "assistant-tool",
          role: "assistant",
          createdAt: new Date().toISOString(),
          content: [
            { type: "thinking", text: "must call a tool" },
            {
              type: "tool_call",
              toolCall: { id: "call-1", name: "read_file", arguments: "{}" },
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
                content: "",
              },
            },
          ],
        },
        {
          id: "assistant-answer",
          role: "assistant",
          createdAt: new Date().toISOString(),
          content: [
            { type: "thinking", text: "historical private reasoning" },
            { type: "text", text: "answer" },
          ],
        },
        {
          id: "user-next",
          role: "user",
          createdAt: new Date().toISOString(),
          content: [{ type: "text", text: "continue" }],
        },
      ],
      stream: false,
      thinking: { enabled: true, budgetTokens: 4096 },
    })) {
      void event;
    }

    const postCall = (global.fetch as any).mock.calls.find(
      (call: any) => call[1]?.method === "POST",
    );
    const body = JSON.parse(postCall[1].body);
    expect(body.messages[0]).toMatchObject({
      role: "assistant",
      content: "",
      reasoning_content: "must call a tool",
    });
    expect(body.messages[1]).toEqual({
      role: "tool",
      tool_call_id: "call-1",
      content: "(no output)",
    });
    expect(body.messages[2].reasoning_content).toBeUndefined();
  });

  it("reports truncated successful HTTP responses as model errors", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              finish_reason: "length",
              message: { content: "partial" },
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 4, total_tokens: 6 },
        }),
    }) as any;
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://api.deepseek.com",
      { disablePreheat: true, maxRetries: 0 },
    );
    const events = [];

    for await (const event of provider.chat({
      model: "deepseek-v4-flash",
      messages: [
        {
          id: "msg",
          role: "user",
          createdAt: new Date().toISOString(),
          content: [{ type: "text", text: "answer" }],
        },
      ],
      stream: false,
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect((events.at(-1) as any).error.message).toContain("truncated");
  });

  it("rejects malformed tool argument JSON instead of replaying a broken call", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-bad",
                    function: { name: "read_file", arguments: "{" },
                  },
                ],
              },
            },
          ],
        }),
    }) as any;
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://api.deepseek.com",
      { disablePreheat: true, maxRetries: 0 },
    );
    const events = [];

    for await (const event of provider.chat({
      model: "deepseek-v4-flash",
      messages: [
        {
          id: "msg-bad-tool",
          role: "user",
          createdAt: new Date().toISOString(),
          content: [{ type: "text", text: "read" }],
        },
      ],
      stream: false,
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect((events.at(-1) as any).error.message).toContain("malformed JSON");
    expect(events.some((event) => event.type === "tool_call")).toBe(false);
  });

  it("accepts complete gateway tool calls even when finish_reason is stop", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-compatible",
                    function: {
                      name: "write_file",
                      arguments: '{"path":"result.txt","content":"ok"}',
                    },
                  },
                ],
              },
            },
          ],
        }),
    }) as any;
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://api.deepseek.com",
      { disablePreheat: true, maxRetries: 0 },
    );
    const events = [];

    for await (const event of provider.chat({
      model: "deepseek-v4-flash",
      messages: [
        {
          id: "msg-compatible-tool",
          role: "user",
          createdAt: new Date().toISOString(),
          content: [{ type: "text", text: "write" }],
        },
      ],
      stream: false,
    })) {
      events.push(event);
    }

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_call",
          toolCall: expect.objectContaining({ id: "call-compatible" }),
        }),
        expect.objectContaining({ type: "done" }),
      ]),
    );
  });

  it("uses exact legacy alias semantics while sending canonical V4 model ids", async () => {
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://api.deepseek.com",
      { disablePreheat: true, maxRetries: 0 },
    );

    for (const model of ["deepseek-chat", "deepseek-reasoner"]) {
      for await (const event of provider.chat({
        model,
        messages: [
          {
            id: `msg-${model}`,
            role: "user",
            createdAt: new Date().toISOString(),
            content: [{ type: "text", text: "hello" }],
          },
        ],
        stream: false,
      })) {
        void event;
      }
    }

    const bodies = (global.fetch as any).mock.calls
      .filter((call: any) => call[1]?.method === "POST")
      .map((call: any) => JSON.parse(call[1].body));
    expect(bodies[0]).toMatchObject({
      model: "deepseek-v4-flash",
      thinking: { type: "disabled" },
    });
    expect(bodies[1]).toMatchObject({
      model: "deepseek-v4-flash",
      thinking: { type: "enabled" },
      reasoning_effort: "high",
    });
  });

  it("rejects unsupported official model ids before network I/O", async () => {
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://api.deepseek.com",
      { disablePreheat: true, maxRetries: 0 },
    );
    const events = [];

    for await (const event of provider.chat({
      model: "deepseek-v4-pr0",
      messages: [
        {
          id: "msg-typo",
          role: "user",
          createdAt: new Date().toISOString(),
          content: [{ type: "text", text: "hello" }],
        },
      ],
      stream: false,
    })) {
      events.push(event);
    }

    expect(global.fetch).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error" });
  });

  it("trusts official reasoning_content and preserves literal think tags in answer text", async () => {
    const encoder = new TextEncoder();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              [
                'data: {"choices":[{"delta":{"content":"<think>literal</think>"}}]}',
                "",
                'data: {"choices":[{"finish_reason":"stop","delta":{}}]}',
                "",
                'data: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":3,"prompt_cache_hit_tokens":16,"prompt_cache_miss_tokens":4}}',
                "",
                "data: [DONE]",
                "",
              ].join("\n"),
            ),
          );
          controller.close();
        },
      }),
    }) as any;
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://api.deepseek.com",
      { disablePreheat: true, maxRetries: 0 },
    );
    const events = [];

    for await (const event of provider.chat({
      model: "deepseek-v4-flash",
      messages: [
        {
          id: "msg-literal-think",
          role: "user",
          createdAt: new Date().toISOString(),
          content: [{ type: "text", text: "quote tags" }],
        },
      ],
      stream: true,
    })) {
      events.push(event);
    }

    expect(events).toContainEqual({
      type: "text_delta",
      text: "<think>literal</think>",
    });
    expect(events.some((event) => event.type === "thinking_delta")).toBe(false);
    expect(events).toContainEqual({
      type: "usage",
      usage: expect.objectContaining({
        cacheReadTokens: 16,
        cacheMissTokens: 4,
      }),
    });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("parses <thinking> and <reasoning> tag variants from compatible endpoints, across chunk splits", async () => {
    const encoder = new TextEncoder();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              [
                // The <thinking> open tag is split across two SSE frames.
                'data: {"choices":[{"delta":{"content":"Alpha<thinki"}}]}',
                "",
                'data: {"choices":[{"delta":{"content":"ng>hidden</thinking>Beta<reasoning>deep</reasoning>Gamma"}}]}',
                "",
                'data: {"choices":[{"finish_reason":"stop","delta":{}}]}',
                "",
                "data: [DONE]",
                "",
              ].join("\n"),
            ),
          );
          controller.close();
        },
      }),
    }) as any;
    const provider = new OpenAICompatibleProvider(
      "ollama-no-key",
      "http://localhost:11434/v1",
      { disablePreheat: true, maxRetries: 0 },
    );
    const events = [];

    for await (const event of provider.chat({
      model: "qwen2.5-coder",
      messages: [
        {
          id: "msg-think-variants",
          role: "user",
          createdAt: new Date().toISOString(),
          content: [{ type: "text", text: "solve it" }],
        },
      ],
      stream: true,
    })) {
      events.push(event);
    }

    const thinkingText = events
      .filter((event) => event.type === "thinking_delta")
      .map((event) => ("text" in event ? event.text : ""))
      .join("");
    const answerText = events
      .filter((event) => event.type === "text_delta")
      .map((event) => ("text" in event ? event.text : ""))
      .join("");
    expect(thinkingText).toBe("hiddendeep");
    expect(answerText).toBe("AlphaBetaGamma");
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("surfaces API error frames and premature official stream EOF", async () => {
    const encoder = new TextEncoder();
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://api.deepseek.com",
      { disablePreheat: true, maxRetries: 0 },
    );

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"error":{"message":"queue failed","type":"server_error"}}\n\n',
            ),
          );
          controller.close();
        },
      }),
    }) as any;
    const errorEvents = [];
    for await (const event of provider.chat({
      model: "deepseek-v4-flash",
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
    expect((errorEvents.at(-1) as any).error.message).toContain("queue failed");

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
            ),
          );
          controller.close();
        },
      }),
    }) as any;
    const eofEvents = [];
    for await (const event of provider.chat({
      model: "deepseek-v4-flash",
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
    expect((eofEvents.at(-1) as any).error.message).toContain("finish reason");
    expect(eofEvents.some((event) => event.type === "done")).toBe(false);
  });

  it("classifies an empty terminated stream as retryable transport closure", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      headers: new Headers(),
      body: new ReadableStream({
        start(controller) {
          controller.error(new TypeError("terminated"));
        },
      }),
    }) as any;
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://api.deepseek.com",
      { disablePreheat: true, maxRetries: 0 },
    );

    const events = [];
    for await (const event of provider.chat({
      model: "deepseek-v4-flash",
      messages: [],
      stream: true,
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
      type: "error",
      error: {
        code: "STREAM_CLOSED",
        retryable: true,
        partialOutput: false,
      },
    });
  });

  it("requires the official [DONE] marker even after a streamed finish reason", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          'data: {"id":"stream-without-done","model":"deepseek-v4-flash","choices":[{"delta":{"content":"partial"},"finish_reason":"stop"}]}\n\n',
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
      );
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://api.deepseek.com",
      { disablePreheat: true, maxRetries: 0 },
    );

    const events = [];
    for await (const event of provider.chat({
      model: "deepseek-v4-flash",
      messages: [],
      stream: true,
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect((events.at(-1) as any).error.message).toContain("[DONE]");
    expect(events.some((event) => event.type === "done")).toBe(false);
  });

  it("rejects a successful official response with no text, reasoning, or tools", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      Response.json({
        id: "empty-completion",
        model: "deepseek-v4-pro",
        choices: [{ finish_reason: "stop", message: { content: "" } }],
        usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
      }),
    );
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://api.deepseek.com",
      { disablePreheat: true, maxRetries: 0 },
    );

    const events = [];
    for await (const event of provider.chat({
      model: "deepseek-v4-pro",
      messages: [],
      stream: false,
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect((events.at(-1) as any).error.message).toContain("empty completion");
    expect(events.some((event) => event.type === "done")).toBe(false);
  });

  it("keeps official request invariants ahead of extraBody overrides", async () => {
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://api.deepseek.com",
      {
        disablePreheat: true,
        maxRetries: 0,
        extraBody: {
          model: "typo-model",
          messages: [{ role: "user", content: "injected" }],
          thinking: { type: "enabled", budget_tokens: 1 },
          reasoning_effort: "low",
          temperature: 2,
        },
      },
    );

    for await (const event of provider.chat({
      model: "deepseek-v4-flash",
      messages: [
        {
          id: "msg-safe-body",
          role: "user",
          createdAt: new Date().toISOString(),
          content: [{ type: "text", text: "original" }],
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
    expect(body).toMatchObject({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "original" }],
      thinking: { type: "enabled" },
    });
    expect(body.temperature).toBeUndefined();
    expect(body.reasoning_effort).toBe("high");
  });

  it("rejects impossible provider token counters", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ finish_reason: "stop", message: { content: "ok" } }],
          usage: { prompt_tokens: 1_000_000_001 },
        }),
    }) as any;
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://api.deepseek.com",
      { disablePreheat: true, maxRetries: 0 },
    );
    const events = [];

    for await (const event of provider.chat({
      model: "deepseek-v4-flash",
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

  it("redacts credentials and bounds untrusted HTTP errors", async () => {
    const secret = "ds-super-secret-token";
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () =>
        Promise.resolve(
          `authorization: Bearer ${secret}\n${"provider detail ".repeat(200)}`,
        ),
    }) as any;
    const provider = new OpenAICompatibleProvider(
      secret,
      "https://api.deepseek.com",
      { disablePreheat: true, maxRetries: 0 },
    );
    const events = [];

    for await (const event of provider.chat({
      model: "deepseek-v4-flash",
      messages: [
        {
          id: "msg-http-error",
          role: "user",
          createdAt: new Date().toISOString(),
          content: [{ type: "text", text: "hello" }],
        },
      ],
      stream: false,
    })) {
      events.push(event);
    }

    const message = (events.at(-1) as any).error.message as string;
    expect(message).toContain("HTTP 401");
    expect(message).not.toContain(secret);
    expect(message.length).toBeLessThan(1100);
  });

  it("rejects unsupported official embeddings and clamps FIM output", async () => {
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://api.deepseek.com/v1",
      { disablePreheat: true, maxRetries: 0 },
    );

    await expect(provider.embed(["hello"])).rejects.toThrow(
      "does not provide an embeddings endpoint",
    );
    expect(global.fetch).not.toHaveBeenCalled();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ text: "done", finish_reason: "stop" }],
        }),
    }) as any;
    await provider.complete("prefix", { maxTokens: -10, suffix: "suffix" });
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body).toMatchObject({
      model: "deepseek-v4-flash",
      max_tokens: 1,
      suffix: "suffix",
    });
  });

  it("does not perform network I/O in the constructor", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { cancel },
    }) as any;
    const provider = new OpenAICompatibleProvider(
      "test-key",
      "https://api.deepseek.com",
      { maxRetries: 0 },
    );

    expect(global.fetch).not.toHaveBeenCalled();
    await provider.initialize();
    await provider.initialize();
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.deepseek.com",
      expect.objectContaining({ method: "HEAD" }),
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
