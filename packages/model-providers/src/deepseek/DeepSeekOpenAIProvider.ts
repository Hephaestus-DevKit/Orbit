import {
  ModelProvider,
  ModelChatInput,
  ModelEvent,
  ModelCapabilities,
  ProviderRuntimeOptions,
} from "../types.js";
import {
  zodToJsonSchema,
  fetchWithRetry,
  modelFinishReasonError,
  providerHttpError,
  sanitizeProviderError,
  sanitizeProviderErrorText,
  toError,
} from "../utils.js";
import {
  DEEPSEEK_V4_CONTEXT_TOKENS,
  DEEPSEEK_V4_MAX_OUTPUT_TOKENS,
  DEEPSEEK_V4_PRO,
  getDeepSeekReasoningEffort,
  getDeepSeekV4ModelProfile,
  isOfficialDeepSeekApi,
} from "./DeepSeekV4.js";
import { z } from "zod";

const OpenAIUsageSchema = z
  .object({
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative().optional(),
    prompt_cache_hit_tokens: z.number().int().nonnegative().optional(),
    prompt_cache_miss_tokens: z.number().int().nonnegative().optional(),
    prompt_cache_write_tokens: z.number().int().nonnegative().optional(),
    prompt_tokens_details: z
      .object({ cached_tokens: z.number().int().nonnegative().optional() })
      .passthrough()
      .optional(),
    completion_tokens_details: z
      .object({ reasoning_tokens: z.number().int().nonnegative().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

const OpenAIErrorSchema = z
  .object({
    message: z.string(),
    type: z.string().optional(),
    code: z.union([z.string(), z.number()]).nullable().optional(),
  })
  .passthrough();

const OpenAIToolCallSchema = z
  .object({
    id: z.string(),
    function: z
      .object({ name: z.string(), arguments: z.string() })
      .passthrough(),
  })
  .passthrough();

const OpenAIChatResponseSchema = z
  .object({
    id: z.string().optional(),
    model: z.string().optional(),
    choices: z
      .array(
        z
          .object({
            finish_reason: z.string().nullable().optional(),
            message: z
              .object({
                content: z.string().nullable().optional(),
                reasoning_content: z.string().nullable().optional(),
                tool_calls: z.array(OpenAIToolCallSchema).optional(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .default([]),
    usage: OpenAIUsageSchema.optional(),
    error: OpenAIErrorSchema.optional(),
  })
  .passthrough();

const OpenAIChatChunkSchema = z
  .object({
    id: z.string().optional(),
    model: z.string().optional(),
    choices: z
      .array(
        z
          .object({
            finish_reason: z.string().nullable().optional(),
            delta: z
              .object({
                content: z.string().nullable().optional(),
                reasoning_content: z.string().nullable().optional(),
                tool_calls: z
                  .array(
                    z
                      .object({
                        index: z.number().int().nonnegative(),
                        id: z.string().optional(),
                        function: z
                          .object({
                            name: z.string().optional(),
                            arguments: z.string().optional(),
                          })
                          .passthrough()
                          .optional(),
                      })
                      .passthrough(),
                  )
                  .optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .default([]),
    usage: OpenAIUsageSchema.nullish(),
    error: OpenAIErrorSchema.optional(),
  })
  .passthrough();

const OpenAIEmbeddingResponseSchema = z.object({
  data: z.array(
    z.object({
      index: z.number().int().nonnegative().optional(),
      embedding: z.array(z.number()),
    }),
  ),
});

const OpenAICompletionResponseSchema = z.object({
  choices: z.array(
    z
      .object({
        text: z.string(),
        finish_reason: z.string().nullable().optional(),
      })
      .passthrough(),
  ),
});

interface OpenAIFunctionToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type OpenAIRequestMessage =
  | {
      role: "system" | "user";
      content: string | OpenAIContentPart[];
    }
  | {
      role: "assistant";
      content: string | null;
      reasoning_content?: string;
      tool_calls?: OpenAIFunctionToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

interface OpenAIFunctionToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}

interface OpenAIChatRequestBody {
  [key: string]: unknown;
  model: string;
  messages: OpenAIRequestMessage[];
  stream: boolean;
  user_id?: string;
  max_tokens?: number;
  max_completion_tokens?: number;
  reasoning_effort?: string;
  thinking?: { type: string; budget_tokens?: number };
  temperature?: number;
  stream_options?: { include_usage: boolean };
  tools?: OpenAIFunctionToolDefinition[];
  response_format?: { type: "json_object" };
}

interface OpenAICompletionRequestBody {
  model: string;
  prompt: string;
  max_tokens: number;
  temperature: number;
  stop: string[];
  suffix?: string;
}

const OfficialDeepSeekUserIdSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/);
const OfficialDeepSeekToolNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

function validateToolArguments(argumentsText: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsText);
  } catch {
    throw new Error("DeepSeek returned malformed JSON tool arguments.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("DeepSeek tool arguments must be a JSON object.");
  }
}

function validateToolFinishReason(
  finishReason: string | null | undefined,
  toolCallCount: number,
): void {
  if (finishReason === "tool_calls" && toolCallCount === 0) {
    throw new Error(
      "DeepSeek reported a tool-call finish without returning a tool call.",
    );
  }
  if (toolCallCount > 0 && finishReason !== "tool_calls") {
    throw new Error(
      "DeepSeek returned a tool call without the tool_calls finish reason.",
    );
  }
}

function normalizeOfficialMaxTokens(
  value: number | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) {
    throw new Error("DeepSeek maxTokens must be a finite number.");
  }
  return Math.max(
    1,
    Math.min(DEEPSEEK_V4_MAX_OUTPUT_TOKENS, Math.floor(value)),
  );
}

function validateOfficialTemperature(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 2) {
    throw new Error("DeepSeek temperature must be between 0 and 2.");
  }
  return value;
}

function validateOfficialRequestInput(input: ModelChatInput): void {
  if (input.userId) {
    const result = OfficialDeepSeekUserIdSchema.safeParse(input.userId);
    if (!result.success) {
      throw new Error(
        "DeepSeek userId must contain only letters, digits, underscores, or dashes and be at most 512 characters.",
      );
    }
  }
  if ((input.tools?.length ?? 0) > 128) {
    throw new Error("DeepSeek accepts at most 128 tools per request.");
  }
  for (const tool of input.tools ?? []) {
    if (!OfficialDeepSeekToolNameSchema.safeParse(tool.name).success) {
      throw new Error(
        "Invalid DeepSeek tool name. Use 1-64 letters, digits, underscores, or dashes.",
      );
    }
  }
  normalizeOfficialMaxTokens(input.maxTokens);
  if (input.temperature !== undefined) {
    validateOfficialTemperature(input.temperature);
  }
}

function buildOpenAIRequestMessages(
  input: ModelChatInput,
  isOfficialDeepSeek: boolean,
): OpenAIRequestMessage[] {
  const messages: OpenAIRequestMessage[] = [];

  for (const message of input.messages) {
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    const images = message.content.filter((block) => block.type === "image");

    if (images.length > 0 && isOfficialDeepSeek) {
      throw new Error(
        "The selected DeepSeek model does not accept image input. Switch to a vision-capable model or remove the attachment.",
      );
    }

    if (message.role === "tool") {
      const toolResults = message.content.filter(
        (block) => block.type === "tool_result",
      );
      if (toolResults.length === 0) {
        throw new Error(
          "A tool-role message must contain at least one tool result.",
        );
      }
      for (const block of toolResults) {
        messages.push({
          role: "tool",
          tool_call_id: block.toolResult.toolCallId,
          content: block.toolResult.content,
        });
      }
      continue;
    }

    const toolCalls: OpenAIFunctionToolCall[] = message.content
      .filter((block) => block.type === "tool_call")
      .map((block) => {
        if (isOfficialDeepSeek) {
          validateToolArguments(block.toolCall.arguments);
        }
        return {
          id: block.toolCall.id,
          type: "function",
          function: {
            name: block.toolCall.name,
            arguments: block.toolCall.arguments,
          },
        };
      });

    if (toolCalls.length > 0 && message.role !== "assistant") {
      throw new Error("Tool-call content is only valid in assistant messages.");
    }

    if (message.role === "assistant") {
      const reasoningContent = message.content
        .filter((block) => block.type === "thinking")
        .map((block) => block.text)
        .join("\n");
      const content =
        reasoningContent && !isOfficialDeepSeek
          ? `<think>\n${reasoningContent}\n</think>\n${text}`
          : text || (toolCalls.length > 0 && isOfficialDeepSeek ? "" : null);
      const assistantMessage: Extract<
        OpenAIRequestMessage,
        { role: "assistant" }
      > = {
        role: "assistant",
        content,
      };
      if (toolCalls.length > 0) {
        assistantMessage.tool_calls = toolCalls;
        if (isOfficialDeepSeek) {
          // Thinking + tool continuations must replay the complete field. An
          // empty string is intentional and keeps assistant content non-null.
          assistantMessage.reasoning_content = reasoningContent || "";
        }
      }
      messages.push(assistantMessage);
      continue;
    }

    if (message.role === "user" && images.length > 0) {
      messages.push({
        role: "user",
        content: [
          ...(text ? [{ type: "text" as const, text }] : []),
          ...images.map((image) => ({
            type: "image_url" as const,
            image_url: {
              url: `data:${image.mediaType};base64,${image.data}`,
            },
          })),
        ],
      });
    } else {
      messages.push({ role: message.role, content: text });
    }
  }

  if (input.system) {
    messages.unshift({ role: "system", content: input.system });
  }
  return messages;
}

/**
 * Reasoning tag pairs emitted as plain text by models without an official
 * reasoning stream. `<think>` is DeepSeek R1-style; local models served
 * through Ollama commonly use `<thinking>` or `<reasoning>` instead.
 */
const STREAMING_THINK_TAGS = [
  { open: "<think>", close: "</think>" },
  { open: "<thinking>", close: "</thinking>" },
  { open: "<reasoning>", close: "</reasoning>" },
];

class StreamingThinkParser {
  private buffer = "";
  private activeCloseTag: string | null = null;

  public feed(
    chunk: string,
  ): Array<{ type: "text_delta" | "thinking_delta"; text: string }> {
    this.buffer += chunk;
    const events: Array<{
      type: "text_delta" | "thinking_delta";
      text: string;
    }> = [];

    while (this.buffer.length > 0) {
      if (!this.activeCloseTag) {
        let earliest: {
          index: number;
          tag: (typeof STREAMING_THINK_TAGS)[number];
        } | null = null;
        for (const tag of STREAMING_THINK_TAGS) {
          const index = this.buffer.indexOf(tag.open);
          if (index !== -1 && (!earliest || index < earliest.index)) {
            earliest = { index, tag };
          }
        }
        if (earliest) {
          if (earliest.index > 0) {
            events.push({
              type: "text_delta",
              text: this.buffer.substring(0, earliest.index),
            });
          }
          this.buffer = this.buffer.substring(
            earliest.index + earliest.tag.open.length,
          );
          this.activeCloseTag = earliest.tag.close;
          continue;
        }

        const holdIndex = this.findPartialTagStart(
          STREAMING_THINK_TAGS.map((tag) => tag.open),
        );
        if (holdIndex !== -1) {
          if (holdIndex > 0) {
            events.push({
              type: "text_delta",
              text: this.buffer.substring(0, holdIndex),
            });
          }
          this.buffer = this.buffer.substring(holdIndex);
          break;
        }

        events.push({ type: "text_delta", text: this.buffer });
        this.buffer = "";
      } else {
        const index = this.buffer.indexOf(this.activeCloseTag);
        if (index !== -1) {
          if (index > 0) {
            events.push({
              type: "thinking_delta",
              text: this.buffer.substring(0, index),
            });
          }
          this.buffer = this.buffer.substring(
            index + this.activeCloseTag.length,
          );
          this.activeCloseTag = null;
          continue;
        }

        const holdIndex = this.findPartialTagStart([this.activeCloseTag]);
        if (holdIndex !== -1) {
          if (holdIndex > 0) {
            events.push({
              type: "thinking_delta",
              text: this.buffer.substring(0, holdIndex),
            });
          }
          this.buffer = this.buffer.substring(holdIndex);
          break;
        }

        events.push({ type: "thinking_delta", text: this.buffer });
        this.buffer = "";
      }
    }

    return events;
  }

  /**
   * Index of a trailing `<...` fragment that may still complete into one of
   * `tags` with the next chunk, or -1 when the tail cannot become a tag.
   */
  private findPartialTagStart(tags: string[]): number {
    const longestTag = Math.max(...tags.map((tag) => tag.length));
    const from = Math.max(0, this.buffer.length - longestTag + 1);
    for (let index = from; index < this.buffer.length; index += 1) {
      if (this.buffer[index] !== "<") continue;
      const partial = this.buffer.substring(index);
      if (tags.some((tag) => tag.startsWith(partial))) return index;
    }
    return -1;
  }

  public flush(): Array<{
    type: "text_delta" | "thinking_delta";
    text: string;
  }> {
    const events: Array<{
      type: "text_delta" | "thinking_delta";
      text: string;
    }> = [];
    if (this.buffer.length > 0) {
      events.push({
        type: this.activeCloseTag ? "thinking_delta" : "text_delta",
        text: this.buffer,
      });
      this.buffer = "";
    }
    return events;
  }
}

export class DeepSeekOpenAIProvider implements ModelProvider {
  id = "deepseek-openai";
  type: ModelProvider["type"] = "openai-compatible";
  capabilities = {
    streaming: true,
    toolCalls: true,
    jsonMode: true,
    thinking: true,
    vision: false,
    promptCaching: true,
  };

  constructor(
    private apiKey?: string,
    private baseUrl = "https://api.deepseek.com",
    private options: ProviderRuntimeOptions = {},
  ) {
    if (options.id) {
      this.id = options.id;
    }
  }

  public async initialize(): Promise<void> {
    if (this.options.disablePreheat) return;
    try {
      if (this.baseUrl && typeof fetch === "function") {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1000);
        timeout.unref?.();
        try {
          await fetch(this.baseUrl, {
            method: "HEAD",
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
      }
    } catch {
      // Connection warming is best-effort and must never block a request.
    }
  }

  private getEndpointUrl(path: string): string {
    const base = this.baseUrl.endsWith("/")
      ? this.baseUrl.slice(0, -1)
      : this.baseUrl;
    if (base.endsWith("/v1") && path.startsWith("/v1/")) {
      return `${base}${path.substring(3)}`;
    }
    return `${base}${path}`;
  }

  private getDefaultApiKeyEnv(): string {
    if (this.options.apiKeyEnv) {
      return this.options.apiKeyEnv;
    }
    if (this.type === "openai" || this.id === "openai") {
      return "OPENAI_API_KEY";
    }
    return "DEEPSEEK_API_KEY";
  }

  private resolveApiKey(): string | undefined {
    if (this.apiKey === "ollama-no-key") {
      return undefined;
    }
    return (
      this.apiKey ||
      (this.options.apiKeyEnv
        ? process.env[this.options.apiKeyEnv]
        : undefined) ||
      process.env[this.getDefaultApiKeyEnv()]
    );
  }

  private buildJsonHeaders(key?: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (key) {
      const authHeader = this.options.apiKeyHeader || "Authorization";
      const prefix = this.options.apiKeyPrefix ?? "Bearer";
      headers[authHeader] = prefix
        ? `${prefix}${prefix.endsWith(" ") ? "" : " "}${key}`
        : key;
    }
    return { ...headers, ...(this.options.headers || {}) };
  }

  private getModelCapabilityOverride(
    model: string,
  ): Partial<ModelCapabilities> | undefined {
    const overrides = this.options.modelCapabilities || {};
    const normalizedModel = model.toLowerCase();
    for (const [pattern, caps] of Object.entries(overrides)) {
      const normalizedPattern = pattern.toLowerCase();
      if (normalizedPattern === normalizedModel) {
        return caps;
      }
      if (
        normalizedPattern.includes("*") &&
        this.matchesWildcard(normalizedModel, normalizedPattern)
      ) {
        return caps;
      }
    }
    return undefined;
  }

  private matchesWildcard(value: string, pattern: string): boolean {
    const escaped = pattern
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    return new RegExp(`^${escaped}$`).test(value);
  }

  public getModelCapabilities(model: string): ModelCapabilities {
    const lowercase = model.toLowerCase();
    const isReasoner =
      lowercase.includes("reasoner") ||
      lowercase.includes("r1") ||
      lowercase.includes("v4-pro");

    const isOpenAIReasoner =
      this.id === "openai" &&
      (/^o\d/.test(lowercase) ||
        lowercase.includes("reasoning") ||
        lowercase.includes("gpt-5"));
    const isLegacyNonStreamingOpenAIReasoner =
      this.id === "openai" &&
      (lowercase.startsWith("o1") || lowercase.includes("o1-"));

    const isOfficialDeepSeek = isOfficialDeepSeekApi(this.baseUrl);
    const deepSeekV4Profile = getDeepSeekV4ModelProfile(model);
    const supportsNativeTools = !(
      lowercase.includes("o1-preview") || lowercase.includes("o1-mini")
    );

    const inferred: ModelCapabilities = {
      streaming: !isLegacyNonStreamingOpenAIReasoner,
      toolCalls: supportsNativeTools,
      jsonMode: isOfficialDeepSeek ? true : !isReasoner,
      thinking: Boolean(deepSeekV4Profile) || isReasoner || isOpenAIReasoner,
      vision:
        lowercase.includes("vision") ||
        lowercase.includes("gpt-4o") ||
        lowercase.includes("claude-3"),
      promptCaching: true,
      ...(isOfficialDeepSeek && deepSeekV4Profile
        ? {
            maxContextTokens: DEEPSEEK_V4_CONTEXT_TOKENS,
            maxOutputTokens: DEEPSEEK_V4_MAX_OUTPUT_TOKENS,
          }
        : {}),
    };
    return {
      ...inferred,
      ...(this.options.capabilities || {}),
      ...(this.getModelCapabilityOverride(model) || {}),
    };
  }

  async *chat(input: ModelChatInput): AsyncIterable<ModelEvent> {
    const thinkParser = new StreamingThinkParser();
    const key = this.resolveApiKey();
    if (!key && this.apiKey !== "ollama-no-key") {
      const keyEnv = this.getDefaultApiKeyEnv();
      yield {
        type: "error",
        error: new Error(
          `API key missing for ${this.id} provider. Please set ${keyEnv}.`,
        ),
      };
      return;
    }

    const isOfficialDeepSeek = isOfficialDeepSeekApi(this.baseUrl);
    const deepSeekV4Profile = getDeepSeekV4ModelProfile(input.model);
    if (isOfficialDeepSeek && !deepSeekV4Profile) {
      yield {
        type: "error",
        error: new Error(
          "Unsupported model for the official DeepSeek API. Use deepseek-v4-flash or deepseek-v4-pro.",
        ),
      };
      return;
    }

    let openaiMessages: OpenAIRequestMessage[];
    let tools: OpenAIFunctionToolDefinition[] | undefined;
    try {
      if (isOfficialDeepSeek) validateOfficialRequestInput(input);
      openaiMessages = buildOpenAIRequestMessages(input, isOfficialDeepSeek);
      tools = input.tools?.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputJsonSchema ?? zodToJsonSchema(tool.inputSchema),
        },
      }));
    } catch (error: unknown) {
      yield { type: "error", error: toError(error) };
      return;
    }

    const capabilities = this.getModelCapabilities(input.model);
    const modelLowercase = input.model.toLowerCase();
    const isOpenAIReasoner =
      this.id === "openai" &&
      capabilities.thinking &&
      (/^o\d/.test(modelLowercase) ||
        modelLowercase.includes("reasoning") ||
        modelLowercase.includes("gpt-5"));
    const isReasoner = capabilities.thinking && !isOpenAIReasoner;
    const deepSeekThinkingEnabled =
      isOfficialDeepSeek && deepSeekV4Profile
        ? (input.thinking?.enabled ??
          deepSeekV4Profile.optimizedThinkingDefault)
        : false;

    const body: OpenAIChatRequestBody = {
      ...(this.options.extraBody ?? {}),
      model:
        isOfficialDeepSeek && deepSeekV4Profile
          ? deepSeekV4Profile.canonicalModel
          : input.model,
      messages: openaiMessages,
      stream: input.stream !== false && capabilities.streaming,
    };

    if (input.userId) {
      body.user_id = input.userId;
    } else {
      delete body.user_id;
    }

    if (isOpenAIReasoner) {
      body.max_completion_tokens = input.maxTokens;
      if (input.thinking?.enabled) {
        const budget = input.thinking.budgetTokens || 1024;
        body.reasoning_effort =
          budget > 1500 ? "high" : budget > 500 ? "medium" : "low";
      }
    } else {
      body.max_tokens = input.maxTokens;
    }

    if (isOfficialDeepSeek && deepSeekV4Profile) {
      delete body.max_completion_tokens;
      body.max_tokens = normalizeOfficialMaxTokens(input.maxTokens);
      body.thinking = {
        type: deepSeekThinkingEnabled ? "enabled" : "disabled",
      };
      if (deepSeekThinkingEnabled) {
        body.reasoning_effort = getDeepSeekReasoningEffort(
          input.thinking?.budgetTokens,
        );
        delete body.temperature;
        delete body.top_p;
        delete body.presence_penalty;
        delete body.frequency_penalty;
      } else {
        delete body.reasoning_effort;
        body.temperature = validateOfficialTemperature(input.temperature ?? 0);
      }
    } else if (input.thinking?.enabled) {
      if (!isOpenAIReasoner) {
        body.thinking = {
          type: "enabled",
          budget_tokens: input.thinking.budgetTokens || 1024,
        };
        body.temperature = 1.0;
      }
    } else if (isReasoner) {
      body.temperature = 1.0;
    } else {
      if (isOpenAIReasoner) {
        // o1/o3-mini only support temperature 1.0 (or default)
      } else {
        body.temperature = input.temperature ?? 0.7;
      }
    }

    if (body.stream) {
      body.stream_options = { include_usage: true };
    } else {
      delete body.stream_options;
    }

    const supportsNativeTools = capabilities.toolCalls;

    if (tools && tools.length > 0 && supportsNativeTools) {
      body.tools = tools;
    } else {
      delete body.tools;
    }

    if (input.responseFormat === "json") {
      body.response_format = { type: "json_object" };
    } else {
      delete body.response_format;
    }
    const chatController = new AbortController();
    const chatSignal = chatController.signal;

    const onExternalAbort = () => {
      chatController.abort();
    };

    if (input.abortSignal) {
      if (input.abortSignal.aborted) {
        yield {
          type: "error",
          error: sanitizeProviderError(
            input.abortSignal.reason ??
              new DOMException("The user aborted a request.", "AbortError"),
            [key],
          ),
        };
        return;
      }
      input.abortSignal.addEventListener("abort", onExternalAbort);
    }

    let response: Response;
    try {
      response = await fetchWithRetry(
        this.getEndpointUrl("/v1/chat/completions"),
        {
          method: "POST",
          headers: this.buildJsonHeaders(key),
          body: JSON.stringify(body),
          signal: chatSignal,
          timeout: this.options.requestTimeoutMs,
        },
        this.options.maxRetries ?? 2,
      );
    } catch (error: unknown) {
      if (input.abortSignal) {
        input.abortSignal.removeEventListener("abort", onExternalAbort);
      }
      yield {
        type: "error",
        error: sanitizeProviderError(error, [key]),
      };
      return;
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      yield {
        type: "error",
        error: providerHttpError("DeepSeek", response.status, errText, [key]),
      };
      if (input.abortSignal) {
        input.abortSignal.removeEventListener("abort", onExternalAbort);
      }
      return;
    }

    if (!body.stream) {
      let data: z.infer<typeof OpenAIChatResponseSchema>;
      try {
        data = OpenAIChatResponseSchema.parse(await response.json());
      } catch (error: unknown) {
        yield {
          type: "error",
          error: new Error(
            `Invalid OpenAI-compatible response: ${sanitizeProviderErrorText(toError(error).message, [key])}`,
          ),
        };
        if (input.abortSignal) {
          input.abortSignal.removeEventListener("abort", onExternalAbort);
        }
        return;
      }
      if (data.error) {
        yield {
          type: "error",
          error: new Error(
            `DeepSeek API error: ${sanitizeProviderErrorText(data.error.message, [key])}`,
          ),
        };
        if (input.abortSignal) {
          input.abortSignal.removeEventListener("abort", onExternalAbort);
        }
        return;
      }
      const choice = data.choices?.[0];
      if (!choice) {
        yield {
          type: "error",
          error: new Error("DeepSeek returned no completion choice."),
        };
        if (input.abortSignal) {
          input.abortSignal.removeEventListener("abort", onExternalAbort);
        }
        return;
      }
      if (isOfficialDeepSeek) {
        try {
          validateToolFinishReason(
            choice.finish_reason,
            choice.message.tool_calls?.length ?? 0,
          );
        } catch (error: unknown) {
          yield { type: "error", error: toError(error) };
          if (input.abortSignal) {
            input.abortSignal.removeEventListener("abort", onExternalAbort);
          }
          return;
        }
      }
      if (choice?.message?.reasoning_content) {
        yield {
          type: "thinking_delta",
          text: choice.message.reasoning_content,
        };
      }
      if (choice?.message?.content) {
        yield { type: "text_delta", text: choice.message.content };
      }
      if (choice?.message?.tool_calls) {
        for (const tc of choice.message.tool_calls) {
          try {
            validateToolArguments(tc.function.arguments);
          } catch (error: unknown) {
            yield {
              type: "error",
              error: sanitizeProviderError(error, [key]),
            };
            if (input.abortSignal) {
              input.abortSignal.removeEventListener("abort", onExternalAbort);
            }
            return;
          }
          yield {
            type: "tool_call",
            toolCall: {
              id: tc.id,
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          };
        }
      }
      yield {
        type: "response_metadata",
        requestedModel: input.model,
        resolvedModel: data.model,
        providerRequestId:
          data.id || response.headers?.get?.("x-request-id") || undefined,
      };
      yield {
        type: "usage",
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? 0,
          outputTokens: data.usage?.completion_tokens ?? 0,
          cacheReadTokens:
            data.usage?.prompt_cache_hit_tokens ||
            data.usage?.prompt_tokens_details?.cached_tokens ||
            0,
          cacheMissTokens: data.usage?.prompt_cache_miss_tokens || 0,
          cacheWriteTokens: data.usage?.prompt_cache_write_tokens || 0,
          reasoningTokens:
            data.usage?.completion_tokens_details?.reasoning_tokens || 0,
          totalTokens:
            data.usage?.total_tokens ??
            (data.usage?.prompt_tokens ?? 0) +
              (data.usage?.completion_tokens ?? 0),
        },
      };
      const finishError =
        isOfficialDeepSeek && !choice.finish_reason
          ? new Error("DeepSeek response did not include a finish reason.")
          : modelFinishReasonError(choice.finish_reason);
      if (finishError) {
        yield { type: "error", error: finishError };
      } else {
        yield { type: "done" };
      }
      if (input.abortSignal) {
        input.abortSignal.removeEventListener("abort", onExternalAbort);
      }
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      if (input.abortSignal) {
        input.abortSignal.removeEventListener("abort", onExternalAbort);
      }
      yield {
        type: "error",
        error: new Error("Response body is not readable"),
      };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    const streamingTools = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    let promptTokens = 0;
    let completionTokens = 0;
    let cacheReadTokens = 0;
    let cacheMissTokens = 0;
    let cacheWriteTokens = 0;
    let reasoningTokens = 0;
    let finishReason: string | null = null;
    let streamComplete = false;
    let metadataEmitted = false;

    let streamTimeoutId: NodeJS.Timeout | undefined;
    const streamTimeoutMs = this.options.streamTimeoutMs ?? 60000;

    const resetStreamTimeout = () => {
      if (streamTimeoutId) clearTimeout(streamTimeoutId);
      streamTimeoutId = setTimeout(() => {
        chatController.abort(
          new DOMException(
            `Stream reading timed out after ${Math.round(streamTimeoutMs / 1000)} seconds of inactivity.`,
            "TimeoutError",
          ),
        );
      }, streamTimeoutMs);
    };

    try {
      resetStreamTimeout();
      readLoop: while (true) {
        const { done, value } = await reader.read();
        resetStreamTimeout();
        if (done) break;

        let accumulatedText = "";
        let accumulatedThinking = "";

        buffer += decoder.decode(value, { stream: true });
        let lineStart = 0;
        while (true) {
          const idx = buffer.indexOf("\n", lineStart);
          if (idx === -1) break;
          const line = buffer.substring(lineStart, idx);
          lineStart = idx + 1;

          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed.startsWith("data:")) {
            const rawData = trimmed.substring(5).trimStart();
            if (!rawData) continue;
            if (rawData === "[DONE]") {
              streamComplete = true;
              continue;
            }
            try {
              const parsed = OpenAIChatChunkSchema.parse(JSON.parse(rawData));
              if (!metadataEmitted) {
                metadataEmitted = true;
                yield {
                  type: "response_metadata",
                  requestedModel: input.model,
                  resolvedModel: parsed.model,
                  providerRequestId:
                    parsed.id ||
                    response.headers?.get?.("x-request-id") ||
                    undefined,
                };
              }
              if (parsed.error) {
                throw new Error(
                  `DeepSeek API error: ${sanitizeProviderErrorText(parsed.error.message, [key])}`,
                );
              }
              const choice = parsed.choices?.[0];
              if (choice?.finish_reason) {
                finishReason = choice.finish_reason;
              }

              if (choice?.delta?.content) {
                if (isOfficialDeepSeek) {
                  accumulatedText += choice.delta.content;
                } else {
                  const parsedEvents = thinkParser.feed(choice.delta.content);
                  for (const ev of parsedEvents) {
                    if (ev.type === "text_delta") {
                      accumulatedText += ev.text;
                    } else {
                      accumulatedThinking += ev.text;
                    }
                  }
                }
              }

              if (choice?.delta?.reasoning_content) {
                accumulatedThinking += choice.delta.reasoning_content;
              }

              if (choice?.delta?.tool_calls) {
                for (const tcDelta of choice.delta.tool_calls) {
                  const idx = tcDelta.index;
                  let tool = streamingTools.get(idx);
                  if (!tool) {
                    tool = { id: "", name: "", arguments: "" };
                    streamingTools.set(idx, tool);
                  }
                  if (tcDelta.id) tool.id = tcDelta.id;
                  if (tcDelta.function?.name) tool.name = tcDelta.function.name;
                  if (tcDelta.function?.arguments)
                    tool.arguments += tcDelta.function.arguments;
                }
              }

              if (parsed.usage) {
                promptTokens = parsed.usage.prompt_tokens || promptTokens;
                completionTokens =
                  parsed.usage.completion_tokens || completionTokens;
                if (parsed.usage.prompt_cache_hit_tokens) {
                  cacheReadTokens = parsed.usage.prompt_cache_hit_tokens;
                } else if (parsed.usage.prompt_tokens_details?.cached_tokens) {
                  cacheReadTokens =
                    parsed.usage.prompt_tokens_details.cached_tokens;
                }
                if (parsed.usage.prompt_cache_miss_tokens) {
                  cacheMissTokens = parsed.usage.prompt_cache_miss_tokens;
                }
                if (parsed.usage.prompt_cache_write_tokens) {
                  cacheWriteTokens = parsed.usage.prompt_cache_write_tokens;
                }
                if (parsed.usage.completion_tokens_details?.reasoning_tokens) {
                  reasoningTokens =
                    parsed.usage.completion_tokens_details.reasoning_tokens;
                }
              }
            } catch (error) {
              if (
                error instanceof Error &&
                error.message.startsWith("DeepSeek API error:")
              ) {
                throw error;
              }
              throw new Error(
                `Invalid OpenAI-compatible SSE frame: ${sanitizeProviderErrorText(toError(error).message, [key])}`,
              );
            }
            if (accumulatedText) {
              yield { type: "text_delta", text: accumulatedText };
              accumulatedText = "";
            }
            if (accumulatedThinking) {
              yield { type: "thinking_delta", text: accumulatedThinking };
              accumulatedThinking = "";
            }
          }
        }
        buffer = buffer.substring(lineStart);

        if (streamComplete) {
          await reader.cancel().catch(() => {});
          break readLoop;
        }

        if (accumulatedText) {
          yield { type: "text_delta", text: accumulatedText };
        }
        if (accumulatedThinking) {
          yield { type: "thinking_delta", text: accumulatedThinking };
        }
      }

      if (isOfficialDeepSeek && finishReason === null) {
        throw new Error(
          "DeepSeek stream ended before a finish reason was received.",
        );
      }
      if (isOfficialDeepSeek) {
        validateToolFinishReason(finishReason, streamingTools.size);
      }

      // Compatible providers may encode reasoning with <think> tags.
      if (!isOfficialDeepSeek) {
        const flushed = thinkParser.flush();
        for (const ev of flushed) {
          yield { type: ev.type, text: ev.text };
        }
      }

      // Emit finished tool calls
      for (const tool of streamingTools.values()) {
        if (!tool.id || !tool.name) {
          throw new Error(
            "DeepSeek stream ended with an incomplete tool call.",
          );
        }
        validateToolArguments(tool.arguments);
        yield {
          type: "tool_call",
          toolCall: {
            id: tool.id,
            name: tool.name,
            arguments: tool.arguments,
          },
        };
      }

      yield {
        type: "usage",
        usage: {
          inputTokens: promptTokens,
          outputTokens: completionTokens,
          cacheReadTokens: cacheReadTokens,
          cacheMissTokens,
          cacheWriteTokens,
          reasoningTokens,
          totalTokens: promptTokens + completionTokens,
        },
      };
      const finishError = modelFinishReasonError(finishReason);
      if (finishError) {
        yield { type: "error", error: finishError };
      } else {
        yield { type: "done" };
      }
    } catch (error: unknown) {
      yield {
        type: "error",
        error: sanitizeProviderError(error, [key]),
      };
    } finally {
      if (streamTimeoutId) clearTimeout(streamTimeoutId);
      if (input.abortSignal) {
        input.abortSignal.removeEventListener("abort", onExternalAbort);
      }
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  async embed(
    texts: string[],
    options?: { model?: string },
  ): Promise<number[][]> {
    if (isOfficialDeepSeekApi(this.baseUrl)) {
      throw new Error(
        "The official DeepSeek API does not provide an embeddings endpoint. Configure a separate embedding provider or use lexical retrieval.",
      );
    }
    const key = this.resolveApiKey();
    if (!key) {
      throw new Error(
        `API key missing for embedding provider. Please set ${this.getDefaultApiKeyEnv()}.`,
      );
    }

    const model = options?.model || "text-embedding-3-small";

    const response = await fetchWithRetry(
      this.getEndpointUrl("/v1/embeddings"),
      {
        method: "POST",
        headers: this.buildJsonHeaders(key),
        body: JSON.stringify({
          input: texts,
          model: model,
        }),
        timeout: this.options.requestTimeoutMs,
      },
      this.options.maxRetries ?? 2,
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw providerHttpError("Embedding provider", response.status, errText, [
        key,
      ]);
    }

    let data: z.infer<typeof OpenAIEmbeddingResponseSchema>;
    try {
      data = OpenAIEmbeddingResponseSchema.parse(await response.json());
    } catch {
      throw new Error("Embedding provider returned an invalid response.");
    }

    // Sort by index to preserve order
    const sorted = [...data.data].sort(
      (a, b) => (a.index ?? 0) - (b.index ?? 0),
    );
    return sorted.map((item) => item.embedding);
  }

  async complete(
    prompt: string,
    options?: {
      model?: string;
      maxTokens?: number;
      stop?: string[];
      suffix?: string;
      abortSignal?: AbortSignal;
    },
  ): Promise<string> {
    const key = this.resolveApiKey();
    if (!key && this.apiKey !== "ollama-no-key") {
      throw new Error(
        `API key missing for completion provider. Please set ${this.getDefaultApiKeyEnv()}.`,
      );
    }
    const headers = this.buildJsonHeaders(key);

    const isOfficialDeepSeek = isOfficialDeepSeekApi(this.baseUrl);
    let url = this.getEndpointUrl("/v1/completions");
    const requestedMaxTokens = options?.maxTokens ?? 64;
    if (!Number.isFinite(requestedMaxTokens)) {
      throw new Error("Completion maxTokens must be a finite number.");
    }
    const bodyData: OpenAICompletionRequestBody = {
      model: options?.model || "qwen2.5-coder:1.5b",
      prompt: prompt,
      max_tokens: requestedMaxTokens,
      temperature: 0.0,
      stop: options?.stop || [],
    };

    if (isOfficialDeepSeek) {
      bodyData.max_tokens = Math.max(
        1,
        Math.min(4096, Math.floor(bodyData.max_tokens)),
      );
      // Official DeepSeek FIM uses base_url=https://api.deepseek.com/beta.
      const betaUrl = new URL(this.baseUrl);
      betaUrl.pathname = "/beta/completions";
      betaUrl.search = "";
      betaUrl.hash = "";
      url = betaUrl.toString();

      if (options?.suffix !== undefined) {
        bodyData.prompt = prompt;
        bodyData.suffix = options.suffix;
      }
      bodyData.model = DEEPSEEK_V4_PRO;
    }

    const response = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers,
        body: JSON.stringify(bodyData),
        signal: options?.abortSignal,
        timeout: this.options.requestTimeoutMs,
      },
      this.options.maxRetries ?? 2,
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw providerHttpError("Completion provider", response.status, errText, [
        key,
      ]);
    }

    let data: z.infer<typeof OpenAICompletionResponseSchema>;
    try {
      data = OpenAICompletionResponseSchema.parse(await response.json());
    } catch {
      throw new Error("Completion provider returned an invalid response.");
    }
    const choice = data.choices[0];
    if (!choice) {
      throw new Error("Completion provider returned no completion choice.");
    }
    if (isOfficialDeepSeek && !choice.finish_reason) {
      throw new Error("DeepSeek FIM response did not include a finish reason.");
    }
    const finishError = modelFinishReasonError(choice.finish_reason);
    if (finishError) throw finishError;
    return choice.text;
  }
}
