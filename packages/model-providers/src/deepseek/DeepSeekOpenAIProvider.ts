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
  mergeSafeProviderHeaders,
  ProviderError,
  isProviderError,
  providerHttpError,
  readProviderErrorText,
  readProviderJsonResponse,
  sanitizeProviderError,
  sanitizeProviderErrorText,
  toError,
} from "../utils.js";
import {
  DEEPSEEK_V4_CONTEXT_TOKENS,
  DEEPSEEK_V4_EFFECTIVE_CONTEXT_PERCENT,
  DEEPSEEK_V4_FLASH,
  DEEPSEEK_V4_MAX_OUTPUT_TOKENS,
  getDeepSeekReasoningEffort,
  isOfficialDeepSeekApi,
} from "./DeepSeekV4.js";
import {
  chatWithDeepSeekResponses,
  DeepSeekResponsesUnavailableError,
} from "./DeepSeekResponsesApi.js";
import { z } from "zod";
import { resolveModelAdaptation } from "../ModelAdaptation.js";
import {
  MAX_TOOL_ARGUMENT_CHARS,
  validateJsonObjectToolArguments,
} from "../ToolArguments.js";

const ProviderTokenCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(1_000_000_000);
const ProviderCollectionIndexSchema = z
  .number()
  .int()
  .nonnegative()
  .max(1_000_000);

const OpenAIUsageSchema = z
  .object({
    prompt_tokens: ProviderTokenCountSchema.optional(),
    completion_tokens: ProviderTokenCountSchema.optional(),
    total_tokens: ProviderTokenCountSchema.optional(),
    prompt_cache_hit_tokens: ProviderTokenCountSchema.optional(),
    prompt_cache_miss_tokens: ProviderTokenCountSchema.optional(),
    prompt_cache_write_tokens: ProviderTokenCountSchema.optional(),
    prompt_tokens_details: z
      .object({ cached_tokens: ProviderTokenCountSchema.optional() })
      .passthrough()
      .optional(),
    completion_tokens_details: z
      .object({ reasoning_tokens: ProviderTokenCountSchema.optional() })
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
                tool_calls: z.array(OpenAIToolCallSchema).max(1000).optional(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .max(100)
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
                        index: ProviderCollectionIndexSchema,
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
                  .max(1000)
                  .optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .max(100)
      .default([]),
    usage: OpenAIUsageSchema.nullish(),
    error: OpenAIErrorSchema.optional(),
  })
  .passthrough();

const OpenAIEmbeddingResponseSchema = z.object({
  data: z
    .array(
      z.object({
        index: ProviderCollectionIndexSchema.optional(),
        embedding: z.array(z.number().finite()).min(1).max(32_768),
      }),
    )
    .max(1000),
});

const OpenAICompletionResponseSchema = z.object({
  choices: z
    .array(
      z
        .object({
          text: z.string(),
          finish_reason: z.string().nullable().optional(),
        })
        .passthrough(),
    )
    .max(100),
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
  tool_choice?:
    | "none"
    | "auto"
    | "required"
    | { type: "function"; function: { name: string } };
  stop?: string[];
  response_format?:
    | { type: "json_object" }
    | {
        type: "json_schema";
        json_schema: { name: string; schema: Record<string, unknown> };
      };
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
const MAX_STREAM_FRAME_CHARS = 4 * 1024 * 1024;
const MAX_STREAM_TOTAL_CHARS = 8 * 1024 * 1024;
const MAX_STREAM_TOOL_CALLS = 1000;

function validateToolFinishReason(
  finishReason: string | null | undefined,
  toolCallCount: number,
): void {
  if (finishReason === "tool_calls" && toolCallCount === 0) {
    throw new Error(
      "DeepSeek reported a tool-call finish without returning a tool call.",
    );
  }
  // Compatible gateways occasionally preserve complete tool_calls while
  // normalizing finish_reason to "stop" (or omitting it). The tool payload is
  // validated separately, so keep the actionable call instead of discarding
  // it solely because transport metadata differs from the official API.
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

function validateDeepSeekV4Temperature(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 2) {
    throw new Error("DeepSeek temperature must be between 0 and 2.");
  }
  return value;
}

function validateDeepSeekV4RequestInput(input: ModelChatInput): void {
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
  const toolNames = new Set<string>();
  for (const tool of input.tools ?? []) {
    if (!OfficialDeepSeekToolNameSchema.safeParse(tool.name).success) {
      throw new Error(
        "Invalid DeepSeek tool name. Use 1-64 letters, digits, underscores, or dashes.",
      );
    }
    if (toolNames.has(tool.name)) {
      throw new Error(`DeepSeek tool name "${tool.name}" is duplicated.`);
    }
    toolNames.add(tool.name);
  }
  if ((input.stopSequences?.length ?? 0) > 16) {
    throw new Error("DeepSeek accepts at most 16 stop sequences.");
  }
  for (const stop of input.stopSequences ?? []) {
    if (!stop) throw new Error("DeepSeek stop sequences cannot be empty.");
  }
  normalizeOfficialMaxTokens(input.maxTokens);
  if (input.temperature !== undefined) {
    validateDeepSeekV4Temperature(input.temperature);
  }
}

function buildOpenAIRequestMessages(
  input: ModelChatInput,
  isDeepSeekV4: boolean,
): OpenAIRequestMessage[] {
  const messages: OpenAIRequestMessage[] = [];

  for (const message of input.messages) {
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    const images = message.content.filter((block) => block.type === "image");

    if (images.length > 0 && isDeepSeekV4) {
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
          content: block.toolResult.content || "(no output)",
        });
      }
      continue;
    }

    const toolCalls: OpenAIFunctionToolCall[] = message.content
      .filter((block) => block.type === "tool_call")
      .map((block) => {
        if (isDeepSeekV4) {
          validateJsonObjectToolArguments(block.toolCall.arguments);
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
        reasoningContent && !isDeepSeekV4
          ? `<think>\n${reasoningContent}\n</think>\n${text}`
          : text || (toolCalls.length > 0 && isDeepSeekV4 ? "" : null);
      const assistantMessage: Extract<
        OpenAIRequestMessage,
        { role: "assistant" }
      > = {
        role: "assistant",
        content,
      };
      if (toolCalls.length > 0) {
        assistantMessage.tool_calls = toolCalls;
        if (isDeepSeekV4) {
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
  private static readonly RESPONSES_CIRCUIT_TTL_MS = 5 * 60 * 1000;
  private responsesEndpointCircuit:
    | { unavailableUntil: number; status: number }
    | undefined;
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
          const response = await fetch(this.baseUrl, {
            method: "HEAD",
            signal: controller.signal,
          });
          await response.body?.cancel().catch(() => undefined);
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
      this.options.apiKeyResolver?.() ||
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
      "User-Agent": "Orbit",
    };
    if (key) {
      const authHeader = this.options.apiKeyHeader || "Authorization";
      const prefix = this.options.apiKeyPrefix ?? "Bearer";
      headers[authHeader] = prefix
        ? `${prefix}${prefix.endsWith(" ") ? "" : " "}${key}`
        : key;
    }
    return mergeSafeProviderHeaders(headers, this.options.headers, [
      this.options.apiKeyHeader || "Authorization",
    ]);
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

    const modelAdaptation = resolveModelAdaptation(model);
    const deepSeekV4Profile =
      modelAdaptation.family === "deepseek-v4"
        ? modelAdaptation.deepSeekV4
        : undefined;
    const supportsNativeTools = !(
      lowercase.includes("o1-preview") || lowercase.includes("o1-mini")
    );

    const inferred: ModelCapabilities = {
      streaming: !isLegacyNonStreamingOpenAIReasoner,
      toolCalls: supportsNativeTools,
      jsonMode: deepSeekV4Profile ? true : !isReasoner,
      thinking: Boolean(deepSeekV4Profile) || isReasoner || isOpenAIReasoner,
      vision: deepSeekV4Profile
        ? false
        : lowercase.includes("vision") ||
          lowercase.includes("gpt-4o") ||
          lowercase.includes("claude-3"),
      promptCaching: true,
      ...(deepSeekV4Profile
        ? {
            maxContextTokens: DEEPSEEK_V4_CONTEXT_TOKENS,
            maxOutputTokens: DEEPSEEK_V4_MAX_OUTPUT_TOKENS,
            apiFormats: deepSeekV4Profile.supportsResponses
              ? (["chat-completions", "responses"] as const)
              : (["chat-completions"] as const),
            reasoningEfforts: [...deepSeekV4Profile.reasoningEfforts],
            parallelToolCalls: deepSeekV4Profile.parallelToolCalls,
            modelVersion: deepSeekV4Profile.modelVersion,
            effectiveContextWindowPercent:
              DEEPSEEK_V4_EFFECTIVE_CONTEXT_PERCENT,
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
    if (this.options.totalTimeoutMs) {
      const totalSignal = AbortSignal.timeout(this.options.totalTimeoutMs);
      input = {
        ...input,
        abortSignal: input.abortSignal
          ? AbortSignal.any([input.abortSignal, totalSignal])
          : totalSignal,
      };
    }
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
    const modelAdaptation = resolveModelAdaptation(input.model);
    const deepSeekV4Profile =
      modelAdaptation.family === "deepseek-v4"
        ? modelAdaptation.deepSeekV4
        : undefined;
    const isDeepSeekV4 = Boolean(deepSeekV4Profile);
    const capabilities = this.getModelCapabilities(input.model);
    if (
      isOfficialDeepSeek &&
      (!deepSeekV4Profile || !deepSeekV4Profile.officialRequestModel)
    ) {
      yield {
        type: "error",
        error: new Error(
          "Unsupported model for the official DeepSeek API. Use deepseek-v4-flash or deepseek-v4-pro.",
        ),
      };
      return;
    }

    try {
      if (isDeepSeekV4) validateDeepSeekV4RequestInput(input);
    } catch (error: unknown) {
      yield { type: "error", error: toError(error) };
      return;
    }

    const requestedApiFormat =
      this.options.deepSeekApiFormat ?? "chat-completions";
    const circuitOpen =
      requestedApiFormat === "auto" &&
      this.responsesEndpointCircuit !== undefined &&
      this.responsesEndpointCircuit.unavailableUntil > Date.now();
    const useResponses =
      deepSeekV4Profile?.supportsResponses === true &&
      (requestedApiFormat === "responses" ||
        (requestedApiFormat === "auto" && !isOfficialDeepSeek)) &&
      !circuitOpen;
    let responsesFallbackStatus: number | undefined = circuitOpen
      ? this.responsesEndpointCircuit?.status
      : undefined;
    if (useResponses && deepSeekV4Profile) {
      try {
        const responsesInput: ModelChatInput = {
          ...input,
          stream: input.stream !== false && capabilities.streaming,
          tools: capabilities.toolCalls ? input.tools : undefined,
          responseFormat: capabilities.jsonMode ? input.responseFormat : "text",
          thinking: capabilities.thinking ? input.thinking : { enabled: false },
        };
        yield* chatWithDeepSeekResponses(responsesInput, {
          endpoint: this.getEndpointUrl("/v1/responses"),
          headers: this.buildJsonHeaders(key),
          apiKey: key,
          runtime: this.options,
          profile: deepSeekV4Profile,
          requestModel: isOfficialDeepSeek
            ? deepSeekV4Profile.canonicalModel
            : input.model,
          official: isOfficialDeepSeek,
        });
        this.responsesEndpointCircuit = undefined;
        return;
      } catch (error: unknown) {
        if (
          requestedApiFormat !== "auto" ||
          !(error instanceof DeepSeekResponsesUnavailableError)
        ) {
          yield {
            type: "error",
            error: sanitizeProviderError(error, [key]),
          };
          return;
        }
        responsesFallbackStatus = error.status;
        this.responsesEndpointCircuit = {
          status: error.status,
          unavailableUntil:
            Date.now() + DeepSeekOpenAIProvider.RESPONSES_CIRCUIT_TTL_MS,
        };
      }
    }

    let openaiMessages: OpenAIRequestMessage[];
    let tools: OpenAIFunctionToolDefinition[] | undefined;
    try {
      openaiMessages = buildOpenAIRequestMessages(input, isDeepSeekV4);
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

    const modelLowercase = input.model.toLowerCase();
    const isOpenAIReasoner =
      this.id === "openai" &&
      capabilities.thinking &&
      (/^o\d/.test(modelLowercase) ||
        modelLowercase.includes("reasoning") ||
        modelLowercase.includes("gpt-5"));
    const isReasoner = capabilities.thinking && !isOpenAIReasoner;
    const deepSeekThinkingEnabled = deepSeekV4Profile
      ? capabilities.thinking &&
        (input.thinking?.enabled ?? deepSeekV4Profile.optimizedThinkingDefault)
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

    if (deepSeekV4Profile) {
      delete body.max_completion_tokens;
      body.max_tokens = normalizeOfficialMaxTokens(input.maxTokens);
      body.thinking = {
        type: deepSeekThinkingEnabled ? "enabled" : "disabled",
      };
      if (deepSeekThinkingEnabled) {
        body.reasoning_effort = getDeepSeekReasoningEffort(
          input.thinking?.budgetTokens,
          input.thinking?.effort,
        );
        delete body.temperature;
        delete body.top_p;
        delete body.presence_penalty;
        delete body.frequency_penalty;
      } else {
        delete body.reasoning_effort;
        if (input.temperature !== undefined) {
          body.temperature = validateDeepSeekV4Temperature(input.temperature);
        } else {
          delete body.temperature;
        }
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
      if (input.toolChoice && typeof input.toolChoice === "object") {
        body.tool_choice = {
          type: "function",
          function: { name: input.toolChoice.name },
        };
      } else if (input.toolChoice) {
        body.tool_choice = input.toolChoice;
      }
    } else {
      delete body.tools;
      delete body.tool_choice;
    }

    if (input.stopSequences?.length) body.stop = [...input.stopSequences];
    else delete body.stop;

    if (input.responseFormat === "json" && capabilities.jsonMode) {
      body.response_format = input.responseJsonSchema
        ? {
            type: "json_schema",
            json_schema: {
              name: "orbit_response",
              schema: input.responseJsonSchema,
            },
          }
        : { type: "json_object" };
      const jsonInstruction = input.responseJsonSchema
        ? "Return only valid JSON matching the supplied response schema."
        : "Return only a valid JSON object. Do not wrap it in Markdown.";
      const systemMessage = body.messages.find(
        (message) => message.role === "system",
      );
      if (systemMessage && typeof systemMessage.content === "string") {
        systemMessage.content = `${systemMessage.content}\n\n${jsonInstruction}`;
      } else {
        body.messages.unshift({ role: "system", content: jsonInstruction });
      }
    } else {
      delete body.response_format;
    }
    const chatController = new AbortController();
    const chatSignal = input.abortSignal
      ? AbortSignal.any([chatController.signal, input.abortSignal])
      : chatController.signal;

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
        this.options.maxRetries ?? (isOfficialDeepSeek ? 0 : 2),
      );
    } catch (error: unknown) {
      const sanitized = sanitizeProviderError(error, [key]);
      yield {
        type: "error",
        error: isProviderError(sanitized)
          ? sanitized
          : new ProviderError(
              sanitized.name === "TimeoutError" ? "TIMEOUT" : "TRANSPORT",
              sanitized.message,
              { retryable: true, cause: sanitized },
            ),
      };
      return;
    }

    if (!response.ok) {
      const errText = await readProviderErrorText(response);
      yield {
        type: "error",
        error: providerHttpError("DeepSeek", response.status, errText, [key], {
          retryAfter: response.headers?.get?.("retry-after"),
          requestId:
            response.headers?.get?.("x-request-id") ??
            response.headers?.get?.("x-deepseek-request-id") ??
            undefined,
        }),
      };
      return;
    }

    if (!body.stream) {
      let data: z.infer<typeof OpenAIChatResponseSchema>;
      try {
        data = OpenAIChatResponseSchema.parse(
          await readProviderJsonResponse(response),
        );
      } catch (error: unknown) {
        yield {
          type: "error",
          error: new Error(
            `Invalid OpenAI-compatible response: ${sanitizeProviderErrorText(toError(error).message, [key])}`,
          ),
        };
        return;
      }
      if (data.error) {
        yield {
          type: "error",
          error: new Error(
            `DeepSeek API error: ${sanitizeProviderErrorText(data.error.message, [key])}`,
          ),
        };
        return;
      }
      const choice = data.choices?.[0];
      if (!choice) {
        yield {
          type: "error",
          error: new Error("DeepSeek returned no completion choice."),
        };
        return;
      }
      if (isDeepSeekV4) {
        try {
          validateToolFinishReason(
            choice.finish_reason,
            choice.message.tool_calls?.length ?? 0,
          );
        } catch (error: unknown) {
          yield { type: "error", error: toError(error) };
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
            validateJsonObjectToolArguments(tc.function.arguments);
          } catch (error: unknown) {
            yield {
              type: "error",
              error: sanitizeProviderError(error, [key]),
            };
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
          data.id ||
          response.headers?.get?.("x-request-id") ||
          response.headers?.get?.("x-deepseek-request-id") ||
          undefined,
        ...(deepSeekV4Profile
          ? {
              apiFormat: "chat-completions" as const,
              modelVersion: deepSeekV4Profile?.modelVersion,
              reasoningEffort: deepSeekThinkingEnabled
                ? getDeepSeekReasoningEffort(
                    input.thinking?.budgetTokens,
                    input.thinking?.effort,
                  )
                : ("none" as const),
              endpointKind: isOfficialDeepSeek
                ? ("official" as const)
                : ("gateway" as const),
              ...(responsesFallbackStatus !== undefined
                ? {
                    apiFormatFallback: {
                      from: "responses" as const,
                      status: responsesFallbackStatus,
                    },
                  }
                : {}),
            }
          : {}),
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
        isDeepSeekV4 && !choice.finish_reason
          ? new Error("DeepSeek response did not include a finish reason.")
          : isDeepSeekV4 &&
              !choice.message.reasoning_content &&
              !choice.message.content &&
              !choice.message.tool_calls?.length
            ? new Error("DeepSeek returned an empty completion.")
            : modelFinishReasonError(choice.finish_reason);
      if (finishError) {
        yield { type: "error", error: finishError };
      } else {
        yield { type: "done" };
      }
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
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
    let emittedOutput = false;
    let metadataEmitted = false;
    let totalStreamChars = 0;

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
        let accumulatedText = "";
        let accumulatedThinking = "";

        const decoded = done
          ? `${decoder.decode()}${buffer.trim() ? "\n" : ""}`
          : decoder.decode(value, { stream: true });
        if (done && !decoded) break;
        totalStreamChars += decoded.length;
        if (totalStreamChars > MAX_STREAM_TOTAL_CHARS) {
          throw new Error(
            "DeepSeek stream exceeded the safe total response limit.",
          );
        }
        buffer += decoded;
        if (buffer.length > MAX_STREAM_FRAME_CHARS) {
          throw new Error(
            "DeepSeek SSE frame exceeded the safe streaming limit.",
          );
        }
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
                    response.headers?.get?.("x-deepseek-request-id") ||
                    undefined,
                  ...(deepSeekV4Profile
                    ? {
                        apiFormat: "chat-completions" as const,
                        modelVersion: deepSeekV4Profile?.modelVersion,
                        reasoningEffort: deepSeekThinkingEnabled
                          ? getDeepSeekReasoningEffort(
                              input.thinking?.budgetTokens,
                              input.thinking?.effort,
                            )
                          : ("none" as const),
                        endpointKind: isOfficialDeepSeek
                          ? ("official" as const)
                          : ("gateway" as const),
                        ...(responsesFallbackStatus !== undefined
                          ? {
                              apiFormatFallback: {
                                from: "responses" as const,
                                status: responsesFallbackStatus,
                              },
                            }
                          : {}),
                      }
                    : {}),
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
                emittedOutput = true;
                if (isDeepSeekV4) {
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
                emittedOutput = true;
                accumulatedThinking += choice.delta.reasoning_content;
              }

              if (choice?.delta?.tool_calls) {
                for (const tcDelta of choice.delta.tool_calls) {
                  const idx = tcDelta.index;
                  let tool = streamingTools.get(idx);
                  if (!tool) {
                    if (streamingTools.size >= MAX_STREAM_TOOL_CALLS) {
                      throw new Error(
                        "DeepSeek stream returned too many tool calls.",
                      );
                    }
                    tool = { id: "", name: "", arguments: "" };
                    streamingTools.set(idx, tool);
                  }
                  if (tcDelta.id) tool.id = tcDelta.id;
                  if (tcDelta.function?.name) tool.name = tcDelta.function.name;
                  if (tcDelta.function?.arguments) {
                    tool.arguments += tcDelta.function.arguments;
                    if (tool.arguments.length > MAX_TOOL_ARGUMENT_CHARS) {
                      throw new Error(
                        "DeepSeek stream returned oversized JSON tool arguments.",
                      );
                    }
                  }
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
        if (done) break;
      }

      if (isDeepSeekV4 && finishReason === null) {
        throw new Error(
          "DeepSeek stream ended before a finish reason was received.",
        );
      }
      if (isDeepSeekV4 && isOfficialDeepSeek && !streamComplete) {
        throw new Error(
          "DeepSeek stream ended before the required [DONE] marker was received.",
        );
      }
      if (isDeepSeekV4) {
        validateToolFinishReason(finishReason, streamingTools.size);
        if (!emittedOutput && streamingTools.size === 0) {
          throw new Error("DeepSeek returned an empty completion.");
        }
      }

      // Compatible providers may encode reasoning with <think> tags.
      if (!isDeepSeekV4) {
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
        validateJsonObjectToolArguments(tool.arguments);
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
      const sanitized = sanitizeProviderError(error, [key]);
      const streamError = isProviderError(sanitized)
        ? new ProviderError(sanitized.code, sanitized.message, {
            status: sanitized.status,
            retryAfterMs: sanitized.retryAfterMs,
            requestId: sanitized.requestId,
            retryable: sanitized.retryable,
            partialOutput: emittedOutput || streamingTools.size > 0,
            cause: sanitized.cause,
          })
        : new ProviderError(
            sanitized.name === "TimeoutError"
              ? "TIMEOUT"
              : "MALFORMED_RESPONSE",
            sanitized.message,
            {
              retryable: sanitized.name === "TimeoutError",
              partialOutput: emittedOutput || streamingTools.size > 0,
              cause: sanitized,
            },
          );
      yield {
        type: "error",
        error: streamError,
      };
    } finally {
      if (streamTimeoutId) clearTimeout(streamTimeoutId);
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
      const errText = await readProviderErrorText(response);
      throw providerHttpError("Embedding provider", response.status, errText, [
        key,
      ]);
    }

    let data: z.infer<typeof OpenAIEmbeddingResponseSchema>;
    try {
      data = OpenAIEmbeddingResponseSchema.parse(
        await readProviderJsonResponse(response),
      );
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
      const requestedAdaptation = resolveModelAdaptation(
        options?.model ?? DEEPSEEK_V4_FLASH,
      );
      bodyData.model =
        requestedAdaptation.family === "deepseek-v4" &&
        !requestedAdaptation.deepSeekV4.legacyAlias
          ? requestedAdaptation.deepSeekV4.canonicalModel
          : DEEPSEEK_V4_FLASH;
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
      const errText = await readProviderErrorText(response);
      throw providerHttpError("Completion provider", response.status, errText, [
        key,
      ]);
    }

    let data: z.infer<typeof OpenAICompletionResponseSchema>;
    try {
      data = OpenAICompletionResponseSchema.parse(
        await readProviderJsonResponse(response),
      );
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
