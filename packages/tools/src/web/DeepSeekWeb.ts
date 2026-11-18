import { z } from "zod";
import { CredentialsManager } from "@orbit-build/config";
import { readResponseTextWithinLimit } from "@orbit-build/shared";
import type { ToolContext, ToolResult } from "../types.js";
import { assertPublicHttpUrl } from "./publicHttpUrl.js";

/** Published per-successful-request rate, shared with harness admission. */
export const DEEPSEEK_WEB_REQUEST_COST_USD = 0.00075;

const SearchResponse = z.object({
  results: z
    .array(
      z.object({
        title: z.string().max(16_384),
        url: z
          .string()
          .url()
          .max(8192)
          .refine((value) => {
            const url = new URL(value);
            return (
              ["https:", "http:"].includes(url.protocol)
              && !url.username
              && !url.password
            );
          }),
        snippet: z.string().max(100_000),
        summary: z.string().max(100_000).optional(),
        date: z.string().max(200).nullable().optional(),
      }),
    )
    .max(50),
});
const FetchResponse = z.object({ content: z.string().max(4 * 1024 * 1024) });
const RequestSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("search"),
    query: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .refine((query) => Array.from(query).length <= 128),
    count: z.number().int().min(1).max(20),
  }),
  z.object({
    operation: z.literal("fetch"),
    url: z.string().url().max(8192),
    maxChars: z.number().int().min(1000).max(50_000),
  }),
]);
type WebRequest = z.infer<typeof RequestSchema>;

/** Injectable boundaries keep credentials and network behavior independently testable. */
export interface DeepSeekWebDependencies {
  fetch?: typeof globalThis.fetch;
  readSecret?: (name: string) => string | null;
  validateUrl?: (url: string, signal: AbortSignal) => Promise<string>;
}

/** One explicitly selected, bounded API request; never retries a potentially billed call. */
export async function executeDeepSeekWeb(
  request: WebRequest,
  context: ToolContext,
  dependencies: DeepSeekWebDependencies = {},
): Promise<ToolResult<string>> {
  const parsed = RequestSchema.safeParse(request);
  if (!parsed.success)
    return {
      ok: false,
      error: "Invalid DeepSeek web request. Search queries must contain 1–128 Unicode characters.",
    };
  request = parsed.data;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (context.abortSignal?.aborted)
    return failure("cancelled", "DeepSeek web request cancelled.");
  context.abortSignal?.addEventListener("abort", abort, { once: true });
  const timeoutMs = context.config?.tools.webSearch.timeoutMs ?? 8000;
  const timer = setTimeout(abort, timeoutMs);
  let dispatched = false;
  try {
    const keyName = context.config?.tools.webSearch.deepseekApiKeyEnv ?? "DEEPSEEK_API_KEY";
    const readSecret = dependencies.readSecret
      ?? ((name: string) => new CredentialsManager().getSecret(name));
    const key = process.env[keyName] || readSecret(keyName);
    if (!key)
      return failure(
        "unavailable",
        `DeepSeek web API needs ${keyName} in credentials or the environment.`,
      );
    let body: Record<string, unknown>;
    if (request.operation === "fetch") {
      // Even Full Access must not forward private URLs to a third-party fetch service.
      const validate = dependencies.validateUrl
        ?? ((url, signal) => assertPublicHttpUrl(url, undefined, undefined, signal));
      const url = await validate(request.url, controller.signal);
      body = { url };
    } else
      body = {
        query: request.query,
        count: request.count,
        need_content: false,
      };
    controller.signal.throwIfAborted();
    dispatched = true;
    context.reportUsage?.({ externalUsageUnknown: true });
    const response = await (dependencies.fetch ?? globalThis.fetch)(
      `https://api.deepseek.com/v1/tools/${request.operation}`,
      {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (response.status !== 200) {
      context.reportUsage?.({ externalUsageUnknown: false });
      await response.body?.cancel().catch(() => undefined);
      const hint = response.status === 402
        ? "Check your DeepSeek balance."
        : response.status === 429
        ? "Rate limited; retry later."
        : response.status === 401 || response.status === 403
        ? "Check the stored API credential."
        : "Check the service status and request.";
      return failure(
        `http_${response.status}`,
        `DeepSeek ${request.operation} failed (HTTP ${response.status}). ${hint}`,
      );
    }
    const text = await readResponseTextWithinLimit(
      response,
      4 * 1024 * 1024,
      "DeepSeek web response",
    );
    controller.signal.throwIfAborted();
    const json: unknown = JSON.parse(text);
    let data: string;
    let billable: boolean;
    if (request.operation === "search") {
      const result = SearchResponse.parse(json);
      billable = result.results.length > 0;
      const seen = new Set<string>();
      const results = result.results
        .filter((item) => {
          if (seen.has(item.url)) return false;
          seen.add(item.url);
          return true;
        })
        .slice(0, request.count);
      data = results
        .map(
          (item, index) =>
            `[${index + 1}] ${item.title.slice(0, 500)}\nLink: ${item.url}\n${
              item.date ? `Published: ${item.date}\n` : ""
            }${(item.summary || item.snippet).slice(0, 2000)}`,
        )
        .join("\n\n")
        || "No search results returned. Try a more specific query.";
    } else {
      const result = FetchResponse.parse(json);
      billable = result.content.trim().length > 0;
      const content = result.content.length > request.maxChars
        ? `${result.content.slice(0, request.maxChars - 32)}\n... [truncated by web_fetch]`
        : result.content;
      data = `Source: ${request.url}\n\n${content || "[No readable content]"}`;
    }
    const metadata = {
      externalUsageUnknown: false,
      externalUsage: {
        provider: "deepseek",
        operation: request.operation,
        successfulRequests: billable ? 1 : 0,
        estimatedCostUsd: billable ? DEEPSEEK_WEB_REQUEST_COST_USD : 0,
        pricingAsOf: "2026-11-16",
      },
    };
    context.reportUsage?.(metadata);
    return {
      ok: true,
      data,
      display: `DeepSeek ${request.operation} completed${
        billable ? " (estimated API charge: $0.00075)" : " (no results)"
      }.`,
      metadata,
    };
  } catch {
    // Never include a remote body, transport exception, URL query, or credential in diagnostics.
    const reason = controller.signal.aborted
      ? context.abortSignal?.aborted
        ? "cancelled"
        : "timeout"
      : "invalid_response";
    return {
      ...failure(
        reason,
        `DeepSeek ${request.operation} ${
          reason.replaceAll("_", " ")
        }. No automatic retry was made.`,
      ),
      ...(dispatched ? { metadata: { externalUsageUnknown: true } } : {}),
    };
  } finally {
    clearTimeout(timer);
    context.abortSignal?.removeEventListener("abort", abort);
  }
}

function failure(code: string, message: string): ToolResult<string> {
  return {
    ok: false,
    error: message,
    failure: { code, message, retryable: false },
  };
}
