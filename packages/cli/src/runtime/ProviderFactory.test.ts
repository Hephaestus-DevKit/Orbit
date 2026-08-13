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

    await consume(createProviderFromConfig(config).chat(chatInput()));
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(
      "https://tokendance.space/gateway/v1/chat/completions",
    );
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
});
