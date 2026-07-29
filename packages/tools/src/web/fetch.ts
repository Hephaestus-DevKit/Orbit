import { z } from "zod";
import { redactSecrets } from "@orbit-build/shared";
import type { OrbitTool, ToolContext, ToolResult } from "../types.js";
import {
  createPublicDnsResolver,
  resolvePublicHttpTarget,
  resolveSystemAddresses,
  type AddressResolver,
} from "./publicHttpUrl.js";
import {
  createPinnedDispatcher,
  type PinnedDispatcherFactory,
} from "./PinnedHttpDispatcher.js";
import type { Dispatcher } from "undici";

export { assertPublicHttpUrl } from "./publicHttpUrl.js";

const WEB_FETCH_MAX_BYTES = 1024 * 1024;
const WEB_FETCH_MAX_REDIRECTS = 5;

export const WebFetchInputSchema = z.object({
  url: z
    .string()
    .url()
    .max(8192)
    .describe(
      "Public HTTP(S) URL to read. Local and private network targets are blocked.",
    ),
  maxChars: z
    .number()
    .int()
    .min(1000)
    .max(50_000)
    .describe("Maximum readable characters to return.")
    .optional(),
});

export type WebFetchInput = z.infer<typeof WebFetchInputSchema>;
type FetchImplementation = typeof globalThis.fetch;
type PinnedRequestInit = RequestInit & { dispatcher: Dispatcher };
/** Fetches bounded public text content while defending the local workspace from SSRF. */
export class WebFetchTool implements OrbitTool<WebFetchInput, string> {
  public readonly name = "web_fetch";
  public readonly description =
    "Read the bounded text content of a public HTTP(S) page after web_search identifies a useful source. Blocks credentials, localhost/private networks, binary responses, and unsafe redirects.";
  public readonly inputSchema = WebFetchInputSchema;
  public readonly risk = "network" as const;

  public constructor(
    private readonly fetchImplementation: FetchImplementation = globalThis.fetch,
    private readonly resolveAddresses: AddressResolver = resolveSystemAddresses,
    private readonly resolvePublicAddresses: AddressResolver = createPublicDnsResolver(
      fetchImplementation,
    ),
    private readonly createDispatcher: PinnedDispatcherFactory = createPinnedDispatcher,
  ) {}

  public async execute(
    input: WebFetchInput,
    context: ToolContext,
  ): Promise<ToolResult<string>> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (context.abortSignal?.aborted) {
      return { ok: false, error: "Web fetch was cancelled before it started." };
    }
    context.abortSignal?.addEventListener("abort", onAbort, { once: true });
    const timeoutMs = Math.max(
      1000,
      Math.min(30_000, context.config?.tools?.webSearch?.timeoutMs ?? 8000),
    );
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let currentTarget = await resolvePublicHttpTarget(
        input.url,
        this.resolveAddresses,
        this.resolvePublicAddresses,
        controller.signal,
      );
      for (
        let redirect = 0;
        redirect <= WEB_FETCH_MAX_REDIRECTS;
        redirect += 1
      ) {
        const lease = this.createDispatcher(
          currentTarget.hostname,
          currentTarget.addresses,
        );
        try {
          const requestInit: PinnedRequestInit = {
            method: "GET",
            redirect: "manual",
            signal: controller.signal,
            dispatcher: lease.dispatcher,
            headers: {
              Accept:
                "text/html, text/plain, application/json, application/xml;q=0.9, text/xml;q=0.9",
              "User-Agent":
                "Orbit/0.1 (+https://github.com/Hephaestus-DevKit/Orbit)",
            },
          };
          const response = await this.fetchImplementation(
            currentTarget.url,
            requestInit,
          );

          if (isRedirectStatus(response.status)) {
            await cancelResponseBody(response);
            const location = response.headers.get("location");
            if (!location) {
              return {
                ok: false,
                error:
                  "Web fetch received a redirect without a Location header.",
              };
            }
            if (redirect === WEB_FETCH_MAX_REDIRECTS) {
              return {
                ok: false,
                error: "Web fetch exceeded the redirect limit.",
              };
            }
            currentTarget = await resolvePublicHttpTarget(
              new URL(location, currentTarget.url).toString(),
              this.resolveAddresses,
              this.resolvePublicAddresses,
              controller.signal,
            );
            continue;
          }

          if (!response.ok) {
            await cancelResponseBody(response);
            return {
              ok: false,
              error:
                `Web fetch failed with HTTP ${response.status} ${response.statusText}`.trim(),
            };
          }
          const contentType =
            response.headers.get("content-type") || "text/plain";
          if (!isReadableContentType(contentType)) {
            await cancelResponseBody(response);
            return {
              ok: false,
              error: `Web fetch rejected non-text content type "${contentType.slice(0, 200)}".`,
            };
          }

          const rawText = await readBoundedResponseText(response);
          const text = contentType.toLowerCase().includes("text/html")
            ? htmlToReadableText(rawText)
            : rawText.trim();
          const maxChars = input.maxChars ?? 24_000;
          const bounded =
            text.length > maxChars
              ? `${text.slice(0, Math.max(0, maxChars - 35)).trimEnd()}\n... [truncated by web_fetch]`
              : text;
          const output = `Source: ${currentTarget.url}\nContent-Type: ${contentType}\n\n${bounded || "[No readable text content]"}`;
          return {
            ok: true,
            data: output,
            display: `Fetched ${currentTarget.url} (${bounded.length} readable characters).`,
          };
        } finally {
          await lease.close().catch(() => undefined);
        }
      }
      return { ok: false, error: "Web fetch exceeded the redirect limit." };
    } catch (error: unknown) {
      const message = controller.signal.aborted
        ? context.abortSignal?.aborted
          ? "Web fetch was cancelled by the user."
          : `Web fetch timed out after ${timeoutMs}ms.`
        : `Web fetch failed: ${error instanceof Error ? error.message : String(error)}`;
      return { ok: false, error: redactSecrets(message).slice(0, 2000) };
    } finally {
      clearTimeout(timeout);
      context.abortSignal?.removeEventListener("abort", onAbort);
    }
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function isRedirectStatus(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

function isReadableContentType(contentType: string): boolean {
  return /^(?:text\/|application\/(?:json|[\w.+-]*\+json|xml|[\w.+-]*\+xml))/i.test(
    contentType.trim(),
  );
}

async function readBoundedResponseText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let completed = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        completed = true;
        break;
      }
      const remaining = WEB_FETCH_MAX_BYTES - total;
      if (remaining <= 0) break;
      const chunk =
        next.value.byteLength > remaining
          ? next.value.subarray(0, remaining)
          : next.value;
      chunks.push(chunk);
      total += chunk.byteLength;
      if (total >= WEB_FETCH_MAX_BYTES) break;
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(combined);
}

function htmlToReadableText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}
