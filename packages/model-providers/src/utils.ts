import type { ModelCapabilities, ModelProvider } from "./types.js";
import type { z } from "zod";
import { zodToJsonSchema as convertZodToJsonSchema } from "zod-to-json-schema";
import {
  readResponseJsonWithinLimit,
  readResponseTextWithinLimit,
} from "@orbit-build/shared";

const PROVIDER_ERROR_RESPONSE_MAX_BYTES = 64 * 1024;
const PROVIDER_JSON_RESPONSE_MAX_BYTES = 32 * 1024 * 1024;

export type ProviderFailureCode =
  | "AUTH"
  | "QUOTA"
  | "RATE_LIMIT"
  | "CONTEXT_WINDOW_EXCEEDED"
  | "INVALID_REQUEST"
  | "SERVER"
  | "OVERLOADED"
  | "TRANSPORT"
  | "TIMEOUT"
  | "ABORTED"
  | "STREAM_CLOSED"
  | "MALFORMED_RESPONSE"
  | "EMPTY_RESPONSE"
  | "OUTPUT_LIMIT";

/** Serializable provider failure used for retry, fallback, and diagnostics. */
export class ProviderError extends Error {
  public readonly code: ProviderFailureCode;
  public readonly status?: number;
  public readonly retryAfterMs?: number;
  public readonly requestId?: string;
  public readonly retryable: boolean;
  public readonly partialOutput: boolean;

  constructor(
    code: ProviderFailureCode,
    message: string,
    options: {
      status?: number;
      retryAfterMs?: number;
      requestId?: string;
      retryable?: boolean;
      partialOutput?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ProviderError";
    this.code = code;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.requestId = options.requestId;
    this.retryable = options.retryable ?? false;
    this.partialOutput = options.partialOutput ?? false;
  }
}

export function isProviderError(value: unknown): value is ProviderError {
  return value instanceof ProviderError;
}

/** Read a bounded provider error body without masking the HTTP status. */
export async function readProviderErrorText(
  response: Response,
): Promise<string> {
  return readResponseTextWithinLimit(
    response,
    PROVIDER_ERROR_RESPONSE_MAX_BYTES,
    "Provider error response",
  ).catch(() => "");
}

/** Read a bounded non-streaming provider JSON response. */
export async function readProviderJsonResponse(
  response: Response,
): Promise<unknown> {
  return readResponseJsonWithinLimit(
    response,
    PROVIDER_JSON_RESPONSE_MAX_BYTES,
    "Provider JSON response",
  );
}

/**
 * Resolve one model's effective capabilities without relying on its name.
 * Provider-level declarations remain the safe fallback when a dynamic catalog
 * rejects an unknown or private model.
 */
export function resolveModelCapabilities(
  provider: ModelProvider,
  model: string,
): ModelCapabilities {
  const providerCapabilities = provider.capabilities ?? {
    streaming: true,
    toolCalls: false,
    jsonMode: false,
    thinking: false,
    vision: false,
    promptCaching: false,
  };
  if (typeof provider.getModelCapabilities !== "function") {
    return { ...providerCapabilities };
  }
  try {
    return {
      ...providerCapabilities,
      ...provider.getModelCapabilities(model),
    };
  } catch {
    return { ...providerCapabilities };
  }
}

/** Convert a tool's Zod input contract without depending on Zod internals. */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const converted = convertZodToJsonSchema(schema, {
    $refStrategy: "none",
    target: "jsonSchema7",
  });
  if (
    typeof converted !== "object" ||
    converted === null ||
    Array.isArray(converted)
  ) {
    return { type: "object" };
  }
  const json = { ...(converted as Record<string, unknown>) };
  delete json.$schema;
  delete json.definitions;
  return json;
}

/** Merge user headers without allowing credential or content-type replacement. */
export function mergeSafeProviderHeaders(
  base: Record<string, string>,
  custom: Record<string, string> | undefined,
  protectedNames: ReadonlyArray<string> = [],
): Record<string, string> {
  const protectedSet = new Set(
    ["authorization", "content-type", ...protectedNames].map((name) =>
      name.toLowerCase(),
    ),
  );
  const result = { ...base };
  for (const [name, value] of Object.entries(custom || {})) {
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
      /[\r\n]/.test(value) ||
      protectedSet.has(name.toLowerCase())
    ) {
      continue;
    }
    result[name] = value;
  }
  return result;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit & { timeout?: number },
  maxRetries = 3,
): Promise<Response> {
  const timeoutMs = init.timeout ?? 60000;
  let attempt = 0;

  while (true) {
    const controller = new AbortController();
    const signal = init.signal
      ? AbortSignal.any([controller.signal, init.signal])
      : controller.signal;
    let retryResponse: Response | undefined;

    if (init.signal) {
      if (init.signal.aborted) {
        throw (
          init.signal.reason ||
          new DOMException("The user aborted a request.", "AbortError")
        );
      }
    }

    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    timeoutId.unref?.();

    try {
      const response = await fetch(url, {
        ...init,
        signal,
      });

      if (response.ok) {
        return response;
      }

      const status = response.status;
      const isTransient = status === 429 || (status >= 500 && status <= 504);
      if (!isTransient || attempt >= maxRetries) {
        return response;
      }
      retryResponse = response;
      await response.body?.cancel();
    } catch (error: unknown) {
      const isExternalAbort = init.signal?.aborted;
      if (isExternalAbort) {
        throw error;
      }

      const isTimeout =
        error instanceof Error &&
        error.name === "AbortError" &&
        !isExternalAbort;
      if (isTimeout) {
        if (attempt >= maxRetries) {
          throw new DOMException("Request timed out", "TimeoutError");
        }
      } else {
        if (attempt >= maxRetries) {
          throw error;
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }

    attempt++;
    const delay = getRetryDelayMs(retryResponse, attempt);
    await abortableDelay(delay, init.signal);
  }
}

const MAX_PROVIDER_ERROR_LENGTH = 1000;

/** Converts an unknown thrown value into a safe Error instance. */
export function toError(
  value: unknown,
  fallbackMessage = "Unknown provider error.",
): Error {
  return value instanceof Error ? value : new Error(fallbackMessage);
}

/**
 * Redacts credentials and bounds untrusted provider error text before it is
 * surfaced in the terminal or persisted in diagnostics.
 */
export function sanitizeProviderErrorText(
  value: unknown,
  secrets: ReadonlyArray<string | undefined> = [],
): string {
  let text = typeof value === "string" ? value : String(value ?? "");

  for (const secret of secrets) {
    if (!secret) continue;
    text = text.split(secret).join("[REDACTED]");
  }

  text = text
    .replace(/\bBearer\s+[^\s,"'}]+/gi, "Bearer [REDACTED]")
    .replace(
      /((?:x-api-key|api[_-]?key|authorization|auth[_-]?token)["'\s]*[:=]["'\s]*)([^\s,"'}]+)/gi,
      "$1[REDACTED]",
    )
    .replace(/\b(?:sk|ds)-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (text.length <= MAX_PROVIDER_ERROR_LENGTH) return text;
  return `${text.slice(0, MAX_PROVIDER_ERROR_LENGTH)}…`;
}

/** Preserves an error category while redacting its untrusted message. */
export function sanitizeProviderError(
  value: unknown,
  secrets: ReadonlyArray<string | undefined> = [],
  fallbackMessage = "Unknown provider error.",
): Error {
  const source = toError(value, fallbackMessage);
  const safeMessage =
    sanitizeProviderErrorText(source.message, secrets) || fallbackMessage;
  if (source instanceof ProviderError) {
    return new ProviderError(source.code, safeMessage, {
      status: source.status,
      retryAfterMs: source.retryAfterMs,
      requestId: source.requestId,
      retryable: source.retryable,
      partialOutput: source.partialOutput,
      cause: source.cause,
    });
  }
  const error = new Error(safeMessage);
  error.name = source.name;
  return error;
}

/** Creates an actionable, bounded HTTP error without exposing credentials. */
export function providerHttpError(
  provider: string,
  status: number,
  responseBody: unknown,
  secrets: ReadonlyArray<string | undefined> = [],
  metadata: { retryAfter?: string | null; requestId?: string } = {},
): ProviderError {
  const detail = sanitizeProviderErrorText(responseBody, secrets);
  const normalized = detail.toLowerCase();
  const code: ProviderFailureCode =
    status === 401 || status === 403
      ? "AUTH"
      : status === 402
        ? "QUOTA"
        : status === 429
          ? "RATE_LIMIT"
          : status === 422
            ? "INVALID_REQUEST"
            : status === 400 &&
                /context|maximum context|context length|too many tokens/.test(
                  normalized,
                )
              ? "CONTEXT_WINDOW_EXCEEDED"
              : status === 400
                ? "INVALID_REQUEST"
                : status === 503
                  ? "OVERLOADED"
                  : status >= 500
                    ? "SERVER"
                    : "INVALID_REQUEST";
  return new ProviderError(
    code,
    `${provider} request failed (HTTP ${status})${detail ? `: ${detail}` : "."}`,
    {
      status,
      retryAfterMs: parseRetryAfterMs(metadata.retryAfter),
      requestId: metadata.requestId,
      retryable:
        code === "RATE_LIMIT" || code === "SERVER" || code === "OVERLOADED",
    },
  );
}

export function modelFinishReasonError(
  reason: string | null | undefined,
): Error | undefined {
  if (
    !reason ||
    reason === "stop" ||
    reason === "tool_calls" ||
    reason === "tool_use" ||
    reason === "end_turn" ||
    reason === "stop_sequence"
  ) {
    return undefined;
  }
  if (reason === "length" || reason === "max_tokens") {
    return new ProviderError(
      "OUTPUT_LIMIT",
      "Model output was truncated at the configured token limit. Increase the output limit or reduce the requested scope.",
    );
  }
  if (reason === "content_filter" || reason === "refusal") {
    return new Error(
      "Model output was stopped by the provider content filter.",
    );
  }
  if (reason === "insufficient_system_resource") {
    return new ProviderError(
      "OVERLOADED",
      "DeepSeek stopped generation because inference resources were insufficient. Retry shortly or fall back to deepseek-v4-flash.",
      { retryable: true },
    );
  }
  return new Error(`Model generation stopped unexpectedly (${reason}).`);
}

function abortableDelay(
  delayMs: number,
  signal?: AbortSignal | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const timeoutId = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    timeoutId.unref?.();
    function onAbort() {
      clearTimeout(timeoutId);
      cleanup();
      reject(
        signal?.reason ??
          new DOMException("The user aborted a request.", "AbortError"),
      );
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

const MAX_RETRY_AFTER_MS = 10000;

function getRetryDelayMs(
  response: Response | undefined,
  attempt: number,
): number {
  const retryAfter = parseRetryAfterMs(response?.headers.get("retry-after"));
  if (retryAfter !== undefined) {
    return Math.min(MAX_RETRY_AFTER_MS, retryAfter);
  }

  return Math.min(3000, Math.pow(2, attempt) * 250 + Math.random() * 250);
}

export function parseRetryAfterMs(
  value: string | null | undefined,
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return undefined;
}
