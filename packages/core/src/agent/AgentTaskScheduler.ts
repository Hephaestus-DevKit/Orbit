import { z } from "zod";
import {
  AgentTaskAccessSchema,
  agentOwnershipScopesOverlap,
} from "./AgentOwnership.js";

const AgentTaskGraphSchema = z
  .array(
    z.object({
      id: z.string().min(1).max(128),
      dependsOn: z.array(z.string().min(1).max(128)).max(64).default([]),
      access: AgentTaskAccessSchema.optional(),
    }),
  )
  .max(128)
  .superRefine((tasks, context) => {
    const ids = new Set<string>();
    for (const [index, task] of tasks.entries()) {
      if (ids.has(task.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "id"],
          message: `Duplicate task id: ${task.id}`,
        });
      }
      ids.add(task.id);
    }
    for (const [index, task] of tasks.entries()) {
      for (const dependency of task.dependsOn) {
        if (!ids.has(dependency)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "dependsOn"],
            message: `Unknown dependency: ${dependency}`,
          });
        }
      }
    }
  });

export interface AgentTaskAccess {
  mode: "read" | "write";
  /** Normalized logical ownership scopes. `*` conflicts with every scope. */
  scopes: string[];
}

export interface AgentTask<T> {
  id: string;
  dependsOn?: string[];
  timeoutMs?: number;
  access?: AgentTaskAccess;
  run(signal: AbortSignal): Promise<T>;
}

export type AgentTaskResult<T> =
  | { id: string; status: "completed"; value: T }
  | { id: string; status: "failed"; error: Error }
  | { id: string; status: "blocked"; error: Error }
  | { id: string; status: "aborted"; error: Error };

export interface AgentTaskSchedulerOptions {
  maxConcurrency?: number;
  /** Time allowed for a task to cooperate with cancellation after timeout. */
  abortGraceMs?: number;
}

/**
 * Runs a bounded task DAG with dependency, timeout, cancellation and workspace
 * ownership controls. Tasks that can mutate an overlapping scope never run in
 * parallel; independent read-only reviewers can fan out safely.
 */
export class AgentTaskScheduler {
  private readonly controller = new AbortController();
  private readonly maxConcurrency: number;
  private readonly abortGraceMs: number;
  private state: "idle" | "running" | "finished" = "idle";

  public constructor(options: AgentTaskSchedulerOptions = {}) {
    this.maxConcurrency = Math.max(
      1,
      Math.min(16, Math.floor(options.maxConcurrency ?? 2)),
    );
    this.abortGraceMs = Math.max(
      100,
      Math.min(30_000, Math.floor(options.abortGraceMs ?? 5_000)),
    );
  }

  public abort(reason = "Agent task scheduling was aborted."): void {
    if (!this.controller.signal.aborted) {
      this.controller.abort(new Error(reason));
    }
  }

  public async run<T>(tasks: AgentTask<T>[]): Promise<AgentTaskResult<T>[]> {
    if (this.state !== "idle") {
      throw new Error("AgentTaskScheduler instances can only run once.");
    }
    AgentTaskGraphSchema.parse(
      tasks.map((task) => ({
        id: task.id,
        dependsOn: task.dependsOn ?? [],
        access: task.access,
      })),
    );
    this.state = "running";
    try {
      return await this.runGraph(tasks);
    } finally {
      this.state = "finished";
    }
  }

  private async runGraph<T>(
    tasks: AgentTask<T>[],
  ): Promise<AgentTaskResult<T>[]> {
    const pending = new Map(tasks.map((task) => [task.id, task]));
    const running = new Map<
      string,
      { task: AgentTask<T>; promise: Promise<AgentTaskResult<T>> }
    >();
    const results = new Map<string, AgentTaskResult<T>>();

    while (pending.size > 0 || running.size > 0) {
      if (this.controller.signal.aborted) {
        for (const task of pending.values()) {
          results.set(task.id, {
            id: task.id,
            status: "aborted",
            error: abortError(this.controller.signal),
          });
        }
        pending.clear();
      }

      this.blockFailedDependents(pending, results);
      let launched = false;
      for (const task of pending.values()) {
        if (running.size >= this.maxConcurrency) break;
        if (!dependenciesCompleted(task, results)) continue;
        if (
          [...running.values()].some(({ task: active }) =>
            conflicts(task, active),
          )
        ) {
          continue;
        }
        pending.delete(task.id);
        running.set(task.id, { task, promise: this.runTask(task) });
        launched = true;
      }

      if (running.size === 0) {
        if (pending.size === 0) break;
        const cycle = [...pending.keys()].join(", ");
        for (const task of pending.values()) {
          results.set(task.id, {
            id: task.id,
            status: "blocked",
            error: new Error(`Task dependency cycle or deadlock: ${cycle}`),
          });
        }
        pending.clear();
        break;
      }

      if (
        !launched ||
        running.size >= this.maxConcurrency ||
        pending.size === 0
      ) {
        const settled = await Promise.race(
          [...running.values()].map(({ promise }) => promise),
        );
        running.delete(settled.id);
        results.set(settled.id, settled);
      }
    }

    return tasks.map((task) => {
      const result = results.get(task.id);
      if (!result) throw new Error(`Task result missing: ${task.id}`);
      return result;
    });
  }

  private blockFailedDependents<T>(
    pending: Map<string, AgentTask<T>>,
    results: Map<string, AgentTaskResult<T>>,
  ): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const task of pending.values()) {
        const failedDependency = (task.dependsOn ?? []).find((dependency) => {
          const result = results.get(dependency);
          return result && result.status !== "completed";
        });
        if (!failedDependency) continue;
        pending.delete(task.id);
        results.set(task.id, {
          id: task.id,
          status: "blocked",
          error: new Error(`Dependency did not complete: ${failedDependency}`),
        });
        changed = true;
      }
    }
  }

  private async runTask<T>(task: AgentTask<T>): Promise<AgentTaskResult<T>> {
    const taskController = new AbortController();
    const signal = AbortSignal.any([
      this.controller.signal,
      taskController.signal,
    ]);
    const timeoutMs = Math.max(
      1_000,
      Math.min(3_600_000, Math.floor(task.timeoutMs ?? 600_000)),
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutResult = new Promise<AgentTaskResult<T>>((resolve) => {
      timeout = setTimeout(() => {
        const error = new Error(`Agent task timed out after ${timeoutMs}ms.`);
        taskController.abort(error);
        this.abort(
          `Agent task ${task.id} timed out; the remaining task graph was cancelled.`,
        );
        resolve({ id: task.id, status: "failed", error });
      }, timeoutMs);
    });
    const runResult: Promise<AgentTaskResult<T>> = Promise.resolve()
      .then(() => task.run(signal))
      .then<AgentTaskResult<T>>((value) => ({
        id: task.id,
        status: "completed",
        value,
      }))
      .catch((error: unknown): AgentTaskResult<T> => {
        return {
          id: task.id,
          status: signal.aborted ? "aborted" : "failed",
          error: toError(error),
        };
      });
    try {
      const result = await Promise.race([runResult, timeoutResult]);
      if (result.status !== "failed" || !taskController.signal.aborted) {
        return result;
      }

      // Give cooperative tasks a bounded window to stop before returning the
      // graph result. No further tasks are launched after a timeout because
      // the scheduler-level signal above is also aborted.
      let graceTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          runResult.then(() => undefined),
          new Promise<void>((resolve) => {
            graceTimer = setTimeout(resolve, this.abortGraceMs);
            graceTimer.unref?.();
          }),
        ]);
      } finally {
        if (graceTimer) clearTimeout(graceTimer);
      }
      return result;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

function dependenciesCompleted<T>(
  task: AgentTask<T>,
  results: Map<string, AgentTaskResult<T>>,
): boolean {
  return (task.dependsOn ?? []).every(
    (dependency) => results.get(dependency)?.status === "completed",
  );
}

function conflicts<T>(left: AgentTask<T>, right: AgentTask<T>): boolean {
  const leftAccess = left.access ?? { mode: "read" as const, scopes: ["*"] };
  const rightAccess = right.access ?? { mode: "read" as const, scopes: ["*"] };
  if (leftAccess.mode === "read" && rightAccess.mode === "read") return false;
  return leftAccess.scopes.some((leftScope) =>
    rightAccess.scopes.some((rightScope) =>
      agentOwnershipScopesOverlap(leftScope, rightScope),
    ),
  );
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Agent task scheduling was aborted.");
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
