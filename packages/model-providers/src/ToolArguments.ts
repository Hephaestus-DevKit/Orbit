import type { OrbitToolCall } from "./types.js";

/** Shared bounds and parsing for tool arguments across DeepSeek transports. */
export const MAX_TOOL_ARGUMENT_CHARS = 4 * 1024 * 1024;

export function parseJsonObjectToolArguments(
  argumentsText: string,
  messages: {
    oversized: string;
    malformed: string;
    invalid: string;
  },
): Record<string, unknown> {
  if (argumentsText.length > MAX_TOOL_ARGUMENT_CHARS) {
    throw new Error(messages.oversized);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsText);
  } catch {
    throw new Error(messages.malformed);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(messages.invalid);
  }
  return parsed as Record<string, unknown>;
}

export function validateJsonObjectToolArguments(argumentsText: string): void {
  parseJsonObjectToolArguments(argumentsText, {
    oversized: "DeepSeek returned oversized JSON tool arguments.",
    malformed: "DeepSeek returned malformed JSON tool arguments.",
    invalid: "DeepSeek tool arguments must be a JSON object.",
  });
}

/** Validate the whole settled batch before exposing any executable tool call. */
export function validateCompleteToolCallBatch(
  calls: readonly OrbitToolCall[],
): void {
  const ids = new Set<string>();
  for (const call of calls) {
    if (!call.id?.trim() || !call.name?.trim() || ids.has(call.id)) {
      throw new Error(
        "Provider returned incomplete or duplicate tool-call identities.",
      );
    }
    ids.add(call.id);
    validateJsonObjectToolArguments(call.arguments);
  }
}
