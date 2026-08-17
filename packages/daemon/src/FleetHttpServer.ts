import {
  createServer as createHttpServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "http";
import {
  createServer as createHttpsServer,
  type Server as HttpsServer,
} from "https";
import { timingSafeEqual } from "crypto";
import { readFileSync } from "fs";
import { URL } from "url";
import { z } from "zod";
import { redactSecrets } from "@orbit-build/shared";
import { DaemonAuditLog } from "./DaemonAudit.js";
import { FleetCoordinator, type FleetCompletion } from "./FleetCoordinator.js";
import {
  FleetJobIdSchema,
  FleetSignedEnvelopeSchema,
  FleetWorkerIdSchema,
  verifyFleetEnvelope,
} from "./FleetProtocol.js";
import {
  FLEET_HTTP_PROTOCOL_VERSION,
  MAX_FLEET_HTTP_BODY_BYTES,
  MAX_FLEET_HTTP_RESPONSE_BYTES,
  FleetClaimRequestSchema,
  FleetCompletionRequestSchema,
  FleetHttpPrincipalSchema,
  FleetJobListQuerySchema,
  FleetLeaseRequestSchema,
  FleetHttpErrorSchema,
  type FleetHttpPrincipal,
  type FleetHttpScope,
} from "./FleetHttpProtocol.js";

const MAX_HOST_LENGTH = 256;

export interface FleetHttpAuthenticator {
  authenticate(
    headers: IncomingHttpHeaders,
  ): FleetHttpPrincipal | undefined | Promise<FleetHttpPrincipal | undefined>;
}

/** Constant-time bearer authenticator for local or deployment-owned tokens. */
export class FleetHttpTokenAuthenticator implements FleetHttpAuthenticator {
  private readonly principals: FleetHttpPrincipal[];

  public constructor(principals: FleetHttpPrincipal[]) {
    this.principals = principals.map((principal) =>
      FleetHttpPrincipalSchema.parse(principal),
    );
    if (this.principals.length === 0) {
      throw new Error(
        "Fleet HTTP authentication requires at least one principal.",
      );
    }
  }

  public authenticate(
    headers: IncomingHttpHeaders,
  ): FleetHttpPrincipal | undefined {
    const authorization = headers.authorization;
    const token =
      typeof authorization === "string"
        ? /^Bearer\s+([^\s]+)$/i.exec(authorization)?.[1]
        : undefined;
    if (!token) return undefined;
    const presented = Buffer.from(token, "utf8");
    for (const principal of this.principals) {
      const expected = Buffer.from(principal.token, "utf8");
      if (
        presented.length === expected.length &&
        timingSafeEqual(presented, expected)
      ) {
        return principal;
      }
    }
    return undefined;
  }
}

export interface FleetHttpServerAddress {
  protocol: "http" | "https";
  host: string;
  port: number;
}

export interface FleetHttpServerOptions {
  coordinator: FleetCoordinator;
  signerKeys: Record<string, string | Buffer>;
  authenticator: FleetHttpAuthenticator;
  host?: string;
  port?: number;
  tls?: { certFile: string; keyFile: string };
  allowedHosts?: string[];
  /**
   * Require every principal with the worker scope to declare workerIds.
   * Keep false for local/backwards-compatible deployments; hosted deployments
   * should enable it unless their authenticator enforces an equivalent binding.
   */
  requireWorkerBinding?: boolean;
  auditLog?: DaemonAuditLog;
  requireAudit?: boolean;
}

/**
 * Authenticated HTTP transport for the provider-neutral FleetCoordinator.
 * The transport is deployment-neutral: it can run locally, behind a reverse
 * proxy, or inside a hosted service without moving workspace bytes itself.
 */
export class FleetHttpServer {
  private readonly host: string;
  private readonly port: number;
  private readonly allowedHosts: Set<string>;
  private readonly serverOptions: FleetHttpServerOptions;
  private server: HttpServer | HttpsServer | undefined;
  private address: FleetHttpServerAddress | undefined;
  private stopping: Promise<void> | undefined;

  public constructor(options: FleetHttpServerOptions) {
    this.serverOptions = options;
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 0;
    if (Object.keys(options.signerKeys).length === 0) {
      throw new Error("Fleet HTTP signed submissions require signer keys.");
    }
    if (!options.tls && !isLoopbackHost(this.host)) {
      throw new Error("Non-loopback Fleet HTTP listeners require TLS.");
    }
    const configuredHosts = options.allowedHosts ?? [this.host, "localhost"];
    this.allowedHosts = new Set(
      configuredHosts
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0 && value.length <= MAX_HOST_LENGTH),
    );
    if (this.allowedHosts.size === 0) {
      throw new Error("Fleet HTTP requires at least one allowed Host value.");
    }
  }

  public async start(): Promise<FleetHttpServerAddress> {
    if (this.server) return this.address!;
    const handler = (request: IncomingMessage, response: ServerResponse) => {
      void this.handle(request, response);
    };
    const server = this.serverOptions.tls
      ? createHttpsServer(
          {
            cert: readFileSync(this.serverOptions.tls.certFile),
            key: readFileSync(this.serverOptions.tls.keyFile),
          },
          handler,
        )
      : createHttpServer(handler);
    this.server = server;
    await new Promise<void>((resolveListen, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolveListen();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.port, this.host);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      await this.stop();
      throw new Error("Fleet HTTP server did not expose a TCP address.");
    }
    this.address = {
      protocol: this.serverOptions.tls ? "https" : "http",
      host: this.host,
      port: address.port,
    };
    return this.address;
  }

  public getAddress(): FleetHttpServerAddress {
    if (!this.address) throw new Error("Fleet HTTP server is not running.");
    return this.address;
  }

  public async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = new Promise<void>((resolveStop) => {
      const server = this.server;
      this.server = undefined;
      this.address = undefined;
      if (!server) return resolveStop();
      server.close(() => resolveStop());
    });
    return this.stopping;
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    let principal: FleetHttpPrincipal | undefined;
    try {
      if (!this.validHost(request.headers.host)) {
        this.sendError(response, 403, "invalid_host", "Invalid Host header.");
        return;
      }
      principal = await this.serverOptions.authenticator.authenticate(
        request.headers,
      );
      if (!principal) {
        if (!this.audit(undefined, "auth", "denied")) {
          this.sendError(
            response,
            503,
            "audit_unavailable",
            "Fleet audit storage is unavailable.",
          );
          return;
        }
        this.sendError(
          response,
          401,
          "unauthorized",
          "Bearer token is required.",
        );
        return;
      }
      if (
        !this.audit(principal, "request", "accepted", {
          method: request.method ?? "",
          path: new URL(request.url || "/", "http://orbit-fleet.invalid")
            .pathname,
        })
      ) {
        this.sendError(
          response,
          503,
          "audit_unavailable",
          "Fleet audit storage is unavailable.",
        );
        return;
      }
      const url = new URL(request.url || "/", "http://orbit-fleet.invalid");
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] !== "v1") {
        this.sendError(response, 404, "not_found", "Unknown Fleet endpoint.");
        return;
      }
      if (
        parts.length === 2 &&
        parts[1] === "health" &&
        request.method === "GET"
      ) {
        if (!this.requireScope(principal, "read", response)) return;
        this.sendJson(response, 200, {
          schemaVersion: FLEET_HTTP_PROTOCOL_VERSION,
          ok: true,
          protocolVersion: FLEET_HTTP_PROTOCOL_VERSION,
          accepting: true,
          jobs: this.serverOptions.coordinator.list(10_000).length,
        });
        return;
      }
      if (parts.length === 2 && parts[1] === "jobs") {
        await this.handleJobs(request, response, url, principal);
        return;
      }
      if (
        parts.length === 3 &&
        parts[1] === "jobs" &&
        parts[2] === "claim" &&
        request.method === "POST"
      ) {
        await this.handleClaim(request, response, principal);
        return;
      }
      if (parts.length >= 3 && parts[1] === "jobs") {
        const jobId = FleetJobIdSchema.parse(parts[2]);
        await this.handleJob(
          jobId,
          parts.slice(3),
          request,
          response,
          principal,
        );
        return;
      }
      this.sendError(response, 404, "not_found", "Unknown Fleet endpoint.");
    } catch (error: unknown) {
      const message = redactSecrets(
        error instanceof Error ? error.message : String(error),
      ).slice(0, 4_000);
      this.audit(principal, "request", "failed", { error: message });
      const status = /not found/i.test(message)
        ? 404
        : /unauthorized|requires scope/i.test(message)
          ? 403
          : /already exists|stale|expired|busy/i.test(message)
            ? 409
            : 400;
      this.sendError(response, status, "request_failed", message);
    }
  }

  private async handleJobs(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    principal: FleetHttpPrincipal,
  ): Promise<void> {
    if (request.method === "GET") {
      if (!this.requireScope(principal, "read", response)) return;
      const query = FleetJobListQuerySchema.parse({
        limit: url.searchParams.get("limit") ?? undefined,
      });
      this.sendJson(response, 200, {
        schemaVersion: FLEET_HTTP_PROTOCOL_VERSION,
        ok: true,
        jobs: this.serverOptions.coordinator.list(query.limit),
      });
      return;
    }
    if (request.method === "POST") {
      if (!this.requireScope(principal, "submit", response)) return;
      const envelope = FleetSignedEnvelopeSchema.parse(
        await this.readJson(request),
      );
      const key = this.serverOptions.signerKeys[envelope.signerId];
      if (!key || !verifyEnvelope(envelope, key)) {
        this.sendError(
          response,
          403,
          "invalid_signature",
          "Fleet job signature is invalid.",
        );
        return;
      }
      const job = this.serverOptions.coordinator.submit(
        envelope.job,
        envelope.jobId,
      );
      this.sendJson(response, 202, {
        schemaVersion: FLEET_HTTP_PROTOCOL_VERSION,
        ok: true,
        job,
      });
      return;
    }
    this.sendError(
      response,
      405,
      "method_not_allowed",
      "Use GET or POST for Fleet jobs.",
    );
  }

  private async handleClaim(
    request: IncomingMessage,
    response: ServerResponse,
    principal: FleetHttpPrincipal,
  ): Promise<void> {
    if (!this.requireScope(principal, "worker", response)) return;
    const claim = FleetClaimRequestSchema.parse(await this.readJson(request));
    if (!this.requireWorkerIdentity(principal, claim.workerId, response))
      return;
    const job = this.serverOptions.coordinator.claim(claim.workerId);
    if (!job) {
      response.writeHead(204);
      response.end();
      return;
    }
    this.sendJson(response, 200, {
      schemaVersion: FLEET_HTTP_PROTOCOL_VERSION,
      ok: true,
      job,
    });
  }

  private async handleJob(
    jobId: z.infer<typeof FleetJobIdSchema>,
    suffix: string[],
    request: IncomingMessage,
    response: ServerResponse,
    principal: FleetHttpPrincipal,
  ): Promise<void> {
    if (suffix.length === 0 && request.method === "GET") {
      if (!this.requireScope(principal, "read", response)) return;
      const job = this.serverOptions.coordinator.inspect(jobId);
      if (!job) {
        this.sendError(
          response,
          404,
          "not_found",
          `Fleet job not found: ${jobId}`,
        );
        return;
      }
      this.sendJson(response, 200, {
        schemaVersion: FLEET_HTTP_PROTOCOL_VERSION,
        ok: true,
        job,
      });
      return;
    }
    if (suffix.length !== 1 || request.method !== "POST") {
      this.sendError(
        response,
        405,
        "method_not_allowed",
        "Unknown Fleet job operation.",
      );
      return;
    }
    if (suffix[0] === "cancel") {
      if (!this.requireScope(principal, "control", response)) return;
      await this.readJson(request);
      const job = this.serverOptions.coordinator.cancel(jobId);
      this.sendJson(response, 202, {
        schemaVersion: FLEET_HTTP_PROTOCOL_VERSION,
        ok: true,
        job,
      });
      return;
    }
    if (suffix[0] === "heartbeat") {
      if (!this.requireScope(principal, "worker", response)) return;
      const input = FleetLeaseRequestSchema.parse(await this.readJson(request));
      if (!this.requireWorkerIdentity(principal, input.workerId, response))
        return;
      const job = this.serverOptions.coordinator.heartbeat(
        jobId,
        input.workerId,
        input.leaseId,
      );
      this.sendJson(response, 200, {
        schemaVersion: FLEET_HTTP_PROTOCOL_VERSION,
        ok: true,
        job,
      });
      return;
    }
    if (suffix[0] === "complete") {
      if (!this.requireScope(principal, "worker", response)) return;
      const input = FleetCompletionRequestSchema.parse(
        await this.readJson(request),
      );
      if (!this.requireWorkerIdentity(principal, input.workerId, response))
        return;
      const job = this.serverOptions.coordinator.complete(
        jobId,
        input.workerId,
        input.leaseId,
        input.completion as FleetCompletion,
      );
      this.sendJson(response, 200, {
        schemaVersion: FLEET_HTTP_PROTOCOL_VERSION,
        ok: true,
        job,
      });
      return;
    }
    this.sendError(response, 404, "not_found", "Unknown Fleet job operation.");
  }

  private async readJson(request: IncomingMessage): Promise<unknown> {
    const contentType = String(request.headers["content-type"] ?? "");
    if (!contentType.toLowerCase().startsWith("application/json")) {
      throw new Error("Fleet requests require application/json.");
    }
    const declaredLength = Number(request.headers["content-length"] ?? 0);
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_FLEET_HTTP_BODY_BYTES
    ) {
      throw new Error("Fleet request body is too large.");
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_FLEET_HTTP_BODY_BYTES)
        throw new Error("Fleet request body is too large.");
      chunks.push(buffer);
    }
    if (chunks.length === 0) return {};
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }

  private validHost(value: string | undefined): boolean {
    if (!value || value.length > MAX_HOST_LENGTH) return false;
    const host = value.toLowerCase().replace(/:\d+$/, "");
    return this.allowedHosts.has(host);
  }

  private requireScope(
    principal: FleetHttpPrincipal,
    scope: FleetHttpScope,
    response: ServerResponse,
  ): boolean {
    if (principal.scopes.includes("admin") || principal.scopes.includes(scope))
      return true;
    this.sendError(
      response,
      403,
      "forbidden",
      `Fleet scope required: ${scope}.`,
    );
    return false;
  }

  private requireWorkerIdentity(
    principal: FleetHttpPrincipal,
    workerId: string,
    response: ServerResponse,
  ): boolean {
    const binding = principal.workerIds;
    const parsedWorkerId = FleetWorkerIdSchema.parse(workerId);
    if (binding?.includes(parsedWorkerId)) return true;
    if (binding === undefined && !this.serverOptions.requireWorkerBinding)
      return true;
    this.sendError(
      response,
      403,
      "worker_identity_forbidden",
      "Fleet principal is not authorized for this worker identity.",
    );
    return false;
  }

  private audit(
    principal: FleetHttpPrincipal | undefined,
    action: string,
    outcome: "accepted" | "denied" | "failed",
    metadata?: Record<string, unknown>,
  ): boolean {
    const log = this.serverOptions.auditLog;
    if (!log) return true;
    try {
      log.append({
        principalId: principal?.id ?? "anonymous",
        authMethod: "fleet-token",
        action: `fleet.${action}`,
        outcome,
        metadata,
      });
      return true;
    } catch {
      return !this.serverOptions.requireAudit;
    }
  }

  private sendJson(
    response: ServerResponse,
    status: number,
    value: unknown,
  ): void {
    const body = JSON.stringify(value);
    if (Buffer.byteLength(body, "utf8") > MAX_FLEET_HTTP_RESPONSE_BYTES) {
      this.sendError(
        response,
        500,
        "response_too_large",
        "Fleet response is too large.",
      );
      return;
    }
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(body, "utf8"),
    });
    response.end(body);
  }

  private sendError(
    response: ServerResponse,
    status: number,
    code: string,
    message: string,
  ): void {
    const body = FleetHttpErrorSchema.parse({
      schemaVersion: FLEET_HTTP_PROTOCOL_VERSION,
      ok: false,
      error: { code, message: redactSecrets(message).slice(0, 4_000) },
    });
    this.sendJson(response, status, body);
  }
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function verifyEnvelope(
  envelope: z.infer<typeof FleetSignedEnvelopeSchema>,
  publicKey: string | Buffer,
): boolean {
  // The protocol helper performs canonicalization and signature verification;
  // alternate JSON serialization cannot become an authorization bypass.
  return verifyFleetEnvelope(envelope, publicKey);
}
