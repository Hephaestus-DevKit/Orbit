import { z } from "zod";
import type { OrbitConfig } from "@orbit-build/config";
import type {
  ModelCapabilities,
  ModelProvider,
} from "@orbit-build/model-providers";
import {
  readBoundedRegularFile,
  redactSecrets,
  replacePrivateFileAtomically,
  resolveSafePath,
} from "@orbit-build/shared";

const DEFAULT_PROVIDER_PROBE_TIMEOUT_MS = 15_000;
const MAX_PROVIDER_PROBE_CACHE_BYTES = 2 * 1024 * 1024;

const ModelCapabilitiesSchema = z
  .object({
    streaming: z.boolean(),
    toolCalls: z.boolean(),
    jsonMode: z.boolean(),
    thinking: z.boolean(),
    vision: z.boolean(),
    promptCaching: z.boolean(),
    maxContextTokens: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    apiFormats: z
      .array(z.enum(["chat-completions", "responses", "anthropic"]))
      .max(4)
      .optional(),
    reasoningEfforts: z
      .array(z.enum(["low", "high", "max"]))
      .max(3)
      .optional(),
    parallelToolCalls: z.boolean().optional(),
    modelVersion: z.string().min(1).max(256).optional(),
    effectiveContextWindowPercent: z.number().positive().max(1).optional(),
  })
  .passthrough();

const ProviderProbeResultSchema = z
  .object({
    providerId: z.string().min(1),
    model: z.string().min(1),
    checkedAt: z.string().min(1),
    declared: ModelCapabilitiesSchema,
    observed: z
      .object({
        streamStarted: z.boolean(),
        usageReturned: z.boolean(),
        cacheUsageReturned: z.boolean().optional(),
        totalTokensReturned: z.boolean().optional(),
        error: z.string().optional(),
        firstDeltaMs: z.number().nonnegative().optional(),
        apiFormat: z
          .enum(["chat-completions", "responses", "anthropic"])
          .optional(),
        modelVersion: z.string().min(1).max(256).optional(),
        apiFormatFallback: z
          .object({
            from: z.enum(["chat-completions", "responses", "anthropic"]),
            status: z.number().int().min(100).max(599),
          })
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

const ProviderProbeCacheSchema = z
  .object({ results: z.array(z.unknown()).max(1_000) })
  .passthrough();

export interface ProviderProbeResult {
  providerId: string;
  model: string;
  checkedAt: string;
  declared: ModelCapabilities;
  observed: {
    streamStarted: boolean;
    usageReturned: boolean;
    cacheUsageReturned?: boolean;
    totalTokensReturned?: boolean;
    error?: string;
    firstDeltaMs?: number;
    apiFormat?: "chat-completions" | "responses" | "anthropic";
    modelVersion?: string;
    apiFormatFallback?: {
      from: "chat-completions" | "responses" | "anthropic";
      status: number;
    };
  };
}

export function providerProbeCachePath(cwd: string): string {
  return resolveSafePath(cwd, ".orbit/provider-capabilities.json");
}

export function readProviderProbeCache(cwd: string): ProviderProbeResult[] {
  try {
    const path = providerProbeCachePath(cwd);
    const raw = readBoundedRegularFile(path, MAX_PROVIDER_PROBE_CACHE_BYTES);
    if (raw === undefined) return [];
    const envelope = ProviderProbeCacheSchema.safeParse(JSON.parse(raw));
    if (!envelope.success) return [];
    return envelope.data.results.flatMap((candidate) => {
      const parsed = ProviderProbeResultSchema.safeParse(candidate);
      return parsed.success ? [parsed.data] : [];
    });
  } catch {
    return [];
  }
}

export function writeProviderProbeCache(
  cwd: string,
  result: ProviderProbeResult,
): void {
  try {
    const validatedResult = ProviderProbeResultSchema.safeParse(result);
    if (!validatedResult.success) return;
    const path = providerProbeCachePath(cwd);
    const existing = readProviderProbeCache(cwd);
    const next = [
      validatedResult.data,
      ...existing.filter(
        (item) =>
          item.providerId !== result.providerId || item.model !== result.model,
      ),
    ].slice(0, 50);
    replacePrivateFileAtomically(
      path,
      `${JSON.stringify({ results: next }, null, 2)}\n`,
    );
  } catch {
    // Diagnostics cache should never block the CLI.
  }
}

export async function probeProviderCapabilities(
  cwd: string,
  config: OrbitConfig,
  provider: ModelProvider,
  options: { timeoutMs?: number } = {},
): Promise<ProviderProbeResult> {
  const model = config.models.default;
  const declared = (typeof provider.getModelCapabilities === "function"
    ? provider.getModelCapabilities(model)
    : provider.capabilities) || {
    streaming: false,
    toolCalls: false,
    jsonMode: false,
    thinking: false,
    vision: false,
    promptCaching: false,
  };
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_PROVIDER_PROBE_TIMEOUT_MS,
  );
  // A diagnostic probe is explicitly awaited by doctor; keep its deadline
  // referenced so a headless invocation always returns a structured result.
  const result: ProviderProbeResult = {
    providerId: provider.id,
    model,
    checkedAt: new Date().toISOString(),
    declared,
    observed: {
      streamStarted: false,
      usageReturned: false,
      cacheUsageReturned: false,
      totalTokensReturned: false,
    },
  };

  try {
    const stream = provider.chat({
      model,
      messages: [
        {
          id: `msg_provider_probe_${Date.now()}`,
          role: "user",
          createdAt: new Date().toISOString(),
          content: [{ type: "text", text: "Reply with ok." }],
        },
      ],
      tools: [],
      stream: true,
      maxTokens: 32,
      thinking: { enabled: false },
      abortSignal: controller.signal,
    });

    for await (const event of stream) {
      if (event.type === "text_delta" || event.type === "thinking_delta") {
        if (!result.observed.streamStarted) {
          result.observed.streamStarted = true;
          result.observed.firstDeltaMs = Date.now() - startedAt;
        }
      } else if (event.type === "usage") {
        result.observed.usageReturned = true;
        result.observed.totalTokensReturned =
          typeof event.usage.totalTokens === "number" &&
          event.usage.totalTokens > 0;
        result.observed.cacheUsageReturned =
          typeof event.usage.cacheReadTokens === "number" ||
          typeof event.usage.cacheMissTokens === "number" ||
          typeof event.usage.cacheWriteTokens === "number";
      } else if (event.type === "response_metadata") {
        result.observed.apiFormat = event.apiFormat;
        result.observed.modelVersion = event.modelVersion;
        result.observed.apiFormatFallback = event.apiFormatFallback;
      } else if (event.type === "error") {
        result.observed.error = redactSecrets(
          event.error instanceof Error
            ? event.error.message
            : String(event.error),
        );
        break;
      } else if (event.type === "done") {
        break;
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    result.observed.error = redactSecrets(message);
  } finally {
    clearTimeout(timeout);
  }

  writeProviderProbeCache(cwd, result);
  return result;
}

export function formatProviderProbe(result: ProviderProbeResult): string {
  const observed = result.observed;
  const cacheUsage =
    typeof observed.cacheUsageReturned === "boolean"
      ? observed.cacheUsageReturned
        ? "yes"
        : "no"
      : "n/a";
  const totalTokens =
    typeof observed.totalTokensReturned === "boolean"
      ? observed.totalTokensReturned
        ? "yes"
        : "no"
      : "n/a";
  const warnings: string[] = [];
  if (result.declared.streaming && !observed.streamStarted) {
    warnings.push("declared streaming but no stream delta observed");
  }
  if (!observed.usageReturned) {
    warnings.push("usage metadata missing");
  }
  if (result.declared.promptCaching && observed.cacheUsageReturned === false) {
    warnings.push("declared cache support but no cache usage fields observed");
  }

  return [
    `Provider probe: ${result.providerId} / ${result.model}`,
    `- declared: streaming=${result.declared.streaming} tools=${result.declared.toolCalls} thinking=${result.declared.thinking} cache=${result.declared.promptCaching} formats=${result.declared.apiFormats?.join(",") ?? "n/a"} modelVersion=${result.declared.modelVersion ?? "n/a"} maxContext=${result.declared.maxContextTokens ?? "n/a"} maxOutput=${result.declared.maxOutputTokens ?? "n/a"}`,
    `- observed: stream=${observed.streamStarted ? "yes" : "no"} usage=${observed.usageReturned ? "yes" : "no"} cacheUsage=${cacheUsage} totalTokens=${totalTokens} apiFormat=${observed.apiFormat ?? "n/a"} modelVersion=${observed.modelVersion ?? "n/a"} fallback=${observed.apiFormatFallback ? `${observed.apiFormatFallback.from}/HTTP${observed.apiFormatFallback.status}` : "none"} firstDelta=${observed.firstDeltaMs ?? "n/a"}ms`,
    warnings.length > 0 ? `- warnings: ${warnings.join("; ")}` : "",
    observed.error ? `- error: ${redactSecrets(observed.error)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
