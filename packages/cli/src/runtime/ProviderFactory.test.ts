import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, type OrbitConfig } from "@orbit-build/config";
import type { ModelEvent } from "@orbit-build/model-providers";
import { createProviderFromConfig } from "./ProviderFactory.js";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

async function consume(stream: AsyncIterable<ModelEvent>): Promise<void> {
  for await (const event of stream) void event;
}

function chatInput() {
  return {
    model: "deepseek-v4-flash",
    messages: [
      {
        id: "factory-test",
        role: "user" as const,
        createdAt: "2026-08-01T00:00:00.000Z",
        content: [{ type: "text" as const, text: "hello" }],
      },
    ],
    stream: false,
  };
}

describe("ProviderFactory DeepSeek transport wiring", () => {
  it("uses the documented Chat transport for the bundled official Flash profile", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      Response.json({
        id: "factory-chat",
        model: "deepseek-v4-flash",
        choices: [{ finish_reason: "stop", message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
    const config = structuredClone(DEFAULT_CONFIG);
    config.providers.deepseek.apiKey = "test-key";
    config.providers.deepseek.disablePreheat = true;
    config.providers.deepseek.maxRetries = 0;

    await consume(createProviderFromConfig(config).chat(chatInput()));
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(
      "https://api.deepseek.com/v1/chat/completions",
    );
  });

  it("upgrades legacy generic configs on the official endpoint to the DeepSeek product provider", () => {
    const config = structuredClone(DEFAULT_CONFIG) as OrbitConfig;
    config.providers.deepseek.type = "openai-compatible";

    const provider = createProviderFromConfig(config);

    expect(provider.type).toBe("deepseek");
    expect(provider.capabilities.apiFormats).toEqual([
      "chat-completions",
      "responses",
      "anthropic",
    ]);
  });

  it("keeps TokenDance on its configured Chat transport", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      Response.json({
        id: "factory-chat",
        model: "deepseek-v4-flash",
        choices: [{ finish_reason: "stop", message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
    const config = structuredClone(DEFAULT_CONFIG) as OrbitConfig;
    config.provider.default = "tokendance";
    config.providers.tokendance.apiKey = "test-key";
    config.providers.tokendance.disablePreheat = true;
    config.providers.tokendance.maxRetries = 0;

    const provider = createProviderFromConfig(config);
    await consume(
      provider.chat({
        ...chatInput(),
        thinking: { enabled: true, effort: "max" },
      }),
    );
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(
      "https://tokendance.space/gateway/v1/chat/completions",
    );
    const body = JSON.parse(
      String(vi.mocked(global.fetch).mock.calls[0]?.[1]?.body),
    );
    expect(body).toMatchObject({
      model: "deepseek-v4-flash",
      thinking: { type: "enabled" },
      reasoning_effort: "max",
    });
    expect(provider.getModelCapabilities?.("deepseek-v4-flash")).toMatchObject({
      thinking: true,
      maxContextTokens: 1_000_000,
      modelVersion: "DeepSeek-V4-Flash-0731",
    });
  });

  it("keeps custom Anthropic-compatible gateways on the generic adapter", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      Response.json({
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    const config = structuredClone(DEFAULT_CONFIG) as OrbitConfig;
    config.provider.default = "anthropic-gateway";
    config.providers["anthropic-gateway"] = {
      type: "anthropic-compatible",
      baseUrl: "https://anthropic-gateway.example/v1",
      apiKey: "test-key",
      disablePreheat: true,
      maxRetries: 0,
    };

    await consume(
      createProviderFromConfig(config).chat({
        ...chatInput(),
        model: "claude-compatible",
      }),
    );
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(
      "https://anthropic-gateway.example/v1/messages",
    );
  });

  it("activates DeepSeek semantics through an Anthropic-compatible gateway", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      Response.json({
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    const config = structuredClone(DEFAULT_CONFIG) as OrbitConfig;
    config.provider.default = "anthropic-deepseek-gateway";
    config.providers["anthropic-deepseek-gateway"] = {
      type: "anthropic-compatible",
      baseUrl: "https://gateway.example/v1",
      apiKey: "test-key",
      disablePreheat: true,
      maxRetries: 0,
    };

    const provider = createProviderFromConfig(config);
    await consume(
      provider.chat({
        ...chatInput(),
        model: "deepseek-ai/deepseek-v4-pro-0813",
        thinking: { enabled: true, effort: "max" },
      }),
    );

    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(
      "https://gateway.example/v1/messages",
    );
    const body = JSON.parse(
      String(vi.mocked(global.fetch).mock.calls[0]?.[1]?.body),
    );
    expect(body).toMatchObject({
      model: "deepseek-ai/deepseek-v4-pro-0813",
      thinking: { type: "enabled" },
      output_config: { effort: "max" },
    });
    expect(
      provider.getModelCapabilities?.("deepseek-ai/deepseek-v4-pro-0813"),
    ).toMatchObject({
      thinking: true,
      maxContextTokens: 1_000_000,
      modelVersion: "DeepSeek-V4-Pro-0813",
    });
  });
});
