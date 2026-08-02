import { ConfigLoader, type OrbitConfig } from "@orbit-build/config";
import picocolors from "picocolors";
import { createHash, randomUUID } from "crypto";
import { resolve } from "path";
import { z } from "zod";
import type { ModelProvider } from "@orbit-build/model-providers";
import { redactSecrets } from "@orbit-build/shared";
import { createProviderFromConfig } from "../runtime/ProviderFactory.js";
import {
  benchmarkPromptHash,
  compareProviderBenchmarkResults,
  formatProviderBenchmarkSummary,
  recordProviderBenchmark,
  type ProviderBenchmarkResult,
} from "../runtime/ProviderBenchmarks.js";

const BenchOptionsSchema = z.object({
  prompt: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  models: z.string().optional(),
  repeat: z.union([z.number(), z.string()]).optional(),
  maxTokens: z.union([z.number(), z.string()]).optional(),
  cacheProfile: z.boolean().optional(),
  minCacheHit: z.union([z.number(), z.string()]).optional(),
  maxFirstDeltaMs: z.union([z.number(), z.string()]).optional(),
  maxFirstTextMs: z.union([z.number(), z.string()]).optional(),
  minThroughput: z.union([z.number(), z.string()]).optional(),
  maxErrorRate: z.union([z.number(), z.string()]).optional(),
  thinking: z.string().optional(),
  json: z.boolean().optional(),
});

export type BenchOptions = z.infer<typeof BenchOptionsSchema>;

/** Validates the local and inherited Commander options used by `orbit bench`. */
export function parseBenchOptions(value: unknown): BenchOptions {
  return BenchOptionsSchema.parse(value);
}

async function runSingleBench(
  provider: ModelProvider,
  model: string,
  prompt: string,
  maxTokens: number,
  thinkingMode: "disabled" | "low" | "high" | "max",
  userId: string,
): Promise<ProviderBenchmarkResult> {
  const startedAt = Date.now();
  let firstDeltaMs: number | undefined;
  let firstThinkingMs: number | undefined;
  let firstTextMs: number | undefined;
  let textChars = 0;
  let reasoningChars = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let inputTokens = 0;
  let cacheReadTokens = 0;
  let cacheMissTokens = 0;
  let error: string | undefined;

  try {
    const stream = provider.chat({
      model,
      messages: [
        {
          id: `msg_bench_${Date.now()}`,
          role: "user",
          createdAt: new Date().toISOString(),
          content: [{ type: "text", text: prompt }],
        },
      ],
      tools: [],
      stream: true,
      maxTokens,
      userId,
      thinking: {
        enabled: thinkingMode !== "disabled",
        budgetTokens:
          thinkingMode === "max" ? 8192 : thinkingMode === "high" ? 4096 : 1024,
        ...(thinkingMode === "disabled" ? {} : { effort: thinkingMode }),
      },
    });

    for await (const event of stream) {
      if (event.type === "text_delta" || event.type === "thinking_delta") {
        // Signature-only thinking events carry no generated output and must not
        // be mistaken for first-token latency.
        if (event.text.length === 0) continue;
        if (firstDeltaMs === undefined) {
          firstDeltaMs = Date.now() - startedAt;
        }
        if (event.type === "thinking_delta") {
          firstThinkingMs ??= Date.now() - startedAt;
          reasoningChars += event.text.length;
        } else {
          firstTextMs ??= Date.now() - startedAt;
          textChars += event.text.length;
        }
      } else if (event.type === "usage") {
        inputTokens = event.usage.inputTokens || 0;
        outputTokens = event.usage.outputTokens || 0;
        cacheReadTokens = event.usage.cacheReadTokens || 0;
        cacheMissTokens = event.usage.cacheMissTokens || 0;
        reasoningTokens = event.usage.reasoningTokens || 0;
      } else if (event.type === "error") {
        error = redactSecrets(
          event.error instanceof Error
            ? event.error.message
            : String(event.error),
        );
        break;
      }
    }
  } catch (caught: unknown) {
    const message = caught instanceof Error ? caught.message : String(caught);
    error = redactSecrets(message);
  }

  const totalMs = Math.max(1, Date.now() - startedAt);
  const decodeMs = Math.max(1, totalMs - (firstDeltaMs || 0));
  const throughputTokensPerSec =
    outputTokens > 0 ? outputTokens / (decodeMs / 1000) : 0;
  const endToEndTokensPerSec =
    outputTokens > 0 ? outputTokens / (totalMs / 1000) : 0;
  const cacheInputTokens = cacheReadTokens + cacheMissTokens || inputTokens;
  const cacheHitRate =
    cacheInputTokens > 0 ? cacheReadTokens / cacheInputTokens : 0;

  return {
    providerId: provider.id,
    model,
    checkedAt: new Date().toISOString(),
    promptHash: benchmarkPromptHash(prompt),
    promptChars: prompt.length,
    maxTokens,
    firstDeltaMs,
    firstThinkingMs,
    firstTextMs,
    totalMs,
    outputTokens,
    reasoningTokens,
    textChars,
    reasoningChars,
    throughputTokensPerSec,
    endToEndTokensPerSec,
    thinkingMode,
    cacheReadTokens,
    cacheInputTokens,
    cacheHitRate,
    error,
  };
}

function clampRepeat(value: unknown): number {
  if (value === undefined || value === null || value === "") return 1;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error("Benchmark repeat must be an integer from 1 to 20.");
  }
  if (parsed < 1 || parsed > 20) {
    throw new Error("Benchmark repeat must be between 1 and 20.");
  }
  return parsed;
}

function clampMaxTokens(
  value: unknown,
  thinkingMode: "disabled" | "low" | "high" | "max",
): number {
  if (value === undefined || value === null || value === "") {
    if (thinkingMode === "max") return 8192;
    if (thinkingMode === "high") return 4096;
    if (thinkingMode === "low") return 1024;
    return 256;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error("Benchmark max tokens must be an integer from 1 to 16384.");
  }
  if (parsed < 1 || parsed > 16384) {
    throw new Error("Benchmark max tokens must be between 1 and 16384.");
  }
  return parsed;
}

function parseModels(options: { model?: string; models?: string }): string[] {
  const raw = options.models || options.model || "";
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveThinkingMode(
  value: unknown,
  model: string,
): "disabled" | "low" | "high" | "max" {
  if (value === "disabled" || value === "off" || value === "false") {
    return "disabled";
  }
  if (value === "max") return "max";
  if (value === "high") return "high";
  if (value === "low") return "low";
  if (value !== undefined && value !== null && value !== "") {
    throw new Error(
      `Invalid thinking mode "${String(value)}". Use disabled, low, high, or max.`,
    );
  }
  return model.toLowerCase().includes("pro") ? "high" : "low";
}

/** Builds a provider-cache-sized stable prefix with an optional real workload. */
export function buildCacheProfilePrompt(
  runId: string,
  instruction?: string,
): string {
  const stablePrefix = [
    "Orbit DeepSeek cache profile stable prefix.",
    "This block is intentionally repeated to test provider-side context caching.",
    "Keep this prefix byte-stable across benchmark rounds.",
  ].join(" ");
  const workload = instruction?.trim() || "Reply with exactly: ok";
  return `Cache profile run: ${runId}\n${Array.from({ length: 180 }, () => stablePrefix).join("\n")}\n\n${workload}`;
}

export function evaluateCacheProfile(results: ProviderBenchmarkResult[]): {
  successful: ProviderBenchmarkResult[];
  cold?: ProviderBenchmarkResult;
  warm: ProviderBenchmarkResult[];
  bestWarm?: ProviderBenchmarkResult;
  warmAvgHit: number;
  speedup: string;
} {
  const successful = results.filter((item) => !item.error);
  const cold = successful[0];
  const warm = successful.slice(1);
  const bestWarm = [...warm].sort(
    (a, b) =>
      (a.firstDeltaMs ?? Number.POSITIVE_INFINITY) -
      (b.firstDeltaMs ?? Number.POSITIVE_INFINITY),
  )[0];
  const warmAvgHit =
    warm.length > 0
      ? warm.reduce((sum, item) => sum + item.cacheHitRate, 0) / warm.length
      : 0;
  const speedup =
    typeof cold?.firstDeltaMs === "number" &&
    typeof bestWarm?.firstDeltaMs === "number" &&
    bestWarm.firstDeltaMs > 0
      ? `${(cold.firstDeltaMs / bestWarm.firstDeltaMs).toFixed(1)}x`
      : "n/a";

  return { successful, cold, warm, bestWarm, warmAvgHit, speedup };
}

export function formatCacheProfileSummary(
  results: ProviderBenchmarkResult[],
): string {
  const profile = evaluateCacheProfile(results);
  const successful = profile.successful;
  if (successful.length === 0) {
    return picocolors.yellow("Cache Profile: no successful samples.");
  }

  const cold = profile.cold!;
  const warm = profile.warm;
  const bestWarm = profile.bestWarm;
  const warmAvgHit = profile.warmAvgHit;
  const coldFirst = cold.firstDeltaMs ?? "n/a";
  const bestWarmFirst = bestWarm?.firstDeltaMs ?? "n/a";
  const verdict =
    warmAvgHit >= 0.75
      ? picocolors.green("cache warm")
      : warm.length > 0
        ? picocolors.yellow("cache weak")
        : picocolors.yellow("cache not measured");

  return [
    picocolors.bold("Cache Profile"),
    `Status: ${verdict}`,
    `Baseline first model delta: ${coldFirst}ms · cache=${Math.round(cold.cacheHitRate * 100)}% (${cold.cacheReadTokens}/${cold.cacheInputTokens})`,
    `Best repeated first model delta: ${bestWarmFirst}ms · repeated avg cache=${Math.round(
      warmAvgHit * 100,
    )}% · speedup=${profile.speedup}`,
    `Prompt hash: ${cold.promptHash} · prompt chars=${cold.promptChars}`,
    "Interpretation: the default profile uses a unique prefix per command and repeats it byte-for-byte within the run. Trust returned cacheReadTokens, since provider caching is best-effort.",
  ].join("\n");
}

function printBenchResult(
  result: ProviderBenchmarkResult,
  index: number,
): void {
  const suffix = index > 1 ? ` #${index}` : "";
  console.log(picocolors.bold(`Orbit Bench${suffix}`));
  console.log(`Provider: ${picocolors.cyan(result.providerId)}`);
  console.log(`Model: ${picocolors.cyan(result.model)}`);
  console.log(`First model delta: ${result.firstDeltaMs ?? "n/a"}ms`);
  console.log(
    `First thinking: ${result.firstThinkingMs ?? "n/a"}ms · first answer: ${result.firstTextMs ?? "n/a"}ms · mode=${result.thinkingMode || "unknown"}`,
  );
  console.log(`Total: ${result.totalMs}ms`);
  console.log(
    `Output: ${result.outputTokens || "n/a"} tokens (${result.reasoningTokens || 0} reasoning), ${result.textChars} answer chars, ${result.reasoningChars || 0} reasoning chars`,
  );
  console.log(
    `Decode throughput: ${
      result.throughputTokensPerSec
        ? result.throughputTokensPerSec.toFixed(1)
        : "n/a"
    } tokens/sec · end-to-end=${result.endToEndTokensPerSec?.toFixed(1) || "n/a"} tokens/sec`,
  );
  console.log(
    `Cache: ${Math.round(result.cacheHitRate * 100)}% (${result.cacheReadTokens}/${result.cacheInputTokens})`,
  );
  if (result.error) {
    console.log(picocolors.red(`Error: ${result.error}`));
  }
}

function clampCacheHitThreshold(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(
      "Minimum cache hit must be a ratio from 0 to 1 or a percentage from 0 to 100.",
    );
  }
  return parsed > 1 ? parsed / 100 : parsed;
}

function parsePositiveThreshold(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return parsed;
}

function parseRateThreshold(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(
      "Maximum error rate must be a ratio from 0 to 1 or a percentage from 0 to 100.",
    );
  }
  return parsed > 1 ? parsed / 100 : parsed;
}

function percentile(values: number[], ratio: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );
  return sorted[index];
}

export interface BenchmarkThresholds {
  maxFirstDeltaMs?: number;
  maxFirstTextMs?: number;
  minThroughput?: number;
  maxErrorRate?: number;
}

/** Evaluate stable aggregate thresholds without making one noisy sample authoritative. */
export function evaluateBenchmarkThresholds(
  results: ProviderBenchmarkResult[],
  thresholds: BenchmarkThresholds,
): string[] {
  if (results.length === 0) return ["no benchmark samples were recorded"];
  const successful = results.filter((result) => !result.error);
  const failures: string[] = [];
  const errorRate = (results.length - successful.length) / results.length;
  if (
    thresholds.maxErrorRate !== undefined &&
    errorRate > thresholds.maxErrorRate
  ) {
    failures.push(
      `error rate ${Math.round(errorRate * 100)}% > ${Math.round(thresholds.maxErrorRate * 100)}%`,
    );
  }
  const firstDeltaP90 = percentile(
    successful.flatMap((result) =>
      typeof result.firstDeltaMs === "number" ? [result.firstDeltaMs] : [],
    ),
    0.9,
  );
  if (
    thresholds.maxFirstDeltaMs !== undefined &&
    (firstDeltaP90 === undefined || firstDeltaP90 > thresholds.maxFirstDeltaMs)
  ) {
    failures.push(
      `p90 first model delta ${firstDeltaP90 === undefined ? "unavailable" : `${Math.round(firstDeltaP90)}ms`} > ${Math.round(thresholds.maxFirstDeltaMs)}ms`,
    );
  }
  const firstTextP90 = percentile(
    successful.flatMap((result) =>
      typeof result.firstTextMs === "number" ? [result.firstTextMs] : [],
    ),
    0.9,
  );
  if (
    thresholds.maxFirstTextMs !== undefined &&
    (firstTextP90 === undefined || firstTextP90 > thresholds.maxFirstTextMs)
  ) {
    failures.push(
      `p90 first answer ${firstTextP90 === undefined ? "unavailable" : `${Math.round(firstTextP90)}ms`} > ${Math.round(thresholds.maxFirstTextMs)}ms`,
    );
  }
  const throughputP50 = percentile(
    successful
      .map((result) => result.throughputTokensPerSec)
      .filter((value) => value > 0),
    0.5,
  );
  if (
    thresholds.minThroughput !== undefined &&
    (throughputP50 === undefined || throughputP50 < thresholds.minThroughput)
  ) {
    failures.push(
      `p50 decode throughput ${throughputP50 === undefined ? "unavailable" : `${throughputP50.toFixed(1)} tok/s`} < ${thresholds.minThroughput.toFixed(1)} tok/s`,
    );
  }
  return failures;
}

export async function runBench(
  cwd: string,
  options: BenchOptions = {},
): Promise<void> {
  if (
    options.minCacheHit !== undefined &&
    options.minCacheHit !== "" &&
    !options.cacheProfile
  ) {
    throw new Error("--min-cache-hit requires --cache-profile.");
  }
  const overrides: Partial<OrbitConfig> | undefined = options.provider
    ? { provider: { default: options.provider } }
    : undefined;
  const config = ConfigLoader.loadSync(cwd, overrides);
  const provider = createProviderFromConfig(config);
  // Keep DNS/TLS setup outside measured model latency, matching the agent's
  // background provider initialization and avoiding false cache speedups.
  await provider.initialize?.();
  const models = parseModels(options);
  if (models.length === 0) {
    models.push(config.models.fast || config.models.default);
  }
  const prompt = options.cacheProfile
    ? buildCacheProfilePrompt(randomUUID(), options.prompt)
    : options.prompt ||
      "Reply with one concise sentence explaining what Orbit is.";
  const repeat = options.cacheProfile
    ? Math.max(3, clampRepeat(options.repeat))
    : clampRepeat(options.repeat);
  const minCacheHit = clampCacheHitThreshold(options.minCacheHit);
  const benchmarkThresholds: BenchmarkThresholds = {
    maxFirstDeltaMs: parsePositiveThreshold(
      options.maxFirstDeltaMs,
      "Maximum first model delta",
    ),
    maxFirstTextMs: parsePositiveThreshold(
      options.maxFirstTextMs,
      "Maximum first answer latency",
    ),
    minThroughput: parsePositiveThreshold(
      options.minThroughput,
      "Minimum decode throughput",
    ),
    maxErrorRate: parseRateThreshold(options.maxErrorRate),
  };
  const results: ProviderBenchmarkResult[] = [];
  const cacheProfileGroups = new Map<string, ProviderBenchmarkResult[]>();
  const workspaceIdentity = resolve(cwd).replace(/\\/g, "/");
  const userId = createHash("sha256")
    .update(
      process.platform === "win32"
        ? workspaceIdentity.toLowerCase()
        : workspaceIdentity,
    )
    .digest("hex");

  for (const model of models) {
    const thinkingMode =
      options.cacheProfile && !options.thinking
        ? "disabled"
        : resolveThinkingMode(options.thinking, model);
    const maxTokens = clampMaxTokens(options.maxTokens, thinkingMode);
    for (let i = 0; i < repeat; i++) {
      const result = await runSingleBench(
        provider,
        model,
        prompt,
        maxTokens,
        thinkingMode,
        userId,
      );
      recordProviderBenchmark(cwd, result);
      results.push(result);
      if (options.cacheProfile) {
        const key = `${result.providerId}\0${result.model}`;
        const group = cacheProfileGroups.get(key) || [];
        group.push(result);
        cacheProfileGroups.set(key, group);
      }
      if (!options.json) {
        printBenchResult(result, i + 1);
        if (i < repeat - 1 || models.length > 1) {
          console.log("");
        }
      }
    }
    if (!options.json) {
      console.log(formatProviderBenchmarkSummary(cwd, provider.id, model));
      if (model !== models.at(-1)) {
        console.log("");
      }
    }
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          results,
          ...(options.cacheProfile
            ? { cacheProfile: { promptHash: results[0]?.promptHash } }
            : {}),
        },
        null,
        2,
      ),
    );
  } else if (options.cacheProfile) {
    console.log("");
    console.log(
      [...cacheProfileGroups.values()]
        .map((group) => formatCacheProfileSummary(group))
        .join("\n\n"),
    );
  } else if (models.length > 1 || repeat > 1) {
    console.log("");
    console.log(compareProviderBenchmarkResults(results));
  }

  if (options.cacheProfile && minCacheHit !== undefined) {
    const failures = [...cacheProfileGroups.values()]
      .map((group) => {
        const profile = evaluateCacheProfile(group);
        const sample = group[0];
        return {
          providerId: sample?.providerId || "unknown",
          model: sample?.model || "unknown",
          warmAvgHit: profile.warmAvgHit,
          warmSamples: profile.warm.length,
        };
      })
      .filter(
        (item) => item.warmSamples === 0 || item.warmAvgHit < minCacheHit,
      );

    if (failures.length > 0) {
      process.exitCode = 1;
      const lines = failures.map(
        (item) =>
          `${item.providerId} / ${item.model}: warm cache=${Math.round(
            item.warmAvgHit * 100,
          )}% samples=${item.warmSamples}`,
      );
      console.error(
        picocolors.red(
          `Cache profile threshold failed: expected warm cache >= ${Math.round(
            minCacheHit * 100,
          )}%. ${lines.join("; ")}`,
        ),
      );
    }
  }

  const thresholdFailures = evaluateBenchmarkThresholds(
    results,
    benchmarkThresholds,
  );
  if (thresholdFailures.length > 0) {
    process.exitCode = 1;
    console.error(
      picocolors.red(
        `Benchmark threshold failed: ${thresholdFailures.join("; ")}.`,
      ),
    );
  }
}
