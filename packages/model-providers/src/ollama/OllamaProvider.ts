import { OpenAICompatibleProvider } from "../openai-compatible/OpenAICompatibleProvider.js";
import type { ProviderRuntimeOptions } from "../types.js";

export class OllamaProvider extends OpenAICompatibleProvider {
  override id = "ollama";
  override type = "ollama" as const;

  constructor(
    baseUrl = "http://localhost:11434",
    options: ProviderRuntimeOptions = {},
  ) {
    // Ollama does not require an API key, so we pass a placeholder to pass the base key check
    super("ollama-no-key", normalizeOllamaOpenAiBaseUrl(baseUrl), {
      ...options,
      disablePreheat: true,
      capabilities: {
        ...options.capabilities,
        promptCaching: false,
      },
    });
  }
}

function normalizeOllamaOpenAiBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}
