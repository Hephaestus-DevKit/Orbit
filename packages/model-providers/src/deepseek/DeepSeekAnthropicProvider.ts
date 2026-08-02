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
  readProviderErrorText,
  readProviderJsonResponse,
  sanitizeProviderError,
  sanitizeProviderErrorText,
  toError,
} from "../utils.js";
import {
  DEEPSEEK_V4_CONTEXT_TOKENS,
  DEEPSEEK_V4_EFFECTIVE_CONTEXT_PERCENT,
  DEEPSEEK_V4_MAX_OUTPUT_TOKENS,
  getDeepSeekReasoningEffort,
  isOfficialDeepSeekApi,
} from "./DeepSeekV4.js";
import { z } from "zod";
import { resolveModelAdaptation } from "../ModelAdaptation.js";
import {
  MAX_TOOL_ARGUMENT_CHARS,
  parseJsonObjectToolArguments,
} from "./ToolArguments.js";

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

const AnthropicUsageSchema = z
  .object({
    input_tokens: ProviderTokenCountSchema.optional(),
    output_tokens: ProviderTokenCountSchema.optional(),
    cache_read_input_tokens: ProviderTokenCountSchema.optional(),
    cache_creation_input_tokens: ProviderTokenCountSchema.optional(),
  })
  .passthrough();

const AnthropicErrorSchema = z
  .object({
    message: z.string(),
    type: z.string().optional(),
  })
  .passthrough();

const AnthropicContentBlockSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("text"),
      text: z.string(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("thinking"),
      thinking: z.string(),
      signature: z.string().optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("tool_use"),
      id: z.string().min(1),
      name: z.string().min(1),
      input: z.record(z.unknown()),
    })
    .passthrough(),
]);

const AnthropicMessageResponseSchema = z
  .object({
    content: z.array(AnthropicContentBlockSchema).max(10_000),
    usage: AnthropicUsageSchema.optional(),
    stop_reason: z.string().nullable().optional(),
  })
  .passthrough();

interface AnthropicCacheControl {
  cache_control?: { type: "ephemeral" };
}

type AnthropicRequestContentBlock = AnthropicCacheControl &
  (
    | { type: "text"; text: string }
    | {
        type: "image";
        source: {
          type: "base64";
          media_type: string;
          data: string;
        };
      }
    | {
        type: "tool_use";
        id: string;
        name: string;
        input: Record<string, unknown>;
      }
    | {
        type: "tool_result";
        tool_use_id: string;
        content: string;
        is_error?: boolean;
      }
    | {
        type: "thinking";
        thinking: string;
        signature?: string;
      }
  );

interface AnthropicRequestMessage {
  role: "user" | "assistant";
  content: AnthropicRequestContentBlock[];
}

interface AnthropicSystemBlock extends AnthropicCacheControl {
  type: "text";
  text: string;
}

interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: unknown;
}

interface AnthropicRequestBody {
  [key: string]: unknown;
  model: string;
  messages: AnthropicRequestMessage[];
  max_tokens: number;
  system?: AnthropicSystemBlock[];
  stream: boolean;
  metadata?: { user_id: string };
  tools?: AnthropicToolDefinition[];
  thinking?: { type: string; budget_tokens?: number; display?: string };
  output_config?: { effort?: string; [key: string]: unknown };
  temperature?: number;
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

const AnthropicStreamEventSchema = z
  .object({
    type: z.string(),
    index: ProviderCollectionIndexSchema.optional(),
    message: z
      .object({ usage: AnthropicUsageSchema.optional() })
      .passthrough()
      .optional(),
    content_block: AnthropicContentBlockSchema.optional(),
    delta: z
      .object({
        type: z.string().optional(),
        text: z.string().optional(),
        thinking: z.string().optional(),
        signature: z.string().optional(),
        partial_json: z.string().optional(),
        stop_reason: z.string().nullable().optional(),
      })
      .passthrough()
      .optional(),
    usage: AnthropicUsageSchema.optional(),
    error: AnthropicErrorSchema.optional(),
  })
  .passthrough();
const MAX_STREAM_FRAME_CHARS = 4 * 1024 * 1024;
const MAX_STREAM_TOTAL_CHARS = 8 * 1024 * 1024;
const MAX_STREAM_TOOL_CALLS = 1000;

function validateToolStopReason(
  stopReason: string | null | undefined,
  toolCallCount: number,
): void {
  if (stopReason === "tool_use" && toolCallCount === 0) {
    throw new Error(
      "DeepSeek reported a tool-use stop without returning a tool call.",
    );
  }
  if (toolCallCount > 0 && stopReason !== "tool_use") {
    throw new Error(
      "DeepSeek returned a tool call without the tool_use stop reason.",
    );
  }
}

function normalizeAnthropicMaxTokens(
  value: number | undefined,
  fallback: number,
  isDeepSeekV4: boolean,
): number {
  const candidate = value ?? fallback;
  if (!Number.isFinite(candidate)) {
    throw new Error("Anthropic maxTokens must be a finite number.");
  }
  const rounded = Math.floor(candidate);
  return isDeepSeekV4
    ? Math.max(1, Math.min(DEEPSEEK_V4_MAX_OUTPUT_TOKENS, rounded))
    : rounded;
}

function validateDeepSeekV4Temperature(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 2) {
    throw new Error("DeepSeek temperature must be between 0 and 2.");
  }
  return value;
}

function validateDeepSeekV4RequestInput(input: ModelChatInput): void {
  if (
    input.messages.some((message) =>
      message.content.some((block) => block.type === "image"),
    )
  ) {
    throw new Error(
      "The selected DeepSeek model does not accept image input. Switch to a vision-capable model or remove the attachment.",
    );
  }
  if (
    input.userId &&
    !OfficialDeepSeekUserIdSchema.safeParse(input.userId).success
  ) {
    throw new Error(
      "DeepSeek userId must contain only letters, digits, underscores, or dashes and be at most 512 characters.",
    );
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
  normalizeAnthropicMaxTokens(input.maxTokens, 8192, true);
  if (input.temperature !== undefined) {
    validateDeepSeekV4Temperature(input.temperature);
  }
}

function toAnthropicContentBlock(
  block: ModelChatInput["messages"][number]["content"][number],
): AnthropicRequestContentBlock {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "image":
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: block.mediaType,
          data: block.data,
        },
      };
    case "tool_call":
      return {
        type: "tool_use",
        id: block.toolCall.id,
        name: block.toolCall.name,
        input: parseJsonObjectToolArguments(block.toolCall.arguments, {
          oversized:
            "Anthropic-compatible tool arguments exceed the safe size limit.",
          malformed:
            "Anthropic-compatible tool arguments contain malformed JSON.",
          invalid: "Anthropic-compatible tool arguments must be a JSON object.",
        }),
      };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: block.toolResult.toolCallId,
        content: block.toolResult.content,
        ...(block.toolResult.isError === undefined
          ? {}
          : { is_error: block.toolResult.isError }),
      };
    case "thinking":
      return {
        type: "thinking",
        thinking: block.text,
        ...(block.signature ? { signature: block.signature } : {}),
      };
  }
}

export class DeepSeekAnthropicProvider implements ModelProvider {
  id = "deepseek-anthropic";
  type: ModelProvider["type"] = "anthropic-compatible";
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
    private baseUrl = "https://api.deepseek.com/anthropic",
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

  private getDefaultApiKeyEnv(): string {
    if (this.options.apiKeyEnv) {
      return this.options.apiKeyEnv;
    }
    if (this.type === "anthropic" || this.id === "anthropic") {
      return "ANTHROPIC_API_KEY";
    }
    return "ANTHROPIC_AUTH_TOKEN";
  }

  private resolveApiKey(): string | undefined {
    return (
      this.apiKey ||
      (this.options.apiKeyEnv
        ? process.env[this.options.apiKeyEnv]
        : undefined) ||
      process.env[this.getDefaultApiKeyEnv()]
    );
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

  private buildJsonHeaders(key: string): Record<string, string> {
    const authHeader = this.options.apiKeyHeader || "x-api-key";
    const prefix = this.options.apiKeyPrefix ?? "";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      [authHeader]: prefix
        ? `${prefix}${prefix.endsWith(" ") ? "" : " "}${key}`
        : key,
    };
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

  private supportsAdaptiveThinking(model: string): boolean {
    const lowercase = model.toLowerCase();
    return (
      lowercase.includes("claude-fable-5") ||
      lowercase.includes("claude-mythos-5") ||
      lowercase.includes("claude-mythos-preview") ||
      lowercase.includes("claude-opus-4-8") ||
      lowercase.includes("claude-opus-4-7") ||
      lowercase.includes("claude-opus-4-6") ||
      lowercase.includes("claude-sonnet-4-6")
    );
  }

  private getAdaptiveThinkingEffort(budgetTokens = 4096): string {
    if (budgetTokens >= 8192) return "max";
    if (budgetTokens >= 4096) return "high";
    if (budgetTokens >= 1500) return "medium";
    return "low";
  }

  public getModelCapabilities(model: string): ModelCapabilities {
    const lowercase = model.toLowerCase();
    const isClaude = lowercase.includes("claude");
    const modelAdaptation = resolveModelAdaptation(model);
    const deepSeekV4Profile =
      modelAdaptation.family === "deepseek-v4"
        ? modelAdaptation.deepSeekV4
        : undefined;
    const inferred: ModelCapabilities = {
      streaming: true,
      toolCalls: true,
      jsonMode: true,
      thinking:
        Boolean(deepSeekV4Profile) ||
        this.supportsAdaptiveThinking(model) ||
        lowercase.includes("thinking") ||
        lowercase.includes("sonnet-3-7") ||
        lowercase.includes("sonnet-4") ||
        lowercase.includes("opus-4"),
      vision: deepSeekV4Profile ? false : isClaude,
      promptCaching: true,
      ...(deepSeekV4Profile
        ? {
            maxContextTokens: DEEPSEEK_V4_CONTEXT_TOKENS,
            maxOutputTokens: DEEPSEEK_V4_MAX_OUTPUT_TOKENS,
            apiFormats: ["chat-completions" as const],
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
    const key = this.resolveApiKey();
    if (!key) {
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
          "Unsupported model for the official DeepSeek Anthropic API. Use deepseek-v4-flash or deepseek-v4-pro.",
        ),
      };
      return;
    }

    let anthropicMessages: AnthropicRequestMessage[];
    let tools: AnthropicToolDefinition[] | undefined;
    let maxTokens: number;
    try {
      if (isDeepSeekV4) validateDeepSeekV4RequestInput(input);
      for (const message of input.messages) {
        const hasToolCall = message.content.some(
          (block) => block.type === "tool_call",
        );
        const hasToolResult = message.content.some(
          (block) => block.type === "tool_result",
        );
        if (hasToolCall && message.role !== "assistant") {
          throw new Error(
            "Tool-call content is only valid in assistant messages.",
          );
        }
        if (hasToolResult && message.role !== "tool") {
          throw new Error("Tool results must use the tool message role.");
        }
        if (message.role === "tool" && !hasToolResult) {
          throw new Error(
            "A tool-role message must contain at least one tool result.",
          );
        }
      }
      anthropicMessages = input.messages
        .filter((message) => message.role !== "system")
        .map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content.map(toAnthropicContentBlock),
        }));
      tools = capabilities.toolCalls
        ? input.tools?.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema:
              tool.inputJsonSchema ?? zodToJsonSchema(tool.inputSchema),
          }))
        : undefined;
      maxTokens = normalizeAnthropicMaxTokens(
        input.maxTokens,
        deepSeekV4Profile?.lane === "flash" ? 8192 : 16384,
        isDeepSeekV4,
      );
    } catch (error: unknown) {
      yield { type: "error", error: toError(error) };
      return;
    }

    // Extract system prompt
    const systemPrompt =
      input.system ||
      input.messages
        .find((m) => m.role === "system")
        ?.content.filter((b) => b.type === "text")
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("\n");

    // Split system prompt at Orbit's volatile marker for optimal cache breakpoints.
    // Layer 1 (stable prefix): core rules + tool schemas + repo map → cached across turns
    // Layer 2 (dynamic suffix): RAG context + file excerpts → changes per turn
    const cacheBoundaryMarkers = [
      "\n<!-- VOLATILE_CONTEXT -->",
      "\n<!-- CACHE_BOUNDARY -->",
    ];
    const cacheBoundary = systemPrompt
      ? cacheBoundaryMarkers.find((marker) => systemPrompt.includes(marker))
      : undefined;
    let systemParam: AnthropicSystemBlock[] | undefined;

    if (isDeepSeekV4 && systemPrompt) {
      // DeepSeek caching is automatic; Anthropic cache_control is ignored.
      systemParam = [{ type: "text" as const, text: systemPrompt }];
    } else if (systemPrompt && cacheBoundary) {
      const splitIdx = systemPrompt.indexOf(cacheBoundary);
      const stablePrefix = systemPrompt.substring(0, splitIdx);
      const dynamicSuffix = systemPrompt.substring(
        splitIdx + cacheBoundary.length,
      );

      systemParam = [
        {
          type: "text" as const,
          text: stablePrefix,
          cache_control: { type: "ephemeral" as const },
        },
        {
          type: "text" as const,
          text: dynamicSuffix,
          cache_control: { type: "ephemeral" as const },
        },
      ];
    } else if (systemPrompt) {
      systemParam = [
        {
          type: "text" as const,
          text: systemPrompt,
          cache_control: { type: "ephemeral" as const },
        },
      ];
    }

    if (
      !isDeepSeekV4 &&
      this.getModelCapabilities(input.model).promptCaching &&
      anthropicMessages.length > 0
    ) {
      const lastMsg = anthropicMessages[anthropicMessages.length - 1];
      if (lastMsg.content.length > 0) {
        const lastBlock = lastMsg.content[lastMsg.content.length - 1];
        lastBlock.cache_control = { type: "ephemeral" as const };
      }
    }

    const body: AnthropicRequestBody = {
      ...(this.options.extraBody ?? {}),
      model:
        isOfficialDeepSeek && deepSeekV4Profile
          ? deepSeekV4Profile.canonicalModel
          : input.model,
      messages: anthropicMessages,
      max_tokens: maxTokens,
      system: systemParam,
      stream: input.stream !== false && capabilities.streaming,
    };

    if (input.userId) {
      body.metadata = { user_id: input.userId };
    } else {
      delete body.metadata;
    }

    if (tools && tools.length > 0) {
      body.tools = tools;
    } else {
      delete body.tools;
    }

    if (deepSeekV4Profile) {
      const thinkingEnabled =
        capabilities.thinking &&
        (input.thinking?.enabled ?? deepSeekV4Profile.optimizedThinkingDefault);
      body.thinking = { type: thinkingEnabled ? "enabled" : "disabled" };
      if (thinkingEnabled) {
        body.output_config = {
          effort: getDeepSeekReasoningEffort(
            input.thinking?.budgetTokens,
            input.thinking?.effort,
          ),
        };
        delete body.temperature;
        delete body.top_p;
      } else {
        body.output_config = undefined;
        body.temperature = validateDeepSeekV4Temperature(
          input.temperature ?? 0,
        );
      }
    } else if (input.thinking?.enabled) {
      if (this.supportsAdaptiveThinking(input.model)) {
        body.thinking = {
          type: "adaptive",
          display: "summarized",
        };
        body.output_config = {
          ...(body.output_config || {}),
          effort: this.getAdaptiveThinkingEffort(input.thinking.budgetTokens),
        };
      } else {
        body.thinking = {
          type: "enabled",
          budget_tokens: input.thinking.budgetTokens || 1024,
        };
        body.temperature = 1.0;
      }
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
        this.getEndpointUrl("/v1/messages"),
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
      const errText = await readProviderErrorText(response);
      yield {
        type: "error",
        error: providerHttpError(
          "DeepSeek Anthropic",
          response.status,
          errText,
          [key],
        ),
      };
      if (input.abortSignal) {
        input.abortSignal.removeEventListener("abort", onExternalAbort);
      }
      return;
    }

    if (!body.stream) {
      let data: z.infer<typeof AnthropicMessageResponseSchema>;
      try {
        data = AnthropicMessageResponseSchema.parse(
          await readProviderJsonResponse(response),
        );
      } catch (error: unknown) {
        yield {
          type: "error",
          error: new Error(
            `Invalid Anthropic-compatible response: ${sanitizeProviderErrorText(toError(error).message, [key])}`,
          ),
        };
        if (input.abortSignal) {
          input.abortSignal.removeEventListener("abort", onExternalAbort);
        }
        return;
      }
      if (isDeepSeekV4) {
        try {
          validateToolStopReason(
            data.stop_reason,
            data.content.filter((block) => block.type === "tool_use").length,
          );
        } catch (error: unknown) {
          yield { type: "error", error: toError(error) };
          if (input.abortSignal) {
            input.abortSignal.removeEventListener("abort", onExternalAbort);
          }
          return;
        }
      }
      for (const block of data.content) {
        if (block.type === "text") {
          yield { type: "text_delta", text: block.text };
        } else if (block.type === "thinking") {
          yield {
            type: "thinking_delta",
            text: block.thinking,
            ...(block.signature ? { signature: block.signature } : {}),
          };
        } else if (block.type === "tool_use") {
          yield {
            type: "tool_call",
            toolCall: {
              id: block.id,
              name: block.name,
              arguments: JSON.stringify(block.input),
            },
          };
        }
      }
      yield {
        type: "usage",
        usage: {
          inputTokens: data.usage?.input_tokens ?? 0,
          outputTokens: data.usage?.output_tokens ?? 0,
          cacheReadTokens: data.usage?.cache_read_input_tokens ?? 0,
          cacheMissTokens: data.usage?.cache_creation_input_tokens ?? 0,
          totalTokens:
            (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
        },
      };
      const finishError =
        isDeepSeekV4 && !data.stop_reason
          ? new Error("DeepSeek response did not include a stop reason.")
          : modelFinishReasonError(data.stop_reason);
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
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheMissTokens = 0;
    let stopReason: string | null = null;
    let streamComplete = false;
    let emittedToolCalls = 0;
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
        if (done) break;

        let accumulatedText = "";
        let accumulatedThinking = "";

        const decoded = decoder.decode(value, { stream: true });
        totalStreamChars += decoded.length;
        if (totalStreamChars > MAX_STREAM_TOTAL_CHARS) {
          throw new Error(
            "DeepSeek Anthropic stream exceeded the safe total response limit.",
          );
        }
        buffer += decoded;
        if (buffer.length > MAX_STREAM_FRAME_CHARS) {
          throw new Error(
            "DeepSeek Anthropic SSE frame exceeded the safe streaming limit.",
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
            if (rawData === "[DONE]") continue;
            try {
              const parsed = AnthropicStreamEventSchema.parse(
                JSON.parse(rawData),
              );
              if (parsed.type === "error" || parsed.error) {
                throw new Error(
                  `DeepSeek API error: ${sanitizeProviderErrorText(parsed.error?.message || "unknown streaming error", [key])}`,
                );
              }

              if (parsed.type === "message_start") {
                if (parsed.message?.usage) {
                  inputTokens = parsed.message.usage.input_tokens || 0;
                  outputTokens = parsed.message.usage.output_tokens || 0;
                  cacheReadTokens =
                    parsed.message.usage.cache_read_input_tokens || 0;
                  cacheMissTokens =
                    parsed.message.usage.cache_creation_input_tokens || 0;
                }
              } else if (parsed.type === "content_block_start") {
                const idx = parsed.index;
                const block = parsed.content_block;
                if (
                  idx !== undefined &&
                  block?.type === "tool_use" &&
                  block.id &&
                  block.name
                ) {
                  if (
                    !streamingTools.has(idx) &&
                    streamingTools.size >= MAX_STREAM_TOOL_CALLS
                  ) {
                    throw new Error(
                      "DeepSeek Anthropic stream returned too many tool calls.",
                    );
                  }
                  streamingTools.set(idx, {
                    id: block.id,
                    name: block.name,
                    arguments: "",
                  });
                }
              } else if (parsed.type === "content_block_delta") {
                const idx = parsed.index;
                const delta = parsed.delta;
                if (delta?.type === "text_delta" && delta.text) {
                  accumulatedText += delta.text;
                } else if (delta?.type === "thinking_delta" && delta.thinking) {
                  accumulatedThinking += delta.thinking;
                } else if (
                  delta?.type === "signature_delta" &&
                  delta.signature
                ) {
                  if (accumulatedThinking) {
                    yield { type: "thinking_delta", text: accumulatedThinking };
                    accumulatedThinking = "";
                  }
                  yield {
                    type: "thinking_delta",
                    text: "",
                    signature: delta.signature,
                  };
                } else if (
                  delta?.type === "input_json_delta" &&
                  delta.partial_json &&
                  idx !== undefined
                ) {
                  const tool = streamingTools.get(idx);
                  if (tool) {
                    tool.arguments += delta.partial_json;
                    if (tool.arguments.length > MAX_TOOL_ARGUMENT_CHARS) {
                      throw new Error(
                        "DeepSeek Anthropic stream returned oversized JSON tool arguments.",
                      );
                    }
                  }
                }
              } else if (parsed.type === "content_block_stop") {
                const idx = parsed.index;
                const tool =
                  idx === undefined ? undefined : streamingTools.get(idx);
                if (tool && idx !== undefined) {
                  parseJsonObjectToolArguments(tool.arguments, {
                    oversized:
                      "Anthropic-compatible tool arguments exceed the safe size limit.",
                    malformed:
                      "Anthropic-compatible tool arguments contain malformed JSON.",
                    invalid:
                      "Anthropic-compatible tool arguments must be a JSON object.",
                  });
                  if (accumulatedText) {
                    yield { type: "text_delta", text: accumulatedText };
                    accumulatedText = "";
                  }
                  if (accumulatedThinking) {
                    yield { type: "thinking_delta", text: accumulatedThinking };
                    accumulatedThinking = "";
                  }
                  yield {
                    type: "tool_call",
                    toolCall: {
                      id: tool.id,
                      name: tool.name,
                      arguments: tool.arguments,
                    },
                  };
                  emittedToolCalls += 1;
                  streamingTools.delete(idx);
                }
              } else if (parsed.type === "message_delta") {
                if (parsed.delta?.stop_reason) {
                  stopReason = parsed.delta.stop_reason;
                }
                if (parsed.usage) {
                  outputTokens = parsed.usage.output_tokens || outputTokens;
                }
              } else if (parsed.type === "message_stop") {
                streamComplete = true;
              }
            } catch (error) {
              if (
                error instanceof Error &&
                error.message.startsWith("DeepSeek API error:")
              ) {
                throw error;
              }
              throw new Error(
                `Invalid Anthropic-compatible SSE frame: ${sanitizeProviderErrorText(toError(error).message, [key])}`,
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

      if (isDeepSeekV4 && stopReason === null) {
        throw new Error(
          "DeepSeek Anthropic stream ended before a stop reason was received.",
        );
      }
      if (streamingTools.size > 0) {
        throw new Error(
          "DeepSeek Anthropic stream ended with an incomplete tool call.",
        );
      }
      if (isDeepSeekV4) {
        validateToolStopReason(stopReason, emittedToolCalls);
      }

      yield {
        type: "usage",
        usage: {
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheMissTokens,
          totalTokens: inputTokens + outputTokens,
        },
      };
      const finishError = modelFinishReasonError(stopReason);
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
}
