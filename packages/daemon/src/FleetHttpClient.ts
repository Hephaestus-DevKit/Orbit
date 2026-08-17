import {
  readResponseJsonWithinLimit,
  redactSecrets,
} from "@orbit-build/shared";
import { z } from "zod";
import {
  FleetSignedEnvelopeSchema,
  type FleetJobId,
  type FleetJobRecord,
  type FleetSignedEnvelope,
} from "./FleetProtocol.js";
import {
  MAX_FLEET_HTTP_RESPONSE_BYTES,
  FleetClaimRequestSchema,
  FleetCompletionRequestSchema,
  FleetHealthResponseSchema,
  FleetHttpErrorSchema,
  FleetJobListQuerySchema,
  FleetJobListResponseSchema,
  FleetJobResponseSchema,
  FleetLeaseRequestSchema,
  type FleetCompletionRequest,
} from "./FleetHttpProtocol.js";

const DEFAULT_TIMEOUT_MS = 30_000;

export interface FleetHttpClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

/** Typed, bounded client for FleetHttpServer or an equivalent hosted adapter. */
export class FleetHttpClient {
  private readonly baseUrl: URL;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof globalThis.fetch;

  public constructor(options: FleetHttpClientOptions) {
    this.baseUrl = parseBaseUrl(options.baseUrl);
    if (options.token.length < 32 || options.token.length > 256) {
      throw new Error("Fleet HTTP bearer token length is invalid.");
    }
    this.token = options.token;
    this.timeoutMs = Math.max(
      1_000,
      Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 120_000),
    );
    this.fetcher = options.fetch ?? globalThis.fetch;
    if (typeof this.fetcher !== "function") {
      throw new Error("Fleet HTTP client requires a fetch implementation.");
    }
  }

  public async health(): Promise<z.infer<typeof FleetHealthResponseSchema>> {
    return this.request(
      "/v1/health",
      "GET",
      undefined,
      FleetHealthResponseSchema,
    );
  }

  public async list(limit = 100): Promise<FleetJobRecord[]> {
    const query = FleetJobListQuerySchema.parse({ limit });
    const result = await this.request(
      `/v1/jobs?limit=${query.limit}`,
      "GET",
      undefined,
      FleetJobListResponseSchema,
    );
    return result.jobs;
  }

  public async submit(envelope: FleetSignedEnvelope): Promise<FleetJobRecord> {
    const parsed = FleetSignedEnvelopeSchema.parse(envelope);
    const result = await this.request(
      "/v1/jobs",
      "POST",
      parsed,
      FleetJobResponseSchema,
    );
    return result.job;
  }

  public async inspect(jobId: FleetJobId): Promise<FleetJobRecord> {
    const result = await this.request(
      `/v1/jobs/${encodeURIComponent(jobId)}`,
      "GET",
      undefined,
      FleetJobResponseSchema,
    );
    return result.job;
  }

  public async claim(workerId: string): Promise<FleetJobRecord | undefined> {
    const body = FleetClaimRequestSchema.parse({ workerId });
    const result = await this.request(
      "/v1/jobs/claim",
      "POST",
      body,
      FleetJobResponseSchema,
      true,
    );
    return result?.job;
  }

  public async heartbeat(
    jobId: FleetJobId,
    workerId: string,
    leaseId: string,
  ): Promise<FleetJobRecord> {
    const body = FleetLeaseRequestSchema.parse({ workerId, leaseId });
    const result = await this.request(
      `/v1/jobs/${encodeURIComponent(jobId)}/heartbeat`,
      "POST",
      body,
      FleetJobResponseSchema,
    );
    return result.job;
  }

  public async complete(
    jobId: FleetJobId,
    request: FleetCompletionRequest,
  ): Promise<FleetJobRecord> {
    const body = FleetCompletionRequestSchema.parse(request);
    const result = await this.request(
      `/v1/jobs/${encodeURIComponent(jobId)}/complete`,
      "POST",
      body,
      FleetJobResponseSchema,
    );
    return result.job;
  }

  public async cancel(jobId: FleetJobId): Promise<FleetJobRecord> {
    const result = await this.request(
      `/v1/jobs/${encodeURIComponent(jobId)}/cancel`,
      "POST",
      {},
      FleetJobResponseSchema,
    );
    return result.job;
  }

  private request<T>(
    path: string,
    method: "GET" | "POST",
    body: unknown,
    schema: z.ZodType<T>,
  ): Promise<T>;

  private request<T>(
    path: string,
    method: "GET" | "POST",
    body: unknown,
    schema: z.ZodType<T>,
    allowEmpty: true,
  ): Promise<T | undefined>;

  private async request<T>(
    path: string,
    method: "GET" | "POST",
    body: unknown,
    schema: z.ZodType<T>,
    allowEmpty = false,
  ): Promise<T | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(new URL(path, this.baseUrl), {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: controller.signal,
      });
      if (response.status === 204 && allowEmpty) return undefined;
      const parsedBody = await readResponseJsonWithinLimit(
        response,
        MAX_FLEET_HTTP_RESPONSE_BYTES,
        "Fleet HTTP response",
      );
      if (!response.ok) {
        const error = FleetHttpErrorSchema.safeParse(parsedBody);
        throw new Error(
          error.success
            ? error.data.error.message
            : `Fleet HTTP ${response.status}: ${redactSecrets(
                JSON.stringify(parsedBody),
              ).slice(0, 2_000)}`,
        );
      }
      return schema.parse(parsedBody);
    } catch (error: unknown) {
      throw new Error(
        `Fleet HTTP request failed: ${redactSecrets(
          error instanceof Error ? error.message : String(error),
        ).slice(0, 4_000)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseBaseUrl(value: string): URL {
  const url = new URL(value);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    (url.protocol === "http:" && !isLoopbackHost(url.hostname))
  ) {
    throw new Error(
      "Fleet HTTP base URL must use HTTPS, or HTTP only on loopback.",
    );
  }
  return url;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "");
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1"
  );
}
