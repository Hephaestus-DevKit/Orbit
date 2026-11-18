import { describe, expect, it } from "../../../../scripts/testing/support.mjs";
import { OllamaProvider } from "./OllamaProvider.js";

describe("OllamaProvider", () => {
  it("normalizes the native Ollama root to the OpenAI-compatible v1 API", () => {
    const provider = new OllamaProvider("http://localhost:11434", {
      modelCapabilities: {
        "qwen2.5-coder:7b": {
          kind: "chat",
          maxContextTokens: 32_768,
          toolCalls: true,
        },
      },
    });

    expect(provider.getModelCapabilities("qwen2.5-coder:7b")).toMatchObject({
      kind: "chat",
      maxContextTokens: 32_768,
      toolCalls: true,
      promptCaching: false,
    });
  });
});
