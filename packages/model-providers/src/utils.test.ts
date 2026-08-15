import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  fetchWithRetry,
  modelFinishReasonError,
  normalizeProviderStreamError,
  ProviderError,
  resolveModelCapabilities,
  sanitizeProviderErrorText,
  zodToJsonSchema,
} from "./utils.js";

describe("resolveModelCapabilities", () => {
  const base = {
    streaming: true,
    toolCalls: false,
    jsonMode: false,
    thinking: false,
    vision: false,
    promptCaching: false,
  };

  it("merges model declarations over provider defaults", () => {
    const capabilities = resolveModelCapabilities(
      {
        id: "custom",
        type: "openai-compatible",
        capabilities: base,
        chat: async function* () {},
        getModelCapabilities: () => ({
          ...base,
          thinking: true,
          maxContextTokens: 256_000,
        }),
      },
      "opaque-model-id",
    );

    expect(capabilities).toMatchObject({
      streaming: true,
      thinking: true,
      maxContextTokens: 256_000,
    });
  });

  it("falls back to provider declarations when a custom model probe fails", () => {
    const capabilities = resolveModelCapabilities(
      {
        id: "custom",
        type: "openai-compatible",
        capabilities: { ...base, toolCalls: true },
        chat: async function* () {},
        getModelCapabilities: () => {
          throw new Error("unknown model");
        },
      },
      "private-model",
    );

    expect(capabilities.toolCalls).toBe(true);
    expect(capabilities.thinking).toBe(false);
  });
});

describe("zodToJsonSchema", () => {
  it("preserves descriptions, required fields, enums, and numeric bounds", () => {
    const schema = z
      .object({
        query: z.string().min(1).describe("Live search query."),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Maximum result count."),
        provider: z
          .enum(["auto", "bing", "duckduckgo"])
          .default("auto")
          .describe("Search backend."),
      })
      .describe("Search input.");

    const json = zodToJsonSchema(schema);

    expect(json).toMatchObject({
      type: "object",
      description: "Search input.",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          minLength: 1,
          description: "Live search query.",
        },
        maxResults: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          description: "Maximum result count.",
        },
        provider: {
          type: "string",
          enum: ["auto", "bing", "duckduckgo"],
          description: "Search backend.",
        },
      },
    });
  });
});

describe("fetchWithRetry", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("honors Retry-After seconds on transient provider responses", async () => {
    vi.useFakeTimers();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "2" },
        }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const responsePromise = fetchWithRetry(
      "https://provider.example.test/chat",
      { timeout: 10000 },
      1,
    );

    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the external abort signal connected after response headers arrive", async () => {
    let requestSignal: AbortSignal | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        requestSignal = init?.signal ?? null;
        return Promise.resolve(new Response("stream", { status: 200 }));
      }),
    );

    const externalController = new AbortController();
    await fetchWithRetry("https://provider.example.test/chat", {
      signal: externalController.signal,
      timeout: 10000,
    });

    expect((requestSignal as AbortSignal | null)?.aborted).toBe(false);
    externalController.abort();
    expect((requestSignal as AbortSignal | null)?.aborted).toBe(true);
  });

  it("does not retry permanent 4xx responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("bad request", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithRetry(
      "https://provider.example.test/chat",
      { timeout: 10000 },
      2,
    );

    expect(response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries transient 503 responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("busy", {
          status: 503,
          headers: { "retry-after": "0" },
        }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithRetry(
      "https://provider.example.test/chat",
      { timeout: 10000 },
      1,
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("normalizeProviderStreamError", () => {
  it("makes a transport-terminated empty stream retryable", () => {
    const error = normalizeProviderStreamError(
      new TypeError("terminated"),
      [],
      false,
    );

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({
      code: "STREAM_CLOSED",
      retryable: true,
      partialOutput: false,
    });
  });

  it("preserves partial-output evidence so callers never replay effects", () => {
    const error = normalizeProviderStreamError(
      new Error("socket closed"),
      [],
      true,
    );

    expect(error).toMatchObject({
      code: "STREAM_CLOSED",
      retryable: true,
      partialOutput: true,
    });
  });

  it("keeps malformed protocol frames non-retryable", () => {
    const error = normalizeProviderStreamError(
      new SyntaxError("Unexpected token in JSON frame"),
    );

    expect(error).toMatchObject({
      code: "MALFORMED_RESPONSE",
      retryable: false,
      partialOutput: false,
    });
  });

  it("preserves user abort identity", () => {
    const error = normalizeProviderStreamError(
      new DOMException("cancelled", "AbortError"),
    );

    expect(error.name).toBe("AbortError");
    expect(error).not.toBeInstanceOf(ProviderError);
  });
});

describe("modelFinishReasonError", () => {
  it("accepts normal OpenAI and Anthropic terminal reasons", () => {
    for (const reason of [
      "stop",
      "tool_calls",
      "tool_use",
      "end_turn",
      "stop_sequence",
    ]) {
      expect(modelFinishReasonError(reason)).toBeUndefined();
    }
  });

  it("fails closed for truncation, resource exhaustion, and unknown reasons", () => {
    expect(modelFinishReasonError("length")?.message).toContain("truncated");
    expect(
      modelFinishReasonError("insufficient_system_resource")?.message,
    ).toContain("resources were insufficient");
    expect(modelFinishReasonError("future_failure")?.message).toContain(
      "unexpectedly",
    );
  });
});

describe("sanitizeProviderErrorText", () => {
  it("redacts configured and bearer credentials and caps provider text", () => {
    const secret = "ds-configured-secret";
    const sanitized = sanitizeProviderErrorText(
      `authorization=Bearer ${secret}\n${"detail ".repeat(300)}`,
      [secret],
    );

    expect(sanitized).not.toContain(secret);
    expect(sanitized).toContain("[REDACTED]");
    expect(sanitized.length).toBeLessThanOrEqual(1001);
  });
});
