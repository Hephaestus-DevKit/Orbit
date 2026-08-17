import { describe, expect, it, vi } from "vitest";
import { ModelAwareProvider } from "./ModelAwareProvider.js";
import type { ModelProvider } from "./types.js";

function provider(id: string): ModelProvider {
  return {
    id,
    type: "openai-compatible",
    capabilities: {
      streaming: true,
      toolCalls: true,
      jsonMode: true,
      thinking: false,
      vision: false,
      promptCaching: false,
    },
    chat: vi.fn(() =>
      (async function* () {
        yield { type: "done" as const };
      })(),
    ),
    getModelCapabilities: vi.fn((model) => ({
      streaming: true,
      toolCalls: model.includes("deepseek"),
      jsonMode: true,
      thinking: false,
      vision: false,
      promptCaching: false,
    })),
  };
}

describe("ModelAwareProvider", () => {
  it("routes DeepSeek models by model identity while preserving generic models", async () => {
    const generic = provider("gateway");
    const deepseek = provider("gateway");
    const aware = new ModelAwareProvider(generic, deepseek);
    for await (const _event of aware.chat({
      model: "qwen3",
      messages: [],
      stream: true,
    })) {
      void _event;
    }
    for await (const _event of aware.chat({
      model: "deepseek-v4-pro",
      messages: [],
      stream: true,
    })) {
      void _event;
    }
    expect(generic.chat).toHaveBeenCalledTimes(1);
    expect(deepseek.chat).toHaveBeenCalledTimes(1);
    expect(aware.getModelCapabilities("deepseek-v4-flash").toolCalls).toBe(
      true,
    );
  });
});
