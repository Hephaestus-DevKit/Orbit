import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  compareProviderBenchmarkResults,
  formatProviderBenchmarkSummary,
  readProviderBenchmarks,
  recordProviderBenchmark,
} from "./ProviderBenchmarks.js";
import {
  evaluateCacheProfile,
  formatCacheProfileSummary,
} from "../commands/bench.js";

describe("ProviderBenchmarks", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records samples without storing prompt text and summarizes latency", () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-provider-bench-"));
    dirs.push(cwd);

    recordProviderBenchmark(cwd, {
      providerId: "deepseek-openai",
      model: "deepseek-v4-flash",
      checkedAt: "2026-07-01T00:00:00.000Z",
      promptHash: "abc123",
      promptChars: 14,
      maxTokens: 96,
      firstDeltaMs: 2800,
      totalMs: 3300,
      outputTokens: 30,
      textChars: 90,
      throughputTokensPerSec: 9.1,
      cacheReadTokens: 0,
      cacheInputTokens: 8,
      cacheHitRate: 0,
    });

    const samples = readProviderBenchmarks(cwd);
    const summary = formatProviderBenchmarkSummary(
      cwd,
      "deepseek-openai",
      "deepseek-v4-flash",
    );

    expect(samples).toHaveLength(1);
    expect(JSON.stringify(samples)).not.toContain("Reply with ok");
    expect(summary).toContain("slow-first-delta");
    expect(summary).toContain("p50 model=2800ms");
    expect(summary).toContain("p50 answer=n/a");
  });

  it("ranks benchmark comparison by first-token latency", () => {
    const comparison = compareProviderBenchmarkResults([
      {
        providerId: "gateway",
        model: "slow",
        checkedAt: "2026-07-01T00:00:00.000Z",
        promptHash: "a",
        promptChars: 1,
        maxTokens: 16,
        firstDeltaMs: 1200,
        totalMs: 1800,
        outputTokens: 20,
        textChars: 60,
        throughputTokensPerSec: 11,
        cacheReadTokens: 0,
        cacheInputTokens: 8,
        cacheHitRate: 0,
      },
      {
        providerId: "gateway",
        model: "fast",
        checkedAt: "2026-07-01T00:00:01.000Z",
        promptHash: "a",
        promptChars: 1,
        maxTokens: 16,
        firstDeltaMs: 300,
        totalMs: 700,
        outputTokens: 20,
        textChars: 60,
        throughputTokensPerSec: 28,
        cacheReadTokens: 0,
        cacheInputTokens: 8,
        cacheHitRate: 0,
      },
    ]);

    expect(comparison).toContain("1. best gateway / fast");
    expect(comparison.indexOf("fast")).toBeLessThan(comparison.indexOf("slow"));
  });

  it("bounds cache input and ignores invalid benchmark results", () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-provider-bench-"));
    dirs.push(cwd);
    const cacheDirectory = join(cwd, ".orbit");
    mkdirSync(cacheDirectory);
    writeFileSync(
      join(cacheDirectory, "provider-benchmarks.json"),
      "x".repeat(2 * 1024 * 1024 + 1),
    );

    expect(readProviderBenchmarks(cwd)).toEqual([]);
    expect(() =>
      recordProviderBenchmark(cwd, {
        providerId: "gateway",
        model: "model",
        checkedAt: "invalid",
        promptHash: "hash",
        promptChars: 1,
        maxTokens: 1,
        totalMs: Number.NaN,
        outputTokens: 0,
        textChars: 0,
        throughputTokensPerSec: 0,
        cacheReadTokens: 0,
        cacheInputTokens: 0,
        cacheHitRate: 0,
      }),
    ).not.toThrow();
    expect(readProviderBenchmarks(cwd)).toEqual([]);
  });

  it("summarizes cache profile cold and warm rounds", () => {
    const samples = [
      {
        providerId: "deepseek-openai",
        model: "deepseek-v4-flash",
        checkedAt: "2026-07-01T00:00:00.000Z",
        promptHash: "stable",
        promptChars: 4096,
        maxTokens: 8,
        firstDeltaMs: 2800,
        totalMs: 3000,
        outputTokens: 8,
        textChars: 16,
        throughputTokensPerSec: 2.7,
        cacheReadTokens: 0,
        cacheInputTokens: 900,
        cacheHitRate: 0,
      },
      {
        providerId: "deepseek-openai",
        model: "deepseek-v4-flash",
        checkedAt: "2026-07-01T00:00:01.000Z",
        promptHash: "stable",
        promptChars: 4096,
        maxTokens: 8,
        firstDeltaMs: 500,
        totalMs: 700,
        outputTokens: 8,
        textChars: 16,
        throughputTokensPerSec: 11,
        cacheReadTokens: 850,
        cacheInputTokens: 900,
        cacheHitRate: 0.94,
      },
    ];
    const summary = formatCacheProfileSummary(samples);
    const profile = evaluateCacheProfile(samples);

    expect(summary).toContain("Cache Profile");
    expect(summary).toContain("cache warm");
    expect(summary).toContain("speedup=5.6x");
    expect(summary).toContain("Prompt hash: stable");
    expect(profile.warmAvgHit).toBe(0.94);
    expect(profile.speedup).toBe("5.6x");
  });
});
