import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DeepSeekOpenAIProvider } from "./DeepSeekOpenAIProvider.js";
import {
  buildDeepSeekResponsesRequest,
  chatWithDeepSeekResponses,
} from "./DeepSeekResponsesApi.js";
import { getDeepSeekV4ModelProfile } from "./DeepSeekV4.js";
import type { ModelChatInput, ModelEvent } from "../types.js";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function profile() {
  const value = getDeepSeekV4ModelProfile("deepseek-v4-flash");
  if (!value) throw new Error("Flash profile missing.");
  return value;
}

function input(overrides: Partial<ModelChatInput> = {}): ModelChatInput {
  return {
    model: "deepseek-v4-flash",
    system: "Be precise.",
    messages: [
      {
        id: "assistant-turn",
        role: "assistant",
        createdAt: "2026-07-31T00:00:00.000Z",
        content: [
          { type: "thinking", text: "Need the tool." },
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
        id: "tool-turn",
        role: "tool",
        createdAt: "2026-07-31T00:00:01.000Z",
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
      {
        id: "user-turn",
        role: "user",
        createdAt: "2026-07-31T00:00:02.000Z",
        content: [{ type: "text", text: "Continue" }],
      },
    ],
    tools: [
      {
        name: "read_file",
        description: "Read one file",
        inputSchema: z.object({ path: z.string() }),
      },
    ],
    stream: true,
    thinking: { enabled: true, effort: "low", budgetTokens: 8192 },
    ...overrides,
  };
}

async function collect(
  stream: AsyncIterable<ModelEvent>,
): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("DeepSeek Responses API", () => {
  it("builds stateless V4 requests with native reasoning and flat function tools", () => {
    const body = buildDeepSeekResponsesRequest(input(), profile(), {
      previous_response_id: "must-not-survive",
      stream_options: { include_usage: true },
      reasoning: { effort: "max" },
      model: "must-not-survive",
    });

    expect(body).toMatchObject({
      model: "deepseek-v4-flash",
      instructions: "Be precise.",
      stream: true,
      reasoning: { effort: "low" },
      tools: [
        {
          type: "function",
          name: "read_file",
          description: "Read one file",
        },
      ],
    });
    expect(body.previous_response_id).toBeUndefined();
    expect(body.stream_options).toBeUndefined();
    expect(body.temperature).toBeUndefined();
    expect(body.input).toEqual([
      { type: "reasoning", content: "Need the tool." },
      {
        type: "function_call",
        call_id: "call-1",
        name: "read_file",
        arguments: '{"path":"README.md"}',
      },
      {
        type: "function_call_output",
        call_id: "call-1",
        output: "contents",
      },
      { type: "message", role: "user", content: "Continue" },
    ]);
  });

  it("normalizes semantic SSE events and waits for the terminal response event", async () => {
    const frames = [
      {
        event: "response.created",
        response: {
          id: "resp-0731",
          model: "deepseek-v4-flash",
          status: "in_progress",
          output: [],
        },
      },
      { event: "response.reasoning_text.delta", delta: "reason" },
      { event: "response.output_text.delta", delta: "answer" },
      {
        event: "response.output_item.added",
        output_index: 2,
        item: {
          id: "item-call",
          type: "function_call",
          call_id: "call-2",
          name: "read_file",
          arguments: "",
        },
      },
      {
        event: "response.function_call_arguments.delta",
        item_id: "item-call",
        delta: '{"path":',
      },
      {
        event: "response.function_call_arguments.done",
        item_id: "item-call",
        arguments: '{"path":"package.json"}',
      },
      {
        event: "response.completed",
        response: {
          id: "resp-0731",
          model: "deepseek-v4-flash",
          status: "completed",
          output: [
            {
              id: "item-call",
              type: "function_call",
              call_id: "call-2",
              name: "read_file",
              arguments: '{"path":"package.json"}',
            },
          ],
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            total_tokens: 120,
            input_tokens_details: { cached_tokens: 80 },
            output_tokens_details: { reasoning_tokens: 6 },
          },
        },
      },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join("")
      .trimEnd();
    global.fetch = vi.fn().mockResolvedValue(
      new Response(frames, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );

    const events = await collect(
      chatWithDeepSeekResponses(
        input({ messages: input().messages.slice(2) }),
        {
          endpoint: "https://api.deepseek.com/v1/responses",
          headers: { Authorization: "Bearer test-key" },
          apiKey: "test-key",
          runtime: { maxRetries: 0, streamTimeoutMs: 5_000 },
          profile: profile(),
        },
      ),
    );

    expect(events).toContainEqual({
      type: "thinking_delta",
      text: "reason",
    });
    expect(events).toContainEqual({ type: "text_delta", text: "answer" });
    expect(events).toContainEqual({
      type: "tool_call",
      toolCall: {
        id: "call-2",
        name: "read_file",
        arguments: '{"path":"package.json"}',
      },
    });
    expect(events).toContainEqual({
      type: "usage",
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        cacheReadTokens: 80,
        cacheMissTokens: 20,
        reasoningTokens: 6,
      },
    });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("routes official Flash to Responses and exposes its concrete release metadata", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp-native",
          model: "deepseek-v4-flash",
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "ok" }],
            },
          ],
          usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new DeepSeekOpenAIProvider(
      "test-key",
      "https://api.deepseek.com",
      { deepSeekApiFormat: "responses", maxRetries: 0, disablePreheat: true },
    );

    const events = await collect(
      provider.chat(
        input({ messages: input().messages.slice(2), stream: false }),
      ),
    );
    const [url, request] = vi.mocked(global.fetch).mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/v1/responses");
    expect(JSON.parse(String(request?.body))).toMatchObject({
      reasoning: { effort: "low" },
      stream: false,
    });
    expect(events).toContainEqual({
      type: "response_metadata",
      requestedModel: "deepseek-v4-flash",
      resolvedModel: "deepseek-v4-flash",
      providerRequestId: "resp-native",
      apiFormat: "responses",
      modelVersion: "DeepSeek-V4-Flash-0731",
    });
    expect(provider.getModelCapabilities("deepseek-v4-flash")).toMatchObject({
      apiFormats: ["responses", "chat-completions"],
      reasoningEfforts: ["low", "high", "max"],
      parallelToolCalls: true,
      modelVersion: "DeepSeek-V4-Flash-0731",
      maxContextTokens: 1_048_576,
    });
  });

  it("honors configured capability restrictions before building Responses requests", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp-restricted",
          model: "deepseek-v4-flash",
          status: "completed",
          output: [],
          usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new DeepSeekOpenAIProvider(
      "test-key",
      "https://api.deepseek.com",
      {
        deepSeekApiFormat: "responses",
        maxRetries: 0,
        disablePreheat: true,
        capabilities: {
          streaming: false,
          toolCalls: false,
          jsonMode: false,
          thinking: false,
        },
      },
    );

    await collect(
      provider.chat(input({ responseFormat: "json", stream: true })),
    );
    const body = JSON.parse(
      String(vi.mocked(global.fetch).mock.calls[0][1]?.body),
    );
    expect(body.stream).toBe(false);
    expect(body.reasoning).toEqual({ effort: "none" });
    expect(body.tools).toBeUndefined();
    expect(body.text).toBeUndefined();
  });

  it("falls back to Chat Completions only when auto mode sees an unavailable endpoint", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "chat-fallback",
            model: "deepseek-v4-flash",
            choices: [{ finish_reason: "stop", message: { content: "ok" } }],
            usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "chat-circuit-fallback",
          model: "deepseek-v4-flash",
          choices: [{ finish_reason: "stop", message: { content: "ok" } }],
          usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
        }),
      );
    const provider = new DeepSeekOpenAIProvider(
      "test-key",
      "https://api.deepseek.com",
      { deepSeekApiFormat: "auto", maxRetries: 0, disablePreheat: true },
    );

    const events = await collect(
      provider.chat(
        input({ messages: input().messages.slice(2), stream: false }),
      ),
    );

    expect(vi.mocked(global.fetch).mock.calls.map(([url]) => url)).toEqual([
      "https://api.deepseek.com/v1/responses",
      "https://api.deepseek.com/v1/chat/completions",
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "response_metadata",
        apiFormat: "chat-completions",
      }),
    );
    expect(events.at(-1)).toEqual({ type: "done" });

    const secondEvents = await collect(
      provider.chat(
        input({ messages: input().messages.slice(2), stream: false }),
      ),
    );
    expect(vi.mocked(global.fetch).mock.calls.map(([url]) => url)).toEqual([
      "https://api.deepseek.com/v1/responses",
      "https://api.deepseek.com/v1/chat/completions",
      "https://api.deepseek.com/v1/chat/completions",
    ]);
    expect(secondEvents).toContainEqual(
      expect.objectContaining({
        type: "response_metadata",
        apiFormatFallback: { from: "responses", status: 404 },
      }),
    );
  });

  it("recognizes explicit gateway unsupported-route errors without masking request errors", async () => {
    const chatResponse = () =>
      Response.json({
        id: "chat-after-unsupported",
        model: "deepseek-v4-flash",
        choices: [{ finish_reason: "stop", message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("Responses API endpoint is not supported", {
          status: 400,
        }),
      )
      .mockResolvedValueOnce(chatResponse());
    const provider = new DeepSeekOpenAIProvider(
      "test-key",
      "https://future-gateway.example/v1",
      { deepSeekApiFormat: "auto", maxRetries: 0, disablePreheat: true },
    );
    await collect(provider.chat(input({ messages: [], stream: false })));
    expect(global.fetch).toHaveBeenCalledTimes(2);

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("invalid model", { status: 400 }));
    await collect(provider.chat(input({ messages: [], stream: false })));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry authentication failures through another transport", async () => {
    const secret = `ds-${"s".repeat(40)}`;
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(`invalid credential ${secret}`, { status: 401 }),
      );
    const provider = new DeepSeekOpenAIProvider(
      secret,
      "https://api.deepseek.com",
      { deepSeekApiFormat: "auto", maxRetries: 0, disablePreheat: true },
    );

    const events = await collect(
      provider.chat(input({ messages: [], stream: false })),
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const error = events.find((event) => event.type === "error");
    expect(error).toMatchObject({ type: "error" });
    if (error?.type === "error") {
      expect(String(error.error)).not.toContain(secret);
      expect(String(error.error)).toContain("HTTP 401");
    }
  });

  it("turns incomplete terminal responses into actionable truncation errors", async () => {
    const frame = `data: ${JSON.stringify({
      event: "response.incomplete",
      response: {
        id: "resp-incomplete",
        model: "deepseek-v4-flash",
        status: "incomplete",
        output: [],
        incomplete_details: { reason: "max_output_tokens" },
        usage: { input_tokens: 10, output_tokens: 8, total_tokens: 18 },
      },
    })}`;
    global.fetch = vi.fn().mockResolvedValue(
      new Response(frame, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );

    const events = await collect(
      chatWithDeepSeekResponses(input({ messages: [] }), {
        endpoint: "https://api.deepseek.com/v1/responses",
        headers: { Authorization: "Bearer test-key" },
        apiKey: "test-key",
        runtime: { maxRetries: 0, streamTimeoutMs: 5_000 },
        profile: profile(),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({
          message: expect.stringContaining("truncated"),
        }),
      }),
    );
    expect(events).not.toContainEqual({ type: "done" });
  });

  it("applies the DeepSeek model-family contract through TokenDance", async () => {
    const gatewayModel = "deepseek-ai/deepseek-v4-flash-0731";
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "tokendance-chat",
          model: gatewayModel,
          choices: [{ finish_reason: "stop", message: { content: "ok" } }],
          usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new DeepSeekOpenAIProvider(
      "test-key",
      "https://tokendance.space/gateway/v1",
      {
        id: "tokendance",
        deepSeekApiFormat: "chat-completions",
        maxRetries: 0,
        disablePreheat: true,
      },
    );

    const events = await collect(
      provider.chat(
        input({
          model: gatewayModel,
          messages: input().messages.slice(2),
          stream: false,
        }),
      ),
    );
    const [url, request] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(String(request?.body));
    expect(url).toBe("https://tokendance.space/gateway/v1/chat/completions");
    expect(body).toMatchObject({
      model: gatewayModel,
      thinking: { type: "enabled" },
      reasoning_effort: "low",
    });
    expect(body.temperature).toBeUndefined();
    expect(provider.getModelCapabilities(gatewayModel)).toMatchObject({
      apiFormats: ["chat-completions"],
      modelVersion: "DeepSeek-V4-Flash-0731",
      maxContextTokens: 1_048_576,
      parallelToolCalls: true,
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "response_metadata",
        apiFormat: "chat-completions",
        modelVersion: "DeepSeek-V4-Flash-0731",
      }),
    );
  });

  it("lets future gateways opt into Responses for DeepSeek without host checks", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "future-response",
          model: "deepseek-v4-flash",
          status: "completed",
          output: [],
          usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new DeepSeekOpenAIProvider(
      "test-key",
      "https://future-gateway.example/api/v1",
      {
        id: "future-gateway",
        deepSeekApiFormat: "responses",
        maxRetries: 0,
        disablePreheat: true,
      },
    );

    expect(
      await collect(provider.chat(input({ messages: [], stream: false }))),
    ).toContainEqual({ type: "done" });
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(
      "https://future-gateway.example/api/v1/responses",
    );
  });

  it("keeps non-DeepSeek models on the generic compatible path", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "generic-chat",
          model: "vendor-general-model",
          choices: [{ finish_reason: "stop", message: { content: "ok" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new DeepSeekOpenAIProvider(
      "test-key",
      "https://future-gateway.example/v1",
      {
        id: "future-gateway",
        deepSeekApiFormat: "responses",
        maxRetries: 0,
        disablePreheat: true,
      },
    );
    await collect(
      provider.chat(
        input({
          model: "vendor-general-model",
          messages: input().messages.slice(2),
          stream: false,
          thinking: undefined,
        }),
      ),
    );

    const [url, request] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(String(request?.body));
    expect(url).toBe("https://future-gateway.example/v1/chat/completions");
    expect(body.model).toBe("vendor-general-model");
    expect(body.thinking).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.temperature).toBe(0.7);
    expect(
      provider.getModelCapabilities("vendor-general-model"),
    ).not.toHaveProperty("modelVersion");
  });

  it("routes the official 0813 Pro release through Responses in auto mode", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      Response.json({
        id: "resp-pro-0813",
        model: "deepseek-v4-pro",
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "ok" }],
          },
        ],
        usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
      }),
    );
    const provider = new DeepSeekOpenAIProvider(
      "test-key",
      "https://api.deepseek.com",
      { deepSeekApiFormat: "auto", maxRetries: 0, disablePreheat: true },
    );
    const events = await collect(
      provider.chat(
        input({ model: "deepseek-v4-pro", messages: [], stream: false }),
      ),
    );
    expect(vi.mocked(global.fetch).mock.calls[0]?.[0]).toBe(
      "https://api.deepseek.com/v1/responses",
    );
    expect(events).toContainEqual({
      type: "response_metadata",
      requestedModel: "deepseek-v4-pro",
      resolvedModel: "deepseek-v4-pro",
      providerRequestId: "resp-pro-0813",
      apiFormat: "responses",
      modelVersion: "DeepSeek-V4-Pro-0813",
    });
    expect(provider.getModelCapabilities("deepseek-v4-pro")).toMatchObject({
      apiFormats: ["responses", "chat-completions"],
      reasoningEfforts: ["low", "high", "max"],
      modelVersion: "DeepSeek-V4-Pro-0813",
    });
  });

  it("keeps provider-qualified aliases away from the strict official endpoint", async () => {
    global.fetch = vi.fn();
    const provider = new DeepSeekOpenAIProvider(
      "test-key",
      "https://api.deepseek.com",
      { deepSeekApiFormat: "auto", maxRetries: 0, disablePreheat: true },
    );
    const events = await collect(
      provider.chat(
        input({
          model: "deepseek-ai/deepseek-v4-flash-0731",
          messages: [],
        }),
      ),
    );
    expect(events).toEqual([expect.objectContaining({ type: "error" })]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
