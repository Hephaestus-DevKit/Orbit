import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "http";
import {
  createServer as createHttpsServer,
  type Server as HttpsServer,
} from "https";
import { timingSafeEqual } from "crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "fs";
import { isAbsolute, relative, resolve } from "path";
import { URL } from "url";
import { z } from "zod";
import { redactSecrets } from "@orbit-build/shared";
import { DaemonStore } from "./DaemonStore.js";
import { DaemonTokenStore } from "./DaemonTokenStore.js";
import {
  DaemonErrorSchema,
  DaemonEventSchema,
  DaemonStartTaskSchema,
  DaemonTaskIdSchema,
  MAX_DAEMON_BODY_BYTES,
  REMOTE_DAEMON_PROTOCOL_VERSION,
  type DaemonEvent,
  type DaemonLeaseId,
  DaemonPrincipalSchema,
  DaemonIdentitySchema,
  type DaemonPrincipal,
  type DaemonIdentity,
  type DaemonScope,
  type DaemonTaskId,
  type DaemonTaskRecord,
} from "./DaemonProtocol.js";
import { DaemonAuditLog } from "./DaemonAudit.js";
import type { DaemonAuthenticator } from "./DaemonIdentity.js";

export interface DaemonTaskRunner {
  run(
    task: DaemonTaskRecord,
    emit: (type: string, payload?: Record<string, unknown>) => void,
    signal: AbortSignal,
  ): Promise<{
    state: "completed" | "failed" | "aborted";
    exitCode?: number;
    error?: string;
    sessionId?: string;
  }>;
}

export interface DaemonServerOptions {
  store: DaemonStore;
  tokenStore: DaemonTokenStore;
  runner: DaemonTaskRunner;
  host?: string;
  port?: number;
  tls?: { certFile: string; keyFile: string };
  allowedRoots: string[];
  /** Optional scoped principals for local desktop/editor integrations. */
  principals?: DaemonPrincipal[];
  /** Optional external identity adapters, such as an offline JWKS verifier. */
  authenticators?: DaemonAuthenticator[];
  /** Optional tamper-evident local audit sink. */
  auditLog?: DaemonAuditLog;
  /** Fail closed when a configured audit sink cannot append. */
  requireAudit?: boolean;
  maxConcurrentTasks?: number;
  now?: () => Date;
}

export interface DaemonServerAddress {
  protocol: "http" | "https";
  host: string;
  port: number;
}

const EmptyObjectSchema = z.object({}).strict();
const MAX_SSE_CLIENTS_PER_TASK = 32;
const HEARTBEAT_INTERVAL_MS = 10_000;
const SSE_HEARTBEAT_INTERVAL_MS = 15_000;
const EventQuerySchema = z.object({
  after: z.coerce.number().int().min(0).max(5_000).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  follow: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
});
const TaskListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(500),
});

/**
 * Authenticated task-control server. It owns no model logic; runner processes
 * remain an explicit injected boundary so CLI, desktop, and test hosts can
 * share this protocol without importing the presentation layer.
 */
export class DaemonServer {
  private readonly host: string;
  private readonly port: number;
  private readonly maxConcurrentTasks: number;
  private readonly controllers = new Map<DaemonTaskId, AbortController>();
  private readonly leases = new Map<DaemonTaskId, DaemonLeaseId>();
  private readonly heartbeats = new Map<DaemonTaskId, NodeJS.Timeout>();
  private readonly clients = new Map<DaemonTaskId, Set<ServerResponse>>();
  private server: HttpServer | HttpsServer | undefined;
  private address: DaemonServerAddress | undefined;
  private accepting = true;
  private scheduling = false;
  private stopping: Promise<void> | undefined;
  private readonly stopped: Promise<void>;
  private resolveStopped!: () => void;
  private token: string | undefined;
  private principals: DaemonPrincipal[] = [];

  public constructor(private readonly options: DaemonServerOptions) {
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 0;
    this.maxConcurrentTasks = Math.max(
      1,
      Math.min(options.maxConcurrentTasks ?? 4, 32),
    );
    this.stopped = new Promise<void>((resolve) => {
      this.resolveStopped = resolve;
    });
    validateListenPolicy(this.host, options.tls);
  }

  public async start(): Promise<DaemonServerAddress> {
    if (this.server) return this.address!;
    this.options.store.initialize();
    this.options.auditLog?.initialize();
    this.token = this.options.tokenStore.loadOrCreate();
    this.principals = validatePrincipals(
      this.options.principals ?? [
        {
          id: "local-admin",
          token: this.token,
          scopes: ["read", "submit", "control", "admin"],
        },
      ],
    );
    const handler = (request: IncomingMessage, response: ServerResponse) => {
      void this.handle(request, response);
    };
    const server = this.options.tls
      ? createHttpsServer(
          {
            cert: readFileSync(this.options.tls.certFile),
            key: readFileSync(this.options.tls.keyFile),
          },
          handler,
        )
      : createHttpServer(handler);
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.port, this.host);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      await this.stop();
      throw new Error("Daemon server did not expose a TCP address.");
    }
    this.address = {
      protocol: this.options.tls ? "https" : "http",
      host: this.host,
      port: address.port,
    };
    this.schedule();
    return this.address;
  }

  public getToken(): string {
    if (!this.token) throw new Error("DaemonServer.start() is required first.");
    return this.token;
  }

  /** Resolve when the listener and all daemon-owned clients have stopped. */
  public waitForStop(): Promise<void> {
    return this.stopped;
  }

  public async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      this.accepting = false;
      for (const [taskId, controller] of this.controllers) {
        controller.abort(new Error("Daemon is shutting down."));
        try {
          this.options.store.finishTask(taskId, "aborted", {
            error: "Daemon stopped while the task was running.",
            ownerLeaseId: this.leases.get(taskId),
          });
        } catch {
          // A task may have finished concurrently; its terminal record wins.
        }
      }
      for (const timer of this.heartbeats.values()) clearInterval(timer);
      this.heartbeats.clear();
      this.leases.clear();
      for (const responses of this.clients.values()) {
        for (const response of responses) response.end();
      }
      this.clients.clear();
      await new Promise<void>((resolve) => {
        if (!this.server) return resolve();
        this.server.close(() => resolve());
      });
      this.server = undefined;
      this.address = undefined;
      this.resolveStopped();
    })();
    return this.stopping;
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const principal = await this.authorized(request);
      if (!principal) {
        const audited = this.audit(request, undefined, "auth", "denied");
        if (!audited && this.options.requireAudit) {
          this.sendError(
            response,
            503,
            "audit_unavailable",
            "Daemon audit storage is unavailable.",
          );
          return;
        }
        this.sendError(
          response,
          401,
          "unauthorized",
          "Daemon bearer token is required.",
        );
        return;
      }
      const audited = this.audit(
        request,
        principal,
        "request",
        "accepted",
        undefined,
        {
          method: request.method ?? "",
          path: new URL(request.url || "/", "http://orbit-daemon.invalid")
            .pathname,
        },
      );
      if (!audited && this.options.requireAudit) {
        this.sendError(
          response,
          503,
          "audit_unavailable",
          "Daemon audit storage is unavailable.",
        );
        return;
      }
      const url = new URL(request.url || "/", "http://orbit-daemon.invalid");
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] !== "v1") {
        this.sendError(response, 404, "not_found", "Unknown daemon endpoint.");
        return;
      }
      if (
        parts.length === 2 &&
        parts[1] === "health" &&
        request.method === "GET"
      ) {
        if (!this.requireScope(principal, "read", response)) return;
        this.sendJson(response, 200, {
          schemaVersion: REMOTE_DAEMON_PROTOCOL_VERSION,
          ok: true,
          protocolVersion: REMOTE_DAEMON_PROTOCOL_VERSION,
          instanceId: this.options.store.getInstanceId(),
          accepting: this.accepting,
          activeTasks: this.controllers.size,
        });
        return;
      }
      if (
        parts.length === 2 &&
        parts[1] === "audit" &&
        request.method === "GET"
      ) {
        if (!this.requireScope(principal, "admin", response)) return;
        const auditLog = this.options.auditLog;
        if (!auditLog) {
          this.sendError(
            response,
            404,
            "audit_unavailable",
            "Daemon audit logging is not configured.",
          );
          return;
        }
        const query = AuditQuerySchema.parse({
          limit: url.searchParams.get("limit") ?? undefined,
        });
        const verification = auditLog.verify();
        if (!verification.valid) {
          this.sendError(
            response,
            503,
            "audit_corrupt",
            "Daemon audit log verification failed.",
          );
          return;
        }
        this.sendJson(response, 200, {
          schemaVersion: 1,
          ok: true,
          verification,
          entries: auditLog.read(query.limit),
        });
        return;
      }
      if (parts.length === 2 && parts[1] === "tasks") {
        await this.handleTasks(request, response, url, principal);
        return;
      }
      if (parts.length >= 3 && parts[1] === "tasks") {
        const taskId = DaemonTaskIdSchema.parse(parts[2]);
        await this.handleTask(
          taskId,
          parts.slice(3),
          request,
          response,
          url,
          principal,
        );
        return;
      }
      if (
        parts.length === 2 &&
        parts[1] === "shutdown" &&
        request.method === "POST"
      ) {
        if (!this.requireScope(principal, "admin", response)) return;
        await this.readJson(request, EmptyObjectSchema);
        this.sendJson(response, 202, { schemaVersion: 1, ok: true });
        void this.stop();
        return;
      }
      this.sendError(response, 404, "not_found", "Unknown daemon endpoint.");
    } catch (error: unknown) {
      const message = redactSecrets(
        error instanceof Error ? error.message : String(error),
      ).slice(0, 4_000);
      const status = /not found/i.test(message)
        ? 404
        : /invalid|cannot|requires|not queued|already/i.test(message)
          ? 409
          : 400;
      this.sendError(response, status, "request_failed", message);
    }
  }

  private async handleTasks(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    principal: DaemonIdentity,
  ): Promise<void> {
    if (request.method === "GET") {
      if (!this.requireScope(principal, "read", response)) return;
      const query = TaskListQuerySchema.parse({
        limit: url.searchParams.get("limit") ?? undefined,
      });
      this.sendJson(response, 200, {
        schemaVersion: 1,
        ok: true,
        tasks: this.options.store.listTasks(query.limit).map(toPublicTask),
      });
      return;
    }
    if (request.method !== "POST") {
      this.sendError(
        response,
        405,
        "method_not_allowed",
        "Use GET or POST for tasks.",
      );
      return;
    }
    if (!this.accepting) {
      this.sendError(
        response,
        503,
        "shutting_down",
        "Daemon is no longer accepting tasks.",
      );
      return;
    }
    if (!this.requireScope(principal, "submit", response)) return;
    const input = await this.readJson(request, DaemonStartTaskSchema);
    const cwd = canonicalAllowedWorkspace(input.cwd, this.options.allowedRoots);
    const task = this.options.store.createTask({ ...input, cwd });
    this.sendJson(response, 202, {
      schemaVersion: 1,
      ok: true,
      task: toPublicTask(task),
    });
    this.schedule();
  }

  private async handleTask(
    taskId: DaemonTaskId,
    suffix: string[],
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    principal: DaemonIdentity,
  ): Promise<void> {
    const task = this.options.store.getTask(taskId);
    if (!task) {
      this.sendError(
        response,
        404,
        "not_found",
        `Daemon task not found: ${taskId}`,
      );
      return;
    }
    if (suffix.length === 0 && request.method === "GET") {
      if (!this.requireScope(principal, "read", response)) return;
      this.sendJson(response, 200, {
        schemaVersion: 1,
        ok: true,
        task: toPublicTask(task),
      });
      return;
    }
    if (suffix.length === 0 && request.method === "DELETE") {
      if (!this.requireScope(principal, "admin", response)) return;
      const removed = this.options.store.removeTask(taskId);
      this.sendJson(response, 200, {
        schemaVersion: 1,
        ok: true,
        removed: {
          id: removed.id,
          state: removed.state,
          attempt: removed.attempt,
        },
      });
      return;
    }
    if (suffix[0] === "events" && request.method === "GET") {
      if (!this.requireScope(principal, "read", response)) return;
      await this.streamEvents(taskId, request, response, url);
      return;
    }
    if (suffix.length !== 1 || request.method !== "POST") {
      this.sendError(
        response,
        405,
        "method_not_allowed",
        "Unknown task operation.",
      );
      return;
    }
    await this.readJson(request, EmptyObjectSchema);
    if (suffix[0] === "cancel") {
      if (!this.requireScope(principal, "control", response)) return;
      this.cancel(taskId);
      this.sendJson(response, 202, {
        schemaVersion: 1,
        ok: true,
        task: toPublicTask(this.options.store.getTask(taskId)),
      });
      return;
    }
    if (suffix[0] === "resume") {
      if (!this.requireScope(principal, "control", response)) return;
      const resumed = this.options.store.resumeTask(taskId);
      this.sendJson(response, 202, {
        schemaVersion: 1,
        ok: true,
        task: toPublicTask(resumed),
      });
      this.schedule();
      return;
    }
    this.sendError(response, 404, "not_found", "Unknown task operation.");
  }

  private schedule(): void {
    if (this.scheduling || !this.accepting) return;
    this.scheduling = true;
    queueMicrotask(() => {
      this.scheduling = false;
      while (this.controllers.size < this.maxConcurrentTasks) {
        const next = this.options.store
          .listTasks(500)
          .filter((task) => task.state === "queued")
          .sort((left, right) =>
            left.createdAt.localeCompare(right.createdAt),
          )[0];
        if (!next) return;
        if (!this.startTask(next.id)) return;
      }
    });
  }

  private startTask(taskId: DaemonTaskId): boolean {
    let task: DaemonTaskRecord;
    try {
      task = this.options.store.claimTask(taskId);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        /busy in another process/i.test(error.message)
      ) {
        const retry = setTimeout(() => this.schedule(), 50);
        retry.unref();
        return false;
      }
      throw error;
    }
    const ownerLeaseId = task.owner?.leaseId;
    if (!ownerLeaseId) {
      throw new Error(
        `Daemon task ${taskId} did not receive an ownership lease.`,
      );
    }
    this.leases.set(taskId, ownerLeaseId);
    const controller = new AbortController();
    this.controllers.set(taskId, controller);
    const heartbeat = setInterval(() => {
      try {
        this.options.store.heartbeat(taskId, ownerLeaseId);
      } catch {
        // The runner's terminal transition owns the authoritative record.
      }
    }, HEARTBEAT_INTERVAL_MS);
    heartbeat.unref();
    this.heartbeats.set(taskId, heartbeat);
    void this.options.runner
      .run(
        task,
        (type, payload = {}) =>
          this.emitEvent(taskId, type, payload, ownerLeaseId),
        controller.signal,
      )
      .then((result) => {
        const current = this.options.store.getTask(taskId);
        if (current && current.attempt !== task.attempt) return;
        const state = isTerminalState(current?.state)
          ? current.state
          : controller.signal.aborted
            ? "aborted"
            : result.state;
        if (!isTerminalState(current?.state)) {
          try {
            this.options.store.finishTask(taskId, state, {
              ...result,
              ownerLeaseId,
            });
          } catch (error: unknown) {
            if (
              error instanceof Error &&
              /stale or missing ownership lease/i.test(error.message)
            ) {
              return;
            }
            throw error;
          }
        }
        this.emitEvent(taskId, "daemon_task_terminal", {
          state,
          exitCode: result.exitCode,
        });
      })
      .catch((error: unknown) => {
        const message = redactSecrets(
          error instanceof Error ? error.message : String(error),
        );
        const current = this.options.store.getTask(taskId);
        if (current && current.attempt !== task.attempt) return;
        const state = isTerminalState(current?.state)
          ? current.state
          : controller.signal.aborted
            ? "aborted"
            : "failed";
        if (!isTerminalState(current?.state)) {
          try {
            this.options.store.finishTask(taskId, state, {
              error: message,
              ownerLeaseId,
            });
          } catch (finishError: unknown) {
            if (
              finishError instanceof Error &&
              /stale or missing ownership lease/i.test(finishError.message)
            ) {
              return;
            }
            throw finishError;
          }
        }
        this.emitEvent(taskId, "daemon_task_terminal", { state });
      })
      .finally(() => {
        const heartbeat = this.heartbeats.get(taskId);
        if (heartbeat) clearInterval(heartbeat);
        this.heartbeats.delete(taskId);
        this.leases.delete(taskId);
        this.controllers.delete(taskId);
        this.schedule();
      });
    return true;
  }

  private cancel(taskId: DaemonTaskId): void {
    const controller = this.controllers.get(taskId);
    if (controller) controller.abort(new Error("Canceled by client."));
    this.options.store.cancelTask(taskId);
    this.schedule();
  }

  private emitEvent(
    taskId: DaemonTaskId,
    type: string,
    payload: Record<string, unknown> = {},
    ownerLeaseId?: DaemonLeaseId,
  ): void {
    const event = this.options.store.appendEvent(
      taskId,
      type,
      payload,
      ownerLeaseId,
    );
    if (event) this.publish(event);
    else if (type === "daemon_task_terminal") this.closeEventClients(taskId);
  }

  private publish(event: DaemonEvent): void {
    const parsed = DaemonEventSchema.parse(event);
    const clients = this.clients.get(parsed.taskId);
    if (!clients) return;
    const line = `id: ${parsed.sequence}\nevent: ${parsed.type}\ndata: ${JSON.stringify(parsed)}\n\n`;
    for (const response of [...clients]) {
      try {
        const writable = response.write(line);
        if (!writable || parsed.type === "daemon_task_terminal") response.end();
      } catch {
        // A client can disconnect between the writable check and write().
        // Remove it without allowing one broken SSE socket to reject the
        // runner's completion promise or terminate the daemon process.
        try {
          response.destroy();
        } catch {
          // The response is already closed.
        }
      }
    }
    if (parsed.type === "daemon_task_terminal")
      this.clients.delete(parsed.taskId);
  }

  private closeEventClients(taskId: DaemonTaskId): void {
    for (const response of this.clients.get(taskId) ?? []) response.end();
    this.clients.delete(taskId);
  }

  private async streamEvents(
    taskId: DaemonTaskId,
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> {
    const query = EventQuerySchema.parse({
      after: url.searchParams.get("after") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      follow: url.searchParams.get("follow") ?? undefined,
    });
    if (
      query.follow &&
      (this.clients.get(taskId)?.size ?? 0) >= MAX_SSE_CLIENTS_PER_TASK
    ) {
      this.sendError(
        response,
        429,
        "too_many_event_clients",
        `At most ${MAX_SSE_CLIENTS_PER_TASK} event followers are allowed per task.`,
      );
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const page = this.options.store.readEvents(
      taskId,
      query.after,
      query.limit,
    );
    if (page.resyncRequired) {
      response.write(
        `event: resync_required\ndata: ${JSON.stringify({ taskId })}\n\n`,
      );
    }
    for (const event of page.events) {
      response.write(
        `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      );
    }
    if (!query.follow) {
      response.end();
      return;
    }
    const clients = this.clients.get(taskId) ?? new Set<ServerResponse>();
    clients.add(response);
    this.clients.set(taskId, clients);
    const cleanup = () => {
      clearInterval(heartbeat);
      clients.delete(response);
      if (clients.size === 0) this.clients.delete(taskId);
    };
    const heartbeat = setInterval(() => {
      if (!response.write(": heartbeat\n\n")) response.end();
    }, SSE_HEARTBEAT_INTERVAL_MS);
    heartbeat.unref();
    request.once("aborted", cleanup);
    request.once("close", cleanup);
    response.once("close", cleanup);
    const task = this.options.store.getTask(taskId);
    if (
      task &&
      ["completed", "failed", "aborted", "canceled"].includes(task.state)
    ) {
      response.end();
      cleanup();
    }
  }

  private async authorized(
    request: IncomingMessage,
  ): Promise<DaemonIdentity | undefined> {
    const header = request.headers.authorization;
    const candidate =
      typeof header === "string"
        ? /^Bearer\s+(.+)$/i.exec(header)?.[1]
        : undefined;
    if (!candidate) return undefined;
    const staticPrincipal = this.principals.find((principal) =>
      tokenMatches(candidate, principal.token),
    );
    if (staticPrincipal) {
      return DaemonIdentitySchema.parse({
        id: staticPrincipal.id,
        scopes: staticPrincipal.scopes,
        authMethod: "bearer",
      });
    }
    for (const authenticator of this.options.authenticators ?? []) {
      const identity = await authenticator.authenticate(request.headers);
      if (identity) return DaemonIdentitySchema.parse(identity);
    }
    return undefined;
  }

  private requireScope(
    principal: DaemonIdentity,
    scope: DaemonScope,
    response: ServerResponse,
  ): boolean {
    if (
      principal.scopes.includes("admin") ||
      principal.scopes.includes(scope)
    ) {
      return true;
    }
    this.sendError(
      response,
      403,
      "forbidden",
      `Daemon principal ${principal.id} lacks the ${scope} scope.`,
    );
    return false;
  }

  private audit(
    request: IncomingMessage,
    principal: DaemonIdentity | undefined,
    action: string,
    outcome: "accepted" | "denied" | "failed",
    taskId?: DaemonTaskId,
    metadata?: Record<string, unknown>,
  ): boolean {
    const auditLog = this.options.auditLog;
    if (!auditLog) return !this.options.requireAudit;
    const requestIdHeader = request.headers["x-request-id"];
    const requestId =
      typeof requestIdHeader === "string" &&
      /^[A-Za-z0-9._:-]{1,128}$/.test(requestIdHeader)
        ? requestIdHeader
        : undefined;
    try {
      auditLog.append({
        principalId: principal?.id ?? "anonymous",
        authMethod: principal?.authMethod ?? "none",
        action,
        outcome,
        requestId,
        taskId,
        metadata,
      });
      return true;
    } catch {
      // Optional audit remains best effort; required audit fails closed above.
      return false;
    }
  }

  private async readJson<T>(
    request: IncomingMessage,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ): Promise<T> {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > MAX_DAEMON_BODY_BYTES)
        throw new Error("Daemon request body is too large.");
      chunks.push(buffer);
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return schema.parse(parsed);
  }

  private sendJson(
    response: ServerResponse,
    status: number,
    body: unknown,
  ): void {
    if (response.headersSent) return;
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(body));
  }

  private sendError(
    response: ServerResponse,
    status: number,
    code: string,
    message: string,
  ): void {
    const body = DaemonErrorSchema.parse({
      schemaVersion: 1,
      ok: false,
      error: {
        code: code
          .toLowerCase()
          .replace(/[^a-z0-9_:-]/g, "_")
          .slice(0, 64),
        message: redactSecrets(message).slice(0, 4_000),
      },
    });
    this.sendJson(response, status, body);
  }
}

function validateListenPolicy(
  host: string,
  tls: DaemonServerOptions["tls"],
): void {
  const loopback =
    host === "127.0.0.1" || host === "::1" || host === "localhost";
  if (!loopback && !tls) {
    throw new Error(
      "Non-loopback daemon listeners require TLS certificate and key files.",
    );
  }
}

function validatePrincipals(principals: DaemonPrincipal[]): DaemonPrincipal[] {
  const parsed = principals.map((principal) =>
    DaemonPrincipalSchema.parse(principal),
  );
  const ids = new Set<string>();
  const tokens = new Set<string>();
  for (const principal of parsed) {
    if (ids.has(principal.id))
      throw new Error(`Duplicate daemon principal id: ${principal.id}.`);
    if (tokens.has(principal.token))
      throw new Error("Daemon principals cannot share a token.");
    ids.add(principal.id);
    tokens.add(principal.token);
  }
  return parsed;
}

function tokenMatches(candidate: string, expected: string): boolean {
  const left = Buffer.from(candidate, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.byteLength !== right.byteLength) return false;
  return timingSafeEqual(left, right);
}

function canonicalAllowedWorkspace(input: string, roots: string[]): string {
  const requested = resolve(input);
  if (!existsSync(requested) || !statSync(requested).isDirectory()) {
    throw new Error(`Task workspace does not exist: ${requested}`);
  }
  const canonical = realpathSync.native(requested);
  for (const root of roots) {
    const allowedPath = resolve(root);
    if (!existsSync(allowedPath) || !statSync(allowedPath).isDirectory()) {
      continue;
    }
    const allowed = realpathSync.native(allowedPath);
    const relation = relative(allowed, canonical);
    if (
      relation === "" ||
      (!relation.startsWith("..") && !isAbsolute(relation))
    ) {
      return canonical;
    }
  }
  throw new Error("Task workspace is outside the daemon's allowed roots.");
}

function isTerminalState(
  state: DaemonTaskRecord["state"] | undefined,
): state is "completed" | "failed" | "aborted" | "canceled" {
  return (
    state === "completed" ||
    state === "failed" ||
    state === "aborted" ||
    state === "canceled"
  );
}

/** Never expose the per-attempt capability through the remote control API. */
function toPublicTask(
  task: DaemonTaskRecord | undefined,
): DaemonTaskRecord | undefined {
  if (!task?.owner?.leaseId) return task;
  const publicOwner = { ...task.owner };
  delete publicOwner.leaseId;
  return { ...task, owner: publicOwner };
}
