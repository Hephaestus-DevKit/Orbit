import { z } from "zod";
import type {
  ModelChatInput,
  ModelEvent,
  OrbitToolCall,
  ProviderRuntimeOptions,
  TokenUsage,
} from "../types.js";
import {
  fetchWithRetry,
  normalizeProviderStreamError,
  ProviderError,
  providerHttpError,
  readProviderErrorText,
  readProviderJsonResponse,
  sanitizeProviderError,
  sanitizeProviderErrorText,
  zodToJsonSchema,
} from "../utils.js";
import {
  DEEPSEEK_V4_MAX_OUTPUT_TOKENS,
  getDeepSeekReasoningEffort,
  type DeepSeekV4ModelProfile,
} from "./DeepSeekV4.js";
import {
  MAX_TOOL_ARGUMENT_CHARS,
  validateJsonObjectToolArguments,
} from "../ToolArguments.js";

const TokenCountSchema = z.number().int().nonnegative().max(1_000_000_000);
const CollectionIndexSchema = z.number().int().nonnegative().max(1_000_000);
const MAX_STREAM_FRAME_CHARS = 4 * 1024 * 1024;
const MAX_STREAM_TOTAL_CHARS = 8 * 1024 * 1024;
const MAX_STREAM_TOOL_CALLS = 1000;

const ResponsesUsageSchema = z
  .object({
    input_tokens: TokenCountSchema.optional(),
    output_tokens: TokenCountSchema.optional(),
    total_tokens: TokenCountSchema.optional(),
    input_tokens_details: z
      .object({
        cached_tokens: TokenCountSchema.optional(),
        cache_write_tokens: TokenCountSchema.optional(),
      })
      .passthrough()
      .optional(),
    output_tokens_details: z
      .object({ reasoning_tokens: TokenCountSchema.optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

const ResponsesErrorSchema = z
  .object({
    message: z.string().optional(),
    code: z.union([z.string(), z.number()]).nullable().optional(),
  })
  .passthrough();

const ResponsesOutputItemSchema = z
  .object({
    id: z.string().optional(),
    type: z.string(),
    role: z.string().optional(),
    call_id: z.string().optional(),
    name: z.string().optional(),
    arguments: z.string().optional(),
    summary: z
      .array(
        z
          .object({
            type: z.string().optional(),
            text: z.string().optional(),
          })
          .passthrough(),
      )
      .max(10_000)
      .optional(),
    content: z
      .union([
        z.string(),
        z
          .array(
            z
              .object({
                type: z.string(),
                text: z.string().optional(),
                refusal: z.string().optional(),
              })
              .passthrough(),
          )
          .max(10_000),
      ])
      .optional(),
  })
  .passthrough();

const DeepSeekResponseSchema = z
  .object({
    id: z.string().optional(),
    model: z.string().optional(),
    status: z.string().optional(),
    output: z.array(ResponsesOutputItemSchema).max(10_000).default([]),
    // Official streaming lifecycle events report `usage: null` until the
    // terminal response carries token accounting.
    usage: ResponsesUsageSchema.nullish(),
    error: ResponsesErrorSchema.nullish(),
    incomplete_details: z
      .object({ reason: z.string().optional() })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const ResponsesStreamEventSchema = z
  .object({
    type: z.string().optional(),
    event: z.string().optional(),
    sequence_number: CollectionIndexSchema.optional(),
    output_index: CollectionIndexSchema.optional(),
    item_id: z.string().optional(),
    delta: z.string().optional(),
    text: z.string().optional(),
    arguments: z.string().optional(),
    code: z.union([z.string(), z.number()]).optional(),
    message: z.string().optional(),
    item: ResponsesOutputItemSchema.optional(),
    response: DeepSeekResponseSchema.optional(),
  })
  .passthrough();

type DeepSeekResponse = z.infer<typeof DeepSeekResponseSchema>;
type ResponsesOutputItem = z.infer<typeof ResponsesOutputItemSchema>;

type ResponsesInputItem =
  | { type: "message"; role: "system" | "user" | "assistant"; content: string }
  | { type: "reasoning"; content: string }
  | {
      type: "function_call";
      call_id: string;
      name: string;
      arguments: string;
    }
  | { type: "function_call_output"; call_id: string; output: string };

export interface DeepSeekResponsesRequestBody {
  [key: string]: unknown;
  model: string;
  input: ResponsesInputItem[];
  instructions?: string;
  stream: boolean;
  store: false;
  max_output_tokens?: number;
  reasoning: { effort: "none" | "low" | "high" | "max" };
  temperature?: number;
  user?: string;
  tools?: Array<{
    type: "function";
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  tool_choice?:
    | "none"
    | "auto"
    | "required"
    | { type: "function"; name: string };
  text?: {
    format:
      | { type: "json_object" }
      | { type: "json_schema"; name: string; schema: Record<string, unknown> };
  };
}

export interface DeepSeekResponsesTransportOptions {
  endpoint: string;
  headers: Record<string, string>;
  apiKey?: string;
  runtime: ProviderRuntimeOptions;
  profile: DeepSeekV4ModelProfile;
  requestModel?: string;
  official?: boolean;
}

/** Signals that automatic routing may safely retry via Chat Completions. */
export class DeepSeekResponsesUnavailableError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DeepSeekResponsesUnavailableError";
  }
}

function isResponsesEndpointUnavailable(
  status: number,
  detail: string,
): boolean {
  if ([404, 405, 501].includes(status)) return true;
  if (status !== 400) return false;
  const normalized = detail.toLowerCase();
  return (
    /(?:responses? api|responses? endpoint|route|path)/.test(normalized) &&
    /(?:not supported|unsupported|not found|unknown|unavailable)/.test(
      normalized,
    )
  );
}

function normalizeMaxOutputTokens(
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

function buildInputItems(input: ModelChatInput): ResponsesInputItem[] {
  const items: ResponsesInputItem[] = [];
  const functionCalls = new Set<string>();
  const functionOutputs = new Set<string>();
  for (const message of input.messages) {
    const images = message.content.filter((block) => block.type === "image");
    if (images.length > 0) {
      throw new Error(
        "The selected DeepSeek model does not accept image input. Switch to a vision-capable model or remove the attachment.",
      );
    }
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    if (message.role === "tool") {
      const results = message.content.filter(
        (block) => block.type === "tool_result",
      );
      if (results.length === 0) {
        throw new Error(
          "A tool-role message must contain at least one tool result.",
        );
      }
      for (const block of results) {
        if (!block.toolResult.toolCallId) {
          throw new Error("DeepSeek tool results require a non-empty call_id.");
        }
        if (functionOutputs.has(block.toolResult.toolCallId)) {
          throw new Error(
            `DeepSeek tool result call_id "${block.toolResult.toolCallId}" was supplied more than once.`,
          );
        }
        functionOutputs.add(block.toolResult.toolCallId);
        items.push({
          type: "function_call_output",
          call_id: block.toolResult.toolCallId,
          output: block.toolResult.content || "(no output)",
        });
      }
      continue;
    }

    const toolCalls = message.content.filter(
      (block) => block.type === "tool_call",
    );
    if (toolCalls.length > 0 && message.role !== "assistant") {
      throw new Error("Tool-call content is only valid in assistant messages.");
    }

    if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type !== "thinking") continue;
        if (block.text) items.push({ type: "reasoning", content: block.text });
      }
      if (text)
        items.push({ type: "message", role: "assistant", content: text });
      for (const block of toolCalls) {
        if (!block.toolCall.id) {
          throw new Error(
            "DeepSeek function calls require a non-empty call_id.",
          );
        }
        if (functionCalls.has(block.toolCall.id)) {
          throw new Error(
            `DeepSeek function call_id "${block.toolCall.id}" was supplied more than once.`,
          );
        }
        functionCalls.add(block.toolCall.id);
        validateJsonObjectToolArguments(block.toolCall.arguments);
        items.push({
          type: "function_call",
          call_id: block.toolCall.id,
          name: block.toolCall.name,
          arguments: block.toolCall.arguments,
        });
      }
      continue;
    }

    items.push({ type: "message", role: message.role, content: text });
  }
  for (const callId of functionOutputs) {
    if (!functionCalls.has(callId)) {
      throw new Error(
        `DeepSeek tool result references unknown call_id "${callId}".`,
      );
    }
  }
  return items;
}

/** Builds a stateless request for a Responses-compatible DeepSeek gateway. */
export function buildDeepSeekResponsesRequest(
  input: ModelChatInput,
  profile: DeepSeekV4ModelProfile,
  extraBody: Record<string, unknown> = {},
  requestModel: string = profile.canonicalModel,
): DeepSeekResponsesRequestBody {
  const thinkingEnabled =
    input.thinking?.enabled ?? profile.optimizedThinkingDefault;
  const body: DeepSeekResponsesRequestBody = {
    ...extraBody,
    model: requestModel,
    input: buildInputItems(input),
    stream: input.stream !== false,
    store: false,
    reasoning: {
      effort: thinkingEnabled
        ? getDeepSeekReasoningEffort(
            input.thinking?.budgetTokens,
            input.thinking?.effort,
          )
        : "none",
    },
  };

  if (input.system) body.instructions = input.system;
  else delete body.instructions;
  body.max_output_tokens = normalizeMaxOutputTokens(input.maxTokens);
  if (body.max_output_tokens === undefined) delete body.max_output_tokens;
  if (input.userId) body.user = input.userId;
  else delete body.user;

  if (thinkingEnabled) {
    delete body.temperature;
    delete body.top_p;
    delete body.presence_penalty;
    delete body.frequency_penalty;
  } else {
    if (input.temperature !== undefined) body.temperature = input.temperature;
    else delete body.temperature;
  }

  if (input.tools && input.tools.length > 0) {
    body.tools = input.tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.inputJsonSchema ?? zodToJsonSchema(tool.inputSchema),
    }));
    if (input.toolChoice && typeof input.toolChoice === "object") {
      body.tool_choice = {
        type: "function",
        name: input.toolChoice.name,
      };
    } else if (input.toolChoice) {
      body.tool_choice = input.toolChoice;
    }
  } else {
    delete body.tools;
    delete body.tool_choice;
    delete body.parallel_tool_calls;
  }
  if (input.responseFormat === "json") {
    body.text = input.responseJsonSchema
      ? {
          format: {
            type: "json_schema",
            name: "orbit_response",
            schema: input.responseJsonSchema,
          },
        }
      : { format: { type: "json_object" } };
    const jsonInstruction = input.responseJsonSchema
      ? "Return only valid JSON matching the supplied response schema."
      : "Return only a valid JSON object. Do not wrap it in Markdown.";
    body.instructions = body.instructions
      ? `${body.instructions}\n\n${jsonInstruction}`
      : jsonInstruction;
  } else {
    delete body.text;
  }

  for (const unsupported of [
    "previous_response_id",
    "conversation",
    "background",
    "metadata",
    "prompt",
    "truncation",
    "service_tier",
    "stream_options",
    "prompt_cache_key",
    "prompt_cache_retention",
    "context_management",
  ]) {
    delete body[unsupported];
  }
  return body;
}

function usageFromResponse(response: DeepSeekResponse): TokenUsage {
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  const cacheReadTokens =
    response.usage?.input_tokens_details?.cached_tokens ?? 0;
  const cacheWriteTokens =
    response.usage?.input_tokens_details?.cache_write_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: response.usage?.total_tokens ?? inputTokens + outputTokens,
    cacheReadTokens,
    cacheMissTokens: Math.max(
      0,
      inputTokens - cacheReadTokens - cacheWriteTokens,
    ),
    cacheWriteTokens,
    reasoningTokens:
      response.usage?.output_tokens_details?.reasoning_tokens ?? 0,
  };
}

function textFromItem(item: ResponsesOutputItem): string {
  if (typeof item.content === "string") return item.content;
  return (item.content ?? [])
    .filter((part) => part.type === "output_text" || part.type === "refusal")
    .map((part) => part.text ?? part.refusal ?? "")
    .join("");
}

function reasoningFromItem(item: ResponsesOutputItem): string {
  if (typeof item.content === "string") return item.content;
  return (item.content ?? [])
    .filter((part) => part.type === "reasoning_text")
    .map((part) => part.text ?? "")
    .join("");
}

function toolCallFromItem(
  item: ResponsesOutputItem,
): OrbitToolCall | undefined {
  if (item.type !== "function_call") return undefined;
  if (!item.call_id || !item.name || item.arguments === undefined) {
    throw new Error("DeepSeek returned an incomplete function call.");
  }
  validateJsonObjectToolArguments(item.arguments);
  return { id: item.call_id, name: item.name, arguments: item.arguments };
}

function terminalResponseError(
  response: DeepSeekResponse,
  apiKey?: string,
): Error | undefined {
  if (response.error?.message) {
    return new ProviderError(
      "SERVER",
      `DeepSeek Responses API error: ${sanitizeProviderErrorText(response.error.message, [apiKey])}`,
      { retryable: true },
    );
  }
  if (response.status === "completed" || response.status === undefined) {
    return undefined;
  }
  if (response.status === "incomplete") {
    const reason = response.incomplete_details?.reason;
    return new ProviderError(
      reason === "max_output_tokens" ? "OUTPUT_LIMIT" : "STREAM_CLOSED",
      reason === "max_output_tokens"
        ? "Model output was truncated at the configured token limit. Increase the output limit or reduce the requested scope."
        : `DeepSeek response was incomplete${reason ? ` (${reason})` : ""}.`,
    );
  }
  return new ProviderError("SERVER", "DeepSeek Responses API failed.", {
    retryable: true,
  });
}

function responseMetadata(
  input: ModelChatInput,
  profile: DeepSeekV4ModelProfile,
  response: DeepSeekResponse,
  requestId?: string,
  official = true,
): ModelEvent {
  return {
    type: "response_metadata",
    requestedModel: input.model,
    resolvedModel: response.model,
    providerRequestId: response.id || requestId,
    apiFormat: "responses",
    modelVersion: profile.modelVersion,
    reasoningEffort:
      input.thinking?.enabled === false
        ? "none"
        : getDeepSeekReasoningEffort(
            input.thinking?.budgetTokens,
            input.thinking?.effort,
          ),
    endpointKind: official ? "official" : "gateway",
  };
}

async function* parseNonStreamingResponse(
  input: ModelChatInput,
  options: DeepSeekResponsesTransportOptions,
  response: Response,
): AsyncIterable<ModelEvent> {
  const data = DeepSeekResponseSchema.parse(
    await readProviderJsonResponse(response),
  );
  yield responseMetadata(
    input,
    options.profile,
    data,
    response.headers.get("x-request-id") ?? undefined,
    options.official !== false,
  );
  let emittedOutput = false;
  for (const item of data.output) {
    if (item.type === "reasoning") {
      const text = reasoningFromItem(item);
      if (text) {
        emittedOutput = true;
        yield { type: "thinking_delta", text };
      }
    } else if (item.type === "message") {
      const text = textFromItem(item);
      if (text) {
        emittedOutput = true;
        yield { type: "text_delta", text };
      }
    } else {
      const toolCall = toolCallFromItem(item);
      if (toolCall) {
        emittedOutput = true;
        yield { type: "tool_call", toolCall };
      }
    }
  }
  yield { type: "usage", usage: usageFromResponse(data) };
  const error = terminalResponseError(data, options.apiKey);
  if (error) yield { type: "error", error };
  else if (!emittedOutput) {
    yield {
      type: "error",
      error: new ProviderError(
        "EMPTY_RESPONSE",
        "DeepSeek Responses API returned an empty response.",
      ),
    };
  } else yield { type: "done" };
}

function parseSseFrame(frame: string): unknown | undefined {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return undefined;
  if (data === "[DONE]") {
    throw new ProviderError(
      "MALFORMED_RESPONSE",
      "DeepSeek Responses API emitted the Chat Completions [DONE] sentinel.",
    );
  }
  return JSON.parse(data);
}

async function* parseStreamingResponse(
  input: ModelChatInput,
  options: DeepSeekResponsesTransportOptions,
  response: Response,
  controller: AbortController,
): AsyncIterable<ModelEvent> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("DeepSeek Responses stream is not readable.");

  const decoder = new TextDecoder();
  const tools = new Map<string, OrbitToolCall>();
  const outputAliases = new Map<string, string>();
  const streamedText = new Map<string, string>();
  const streamedReasoning = new Map<string, string>();
  let buffer = "";
  let totalChars = 0;
  let terminal = false;
  let metadataEmitted = false;
  let emittedOutput = false;
  let timeoutId: NodeJS.Timeout | undefined;
  const streamTimeoutMs = options.runtime.streamTimeoutMs ?? 300_000;
  let lastSequenceNumber = -1;
  const resetTimeout = () => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      controller.abort(
        new DOMException(
          `Stream reading timed out after ${Math.round(streamTimeoutMs / 1000)} seconds of inactivity.`,
          "TimeoutError",
        ),
      );
    }, streamTimeoutMs);
    // Stream inactivity is an awaited request boundary, not background work.
    // Keeping it referenced prevents CLI termination while a stream is idle.
  };

  const outputKey = (
    outputIndex: number | undefined,
    itemId?: string,
  ): string => {
    const aliased = itemId ? outputAliases.get(itemId) : undefined;
    if (aliased) return aliased;
    if (outputIndex !== undefined) {
      const key = `index:${outputIndex}`;
      if (itemId) outputAliases.set(itemId, key);
      return key;
    }
    if (itemId) {
      const key = `item:${itemId}`;
      outputAliases.set(itemId, key);
      return key;
    }
    throw new Error(
      "DeepSeek Responses output event omitted both output_index and item_id.",
    );
  };

  const missingSuffix = (complete: string, emitted: string): string => {
    if (!emitted) return complete;
    return complete.startsWith(emitted) ? complete.slice(emitted.length) : "";
  };

  const upsertTool = (
    item: ResponsesOutputItem,
    outputIndex: number | undefined,
  ): void => {
    if (item.type !== "function_call") return;
    const key = outputKey(outputIndex, item.id);
    if (!tools.has(key) && tools.size >= MAX_STREAM_TOOL_CALLS) {
      throw new Error(
        "DeepSeek Responses stream returned too many tool calls.",
      );
    }
    const current = tools.get(key) ?? { id: "", name: "", arguments: "" };
    if (item.call_id) current.id = item.call_id;
    if (item.name) current.name = item.name;
    if (item.arguments !== undefined) current.arguments = item.arguments;
    if (current.arguments.length > MAX_TOOL_ARGUMENT_CHARS) {
      throw new Error("DeepSeek returned oversized JSON tool arguments.");
    }
    tools.set(key, current);
  };

  const getTool = (
    outputIndex: number | undefined,
    itemId?: string,
  ): OrbitToolCall => {
    const key = outputKey(outputIndex, itemId);
    if (!tools.has(key) && tools.size >= MAX_STREAM_TOOL_CALLS) {
      throw new Error(
        "DeepSeek Responses stream returned too many tool calls.",
      );
    }
    const current = tools.get(key) ?? { id: "", name: "", arguments: "" };
    tools.set(key, current);
    return current;
  };

  try {
    resetTimeout();
    while (!terminal) {
      const { done, value } = await reader.read();
      resetTimeout();
      if (done) {
        const tail = decoder.decode().replace(/\r\n/g, "\n");
        totalChars += tail.length;
        buffer += tail;
        // Dispatch a complete final event at EOF even when the producer omits
        // the optional trailing blank line.
        if (buffer.trim().length > 0 && !buffer.endsWith("\n\n")) {
          buffer += "\n\n";
        }
      } else {
        const decoded = decoder
          .decode(value, { stream: true })
          .replace(/\r\n/g, "\n");
        totalChars += decoded.length;
        if (totalChars > MAX_STREAM_TOTAL_CHARS) {
          throw new Error(
            "DeepSeek Responses stream exceeded the safe total response limit.",
          );
        }
        buffer += decoded;
      }
      if (buffer.length > MAX_STREAM_FRAME_CHARS) {
        throw new Error(
          "DeepSeek Responses SSE frame exceeded the safe streaming limit.",
        );
      }

      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const raw = parseSseFrame(frame);
        if (raw === undefined) continue;
        const event = ResponsesStreamEventSchema.parse(raw);
        if (event.sequence_number !== undefined) {
          if (event.sequence_number <= lastSequenceNumber) {
            throw new ProviderError(
              "MALFORMED_RESPONSE",
              `DeepSeek Responses sequence_number must increase monotonically (received ${event.sequence_number} after ${lastSequenceNumber}).`,
            );
          }
          lastSequenceNumber = event.sequence_number;
        }
        const eventType = event.type || event.event;
        if (!eventType)
          throw new Error("DeepSeek Responses event has no type.");

        if (eventType === "response.created" && event.response) {
          metadataEmitted = true;
          yield responseMetadata(
            input,
            options.profile,
            event.response,
            response.headers.get("x-request-id") ?? undefined,
            options.official !== false,
          );
        } else if (
          eventType === "response.reasoning_text.delta" &&
          event.delta
        ) {
          const key = outputKey(event.output_index ?? 0, event.item_id);
          streamedReasoning.set(
            key,
            (streamedReasoning.get(key) ?? "") + event.delta,
          );
          emittedOutput = true;
          yield { type: "thinking_delta", text: event.delta };
        } else if (
          (eventType === "response.output_text.delta" ||
            eventType === "response.refusal.delta") &&
          event.delta
        ) {
          const key = outputKey(event.output_index ?? 0, event.item_id);
          streamedText.set(key, (streamedText.get(key) ?? "") + event.delta);
          emittedOutput = true;
          yield { type: "text_delta", text: event.delta };
        } else if (eventType === "response.output_item.added" && event.item) {
          outputKey(event.output_index, event.item.id);
          upsertTool(event.item, event.output_index);
        } else if (
          eventType === "response.function_call_arguments.delta" &&
          event.delta
        ) {
          const current = getTool(event.output_index, event.item_id);
          current.arguments += event.delta;
          if (current.arguments.length > MAX_TOOL_ARGUMENT_CHARS) {
            throw new Error("DeepSeek returned oversized JSON tool arguments.");
          }
        } else if (eventType === "response.function_call_arguments.done") {
          const current = getTool(event.output_index, event.item_id);
          if (event.arguments !== undefined)
            current.arguments = event.arguments;
        } else if (eventType === "response.output_item.done" && event.item) {
          const key = outputKey(event.output_index, event.item.id);
          upsertTool(event.item, event.output_index);
          if (event.item.type === "reasoning") {
            const complete = reasoningFromItem(event.item);
            const suffix = missingSuffix(
              complete,
              streamedReasoning.get(key) ?? "",
            );
            if (suffix) {
              emittedOutput = true;
              streamedReasoning.set(key, complete);
              yield { type: "thinking_delta", text: suffix };
            }
          } else if (event.item.type === "message") {
            const complete = textFromItem(event.item);
            const suffix = missingSuffix(complete, streamedText.get(key) ?? "");
            if (suffix) {
              emittedOutput = true;
              streamedText.set(key, complete);
              yield { type: "text_delta", text: suffix };
            }
          }
        } else if (eventType === "error") {
          throw new Error(
            `DeepSeek Responses API error${event.code !== undefined ? ` (${event.code})` : ""}: ${event.message || "unknown stream error"}`,
          );
        } else if (
          eventType === "response.completed" ||
          eventType === "response.incomplete" ||
          eventType === "response.failed"
        ) {
          if (!event.response) {
            throw new Error(
              "DeepSeek Responses terminal event omitted the response object.",
            );
          }
          if (!metadataEmitted) {
            yield responseMetadata(
              input,
              options.profile,
              event.response,
              response.headers.get("x-request-id") ?? undefined,
              options.official !== false,
            );
          }
          for (const [outputIndex, item] of event.response.output.entries()) {
            const key = outputKey(outputIndex, item.id);
            upsertTool(item, outputIndex);
            if (item.type === "reasoning") {
              const complete = reasoningFromItem(item);
              const suffix = missingSuffix(
                complete,
                streamedReasoning.get(key) ?? "",
              );
              if (suffix) {
                emittedOutput = true;
                streamedReasoning.set(key, complete);
                yield { type: "thinking_delta", text: suffix };
              }
            }
            if (item.type === "message") {
              const complete = textFromItem(item);
              const suffix = missingSuffix(
                complete,
                streamedText.get(key) ?? "",
              );
              if (suffix) {
                emittedOutput = true;
                streamedText.set(key, complete);
                yield { type: "text_delta", text: suffix };
              }
            }
          }
          for (const toolCall of tools.values()) {
            if (!toolCall.id || !toolCall.name) {
              throw new Error(
                "DeepSeek Responses stream ended with an incomplete tool call.",
              );
            }
            validateJsonObjectToolArguments(toolCall.arguments);
            emittedOutput = true;
            yield { type: "tool_call", toolCall };
          }
          yield { type: "usage", usage: usageFromResponse(event.response) };
          const error = terminalResponseError(event.response, options.apiKey);
          if (error) yield { type: "error", error };
          else if (!emittedOutput) {
            yield {
              type: "error",
              error: new ProviderError(
                "EMPTY_RESPONSE",
                "DeepSeek Responses API returned an empty response.",
              ),
            };
          } else yield { type: "done" };
          terminal = true;
        }
      }
      if (done) break;
    }
    if (!terminal) {
      throw new ProviderError(
        "STREAM_CLOSED",
        "DeepSeek Responses stream ended before a terminal event.",
      );
    }
  } catch (error: unknown) {
    const abortReason = controller.signal.aborted
      ? controller.signal.reason
      : input.abortSignal?.aborted
        ? input.abortSignal.reason
        : undefined;
    throw normalizeProviderStreamError(
      abortReason ?? error,
      [options.apiKey],
      emittedOutput || tools.size > 0,
    );
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Executes a configured Responses-compatible transport and normalizes events. */
export async function* chatWithDeepSeekResponses(
  input: ModelChatInput,
  options: DeepSeekResponsesTransportOptions,
): AsyncIterable<ModelEvent> {
  const body = buildDeepSeekResponsesRequest(
    input,
    options.profile,
    options.runtime.extraBody,
    options.requestModel,
  );
  const controller = new AbortController();
  const onAbort = () => controller.abort(input.abortSignal?.reason);
  if (input.abortSignal?.aborted) {
    throw (
      input.abortSignal.reason ??
      new DOMException("The user aborted a request.", "AbortError")
    );
  }
  input.abortSignal?.addEventListener("abort", onAbort);

  try {
    const response = await fetchWithRetry(
      options.endpoint,
      {
        method: "POST",
        headers: options.headers,
        body: JSON.stringify(body),
        signal: controller.signal,
        timeout: options.runtime.requestTimeoutMs,
      },
      options.runtime.maxRetries ?? 0,
    );
    if (!response.ok) {
      const detail = await readProviderErrorText(response);
      if (isResponsesEndpointUnavailable(response.status, detail)) {
        throw new DeepSeekResponsesUnavailableError(
          response.status,
          `DeepSeek Responses API is unavailable (HTTP ${response.status})${detail ? `: ${sanitizeProviderErrorText(detail, [options.apiKey])}` : "."}`,
        );
      }
      throw providerHttpError(
        "DeepSeek Responses",
        response.status,
        detail,
        [options.apiKey],
        {
          retryAfter: response.headers.get("retry-after"),
          requestId:
            response.headers.get("x-request-id") ??
            response.headers.get("x-deepseek-request-id") ??
            undefined,
        },
      );
    }
    if (body.stream) {
      yield* parseStreamingResponse(input, options, response, controller);
    } else {
      yield* parseNonStreamingResponse(input, options, response);
    }
  } catch (error: unknown) {
    if (error instanceof DeepSeekResponsesUnavailableError) throw error;
    throw sanitizeProviderError(
      error,
      [options.apiKey],
      "DeepSeek Responses request failed.",
    );
  } finally {
    input.abortSignal?.removeEventListener("abort", onAbort);
  }
}
