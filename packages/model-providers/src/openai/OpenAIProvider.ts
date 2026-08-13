import { OpenAICompatibleProvider } from "../openai-compatible/OpenAICompatibleProvider.js";

import { ModelProvider, ProviderRuntimeOptions } from "../types.js";

export class OpenAIProvider extends OpenAICompatibleProvider {
  override id = "openai";
  override type: ModelProvider["type"] = "openai";

  constructor(
    apiKey?: string,
    baseUrl = "https://api.openai.com/v1",
    options: ProviderRuntimeOptions = {},
  ) {
    super(apiKey, baseUrl, {
      apiKeyEnv: "OPENAI_API_KEY",
      ...options,
    });
  }
}
