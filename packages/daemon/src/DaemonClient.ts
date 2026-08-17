import { z } from "zod";
import {
  DaemonErrorSchema,
  DaemonEventSchema,
  DaemonStartTaskSchema,
  DaemonTaskIdSchema,
  DaemonTaskRecordSchema,
  type DaemonEvent,
  type DaemonEventPage,
  type DaemonStartTask,
  type DaemonTaskId,
  type DaemonTaskRecord,
} from "./DaemonProtocol.js";
import {
  DaemonAuditEntrySchema,
  type DaemonAuditEntry,
  type DaemonAuditVerification,
} from "./DaemonAudit.js";

const MAX_CLIENT_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_CLIENT_SSE_FRAME_BYTES = 128 * 1024;

const HealthSchema = z.object({
  schemaVersion: z.literal(1),
  ok: z.literal(true),
  protocolVersion: z.literal(1),
  instanceId: z.string().regex(/^daemon_[a-f0-9]{24,64}$/),
  accepting: z.boolean(),
  activeTasks: z.number().int().nonnegative().max(32),
});

const TaskEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  ok: z.literal(true),
  task: DaemonTaskRecordSchema,
});

const TaskListSchema = z.object({
  schemaVersion: z.literal(1),
  ok: z.literal(true),
  tasks: z.array(DaemonTaskRecordSchema).max(500),
});

const SubmitEnvelopeSchema = TaskEnvelopeSchema;
const EventReadQuerySchema = z.object({
  after: z.number().int().min(0).max(5_000).default(0),
  limit: z.number().int().min(1).max(500).default(200),
});
const AuditEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  ok: z.literal(true),
  verification: z.object({
    valid: z.boolean(),
    entries: z.number().int().nonnegative(),
    lastDigest: z.string().regex(/^[a-f0-9]{64}$/),
    error: z.string().optional(),
  }),
  entries: z.array(DaemonAuditEntrySchema).max(500),
});

export interface DaemonClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  maxResponseBytes?: number;
  /** Timeout for control/replay requests; follow streams intentionally opt out. */
  requestTimeoutMs?: number;
}

export type DaemonStreamEvent =
  | DaemonEvent
  | { type: "resync_required"; taskId: DaemonTaskId };

export interface DaemonEventReadOptions {
  after?: number;
  limit?: number;
}

export interface DaemonAuditSnapshot {
  verification: DaemonAuditVerification;
  entries: DaemonAuditEntry[];
}

/**
 * Typed client for the authenticated daemon protocol.
 *
 * This deliberately owns no task execution. Desktop, WebUI, editor, and
 * remote clients can share authentication, response bounds, schema validation,
 * replay, and cancellation semantics without importing the CLI.
 */
export class DaemonClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxResponseBytes: number;
  private readonly requestTimeoutMs: number;

  public constructor(options: DaemonClientOptions) {
    const parsed = new URL(options.baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Daemon client URL must use http or https.");
    }
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    this.baseUrl = parsed.toString().replace(/\/$/, "");
    this.token = options.token.trim();
    if (!this.token || this.token.length > 256) {
      throw new Error("Daemon client token is required and must be bounded.");
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxResponseBytes = Math.max(
      64 * 1024,
      Math.min(
        options.maxResponseBytes ?? MAX_CLIENT_RESPONSE_BYTES,
        64 * 1024 * 1024,
      ),
    );
    this.requestTimeoutMs = z
      .number()
      .int()
      .min(1_000)
      .max(300_000)
      .parse(options.requestTimeoutMs ?? 30_000);
  }

  public health(): Promise<z.infer<typeof HealthSchema>> {
    return this.requestJson("/v1/health", HealthSchema);
  }

  public startTask(input: DaemonStartTask): Promise<DaemonTaskRecord> {
    const parsed = DaemonStartTaskSchema.parse(input);
    return this.requestJson("/v1/tasks", SubmitEnvelopeSchema, {
      method: "POST",
      body: JSON.stringify(parsed),
    }).then((result) => result.task);
  }

  public listTasks(limit = 100): Promise<DaemonTaskRecord[]> {
    const bounded = z.number().int().min(1).max(500).parse(limit);
    return this.requestJson(`/v1/tasks?limit=${bounded}`, TaskListSchema).then(
      (result) => result.tasks,
    );
  }

  public readAudit(limit = 500): Promise<DaemonAuditSnapshot> {
    const bounded = z.number().int().min(1).max(500).parse(limit);
    return this.requestJson(
      `/v1/audit?limit=${bounded}`,
      AuditEnvelopeSchema,
    ).then((result) => ({
      verification: result.verification,
      entries: result.entries,
    }));
  }

  public getTask(id: DaemonTaskId): Promise<DaemonTaskRecord> {
    return this.requestJson(
      `/v1/tasks/${encodeTaskId(id)}`,
      TaskEnvelopeSchema,
    ).then((result) => result.task);
  }

  public cancelTask(id: DaemonTaskId): Promise<DaemonTaskRecord> {
    return this.taskMutation(id, "cancel");
  }

  public resumeTask(id: DaemonTaskId): Promise<DaemonTaskRecord> {
    return this.taskMutation(id, "resume");
  }

  public removeTask(
    id: DaemonTaskId,
  ): Promise<{ id: DaemonTaskId; state: string; attempt: number }> {
    const RemovedSchema = z.object({
      schemaVersion: z.literal(1),
      ok: z.literal(true),
      removed: z.object({
        id: DaemonTaskIdSchema,
        state: z.string().min(1),
        attempt: z.number().int().positive(),
      }),
    });
    return this.requestJson(`/v1/tasks/${encodeTaskId(id)}`, RemovedSchema, {
      method: "DELETE",
    }).then((result) => result.removed);
  }

  public async shutdown(): Promise<void> {
    await this.requestJson(
      "/v1/shutdown",
      z.object({ schemaVersion: z.literal(1), ok: z.literal(true) }),
      { method: "POST", body: "{}" },
    );
  }

  /** Read a bounded replay snapshot without keeping the connection open. */
  public async readEvents(
    id: DaemonTaskId,
    options: DaemonEventReadOptions = {},
  ): Promise<DaemonEventPage> {
    const query = EventReadQuerySchema.parse(options);
    const response = await this.requestRaw(
      `/v1/tasks/${encodeTaskId(id)}/events?after=${query.after}&limit=${query.limit}&follow=false`,
      { headers: { Accept: "text/event-stream" } },
    );
    await assertSuccessfulResponse(response, this.maxResponseBytes);
    const text = await readBoundedText(response, this.maxResponseBytes);
    const events: DaemonEvent[] = [];
    let resyncRequired = false;
    for (const frame of splitSseFrames(text)) {
      if (Buffer.byteLength(frame, "utf8") > MAX_CLIENT_SSE_FRAME_BYTES) {
        throw new Error("Daemon SSE frame exceeds the client limit.");
      }
      const parsed = parseSseFrame(frame);
      if (parsed?.type === "resync_required") {
        resyncRequired = true;
      } else if (parsed && "sequence" in parsed) {
        events.push(DaemonEventSchema.parse(parsed));
      }
    }
    return {
      events,
      resyncRequired,
      ...(events[0] ? { firstSequence: events[0].sequence } : {}),
      ...(events.at(-1) ? { lastSequence: events.at(-1)!.sequence } : {}),
    };
  }

  /** Follow events until the daemon closes the stream at a terminal boundary. */
  public async followEvents(
    id: DaemonTaskId,
    onEvent: (event: DaemonStreamEvent) => void | Promise<void>,
    options: DaemonEventReadOptions & { signal?: AbortSignal } = {},
  ): Promise<void> {
    const query = EventReadQuerySchema.parse(options);
    const response = await this.requestRaw(
      `/v1/tasks/${encodeTaskId(id)}/events?after=${query.after}&limit=${query.limit}&follow=true`,
      { headers: { Accept: "text/event-stream" }, signal: options.signal },
      0,
    );
    await assertSuccessfulResponse(response, this.maxResponseBytes);
    if (!response.body) throw new Error("Daemon event response has no body.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
      const frames = buffer.split("\n\n");
      buffer = done ? "" : (frames.pop() ?? "");
      if (Buffer.byteLength(buffer, "utf8") > MAX_CLIENT_SSE_FRAME_BYTES) {
        await reader.cancel();
        throw new Error("Daemon SSE frame exceeds the client limit.");
      }
      for (const frame of frames) {
        if (Buffer.byteLength(frame, "utf8") > MAX_CLIENT_SSE_FRAME_BYTES) {
          await reader.cancel();
          throw new Error("Daemon SSE frame exceeds the client limit.");
        }
        const parsed = parseSseFrame(frame);
        if (parsed) await onEvent(parsed);
      }
      if (done) return;
    }
  }

  private taskMutation(
    id: DaemonTaskId,
    action: "cancel" | "resume",
  ): Promise<DaemonTaskRecord> {
    return this.requestJson(
      `/v1/tasks/${encodeTaskId(id)}/${action}`,
      TaskEnvelopeSchema,
      { method: "POST", body: "{}" },
    ).then((result) => result.task);
  }

  private async requestJson<T>(
    path: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await this.requestRaw(path, init);
    const text = await readBoundedText(response, this.maxResponseBytes);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Daemon returned invalid JSON.");
    }
    if (!response.ok) {
      const error = DaemonErrorSchema.parse(parsed);
      throw new Error(`${error.error.code}: ${error.error.message}`);
    }
    return schema.parse(parsed);
  }

  private async requestRaw(
    path: string,
    init: RequestInit,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<Response> {
    const timeoutSignal =
      timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
    const signal = timeoutSignal
      ? init.signal
        ? AbortSignal.any([init.signal, timeoutSignal])
        : timeoutSignal
      : init.signal;
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      ...(signal ? { signal } : {}),
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(init.headers ?? {}),
      },
    });
    return response;
  }
}

function encodeTaskId(id: DaemonTaskId): string {
  return encodeURIComponent(DaemonTaskIdSchema.parse(id));
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Daemon response exceeds the client limit.");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

async function assertSuccessfulResponse(
  response: Response,
  maxBytes: number,
): Promise<void> {
  if (response.ok) return;
  const text = await readBoundedText(response, maxBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Daemon request failed with HTTP ${response.status}.`);
  }
  const error = DaemonErrorSchema.safeParse(parsed);
  if (error.success) {
    throw new Error(`${error.data.error.code}: ${error.data.error.message}`);
  }
  throw new Error(`Daemon request failed with HTTP ${response.status}.`);
}

function splitSseFrames(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n\n").filter(Boolean);
}

function parseSseFrame(frame: string): DaemonStreamEvent | undefined {
  const eventName = frame
    .split("\n")
    .find((line) => line.startsWith("event:"))
    ?.slice(6)
    .trim();
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return undefined;
  const parsed = JSON.parse(data) as unknown;
  if (eventName === "resync_required") {
    const taskId = z
      .object({ taskId: DaemonTaskIdSchema })
      .parse(parsed).taskId;
    return { type: "resync_required", taskId };
  }
  return DaemonEventSchema.parse(parsed);
}
