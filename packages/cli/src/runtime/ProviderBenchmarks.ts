import { createHash } from "crypto";
import picocolors from "picocolors";
import { z } from "zod";
import {
  readBoundedRegularFile,
  replacePrivateFileAtomically,
  resolveSafePath,
} from "@orbit-build/shared";

const MAX_PROVIDER_BENCHMARK_BYTES = 2 * 1024 * 1024;

export interface ProviderBenchmarkResult {
  providerId: string;
  model: string;
  checkedAt: string;
  promptHash: string;
  promptChars: number;
  maxTokens: number;
  firstDeltaMs?: number;
  firstThinkingMs?: number;
  firstTextMs?: number;
  totalMs: number;
  outputTokens: number;
  reasoningTokens?: number;
  textChars: number;
  reasoningChars?: number;
  throughputTokensPerSec: number;
  endToEndTokensPerSec?: number;
  thinkingMode?: "disabled" | "high" | "max";
  cacheReadTokens: number;
  cacheInputTokens: number;
  cacheHitRate: number;
  error?: string;
}

const ProviderBenchmarkResultSchema = z
  .object({
    providerId: z.string().min(1),
    model: z.string().min(1),
    checkedAt: z.string().min(1),
    promptHash: z.string().min(1),
    promptChars: z.number().int().nonnegative(),
    maxTokens: z.number().int().positive(),
    firstDeltaMs: z.number().nonnegative().optional(),
    firstThinkingMs: z.number().nonnegative().optional(),
    firstTextMs: z.number().nonnegative().optional(),
    totalMs: z.number().positive(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative().optional(),
    textChars: z.number().int().nonnegative(),
    reasoningChars: z.number().int().nonnegative().optional(),
    throughputTokensPerSec: z.number().nonnegative(),
    endToEndTokensPerSec: z.number().nonnegative().optional(),
    thinkingMode: z.enum(["disabled", "high", "max"]).optional(),
    cacheReadTokens: z.number().int().nonnegative(),
    cacheInputTokens: z.number().int().nonnegative(),
    cacheHitRate: z.number().min(0).max(1),
    error: z.string().optional(),
  })
  .passthrough();

const ProviderBenchmarkStoreSchema = z.object({
  results: z.array(ProviderBenchmarkResultSchema).max(200),
});

export function providerBenchmarkPath(cwd: string): string {
  return resolveSafePath(cwd, ".orbit/provider-benchmarks.json");
}

export function benchmarkPromptHash(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

export function readProviderBenchmarks(cwd: string): ProviderBenchmarkResult[] {
  try {
    const path = providerBenchmarkPath(cwd);
    const raw = readBoundedRegularFile(path, MAX_PROVIDER_BENCHMARK_BYTES);
    if (raw === undefined) return [];
    const parsed = ProviderBenchmarkStoreSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.results : [];
  } catch {
    return [];
  }
}

export function recordProviderBenchmark(
  cwd: string,
  result: ProviderBenchmarkResult,
): void {
  try {
    const validated = ProviderBenchmarkResultSchema.safeParse(result);
    if (!validated.success) return;
    const path = providerBenchmarkPath(cwd);
    const existing = readProviderBenchmarks(cwd);
    const next = [validated.data, ...existing].slice(0, 200);
    replacePrivateFileAtomically(
      path,
      `${JSON.stringify({ results: next }, null, 2)}\n`,
    );
  } catch {
    // Benchmark history is diagnostic-only and should never block the CLI.
  }
}

function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * p) - 1),
  );
  return sorted[index];
}

function avg(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function formatProviderBenchmarkSummary(
  cwd: string,
  providerId: string,
  model: string,
): string {
  const samples = readProviderBenchmarks(cwd)
    .filter((item) => item.providerId === providerId && item.model === model)
    .slice(0, 20);

  if (samples.length === 0) {
    return picocolors.gray(
      "● Provider benchmark: no local samples yet. Run `orbit bench --repeat 3` to build a latency profile.",
    );
  }

  const successful = samples.filter((item) => !item.error);
  const latest = samples[0];
  if (successful.length === 0) {
    return picocolors.yellow(
      `⚠ Provider benchmark: ${samples.length} recent sample(s), latest failed: ${latest.error || "unknown error"}.`,
    );
  }

  const firstDeltas = successful
    .map((item) => item.firstDeltaMs)
    .filter((value): value is number => typeof value === "number");
  const totals = successful.map((item) => item.totalMs);
  const firstText = successful
    .map((item) => item.firstTextMs)
    .filter((value): value is number => typeof value === "number");
  const tps = successful
    .map((item) => item.throughputTokensPerSec)
    .filter((value) => value > 0);
  const latestText = latest.error
    ? `latest failed=${latest.error}`
    : `latest model=${latest.firstDeltaMs ?? "n/a"}ms answer=${latest.firstTextMs ?? "n/a"}ms total=${latest.totalMs}ms`;
  const firstP50 = percentile(firstDeltas, 0.5);
  const firstP90 = percentile(firstDeltas, 0.9);
  const textP50 = percentile(firstText, 0.5);
  const totalP50 = percentile(totals, 0.5);
  const avgTps = avg(tps);
  const slowFirstDelta =
    typeof firstP50 === "number" && firstP50 >= 2500 ? " slow-first-delta" : "";

  const color = slowFirstDelta ? picocolors.yellow : picocolors.green;
  return color(
    `● Provider benchmark:${slowFirstDelta} samples=${successful.length}/${samples.length}; ${latestText}; p50 model=${firstP50 ?? "n/a"}ms p50 answer=${textP50 ?? "n/a"}ms p90 model=${firstP90 ?? "n/a"}ms p50 total=${totalP50 ?? "n/a"}ms decode=${avgTps ? avgTps.toFixed(1) : "n/a"} tok/s latest-cache=${Math.round((latest.cacheHitRate || 0) * 100)}%.`,
  );
}

export function compareProviderBenchmarkResults(
  results: ProviderBenchmarkResult[],
): string {
  const successful = results.filter(
    (item) => !item.error && typeof item.firstDeltaMs === "number",
  );
  if (successful.length === 0) {
    return picocolors.yellow(
      "● Benchmark comparison: no successful samples to rank.",
    );
  }

  const grouped = new Map<string, ProviderBenchmarkResult[]>();
  for (const result of successful) {
    const key = `${result.providerId}::${result.model}`;
    const current = grouped.get(key) || [];
    current.push(result);
    grouped.set(key, current);
  }

  const rows = Array.from(grouped.entries())
    .map(([key, items]) => {
      const [providerId, model] = key.split("::");
      const first = avg(
        items
          .map((item) => item.firstDeltaMs)
          .filter((value): value is number => typeof value === "number"),
      );
      const total = avg(items.map((item) => item.totalMs));
      const firstAnswer = avg(
        items
          .map((item) => item.firstTextMs)
          .filter((value): value is number => typeof value === "number"),
      );
      const throughput = avg(
        items
          .map((item) => item.throughputTokensPerSec)
          .filter((value) => value > 0),
      );
      const cache = avg(items.map((item) => item.cacheHitRate));
      return {
        providerId,
        model,
        samples: items.length,
        first: first ?? Number.POSITIVE_INFINITY,
        firstAnswer: firstAnswer ?? Number.POSITIVE_INFINITY,
        total: total ?? Number.POSITIVE_INFINITY,
        throughput: throughput || 0,
        cache: cache || 0,
      };
    })
    .sort(
      (a, b) =>
        a.firstAnswer - b.firstAnswer ||
        a.first - b.first ||
        a.total - b.total ||
        b.throughput - a.throughput,
    );

  const lines = [picocolors.bold("Benchmark Comparison")];
  rows.forEach((row, index) => {
    const leader = index === 0 ? "best " : "";
    lines.push(
      `${index + 1}. ${leader}${row.providerId} / ${row.model}: model=${Math.round(
        row.first,
      )}ms answer=${Number.isFinite(row.firstAnswer) ? `${Math.round(row.firstAnswer)}ms` : "n/a"} total=${Math.round(row.total)}ms decode=${row.throughput.toFixed(
        1,
      )} tok/s cache=${Math.round(row.cache * 100)}% samples=${row.samples}`,
    );
  });
  return lines.join("\n");
}
