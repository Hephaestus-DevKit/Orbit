import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelChatInput, ModelEvent } from "../types.js";
import { DeepSeekProvider } from "./DeepSeekProvider.js";
import { z } from "zod";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function input(overrides: Partial<ModelChatInput> = {}): ModelChatInput {
  return {
    model: "deepseek-v4-flash",
    messages: [
      {
        id: "user-1",
        role: "user",
        createdAt: "2026-08-14T00:00:00.000Z",
        content: [{ type: "text", text: "hello" }],
      },
    ],
    stream: false,
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

describe("DeepSeekProvider", () => {
  it("sends current Flash through the official API with tools and thinking disabled", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      Response.json({
        id: "flash-current",
        model: "deepseek-flash",
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call-add",
                  type: "function",
                  function: { name: "add", arguments: '{"a":2}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
    const provider = new DeepSeekProvider("test-key", undefined, {
      disablePreheat: true,
      maxRetries: 0,
    });
    expect(provider.getModelCapabilities("deepseek-flash")).toMatchObject({
      toolCalls: true,
      vision: true,
      thinking: true,
      jsonMode: true,
      modelVersion: "DeepSeek-V4.1-Flash",
    });
    const events = await collect(
      provider.chat(
        input({
          model: "deepseek-flash",
          thinking: { enabled: false },
          tools: [
            {
              name: "add",
              description: "Add",
              inputSchema: z.object({ a: z.number() }),
            },
          ],
        }),
      ),
    );
    const body = JSON.parse(
      String(vi.mocked(global.fetch).mock.calls[0][1]?.body),
    );
    expect(body.model).toBe("deepseek-flash");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(events).toContainEqual({
      type: "tool_call",
      toolCall: { id: "call-add", name: "add", arguments: '{"a":2}' },
    });
    expect(events.some((event) => event.type === "error")).toBe(false);
  });

  it("exposes one product with three official transports and exact V4 limits", () => {
    const provider = new DeepSeekProvider("test-key");

    expect(provider.type).toBe("deepseek");
    expect(provider.getModelCapabilities("deepseek-v4-pro")).toMatchObject({
      apiFormats: ["chat-completions", "responses", "anthropic"],
      maxContextTokens: 1_000_000,
      maxOutputTokens: 384_000,
      reasoningEfforts: ["low", "high", "max"],
      modelVersion: "DeepSeek-V4-Pro-0813",
    });
  });

  it("uses Chat by default and Responses for schema-constrained output", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          id: "chat-1",
          model: "deepseek-v4-flash",
          choices: [{ finish_reason: "stop", message: { content: "ok" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "response-1",
          model: "deepseek-v4-flash",
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "{}" }],
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        }),
      );
    const provider = new DeepSeekProvider("test-key", undefined, {
      disablePreheat: true,
      maxRetries: 0,
    });

    await collect(provider.chat(input()));
    await collect(
      provider.chat(
        input({
          responseFormat: "json",
          responseJsonSchema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
            additionalProperties: false,
          },
        }),
      ),
    );

    expect(vi.mocked(global.fetch).mock.calls.map(([url]) => url)).toEqual([
      "https://api.deepseek.com/v1/chat/completions",
      "https://api.deepseek.com/v1/responses",
    ]);
  });

  it("falls back to Chat when Responses is unavailable and opens a short circuit", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("Responses is not supported", { status: 404 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "chat-fallback-1",
          model: "deepseek-v4-flash",
          choices: [{ finish_reason: "stop", message: { content: "ok" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "chat-fallback-2",
          model: "deepseek-v4-flash",
          choices: [{ finish_reason: "stop", message: { content: "ok" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    const provider = new DeepSeekProvider("test-key", undefined, {
      disablePreheat: true,
      maxRetries: 0,
    });
    const structuredInput = input({
      responseFormat: "json",
      responseJsonSchema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
    });

    const firstAttempt = await collect(provider.chat(structuredInput));
    const secondAttempt = await collect(provider.chat(structuredInput));

    expect(firstAttempt.some((event) => event.type === "error")).toBe(false);
    expect(secondAttempt.some((event) => event.type === "error")).toBe(false);
    expect(vi.mocked(global.fetch).mock.calls.map(([url]) => url)).toEqual([
      "https://api.deepseek.com/v1/responses",
      "https://api.deepseek.com/v1/chat/completions",
      "https://api.deepseek.com/v1/chat/completions",
    ]);
  });

  it("uses the isolated Anthropic dialect only when explicitly selected", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      Response.json({
        id: "message-1",
        model: "deepseek-v4-pro",
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    const provider = new DeepSeekProvider("test-key", undefined, {
      deepSeekApiFormat: "anthropic",
      disablePreheat: true,
      maxRetries: 0,
    });

    const events = await collect(
      provider.chat(input({ model: "deepseek-v4-pro" })),
    );

    expect(vi.mocked(global.fetch).mock.calls[0]?.[0]).toBe(
      "https://api.deepseek.com/anthropic/v1/messages",
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "response_metadata",
        apiFormat: "anthropic",
        endpointKind: "official",
      }),
    );
  });

  it.each(["deepseek-flash", "deepseek-v4-flash"])(
    "uses one canonical tool catalog across all three transports for %s",
    async (model) => {
      const tools = [
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
      ];
      const formats = ["chat-completions", "responses", "anthropic"] as const;

      for (const format of formats) {
        global.fetch = vi.fn().mockResolvedValue(
          format === "responses"
            ? Response.json({
                id: "response-1",
                model: "deepseek-v4-flash",
                status: "completed",
                output: [
                  {
                    type: "message",
                    role: "assistant",
                    content: [{ type: "output_text", text: "ok" }],
                  },
                ],
                usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
              })
            : format === "anthropic"
              ? Response.json({
                  id: "message-1",
                  model: "deepseek-v4-flash",
                  content: [{ type: "text", text: "ok" }],
                  stop_reason: "end_turn",
                  usage: { input_tokens: 1, output_tokens: 1 },
                })
              : Response.json({
                  id: "chat-1",
                  model: "deepseek-v4-flash",
                  choices: [
                    { finish_reason: "stop", message: { content: "ok" } },
                  ],
                  usage: {
                    prompt_tokens: 1,
                    completion_tokens: 1,
                    total_tokens: 2,
                  },
                }),
        );
        const provider = new DeepSeekProvider("test-key", undefined, {
          deepSeekApiFormat: format,
          disablePreheat: true,
          maxRetries: 0,
        });

        const events = await collect(provider.chat(input({ tools, model })));
        expect(events.some((event) => event.type === "error")).toBe(false);

        const request = vi.mocked(global.fetch).mock.calls[0]?.[1];
        const body = JSON.parse(String(request?.body)) as {
          model: string;
          tools: Array<{
            name?: string;
            function?: { name: string; parameters: Record<string, unknown> };
            input_schema?: Record<string, unknown>;
            parameters?: Record<string, unknown>;
          }>;
        };
        expect(body.model).toBe(model);
        const names = body.tools.map(
          (tool) => tool.function?.name ?? tool.name,
        );
        expect(names).toEqual(["alpha", "zeta"]);
        const zeta = body.tools[1];
        const schema =
          zeta.function?.parameters ?? zeta.input_schema ?? zeta.parameters;
        expect(Object.keys((schema?.properties ?? {}) as object)).toEqual([
          "a",
          "z",
        ]);
      }
    },
  );
});
