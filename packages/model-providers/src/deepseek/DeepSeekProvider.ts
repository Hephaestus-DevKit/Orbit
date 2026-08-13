import type {
  ModelCapabilities,
  ModelChatInput,
  ModelEvent,
  ModelProvider,
  ProviderApiFormat,
  ProviderRuntimeOptions,
} from "../types.js";
import { AnthropicCompatibleProvider } from "../anthropic/AnthropicCompatibleProvider.js";
import { DeepSeekOpenAIProvider } from "./DeepSeekOpenAIProvider.js";
import {
  DEEPSEEK_V4_CONTEXT_TOKENS,
  DEEPSEEK_V4_EFFECTIVE_CONTEXT_PERCENT,
  DEEPSEEK_V4_MAX_OUTPUT_TOKENS,
  getDeepSeekV4ModelProfile,
  isOfficialDeepSeekApi,
} from "./DeepSeekV4.js";

/**
 * Public DeepSeek provider. It keeps one product identity and selects one of
 * DeepSeek's three official wire formats without leaking dialect policy into
 * the generic OpenAI or Anthropic product lines.
 */
export class DeepSeekProvider implements ModelProvider {
  public readonly id: string;
  public readonly type = "deepseek" as const;
  public readonly capabilities: ModelCapabilities = {
    streaming: true,
    toolCalls: true,
    jsonMode: true,
    thinking: true,
    vision: false,
    promptCaching: true,
    maxContextTokens: DEEPSEEK_V4_CONTEXT_TOKENS,
    maxOutputTokens: DEEPSEEK_V4_MAX_OUTPUT_TOKENS,
    apiFormats: ["chat-completions", "responses", "anthropic"],
    reasoningEfforts: ["low", "high", "max"],
    parallelToolCalls: true,
    effectiveContextWindowPercent: DEEPSEEK_V4_EFFECTIVE_CONTEXT_PERCENT,
  };

  private readonly chatTransport: DeepSeekOpenAIProvider;
  private readonly responsesTransport: DeepSeekOpenAIProvider;
  private readonly anthropicTransport: AnthropicCompatibleProvider;
  private readonly configuredFormat: ProviderApiFormat;

  constructor(
    apiKey?: string,
    private readonly baseUrl = "https://api.deepseek.com",
    private readonly options: ProviderRuntimeOptions = {},
  ) {
    this.id = options.id || "deepseek";
    this.configuredFormat = options.deepSeekApiFormat ?? "auto";
    const common = {
      ...options,
      id: this.id,
      maxRetries: options.maxRetries ?? 0,
    };
    this.chatTransport = new DeepSeekOpenAIProvider(apiKey, baseUrl, {
      ...common,
      deepSeekApiFormat: "chat-completions",
    });
    this.responsesTransport = new DeepSeekOpenAIProvider(apiKey, baseUrl, {
      ...common,
      deepSeekApiFormat: "responses",
    });
    this.anthropicTransport = new AnthropicCompatibleProvider(
      apiKey,
      this.resolveAnthropicBaseUrl(baseUrl),
      {
        ...common,
        apiKeyEnv: options.apiKeyEnv || "DEEPSEEK_API_KEY",
        anthropicDialect: "deepseek",
      },
    );
  }

  public async initialize(): Promise<void> {
    await this.chatTransport.initialize();
  }

  public getModelCapabilities(model: string): ModelCapabilities {
    const profile = getDeepSeekV4ModelProfile(model);
    if (!profile || profile.legacyAlias || !profile.officialRequestModel) {
      return {
        ...this.capabilities,
        toolCalls: false,
        jsonMode: false,
        thinking: false,
        promptCaching: false,
      };
    }
    return {
      ...this.capabilities,
      modelVersion: profile.modelVersion,
      reasoningEfforts: [...profile.reasoningEfforts],
    };
  }

  public chat(input: ModelChatInput): AsyncIterable<ModelEvent> {
    const format = this.selectFormat(input);
    if (format === "anthropic") return this.anthropicTransport.chat(input);
    if (format === "responses") return this.responsesTransport.chat(input);
    return this.chatTransport.chat(input);
  }

  public embed(
    texts: string[],
    options?: { model?: string },
  ): Promise<number[][]> {
    return this.chatTransport.embed(texts, options);
  }

  public complete(
    prompt: string,
    options?: {
      model?: string;
      maxTokens?: number;
      stop?: string[];
      suffix?: string;
      abortSignal?: AbortSignal;
    },
  ): Promise<string> {
    return this.chatTransport.complete(prompt, options);
  }

  private selectFormat(
    input: ModelChatInput,
  ): Exclude<ProviderApiFormat, "auto"> {
    if (this.configuredFormat !== "auto") return this.configuredFormat;

    // Chat is the conservative continuity default. Responses is selected when
    // the caller asks for schema-constrained output, where its native format
    // contract is materially stronger. Anthropic remains an explicit ecosystem
    // compatibility choice so model mapping can never surprise the user.
    if (input.responseJsonSchema) return "responses";
    return "chat-completions";
  }

  private resolveAnthropicBaseUrl(baseUrl: string): string {
    if (isOfficialDeepSeekApi(baseUrl))
      return `${baseUrl.replace(/\/$/, "")}/anthropic`;
    return baseUrl.endsWith("/anthropic")
      ? baseUrl
      : `${baseUrl.replace(/\/$/, "")}/anthropic`;
  }
}
