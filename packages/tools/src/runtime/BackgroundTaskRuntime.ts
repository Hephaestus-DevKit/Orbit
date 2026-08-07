import { execFile, spawn, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import {
  HIDDEN_CHILD_PROCESS_OPTIONS,
  redactSecrets,
  resolveSafePath,
} from "@orbit-build/shared";
import { resolveCommandShellInvocation } from "../shell/commandShell.js";

export type BackgroundTaskStatus =
  | "running"
  | "completed"
  | "failed"
  | "killed"
  | "timed_out";

export interface BackgroundTaskSnapshot {
  id: string;
  sessionId: string;
  command: string;
  cwd: string;
  status: BackgroundTaskStatus;
  startedAt: string;
  endedAt?: string;
  durationMs: number;
  exitCode: number | null;
  signal?: string;
  stdout: string;
  stderr: string;
  outputBytes: number;
  droppedOutputBytes: number;
  outputTruncated: boolean;
}

export type BackgroundTaskSummary = Omit<
  BackgroundTaskSnapshot,
  "command" | "cwd" | "stdout" | "stderr"
>;

export interface StartBackgroundCommandRequest {
  command: string;
  cwd: string;
  sessionId: string;
  timeoutMs?: number;
}

export interface BackgroundTaskQuery {
  taskIds?: string[];
  waitMs?: number;
  waitFor?: "any" | "all";
}

export type BackgroundTaskLifecycleEvent =
  | { type: "started"; task: BackgroundTaskSnapshot }
  | { type: "completed"; task: BackgroundTaskSnapshot };

export interface BackgroundTaskRuntimeOptions {
  workspaceRoot: string;
  maxConcurrentTasks?: number;
  maxRetainedTasks?: number;
  maxOutputBytes?: number;
  terminateGraceMs?: number;
  onEvent?(event: BackgroundTaskLifecycleEvent): void;
}

export interface BackgroundTaskService {
  startCommand(
    request: StartBackgroundCommandRequest,
  ): Promise<BackgroundTaskSnapshot>;
  getTasks(
    sessionId: string,
    query?: BackgroundTaskQuery,
    abortSignal?: AbortSignal,
  ): Promise<BackgroundTaskSnapshot[]>;
  listTasks(sessionId: string): BackgroundTaskSnapshot[];
  listTaskSummaries(sessionId: string): BackgroundTaskSummary[];
  listWorkspaceTaskSummaries(): BackgroundTaskSummary[];
  killTask(sessionId: string, taskId: string): Promise<BackgroundTaskSnapshot>;
  drainNotifications(sessionId: string): BackgroundTaskSnapshot[];
  cancelSession(sessionId: string): void;
  dispose(): Promise<void>;
}

interface OutputChunk {
  stream: "stdout" | "stderr";
  data: Buffer;
}

interface ManagedBackgroundTask {
  id: string;
  sequence: number;
  sessionId: string;
  command: string;
  cwd: string;
  status: BackgroundTaskStatus;
  startedAt: number;
  endedAt?: number;
  exitCode: number | null;
  signal?: string;
  child: ChildProcess;
  chunks: OutputChunk[];
  outputBytes: number;
  droppedOutputBytes: number;
  requestedStop?: "killed" | "timed_out";
  timeout?: ReturnType<typeof setTimeout>;
  completion: Promise<void>;
  resolveCompletion(): void;
}

const DEFAULT_MAX_CONCURRENT_TASKS = 8;
const DEFAULT_MAX_RETAINED_TASKS = 64;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_TERMINATE_GRACE_MS = 2_000;
const MAX_WAIT_MS = 30_000;

/**
 * Owns workspace command processes independently from the agent loop.
 *
 * The runtime keeps output bounded, scopes task access to a session, reaps
 * process trees on shutdown, and exposes lifecycle snapshots to tools and UIs.
 */
export class BackgroundTaskRuntime implements BackgroundTaskService {
  private readonly tasks = new Map<string, ManagedBackgroundTask>();
  private readonly notifications = new Map<string, BackgroundTaskSnapshot[]>();
  private readonly maxConcurrentTasks: number;
  private readonly maxRetainedTasks: number;
  private readonly maxOutputBytes: number;
  private readonly terminateGraceMs: number;
  private readonly workspaceRoot: string;
  private readonly onEvent?: BackgroundTaskRuntimeOptions["onEvent"];
  private nextTaskSequence = 0;
  private disposed = false;

  public constructor(options: BackgroundTaskRuntimeOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.maxConcurrentTasks = clampInteger(
      options.maxConcurrentTasks,
      1,
      32,
      DEFAULT_MAX_CONCURRENT_TASKS,
    );
    this.maxRetainedTasks = clampInteger(
      options.maxRetainedTasks,
      this.maxConcurrentTasks,
      256,
      DEFAULT_MAX_RETAINED_TASKS,
    );
    this.maxOutputBytes = clampInteger(
      options.maxOutputBytes,
      16 * 1024,
      16 * 1024 * 1024,
      DEFAULT_MAX_OUTPUT_BYTES,
    );
    this.terminateGraceMs = clampInteger(
      options.terminateGraceMs,
      100,
      30_000,
      DEFAULT_TERMINATE_GRACE_MS,
    );
    this.onEvent = options.onEvent;
  }

  public async startCommand(
    request: StartBackgroundCommandRequest,
  ): Promise<BackgroundTaskSnapshot> {
    if (this.disposed) {
      throw new Error("Background task runtime is already disposed.");
    }
    const activeCount = [...this.tasks.values()].filter(
      (task) => task.status === "running",
    ).length;
    if (activeCount >= this.maxConcurrentTasks) {
      throw new Error(
        `Background task limit reached (${this.maxConcurrentTasks}). Stop an active task before starting another.`,
      );
    }
    if (!request.command.trim() || request.command.length > 100_000) {
      throw new Error(
        "Background command must contain 1 to 100000 characters.",
      );
    }
    if (!request.sessionId.trim() || request.sessionId.length > 256) {
      throw new Error("Background task session id is invalid.");
    }
    const safeCwd = resolveSafePath(this.workspaceRoot, request.cwd);
    this.pruneRetainedTasks();

    const id = `bg_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const startedAt = Date.now();
    let child: ChildProcess;
    try {
      const invocation = resolveCommandShellInvocation(request.command);
      child = spawn(invocation.file, invocation.args, {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        cwd: safeCwd,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error: unknown) {
      throw new Error(
        `Unable to start background command: ${errorMessage(error)}`,
      );
    }

    let resolveCompletion = (): void => undefined;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    const task: ManagedBackgroundTask = {
      id,
      sequence: ++this.nextTaskSequence,
      sessionId: request.sessionId,
      command: request.command,
      cwd: safeCwd,
      status: "running",
      startedAt,
      exitCode: null,
      child,
      chunks: [],
      outputBytes: 0,
      droppedOutputBytes: 0,
      completion,
      resolveCompletion,
    };
    this.tasks.set(id, task);

    child.stdout?.on("data", (data: Buffer | string) => {
      this.appendOutput(task, "stdout", data);
    });
    child.stderr?.on("data", (data: Buffer | string) => {
      this.appendOutput(task, "stderr", data);
    });
    child.once("error", (error) => {
      this.appendOutput(task, "stderr", `${errorMessage(error)}\n`);
      this.settleTask(task, "failed", null);
    });
    child.once("close", (exitCode, signal) => {
      const status =
        task.requestedStop ?? (exitCode === 0 ? "completed" : "failed");
      this.settleTask(task, status, exitCode, signal || undefined);
    });

    const timeoutMs = normalizeOptionalTimeout(request.timeoutMs);
    if (timeoutMs !== undefined) {
      task.timeout = setTimeout(() => {
        void this.terminateTask(task, "timed_out").catch((error: unknown) => {
          this.appendOutput(
            task,
            "stderr",
            `\nOrbit could not confirm timeout termination: ${errorMessage(error)}\n`,
          );
        });
      }, timeoutMs);
      task.timeout.unref?.();
    }

    const snapshot = this.snapshot(task);
    this.emitLifecycle({ type: "started", task: snapshot });
    return snapshot;
  }

  public async getTasks(
    sessionId: string,
    query: BackgroundTaskQuery = {},
    abortSignal?: AbortSignal,
  ): Promise<BackgroundTaskSnapshot[]> {
    const selected = this.selectTasks(sessionId, query.taskIds);
    const waitMs = clampInteger(query.waitMs, 0, MAX_WAIT_MS, 0);
    if (waitMs > 0 && selected.some((task) => task.status === "running")) {
      const active = selected.filter((task) => task.status === "running");
      const waitPromise =
        query.waitFor === "any"
          ? Promise.race(active.map((task) => task.completion))
          : Promise.all(active.map((task) => task.completion)).then(
              () => undefined,
            );
      await waitWithTimeout(waitPromise, waitMs, abortSignal);
    }
    return selected.map((task) => this.snapshot(task));
  }

  public listTasks(sessionId: string): BackgroundTaskSnapshot[] {
    return [...this.tasks.values()]
      .filter((task) => task.sessionId === sessionId)
      .sort(compareNewestTask)
      .map((task) => this.snapshot(task));
  }

  /** List task metadata without materializing retained process output. */
  public listTaskSummaries(sessionId: string): BackgroundTaskSummary[] {
    return [...this.tasks.values()]
      .filter((task) => task.sessionId === sessionId)
      .sort(compareNewestTask)
      .map((task) => this.summary(task));
  }

  /** Return metadata-only task state across sessions in this workspace runtime. */
  public listWorkspaceTaskSummaries(): BackgroundTaskSummary[] {
    return [...this.tasks.values()]
      .sort(compareNewestTask)
      .map((task) => this.summary(task));
  }

  public async killTask(
    sessionId: string,
    taskId: string,
  ): Promise<BackgroundTaskSnapshot> {
    const task = this.requireTask(sessionId, taskId);
    if (task.status === "running") {
      await this.terminateTask(task, "killed");
    }
    return this.snapshot(task);
  }

  public drainNotifications(sessionId: string): BackgroundTaskSnapshot[] {
    const notifications = this.notifications.get(sessionId) ?? [];
    this.notifications.delete(sessionId);
    return notifications;
  }

  public cancelSession(sessionId: string): void {
    for (const task of this.tasks.values()) {
      if (task.sessionId === sessionId && task.status === "running") {
        void this.terminateTask(task, "killed").catch(() => {
          // Session switching must remain synchronous; dispose retries later.
        });
      }
    }
  }

  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await Promise.allSettled(
      [...this.tasks.values()]
        .filter((task) => task.status === "running")
        .map((task) => this.terminateTask(task, "killed")),
    );
  }

  private selectTasks(
    sessionId: string,
    taskIds?: string[],
  ): ManagedBackgroundTask[] {
    if (!taskIds || taskIds.length === 0) {
      return [...this.tasks.values()]
        .filter((task) => task.sessionId === sessionId)
        .sort(compareNewestTask);
    }
    return taskIds.map((taskId) => this.requireTask(sessionId, taskId));
  }

  private requireTask(
    sessionId: string,
    taskId: string,
  ): ManagedBackgroundTask {
    const task = this.tasks.get(taskId);
    if (!task || task.sessionId !== sessionId) {
      throw new Error(`Background task not found in this session: ${taskId}`);
    }
    return task;
  }

  private appendOutput(
    task: ManagedBackgroundTask,
    stream: OutputChunk["stream"],
    value: Buffer | string,
  ): void {
    if (task.status !== "running") return;
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
    if (data.length === 0) return;
    task.chunks.push({ stream, data });
    task.outputBytes += data.length;

    while (task.outputBytes > this.maxOutputBytes && task.chunks.length > 0) {
      const excess = task.outputBytes - this.maxOutputBytes;
      const first = task.chunks[0];
      if (first.data.length <= excess) {
        task.chunks.shift();
        task.outputBytes -= first.data.length;
        task.droppedOutputBytes += first.data.length;
      } else {
        first.data = first.data.subarray(excess);
        task.outputBytes -= excess;
        task.droppedOutputBytes += excess;
      }
    }
  }

  private snapshot(task: ManagedBackgroundTask): BackgroundTaskSnapshot {
    const stdout = Buffer.concat(
      task.chunks
        .filter((chunk) => chunk.stream === "stdout")
        .map((chunk) => chunk.data),
    ).toString("utf8");
    const stderr = Buffer.concat(
      task.chunks
        .filter((chunk) => chunk.stream === "stderr")
        .map((chunk) => chunk.data),
    ).toString("utf8");
    const endedAt = task.endedAt;
    return {
      id: task.id,
      sessionId: task.sessionId,
      command: redactSecrets(task.command),
      cwd: task.cwd,
      status: task.status,
      startedAt: new Date(task.startedAt).toISOString(),
      ...(endedAt ? { endedAt: new Date(endedAt).toISOString() } : {}),
      durationMs: Math.max(0, (endedAt ?? Date.now()) - task.startedAt),
      exitCode: task.exitCode,
      ...(task.signal ? { signal: task.signal } : {}),
      stdout: redactSecrets(stdout),
      stderr: redactSecrets(stderr),
      outputBytes: task.outputBytes,
      droppedOutputBytes: task.droppedOutputBytes,
      outputTruncated: task.droppedOutputBytes > 0,
    };
  }

  private summary(task: ManagedBackgroundTask): BackgroundTaskSummary {
    const endedAt = task.endedAt;
    return {
      id: task.id,
      sessionId: task.sessionId,
      status: task.status,
      startedAt: new Date(task.startedAt).toISOString(),
      ...(endedAt === undefined
        ? {}
        : { endedAt: new Date(endedAt).toISOString() }),
      durationMs: Math.max(0, (endedAt ?? Date.now()) - task.startedAt),
      exitCode: task.exitCode,
      ...(task.signal ? { signal: task.signal } : {}),
      outputBytes: task.outputBytes,
      droppedOutputBytes: task.droppedOutputBytes,
      outputTruncated: task.droppedOutputBytes > 0,
    };
  }

  private settleTask(
    task: ManagedBackgroundTask,
    status: Exclude<BackgroundTaskStatus, "running">,
    exitCode: number | null,
    signal?: string,
  ): void {
    if (task.status !== "running") return;
    task.status = status;
    task.exitCode = exitCode;
    task.signal = signal;
    task.endedAt = Date.now();
    if (task.timeout) clearTimeout(task.timeout);
    task.resolveCompletion();
    const pending = this.notifications.get(task.sessionId) ?? [];
    pending.push(this.snapshot(task));
    this.notifications.set(task.sessionId, pending.slice(-64));
    this.emitLifecycle({ type: "completed", task: this.snapshot(task) });
  }

  private async terminateTask(
    task: ManagedBackgroundTask,
    status: "killed" | "timed_out",
  ): Promise<void> {
    if (task.status !== "running") return;
    task.requestedStop = status;
    const gracefulSignalConfirmed = await signalProcessTree(task.child, false);
    if (await waitWithTimeout(task.completion, this.terminateGraceMs)) return;
    const forcedSignalConfirmed = await signalProcessTree(task.child, true);
    if (await waitWithTimeout(task.completion, this.terminateGraceMs)) return;
    if (
      task.status === "running" &&
      (task.child.exitCode !== null || task.child.signalCode !== null)
    ) {
      this.settleTask(
        task,
        status,
        task.child.exitCode,
        task.child.signalCode || undefined,
      );
      return;
    }
    if (
      process.platform === "win32" &&
      task.status === "running" &&
      (gracefulSignalConfirmed || forcedSignalConfirmed)
    ) {
      // taskkill reports success only after accepting termination for the tree.
      // Under heavy event-loop load, Node's child "close" event can arrive late.
      this.settleTask(task, status, task.child.exitCode);
      return;
    }
    throw new Error(
      `Background task ${task.id} did not exit after graceful and forced termination.`,
    );
  }

  private emitLifecycle(event: BackgroundTaskLifecycleEvent): void {
    try {
      this.onEvent?.(event);
    } catch {
      // Observability must never change process lifecycle behavior.
    }
  }

  private pruneRetainedTasks(): void {
    if (this.tasks.size < this.maxRetainedTasks) return;
    const terminal = [...this.tasks.values()]
      .filter((task) => task.status !== "running")
      .sort(compareOldestTask);
    while (this.tasks.size >= this.maxRetainedTasks && terminal.length > 0) {
      const task = terminal.shift();
      if (task) this.tasks.delete(task.id);
    }
    if (this.tasks.size >= this.maxRetainedTasks) {
      throw new Error(
        `Background task retention limit reached (${this.maxRetainedTasks}).`,
      );
    }
  }
}

function compareNewestTask(
  left: ManagedBackgroundTask,
  right: ManagedBackgroundTask,
): number {
  return right.startedAt - left.startedAt || right.sequence - left.sequence;
}

function compareOldestTask(
  left: ManagedBackgroundTask,
  right: ManagedBackgroundTask,
): number {
  return left.startedAt - right.startedAt || left.sequence - right.sequence;
}

async function signalProcessTree(
  child: ChildProcess,
  force: boolean,
): Promise<boolean> {
  const pid = child.pid;
  if (!pid) return false;
  if (process.platform === "win32") {
    return new Promise<boolean>((resolve) => {
      execFile(
        "taskkill.exe",
        ["/pid", String(pid), "/t", ...(force ? ["/f"] : [])],
        HIDDEN_CHILD_PROCESS_OPTIONS,
        (error) => resolve(error === null),
      );
    });
  }
  try {
    process.kill(-pid, force ? "SIGKILL" : "SIGTERM");
    return true;
  } catch {
    try {
      return child.kill(force ? "SIGKILL" : "SIGTERM");
    } catch {
      // The task may have completed between the status check and the signal.
      return false;
    }
  }
}

async function waitWithTimeout(
  promise: Promise<unknown>,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
        timeout.unref?.();
      }),
      new Promise<boolean>((resolve) => {
        if (!abortSignal) return;
        if (abortSignal.aborted) {
          resolve(false);
          return;
        }
        abortListener = () => resolve(false);
        abortSignal.addEventListener("abort", abortListener, { once: true });
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (abortListener) {
      abortSignal?.removeEventListener("abort", abortListener);
    }
  }
}

function normalizeOptionalTimeout(
  value: number | undefined,
): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.max(1_000, Math.min(24 * 60 * 60 * 1_000, Math.floor(value)));
}

function clampInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

function errorMessage(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error))
    .replace(/[\r\n]+/g, " ")
    .slice(0, 2_000);
}
