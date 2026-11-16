import type { ModelChatInput, OrbitMessage } from "../types.js";
import { ProviderError } from "../utils.js";
import {
  type DeepSeekV4Lane,
  DEEPSEEK_V4_MAX_OUTPUT_TOKENS,
} from "./DeepSeekV4.js";

/** Reject contradictory native options before spending an API request. */
export function validateDeepSeekChatToolChoice(
  input: ModelChatInput,
  thinkingEnabled: boolean,
): void {
  if (!input.tools?.length) return;
  if (
    thinkingEnabled &&
    (input.toolChoice === "required" || typeof input.toolChoice === "object")
  ) {
    throw new ProviderError(
      "INVALID_REQUEST",
      'DeepSeek thinking mode does not support required or named tool choices. Use toolChoice "auto", or explicitly disable thinking to force a tool.',
    );
  }
}

/** Apply the documented model-specific sampling rules across DeepSeek protocols. */
export function applyDeepSeekSamplingPolicy(
  body: Record<string, unknown>,
  thinkingEnabled: boolean,
  lane: DeepSeekV4Lane = "flash",
): void {
  delete body.presence_penalty;
  delete body.frequency_penalty;
  if (thinkingEnabled) delete body.temperature;
  const topPEffective = lane === "flash" ? thinkingEnabled : !thinkingEnabled;
  if (!topPEffective) {
    delete body.top_p;
    return;
  }
  if (body.top_p === undefined) return;
  if (
    typeof body.top_p !== "number" ||
    !Number.isFinite(body.top_p) ||
    body.top_p <= 0 ||
    body.top_p > 1
  ) {
    throw new ProviderError(
      "INVALID_REQUEST",
      "DeepSeek top_p must be a finite number greater than 0 and at most 1.",
    );
  }
  if (lane === "flash") body.top_p = Math.max(0.95, body.top_p);
}

/** Validate immediate, complete tool replies without rewriting durable reasoning history. */
export function validateDeepSeekToolHistory(
  messages: readonly OrbitMessage[],
): void {
  const pending = new Set<string>();
  for (const message of messages) {
    const calls = message.content.filter((block) => block.type === "tool_call");
    const results = message.content.filter(
      (block) => block.type === "tool_result",
    );
    if (results.length > 0 && message.role !== "tool") {
      throw invalidHistory("Tool results must use a tool-role message.");
    }
    if (message.role === "tool") {
      if (results.length === 0 || calls.length > 0) {
        throw invalidHistory(
          "A tool-role message must contain tool results only.",
        );
      }
      for (const block of results) {
        if (!pending.delete(block.toolResult.toolCallId)) {
          throw invalidHistory(
            "A tool result has no pending call, or was supplied twice.",
          );
        }
      }
      continue;
    }
    if (pending.size > 0) {
      throw invalidHistory(
        "Every tool call needs its result before the next conversation message.",
      );
    }
    if (calls.length > 0 && message.role !== "assistant") {
      throw invalidHistory("Tool calls must use an assistant-role message.");
    }
    for (const block of calls) {
      if (!block.toolCall.id || pending.has(block.toolCall.id)) {
        throw invalidHistory(
          "Tool calls need non-empty, unique IDs within a turn.",
        );
      }
      pending.add(block.toolCall.id);
    }
  }
  if (pending.size > 0) {
    throw invalidHistory(
      "History ends with unresolved tool calls. Supply their results before continuing.",
    );
  }
}

function invalidHistory(detail: string): ProviderError {
  return new ProviderError(
    "INVALID_REQUEST",
    `Invalid DeepSeek tool history. ${detail}`,
  );
}

/** Bound the official output budget without substituting a model default. */
export function normalizeOfficialMaxTokens(
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

/** Validate non-thinking temperature before sending the native request. */
export function validateDeepSeekV4Temperature(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 2) {
    throw new Error("DeepSeek temperature must be between 0 and 2.");
  }
  return value;
}

/** Validate native stop sequences and output limits at the model boundary. */
export function validateDeepSeekV4RequestInput(input: ModelChatInput): void {
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

/** Serialize once and reject bodies beyond the official inline transport limit. */
export function serializeDeepSeekRequest(body: unknown): string {
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized, "utf8") > 48 * 1024 * 1024) {
    throw new ProviderError(
      "INVALID_REQUEST",
      "DeepSeek request exceeds 48 MiB. Reduce attachments or enable deepSeekFiles.",
    );
  }
  return serialized;
}
