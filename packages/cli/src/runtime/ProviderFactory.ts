import type { OrbitConfig } from "@orbit-build/config";
import {
  AnthropicProvider,
  AnthropicCompatibleProvider,
  DeepSeekProvider,
  OpenAICompatibleProvider,
  isOfficialDeepSeekApi,
  OllamaProvider,
  OpenAIProvider,
  type ModelProvider,
} from "@orbit-build/model-providers";

export function createProviderFromConfig(config: OrbitConfig): ModelProvider {
  const providerName = config.provider.default;
  const pConfig = config.providers[providerName];
  if (!pConfig) {
    throw new Error(
      `Provider "${providerName}" is not defined in configuration.`,
    );
  }

  const providerOptions = {
    id: providerName,
    apiKeyEnv: pConfig.apiKeyEnv,
    apiKeyHeader: pConfig.apiKeyHeader,
    apiKeyPrefix: pConfig.apiKeyPrefix,
    headers: pConfig.headers,
    requestTimeoutMs: pConfig.requestTimeoutMs,
    streamTimeoutMs: pConfig.streamTimeoutMs,
    totalTimeoutMs: pConfig.totalTimeoutMs,
    maxRetries: pConfig.maxRetries,
    disablePreheat: pConfig.disablePreheat,
    deepSeekApiFormat: pConfig.deepSeekApiFormat,
    extraBody: pConfig.extraBody,
    capabilities: pConfig.capabilities,
    modelCapabilities: pConfig.modelCapabilities,
    apiKeyResolver: () => pConfig.apiKey,
  };

  if (
    pConfig.type === "deepseek" ||
    (pConfig.type === "openai-compatible" &&
      isOfficialDeepSeekApi(pConfig.baseUrl))
  ) {
    return new DeepSeekProvider(undefined, pConfig.baseUrl, providerOptions);
  }

  if (pConfig.type === "anthropic-compatible") {
    return new AnthropicCompatibleProvider(
      undefined,
      pConfig.baseUrl,
      providerOptions,
    );
  }
  if (pConfig.type === "openai-compatible") {
    return new OpenAICompatibleProvider(
      undefined,
      pConfig.baseUrl,
      providerOptions,
    );
  }
  if (pConfig.type === "openai") {
    return new OpenAIProvider(pConfig.apiKey, pConfig.baseUrl, providerOptions);
  }
  if (pConfig.type === "anthropic") {
    return new AnthropicProvider(
      pConfig.apiKey,
      pConfig.baseUrl,
      providerOptions,
    );
  }
  if (pConfig.type === "ollama") {
    return new OllamaProvider(pConfig.baseUrl, providerOptions);
  }

  throw new Error(`Unsupported provider type "${pConfig.type}".`);
}
