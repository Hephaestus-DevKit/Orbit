import { Command } from "commander";
import { describe, expect, it } from "vitest";
import {
  buildCacheProfileMessages,
  buildCacheProfilePrompt,
  evaluateBenchmarkThresholds,
  parseBenchOptions,
} from "./bench.js";
import type { ProviderBenchmarkResult } from "../runtime/ProviderBenchmarks.js";

describe("bench CLI options", () => {
  it("preserves model and provider options inherited from the root command", () => {
    const program = new Command();
    let resolvedOptions: ReturnType<typeof parseBenchOptions> | undefined;

    program.option("--provider <provider>").option("--model <model>");
    program
      .command("bench")
      .option("--provider <provider>")
      .option("--model <model>")
      .action((_localOptions, command) => {
        resolvedOptions = parseBenchOptions(command.optsWithGlobals());
      });

    program.parse([
      "node",
      "orbit",
      "bench",
      "--provider",
      "deepseek-openai",
      "--model",
      "deepseek-v4-pro",
    ]);

    expect(resolvedOptions).toMatchObject({
      provider: "deepseek-openai",
      model: "deepseek-v4-pro",
    });
  });

  it("profiles append-only follow-ups over one byte-stable boundary", () => {
    const prompt = buildCacheProfilePrompt("run-stable");
    const cold = buildCacheProfileMessages(prompt, 0);
    const warm = buildCacheProfileMessages(prompt, 2);

    expect(cold).toHaveLength(1);
    expect(warm.slice(0, cold.length)).toEqual(cold);
    expect(warm).toHaveLength(3);
    expect(warm[2].content).toEqual([
      {
        type: "text",
        text: "Cache continuation 2. Reply with exactly: ok",
      },
    ]);
  });
});

describe("bench cache profile prompt", () => {
  it("keeps a cache-sized prefix when a custom workload is supplied", () => {
    const prompt = buildCacheProfilePrompt(
      "run-stable",
      "Write twelve optimization tips.",
    );

    expect(prompt.length).toBeGreaterThan(20_000);
    expect(prompt).toContain("Cache profile run: run-stable");
    expect(prompt).toContain("Write twelve optimization tips.");
    expect(
      buildCacheProfilePrompt("run-stable", "Write twelve optimization tips."),
    ).toBe(prompt);
  });

  it("uses a unique prefix across separate benchmark invocations", () => {
    expect(buildCacheProfilePrompt("run-a")).not.toBe(
      buildCacheProfilePrompt("run-b"),
    );
  });
});

describe("bench performance thresholds", () => {
  const sample = (
    overrides: Partial<ProviderBenchmarkResult> = {},
  ): ProviderBenchmarkResult => ({
    providerId: "tokendance",
    model: "deepseek-v4-flash",
    checkedAt: "2026-07-18T00:00:00.000Z",
    promptHash: "prompt",
    promptChars: 20,
    maxTokens: 64,
    firstDeltaMs: 800,
    firstTextMs: 1_100,
    totalMs: 2_000,
    outputTokens: 40,
    textChars: 100,
    throughputTokensPerSec: 33,
    cacheReadTokens: 0,
    cacheInputTokens: 20,
    cacheHitRate: 0,
    ...overrides,
  });

  it("passes aggregate latency and throughput budgets", () => {
    expect(
      evaluateBenchmarkThresholds([sample(), sample()], {
        maxFirstDeltaMs: 1_000,
        maxFirstTextMs: 1_500,
        minThroughput: 30,
        maxErrorRate: 0,
      }),
    ).toEqual([]);
  });

  it("reports noisy latency, throughput, and provider failures", () => {
    const failures = evaluateBenchmarkThresholds(
      [
        sample(),
        sample({
          firstDeltaMs: 2_500,
          firstTextMs: 3_000,
          throughputTokensPerSec: 8,
        }),
        sample({ error: "gateway unavailable" }),
      ],
      {
        maxFirstDeltaMs: 2_000,
        maxFirstTextMs: 2_500,
        minThroughput: 20,
        maxErrorRate: 0.2,
      },
    );

    expect(failures).toEqual([
      "error rate 33% > 20%",
      "p90 first model delta 2500ms > 2000ms",
      "p90 first answer 3000ms > 2500ms",
      "p50 decode throughput 8.0 tok/s < 20.0 tok/s",
    ]);
  });
});
