import { DeepSeekImageFiles } from "./DeepSeekImageFiles.js";
import { estimateDeepSeekImageTokens } from "./DeepSeekImageTokens.js";
import {
  canonicalizeModelChatInput,
  validateDeepSeekUserId,
} from "../request/CanonicalRequest.js";
import {
  applyDeepSeekSamplingPolicy,
  validateDeepSeekChatToolChoice,
  validateDeepSeekToolHistory,
  validateDeepSeekV4RequestInput,
} from "./DeepSeekRequestPolicy.js";
import type {
  ModelCapabilities,
  ModelChatInput,
  ModelEvent,
  ModelProvider,
  ProviderApiFormat,
  ProviderRuntimeOptions,
  OrbitContentBlock,
} from "../types.js";
import { AnthropicCompatibleProvider } from "../anthropic-compatible/AnthropicCompatibleProvider.js";
import { OpenAICompatibleProvider } from "../openai-compatible/OpenAICompatibleProvider.js";
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
  private static readonly RESPONSES_UNAVAILABLE_TTL_MS = 30_000;

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

  private readonly imageFiles = new DeepSeekImageFiles();
  private readonly chatTransport: OpenAICompatibleProvider;
  private readonly responsesTransport: OpenAICompatibleProvider;
  private readonly anthropicTransport: AnthropicCompatibleProvider;
  private readonly configuredFormat: ProviderApiFormat;
  private responsesUnavailableUntil = 0;

  constructor(
    private readonly apiKey?: string,
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
    this.chatTransport = new OpenAICompatibleProvider(apiKey, baseUrl, {
      ...common,
      deepSeekApiFormat: "chat-completions",
    });
    this.responsesTransport = new OpenAICompatibleProvider(apiKey, baseUrl, {
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

  public estimateImageTokens(
    image: Extract<OrbitContentBlock, { type: "image" }>,
    model: string,
  ): number {
    return getDeepSeekV4ModelProfile(model)?.vision
      ? estimateDeepSeekImageTokens(image)
      : 4096;
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
      vision: profile.vision,
      maxImages: profile.vision ? 16 : undefined,
      maxImageBytes: profile.vision ? 10 * 1024 * 1024 : undefined,
      modelVersion: profile.modelVersion,
      reasoningEfforts: [...profile.reasoningEfforts],
    };
  }

  public chat(input: ModelChatInput): AsyncIterable<ModelEvent> {
    if (
      this.options.deepSeekFiles &&
      isOfficialDeepSeekApi(this.baseUrl) &&
      getDeepSeekV4ModelProfile(input.model)?.vision &&
      getDeepSeekV4ModelProfile(input.model)?.officialRequestModel &&
      input.messages.some((message) =>
        message.content.some((block) => block.type === "image"),
      )
    ) {
      return this.chatWithImageFiles(input);
    }
    return this.dispatch(input);
  }

  private async *chatWithImageFiles(
    input: ModelChatInput,
  ): AsyncIterable<ModelEvent> {
    // Reject invalid requests before any attachment bytes leave the machine.
    try {
      input = canonicalizeModelChatInput(input);
      validateDeepSeekUserId(input.userId);
      validateDeepSeekV4RequestInput(input);
      validateDeepSeekToolHistory(input.messages);
      const profile = getDeepSeekV4ModelProfile(input.model)!;
      const thinking =
        input.thinking?.enabled ?? profile.optimizedThinkingDefault;
      validateDeepSeekChatToolChoice(input, thinking);
      applyDeepSeekSamplingPolicy(
        { ...this.options.extraBody },
        thinking,
        profile.lane,
      );
    } catch (error: unknown) {
      yield {
        type: "error",
        error: error instanceof Error ? error : new Error(String(error)),
      };
      return;
    }
    const deadline = AbortSignal.timeout(
      this.options.totalTimeoutMs ?? 660_000,
    );
    input = {
      ...input,
      abortSignal: input.abortSignal
        ? AbortSignal.any([input.abortSignal, deadline])
        : deadline,
    };
    const key =
      this.options.apiKeyResolver?.() ||
      this.apiKey ||
      process.env[this.options.apiKeyEnv ?? "DEEPSEEK_API_KEY"];
    let prepared = input;
    try {
      if (key) prepared = await this.imageFiles.prepare(input, key);
    } catch {
      // Upload errors fall back to the original inline payload, once. No history mutation.
    }
    if (input.abortSignal?.aborted) {
      yield {
        type: "error",
        error: new Error("DeepSeek image request cancelled."),
      };
      return;
    }
    let observed = false;
    for await (const event of this.dispatch(prepared)) {
      if (
        event.type === "text_delta" ||
        event.type === "thinking_delta" ||
        event.type === "tool_call" ||
        event.type === "usage"
      )
        observed = true;
      if (
        event.type === "error" &&
        prepared !== input &&
        !observed &&
        !input.abortSignal?.aborted &&
        /file.{0,80}(?:expired|not.found|deleted|invalid)|(?:expired|invalid).{0,40}file/i.test(
          String(event.error),
        )
      ) {
        this.imageFiles.clear();
        yield* this.dispatch({ ...input, retryBudget: 0 });
        return;
      }
      yield event;
    }
  }

  private dispatch(input: ModelChatInput): AsyncIterable<ModelEvent> {
    const format = this.selectFormat(input);
    if (format === "anthropic") {
      return this.anthropicTransport.chat(input);
    }
    if (format === "responses") {
      return this.chatWithResponsesFallback(input);
    }
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

    if (this.responsesUnavailableUntil > Date.now()) {
      return "chat-completions";
    }

    // Chat is the conservative continuity default. Responses is selected when
    // the caller asks for schema-constrained output, where its native format
    // contract is materially stronger. Anthropic remains an explicit ecosystem
    // compatibility choice so model mapping can never surprise the user.
    if (input.responseJsonSchema) return "responses";
    return "chat-completions";
  }

  /**
   * Responses is the preferred structured-output lane, but not every
   * DeepSeek-compatible gateway exposes it. Retry through Chat Completions
   * only when the endpoint is explicitly unavailable and no model output has
   * been observed; then suppress repeated route probes for a short window.
   */
  private async *chatWithResponsesFallback(
    input: ModelChatInput,
  ): AsyncIterable<ModelEvent> {
    let outputObserved = false;
    for await (const event of this.responsesTransport.chat(input)) {
      if (
        event.type === "text_delta" ||
        event.type === "thinking_delta" ||
        event.type === "tool_call"
      ) {
        outputObserved = true;
      }
      if (
        event.type === "error" &&
        !outputObserved &&
        isResponsesUnavailableError(event.error)
      ) {
        this.responsesUnavailableUntil =
          Date.now() + DeepSeekProvider.RESPONSES_UNAVAILABLE_TTL_MS;
        yield* this.chatTransport.chat(input);
        return;
      }
      yield event;
    }
  }

  private resolveAnthropicBaseUrl(baseUrl: string): string {
    if (isOfficialDeepSeekApi(baseUrl))
      return `${baseUrl.replace(/\/$/, "")}/anthropic`;
    return baseUrl.endsWith("/anthropic")
      ? baseUrl
      : `${baseUrl.replace(/\/$/, "")}/anthropic`;
  }
}

function isResponsesUnavailableError(error: unknown): boolean {
  if (
    error instanceof Error &&
    error.name === "DeepSeekResponsesUnavailableError"
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /DeepSeek Responses API is unavailable \(HTTP (?:400|404|405|501)\)/i.test(
    message,
  );
}
