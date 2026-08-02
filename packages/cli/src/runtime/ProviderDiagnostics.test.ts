import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  formatProviderProbe,
  probeProviderCapabilities,
  readProviderProbeCache,
} from "./ProviderDiagnostics.js";
import type { OrbitConfig } from "@orbit-build/config";
import type { ModelProvider } from "@orbit-build/model-providers";

describe("ProviderDiagnostics", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("probes streaming and usage support and caches the result", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-provider-probe-"));
    dirs.push(cwd);
    const config = {
      models: { default: "vendor/fast" },
    } as OrbitConfig;
    const provider: ModelProvider = {
      id: "gateway",
      type: "openai-compatible",
      capabilities: {
        streaming: true,
        toolCalls: false,
        jsonMode: true,
        thinking: false,
        vision: false,
        promptCaching: false,
      },
      async *chat() {
        yield { type: "text_delta", text: "ok" };
        yield {
          type: "usage",
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
            cacheReadTokens: 1,
            cacheMissTokens: 0,
          },
        };
        yield { type: "done" };
      },
    };

    const result = await probeProviderCapabilities(cwd, config, provider);
    const cached = readProviderProbeCache(cwd);

    expect(result.observed.streamStarted).toBe(true);
    expect(result.observed.usageReturned).toBe(true);
    expect(result.observed.cacheUsageReturned).toBe(true);
    expect(result.observed.totalTokensReturned).toBe(true);
    expect(formatProviderProbe(result)).toContain("cacheUsage=yes");
    expect(cached[0].providerId).toBe("gateway");
    expect(cached[0].model).toBe("vendor/fast");
  });

  it("records the effective DeepSeek transport, release, and safe fallback", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-provider-protocol-"));
    dirs.push(cwd);
    const config = {
      models: { default: "deepseek-v4-flash" },
    } as OrbitConfig;
    const provider: ModelProvider = {
      id: "future-gateway",
      type: "openai-compatible",
      capabilities: {
        streaming: true,
        toolCalls: true,
        jsonMode: true,
        thinking: true,
        vision: false,
        promptCaching: true,
        apiFormats: ["responses", "chat-completions"],
        reasoningEfforts: ["low", "high", "max"],
        modelVersion: "DeepSeek-V4-Flash-0731",
      },
      async *chat() {
        yield {
          type: "response_metadata",
          requestedModel: "deepseek-v4-flash",
          resolvedModel: "deepseek-v4-flash",
          apiFormat: "chat-completions",
          modelVersion: "DeepSeek-V4-Flash-0731",
          apiFormatFallback: { from: "responses", status: 404 },
        };
        yield { type: "text_delta", text: "ok" };
        yield {
          type: "usage",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
        yield { type: "done" };
      },
    };

    const result = await probeProviderCapabilities(cwd, config, provider);
    expect(result.observed).toMatchObject({
      apiFormat: "chat-completions",
      modelVersion: "DeepSeek-V4-Flash-0731",
      apiFormatFallback: { from: "responses", status: 404 },
    });
    expect(formatProviderProbe(result)).toContain("fallback=responses/HTTP404");
    expect(readProviderProbeCache(cwd)[0].observed).toMatchObject({
      apiFormat: "chat-completions",
      modelVersion: "DeepSeek-V4-Flash-0731",
    });
  });

  it("formats older probe cache entries with unknown new fields as n/a", () => {
    const text = formatProviderProbe({
      providerId: "deepseek-openai",
      model: "deepseek-v4-flash",
      checkedAt: "2026-07-02T00:00:00.000Z",
      declared: {
        streaming: true,
        toolCalls: true,
        jsonMode: true,
        thinking: false,
        vision: false,
        promptCaching: true,
      },
      observed: {
        streamStarted: true,
        usageReturned: true,
        firstDeltaMs: 900,
      },
    });

    expect(text).toContain("cacheUsage=n/a");
    expect(text).toContain("maxContext=n/a");
    expect(text).toContain("maxOutput=n/a");
    expect(text).not.toContain("declared cache support");
  });

  it("consumes through a terminal error after usage and disables thinking", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-provider-probe-error-"));
    dirs.push(cwd);
    const config = {
      models: { default: "deepseek-v4-pro" },
    } as OrbitConfig;
    let request: Parameters<ModelProvider["chat"]>[0] | undefined;
    const provider: ModelProvider = {
      id: "deepseek-openai",
      type: "openai-compatible",
      capabilities: {
        streaming: true,
        toolCalls: true,
        jsonMode: true,
        thinking: true,
        vision: false,
        promptCaching: true,
        maxContextTokens: 1_000_000,
        maxOutputTokens: 384_000,
      },
      async *chat(input) {
        request = input;
        yield { type: "text_delta", text: "partial" };
        yield {
          type: "usage",
          usage: {
            inputTokens: 8,
            outputTokens: 32,
            totalTokens: 40,
          },
        };
        yield {
          type: "error",
          error: new Error("Model output was truncated at the token limit."),
        };
      },
    };

    const result = await probeProviderCapabilities(cwd, config, provider);
    const formatted = formatProviderProbe(result);

    expect(request).toMatchObject({
      model: "deepseek-v4-pro",
      stream: true,
      maxTokens: 32,
      thinking: { enabled: false },
    });
    expect(result.observed.usageReturned).toBe(true);
    expect(result.observed.error).toContain("truncated");
    expect(formatted).toContain("maxContext=1000000");
    expect(formatted).toContain("maxOutput=384000");
    expect(formatted).toContain("error: Model output was truncated");
    expect(readProviderProbeCache(cwd)[0].observed.error).toContain(
      "truncated",
    );
  });

  it("redacts credentials from probe failures before caching or formatting", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-provider-probe-secret-"));
    dirs.push(cwd);
    const secret = `sk-${"a".repeat(40)}`;
    const config = {
      models: { default: "deepseek-v4-flash" },
    } as OrbitConfig;
    const provider: ModelProvider = {
      id: "deepseek-openai",
      type: "openai-compatible",
      capabilities: {
        streaming: true,
        toolCalls: true,
        jsonMode: true,
        thinking: true,
        vision: false,
        promptCaching: true,
      },
      async *chat() {
        yield {
          type: "error",
          error: new Error(`Authentication failed for ${secret}`),
        };
      },
    };

    const result = await probeProviderCapabilities(cwd, config, provider);
    const formatted = formatProviderProbe(result);
    const cached = readProviderProbeCache(cwd);

    expect(result.observed.error).toContain("***REDACTED***");
    expect(formatted).not.toContain(secret);
    expect(JSON.stringify(cached)).not.toContain(secret);
  });

  it("filters malformed provider probe cache entries with Zod", () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-provider-probe-cache-"));
    dirs.push(cwd);
    const cacheDir = join(cwd, ".orbit");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(
      join(cacheDir, "provider-capabilities.json"),
      JSON.stringify({
        results: [
          null,
          {
            providerId: "invalid",
            model: "bad",
            checkedAt: "now",
            declared: { streaming: "yes" },
            observed: { streamStarted: true, usageReturned: true },
          },
          {
            providerId: "deepseek-openai",
            model: "deepseek-v4-flash",
            checkedAt: "2026-07-13T00:00:00.000Z",
            declared: {
              streaming: true,
              toolCalls: true,
              jsonMode: true,
              thinking: true,
              vision: false,
              promptCaching: true,
              maxContextTokens: 1_000_000,
              maxOutputTokens: 384_000,
            },
            observed: {
              streamStarted: true,
              usageReturned: true,
            },
          },
        ],
      }),
      "utf8",
    );

    const cached = readProviderProbeCache(cwd);

    expect(cached).toHaveLength(1);
    expect(cached[0]).toMatchObject({
      providerId: "deepseek-openai",
      model: "deepseek-v4-flash",
    });
  });

  it("bounds provider probe cache input", () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-provider-probe-cache-"));
    dirs.push(cwd);
    const cacheDir = join(cwd, ".orbit");
    mkdirSync(cacheDir);
    writeFileSync(
      join(cacheDir, "provider-capabilities.json"),
      "x".repeat(2 * 1024 * 1024 + 1),
    );

    expect(readProviderProbeCache(cwd)).toEqual([]);
  });
});
