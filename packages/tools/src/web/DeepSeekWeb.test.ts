import { getEventListeners } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, ConfigSchema } from "@orbit-build/config";
import { executeDeepSeekWeb } from "./DeepSeekWeb.js";
import { WebSearchTool } from "./search.js";
import { WebFetchTool } from "./fetch.js";
import type { ToolContext } from "../types.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function fixture() {
  vi.stubEnv("ORBIT_TEST_DEEPSEEK_KEY", "");
  const config = structuredClone(DEFAULT_CONFIG);
  config.tools.webSearch.deepseekApiKeyEnv = "ORBIT_TEST_DEEPSEEK_KEY";
  const ctx: ToolContext = { cwd: "/tmp", sessionId: "test", config };
  const fetch = vi.fn<typeof globalThis.fetch>();
  const readSecret = vi.fn(() => "private-fixture-secret");
  return { ctx, fetch, readSecret };
}
const search = {
  operation: "search" as const,
  query: "DeepSeek API",
  count: 2,
};
const result = {
  title: "Docs",
  url: "https://api-docs.deepseek.com/",
  snippet: "API documentation",
  date: null,
};

describe("DeepSeek web APIs", () => {
  it("reuses stored credentials only at the official origin and records billable usage", async () => {
    const { ctx, fetch, readSecret } = fixture();
    fetch.mockResolvedValue(Response.json({ results: [result, result] }));
    const response = await executeDeepSeekWeb(search, ctx, {
      fetch,
      readSecret,
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.deepseek.com/v1/tools/search",
      expect.objectContaining({
        redirect: "error",
        method: "POST",
        headers: {
          Authorization: "Bearer private-fixture-secret",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      query: search.query,
      count: 2,
      need_content: false,
    });
    expect(readSecret).toHaveBeenCalledWith("ORBIT_TEST_DEEPSEEK_KEY");
    expect(response.data?.match(/Link:/g)).toHaveLength(1);
    expect(response.metadata?.externalUsage).toMatchObject({
      successfulRequests: 1,
      estimatedCostUsd: 0.00075,
    });
    expect(JSON.stringify(response)).not.toContain("private-fixture-secret");
  });
  it("rejects queries beyond 128 Unicode characters before dispatch", async () => {
    const { ctx, fetch, readSecret } = fixture();
    const rejected = await executeDeepSeekWeb(
      { ...search, query: "a".repeat(129) },
      ctx,
      { fetch, readSecret },
    );
    expect(rejected.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockResolvedValue(Response.json({ results: [] }));
    expect(
      (
        await executeDeepSeekWeb({ ...search, query: "😀".repeat(128) }, ctx, {
          fetch,
          readSecret,
        })
      ).ok,
    ).toBe(true);
  });
  it("does not bill empty search results or retry them", async () => {
    const { ctx, fetch, readSecret } = fixture();
    fetch.mockResolvedValue(Response.json({ results: [] }));
    const response = await executeDeepSeekWeb(search, ctx, {
      fetch,
      readSecret,
    });
    expect(response.ok).toBe(true);
    expect(response.metadata?.externalUsage).toMatchObject({
      successfulRequests: 0,
      estimatedCostUsd: 0,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([401, 402, 408, 429, 500, 302])(
    "handles HTTP %s without body disclosure or automatic retries",
    async (status) => {
      const { ctx, fetch, readSecret } = fixture();
      fetch.mockResolvedValue(
        new Response("private-fixture-secret", { status }),
      );
      const response = await executeDeepSeekWeb(search, ctx, {
        fetch,
        readSecret,
      });
      expect(response.ok).toBe(false);
      expect(response.error).toContain(String(status));
      expect(JSON.stringify(response)).not.toContain("private-fixture-secret");
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    { results: "wrong" },
    { results: [{ ...result, url: "javascript:alert(1)" }] },
  ])(
    "rejects malformed results and marks uncertain billing",
    async (payload) => {
      const { ctx, fetch, readSecret } = fixture();
      fetch.mockResolvedValue(Response.json(payload));
      expect(
        await executeDeepSeekWeb(search, ctx, { fetch, readSecret }),
      ).toMatchObject({ ok: false, metadata: { externalUsageUnknown: true } });
    },
  );
  it("caps remote responses and returned Markdown", async () => {
    const { ctx, fetch, readSecret } = fixture();
    fetch.mockResolvedValueOnce(Response.json({ content: "x".repeat(5000) }));
    const request = {
      operation: "fetch" as const,
      url: "https://example.com/",
      maxChars: 1000,
    };
    const response = await executeDeepSeekWeb(request, ctx, {
      fetch,
      readSecret,
      validateUrl: async (url) => url,
    });
    expect(response.ok).toBe(true);
    expect(response.data!.length).toBeLessThan(1100);
    expect(response.data).toContain("truncated");
    fetch.mockResolvedValueOnce(new Response("x".repeat(4 * 1024 * 1024 + 1)));
    expect(
      (await executeDeepSeekWeb(search, ctx, { fetch, readSecret })).ok,
    ).toBe(false);
  });
  it("blocks private URLs even with Full Access before sending credentials", async () => {
    const { ctx, fetch, readSecret } = fixture();
    const response = await executeDeepSeekWeb(
      { operation: "fetch", url: "http://127.0.0.1/admin", maxChars: 1000 },
      ctx,
      { fetch, readSecret },
    );
    expect(response.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("honors cancellation, cleans listeners and never exposes transport errors", async () => {
    const { ctx, fetch, readSecret } = fixture();
    const reportUsage = vi.fn();
    ctx.reportUsage = reportUsage;
    const controller = new AbortController();
    ctx.abortSignal = controller.signal;
    fetch.mockImplementation(async (_url, options) => {
      expect(reportUsage).toHaveBeenLastCalledWith({
        externalUsageUnknown: true,
      });
      controller.abort();
      options?.signal?.throwIfAborted();
      throw new Error("private-fixture-secret");
    });
    expect(
      await executeDeepSeekWeb(search, ctx, { fetch, readSecret }),
    ).toMatchObject({ ok: false, failure: { code: "cancelled" } });
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    await executeDeepSeekWeb(search, ctx, { fetch, readSecret });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("enforces the timeout with no follow-up request", async () => {
    vi.useFakeTimers();
    const { ctx, fetch, readSecret } = fixture();
    fetch.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(new Error("timeout")),
            { once: true },
          );
        }),
    );
    const pending = executeDeepSeekWeb(search, ctx, { fetch, readSecret });
    await vi.advanceTimersByTimeAsync(8001);
    expect(await pending).toMatchObject({
      ok: false,
      failure: { code: "timeout" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("routes explicitly configured search and fetch through the new backend", async () => {
    const { ctx, fetch } = fixture();
    vi.stubEnv("ORBIT_TEST_DEEPSEEK_KEY", "fixture-key");
    vi.stubEnv("ORBIT_WEB_SEARCH_PROVIDER", "");
    ctx.config!.tools.webSearch.provider = "deepseek";
    ctx.config!.tools.webSearch.fetchProvider = "deepseek";
    expect(ConfigSchema.safeParse(ctx.config).success).toBe(true);
    fetch.mockResolvedValueOnce(Response.json({ results: [result] }));
    vi.stubGlobal("fetch", fetch);
    expect((await new WebSearchTool().execute({ query: "API" }, ctx)).ok).toBe(
      true,
    );
    fetch.mockResolvedValueOnce(Response.json({ content: "Markdown" }));
    const tool = new WebFetchTool(fetch, async () => ["93.184.216.34"]);
    expect(
      (await tool.execute({ url: "https://example.com/" }, ctx)).data,
    ).toContain("Markdown");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://api.deepseek.com/v1/tools/search",
      "https://api.deepseek.com/v1/tools/fetch",
    ]);
  });
});
