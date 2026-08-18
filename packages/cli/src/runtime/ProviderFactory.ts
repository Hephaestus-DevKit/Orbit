import type { OrbitConfig } from "@orbit-build/config";
import {
  AnthropicProvider,
  AnthropicCompatibleProvider,
  DeepSeekProvider,
  OpenAICompatibleProvider,
  ModelAwareProvider,
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
  const baseUrl = pConfig.baseUrl;

  if (
    pConfig.type === "deepseek" ||
    (pConfig.type === "openai-compatible" &&
      baseUrl !== undefined &&
      isOfficialDeepSeekApi(baseUrl))
  ) {
    return new DeepSeekProvider(
      undefined,
      baseUrl ?? "https://api.deepseek.com",
      providerOptions,
    );
  }

  if (pConfig.type === "anthropic-compatible") {
    return new AnthropicCompatibleProvider(
      undefined,
      baseUrl ?? "https://api.anthropic.com",
      providerOptions,
    );
  }
  if (pConfig.type === "openai-compatible") {
    const generic = new OpenAICompatibleProvider(
      undefined,
      baseUrl ?? "https://api.openai.com/v1",
      providerOptions,
    );
    // A gateway may expose DeepSeek under an otherwise generic provider id.
    // Keep its ordinary models on the generic wire format, but select the
    // DeepSeek serializer automatically whenever the requested model is a
    // known DeepSeek family member.
    const deepSeek = new DeepSeekProvider(
      undefined,
      baseUrl ?? "https://api.openai.com/v1",
      providerOptions,
    );
    return new ModelAwareProvider(generic, deepSeek);
  }
  if (pConfig.type === "openai") {
    return new OpenAIProvider(
      pConfig.apiKey,
      baseUrl ?? "https://api.openai.com/v1",
      providerOptions,
    );
  }
  if (pConfig.type === "anthropic") {
    return new AnthropicProvider(
      pConfig.apiKey,
      baseUrl ?? "https://api.anthropic.com",
      providerOptions,
    );
  }
  if (pConfig.type === "ollama") {
    return new OllamaProvider(
      pConfig.baseUrl ?? "http://localhost:11434",
      providerOptions,
    );
  }

  throw new Error(`Unsupported provider type "${pConfig.type}".`);
}
