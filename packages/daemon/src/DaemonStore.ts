import { randomBytes } from "crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readdirSync,
  rmSync,
  writeSync,
} from "fs";
import { join, resolve } from "path";
import {
  ensurePrivateDirectory,
  readBoundedRegularFile,
  redactSecrets,
  replacePrivateFileAtomically,
  resolveSafePath,
} from "@orbit-build/shared";
import {
  daemonTaskIdFromRandomBytes,
  DaemonEventSchema,
  DaemonLeaseIdSchema,
  DaemonTaskIdSchema,
  DaemonTaskRecordSchema,
  MAX_DAEMON_EVENT_BYTES,
  MAX_DAEMON_EVENTS,
  MAX_DAEMON_TASKS,
  type DaemonEvent,
  type DaemonEventPage,
  type DaemonLeaseId,
  type DaemonStartTask,
  type DaemonTaskId,
  type DaemonTaskRecord,
  type DaemonTaskState,
  deriveDaemonFailureMetadata,
} from "./DaemonProtocol.js";

const MAX_RECORD_BYTES = 512 * 1024;
const MAX_EVENT_JOURNAL_BYTES = 32 * 1024 * 1024;
const LEASE_MS = 30_000;
const TASK_LOCK_STALE_MS = 30_000;

/** Durable, bounded state for daemon-owned tasks and replayable events. */
export class DaemonStore {
  private readonly tasksDirectory: string;
  private readonly instanceId = `daemon_${randomBytes(16).toString("hex")}`;
  private readonly startedAt = new Date().toISOString();
  private initialized = false;

  public constructor(private readonly rootDirectory: string) {
    this.tasksDirectory = resolve(rootDirectory, "tasks");
  }

  public initialize(): void {
    ensurePrivateDirectory(this.rootDirectory);
    ensurePrivateDirectory(this.tasksDirectory);
    this.assertDirectorySafe(this.rootDirectory);
    this.assertDirectorySafe(this.tasksDirectory);
    this.initialized = true;
    this.markPreviousOwnersOrphaned();
  }

  public getInstanceId(): string {
    return this.instanceId;
  }

  public createTask(input: DaemonStartTask): DaemonTaskRecord {
    this.assertInitialized();
    if (this.readRecords().length >= MAX_DAEMON_TASKS) {
      throw new Error(
        `Daemon task retention limit reached (${MAX_DAEMON_TASKS}); archive or remove completed tasks before starting another.`,
      );
    }
    const now = new Date().toISOString();
    const task = DaemonTaskRecordSchema.parse({
      schemaVersion: 1,
      id: daemonTaskIdFromRandomBytes(randomBytes(16)),
      cwd: resolveSafePath(input.cwd, "."),
      prompt: input.prompt,
      options: input.options,
      state: "queued",
      attempt: 1,
      createdAt: now,
      updatedAt: now,
      eventCount: 0,
    });
    this.writeRecord(task);
    return task;
  }

  public listTasks(limit = 100): DaemonTaskRecord[] {
    this.assertInitialized();
    const boundedLimit = Math.max(1, Math.min(limit, MAX_DAEMON_TASKS));
    return this.readRecords()
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, boundedLimit);
  }

  public getTask(id: DaemonTaskId): DaemonTaskRecord | undefined {
    this.assertInitialized();
    const path = this.recordPath(id);
    if (!existsSync(path)) return undefined;
    const raw = readBoundedRegularFile(path, MAX_RECORD_BYTES);
    if (raw === undefined) return undefined;
    return DaemonTaskRecordSchema.parse(JSON.parse(raw));
  }

  public claimTask(id: DaemonTaskId, pid = process.pid): DaemonTaskRecord {
    return this.withTaskLock(id, () => {
      const task = this.requireTask(id);
      if (task.state !== "queued") {
        throw new Error(`Daemon task ${id} is not queued.`);
      }
      return this.updateTask(task, {
        state: "running",
        startedAt: task.startedAt ?? new Date().toISOString(),
        owner: {
          instanceId: this.instanceId,
          leaseId: `lease_${randomBytes(16).toString("hex")}`,
          pid,
          startedAt: this.startedAt,
          leaseExpiresAt: new Date(Date.now() + LEASE_MS).toISOString(),
        },
      });
    });
  }

  public heartbeat(
    id: DaemonTaskId,
    leaseId?: DaemonLeaseId,
  ): DaemonTaskRecord {
    return this.withTaskLock(id, () => {
      const task = this.requireTask(id);
      if (
        task.state !== "running" ||
        task.owner?.instanceId !== this.instanceId ||
        (leaseId !== undefined && task.owner.leaseId !== leaseId)
      ) {
        return task;
      }
      return this.updateTask(task, {
        owner: {
          ...task.owner,
          leaseExpiresAt: new Date(Date.now() + LEASE_MS).toISOString(),
        },
      });
    });
  }

  public finishTask(
    id: DaemonTaskId,
    state: Extract<
      DaemonTaskState,
      "completed" | "failed" | "aborted" | "canceled"
    >,
    options: {
      exitCode?: number;
      error?: string;
      sessionId?: string;
      ownerLeaseId?: DaemonLeaseId;
    } = {},
  ): DaemonTaskRecord {
    return this.withTaskLock(id, () => {
      const task = this.requireTask(id);
      if (task.state === state) return task;
      if (
        task.state === "running" &&
        (options.ownerLeaseId === undefined ||
          task.owner?.instanceId !== this.instanceId ||
          task.owner.leaseId !== options.ownerLeaseId)
      ) {
        throw new Error(
          `Daemon task ${id} cannot be finished by a stale or missing ownership lease.`,
        );
      }
      if (!["queued", "running", "orphaned"].includes(task.state)) {
        throw new Error(`Daemon task ${id} is already terminal.`);
      }
      return this.updateTask(task, {
        state,
        endedAt: new Date().toISOString(),
        ...(options.exitCode === undefined
          ? {}
          : { exitCode: options.exitCode }),
        ...(options.error
          ? { error: redactSecrets(options.error).slice(0, 4_000) }
          : {}),
        ...deriveDaemonFailureMetadata(state, options),
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
        owner: undefined,
      });
    });
  }

  public cancelTask(id: DaemonTaskId): DaemonTaskRecord {
    return this.withTaskLock(id, () => {
      const task = this.requireTask(id);
      if (["completed", "failed", "aborted", "canceled"].includes(task.state)) {
        return task;
      }
      return this.updateTask(task, {
        state: "canceled",
        endedAt: new Date().toISOString(),
        error: "Canceled by an authenticated daemon client.",
        failureCode: "canceled",
        retryable: false,
        recoveryHint:
          "Canceled explicitly. Resume the task only when you are ready to retry it.",
        owner: undefined,
      });
    });
  }

  public resumeTask(id: DaemonTaskId): DaemonTaskRecord {
    return this.withTaskLock(id, () => {
      const task = this.requireTask(id);
      if (
        task.state === "completed" ||
        task.state === "running" ||
        task.state === "queued"
      ) {
        throw new Error(
          `Daemon task ${id} cannot be resumed from ${task.state}.`,
        );
      }
      return this.updateTask(task, {
        state: "queued",
        attempt: task.attempt + 1,
        updatedAt: new Date().toISOString(),
        startedAt: undefined,
        endedAt: undefined,
        exitCode: undefined,
        error: undefined,
        failureCode: undefined,
        retryable: undefined,
        recoveryHint: undefined,
        owner: undefined,
      });
    });
  }

  /** Validate a lease without extending it; used before side-effect cleanup. */
  public ownsTask(id: DaemonTaskId, leaseId: DaemonLeaseId): boolean {
    const task = this.requireTask(id);
    DaemonLeaseIdSchema.parse(leaseId);
    return (
      task.state === "running" &&
      task.owner?.instanceId === this.instanceId &&
      task.owner.leaseId === leaseId
    );
  }

  /** Remove one explicitly selected terminal task and its bounded journal. */
  public removeTask(id: DaemonTaskId): DaemonTaskRecord {
    return this.withTaskLock(id, () => {
      const task = this.requireTask(id);
      if (
        !["completed", "failed", "aborted", "canceled"].includes(task.state)
      ) {
        throw new Error(
          `Daemon task ${id} cannot be removed from ${task.state}; cancel it first.`,
        );
      }
      rmSync(this.eventsPath(id), { force: true });
      rmSync(this.recordPath(id), { force: true });
      return task;
    });
  }

  public appendEvent(
    id: DaemonTaskId,
    type: string,
    payload: Record<string, unknown> = {},
    ownerLeaseId?: DaemonLeaseId,
  ): DaemonEvent | undefined {
    return this.withTaskLock(id, () => {
      const task = this.requireTask(id);
      if (
        ownerLeaseId !== undefined &&
        (task.state !== "running" ||
          task.owner?.instanceId !== this.instanceId ||
          task.owner.leaseId !== ownerLeaseId)
      ) {
        return undefined;
      }
      if (task.eventCount >= MAX_DAEMON_EVENTS) return undefined;
      const sequence = task.eventCount + 1;
      const normalizedType = type
        .replace(/[^a-z0-9_:-]/gi, "_")
        .toLowerCase()
        .slice(0, 128);
      const event = DaemonEventSchema.parse({
        schemaVersion: 1,
        taskId: id,
        sequence,
        timestamp: new Date().toISOString(),
        type: normalizedType || "daemon_event",
        payload: boundPayload(payload),
      });
      const line = `${JSON.stringify(event)}\n`;
      const path = this.eventsPath(id);
      this.assertEventJournalSafe(path);
      if (!this.appendEventLine(path, line)) {
        return undefined;
      }
      this.updateTask(task, { eventCount: sequence });
      return event;
    });
  }

  public readEvents(id: DaemonTaskId, after = 0, limit = 200): DaemonEventPage {
    this.requireTask(id);
    const path = this.eventsPath(id);
    if (!existsSync(path)) return { events: [], resyncRequired: after > 0 };
    const raw = readBoundedRegularFile(path, MAX_EVENT_JOURNAL_BYTES);
    if (raw === undefined) return { events: [], resyncRequired: true };
    const events = raw
      .split("\n")
      .filter(Boolean)
      .slice(-MAX_DAEMON_EVENTS)
      .map((line) => DaemonEventSchema.parse(JSON.parse(line)));
    const firstSequence = events[0]?.sequence;
    const resyncRequired =
      firstSequence !== undefined && after < firstSequence - 1;
    return {
      events: events
        .filter((event) => event.sequence > after)
        .slice(0, Math.min(limit, 500)),
      ...(firstSequence === undefined ? {} : { firstSequence }),
      ...(events.at(-1) ? { lastSequence: events.at(-1)!.sequence } : {}),
      resyncRequired,
    };
  }

  private markPreviousOwnersOrphaned(): void {
    for (const task of this.readRecords()) {
      if (task.state !== "running") continue;
      try {
        this.withTaskLock(task.id, () => {
          const current = this.requireTask(task.id);
          if (current.state !== "running") return current;
          return this.updateTask(current, {
            state: "orphaned",
            endedAt: new Date().toISOString(),
            error:
              "The owning Orbit daemon stopped renewing its lease; resume explicitly to retry this task.",
            failureCode: "lease_expired",
            retryable: true,
            recoveryHint:
              "The previous daemon stopped renewing its lease. Inspect the workspace, then resume explicitly.",
            owner: undefined,
          });
        });
      } catch {
        // Another daemon is actively claiming or updating the record.
      }
    }
  }

  /**
   * Serialize cross-process transitions with an exclusive lock file. The
   * record itself remains atomically replaced; stale locks are reclaimed only
   * after the bounded transition window, so a crashed daemon cannot wedge the
   * queue forever.
   */
  private withTaskLock<T>(id: DaemonTaskId, operation: () => T): T {
    const lockPath = join(
      this.tasksDirectory,
      `${DaemonTaskIdSchema.parse(id)}.lock`,
    );
    let descriptor: number;
    try {
      descriptor = openSync(
        lockPath,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        try {
          const age = Date.now() - lstatSync(lockPath).mtimeMs;
          if (age > TASK_LOCK_STALE_MS) {
            rmSync(lockPath, { force: true });
            descriptor = openSync(
              lockPath,
              constants.O_CREAT |
                constants.O_EXCL |
                constants.O_WRONLY |
                (constants.O_NOFOLLOW ?? 0),
              0o600,
            );
          } else {
            throw new Error(`Daemon task ${id} is busy in another process.`);
          }
        } catch (staleError: unknown) {
          if (
            staleError instanceof Error &&
            staleError.message.startsWith("Daemon task")
          ) {
            throw staleError;
          }
          throw new Error(`Daemon task ${id} is busy in another process.`);
        }
      } else {
        throw error;
      }
    }
    try {
      return operation();
    } finally {
      closeSync(descriptor);
      rmSync(lockPath, { force: true });
    }
  }

  private readRecords(): DaemonTaskRecord[] {
    const records: DaemonTaskRecord[] = [];
    for (const entry of readdirSync(this.tasksDirectory)) {
      if (!entry.endsWith(".json") || entry.includes("..")) continue;
      const raw = readBoundedRegularFile(
        join(this.tasksDirectory, entry),
        MAX_RECORD_BYTES,
      );
      if (raw === undefined) continue;
      try {
        records.push(DaemonTaskRecordSchema.parse(JSON.parse(raw)));
      } catch {
        // A malformed record is ignored by list; a direct inspect reports it.
      }
    }
    return records;
  }

  private updateTask(
    task: DaemonTaskRecord,
    patch: Partial<DaemonTaskRecord>,
  ): DaemonTaskRecord {
    const updated = DaemonTaskRecordSchema.parse({
      ...task,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    this.writeRecord(updated);
    return updated;
  }

  private writeRecord(task: DaemonTaskRecord): void {
    replacePrivateFileAtomically(
      this.recordPath(task.id),
      `${JSON.stringify(task, null, 2)}\n`,
    );
  }

  private requireTask(id: DaemonTaskId): DaemonTaskRecord {
    DaemonTaskIdSchema.parse(id);
    const task = this.getTask(id);
    if (!task) throw new Error(`Daemon task not found: ${id}`);
    return task;
  }

  private recordPath(id: DaemonTaskId): string {
    const safe = DaemonTaskIdSchema.parse(id);
    return join(this.tasksDirectory, `${safe}.json`);
  }

  private eventsPath(id: DaemonTaskId): string {
    return join(
      this.tasksDirectory,
      `${DaemonTaskIdSchema.parse(id)}.events.jsonl`,
    );
  }

  private assertDirectorySafe(directory: string): void {
    const stats = lstatSync(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(
        `Daemon storage directory is not a regular directory: ${directory}`,
      );
    }
  }

  /** Reject journal symlinks before opening the append descriptor. */
  private assertEventJournalSafe(path: string): void {
    if (!existsSync(path)) return;
    const stats = lstatSync(path);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`Daemon event journal must be a regular file: ${path}`);
    }
  }

  /** Append through one bounded descriptor and fsync the journal line. */
  private appendEventLine(path: string, line: string): boolean {
    const descriptor = openSync(
      path,
      constants.O_APPEND |
        constants.O_CREAT |
        constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      const stats = fstatSync(descriptor);
      if (!stats.isFile()) {
        throw new Error(`Daemon event journal must be a regular file: ${path}`);
      }
      if (stats.size + Buffer.byteLength(line) > MAX_EVENT_JOURNAL_BYTES) {
        return false;
      }
      writeSync(descriptor, line, undefined, "utf8");
      fsyncSync(descriptor);
      return true;
    } finally {
      closeSync(descriptor);
    }
  }

  private assertInitialized(): void {
    if (!this.initialized)
      throw new Error("DaemonStore.initialize() is required before use.");
  }
}

function boundPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  let raw: string;
  try {
    raw = redactSecrets(JSON.stringify(payload));
  } catch {
    return {
      truncated: true,
      summary: "Event payload was not JSON-serializable.",
    };
  }
  if (Buffer.byteLength(raw) <= MAX_DAEMON_EVENT_BYTES)
    return JSON.parse(raw) as Record<string, unknown>;
  return {
    truncated: true,
    summary: raw.slice(0, MAX_DAEMON_EVENT_BYTES - 64),
  };
}
