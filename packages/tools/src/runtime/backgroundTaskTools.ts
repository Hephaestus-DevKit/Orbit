import { z } from "zod";
import { LogTruncator } from "@orbit-build/shared";
import type { OrbitTool, ToolContext, ToolResult } from "../types.js";
import type {
  BackgroundTaskSnapshot,
  BackgroundTaskSummary,
} from "./BackgroundTaskRuntime.js";

const TaskIdSchema = z.string().regex(/^bg_[a-f0-9]{16}$/);

export const GetBackgroundTaskOutputInputSchema = z.object({
  taskIds: z.array(TaskIdSchema).min(1).max(20),
  waitMs: z.number().int().min(0).max(30_000).optional(),
  waitFor: z.enum(["any", "all"]).optional(),
});

export const KillBackgroundTaskInputSchema = z.object({
  taskId: TaskIdSchema,
});

export const ListBackgroundTasksInputSchema = z.object({}).strict();

export class GetBackgroundTaskOutputTool implements OrbitTool<
  z.infer<typeof GetBackgroundTaskOutputInputSchema>,
  BackgroundTaskSnapshot[]
> {
  public readonly name = "get_background_task_output";
  public readonly description =
    "Get bounded output and status for one or more background tasks. Set waitMs to wait briefly for any or all tasks without polling or sleeping.";
  public readonly inputSchema = GetBackgroundTaskOutputInputSchema;
  public readonly risk = "read" as const;

  public async execute(
    input: z.infer<typeof GetBackgroundTaskOutputInputSchema>,
    ctx: ToolContext,
  ): Promise<ToolResult<BackgroundTaskSnapshot[]>> {
    const runtime = ctx.services?.backgroundTasks;
    if (!runtime) return unavailableResult();
    try {
      const tasks = await runtime.getTasks(
        ctx.sessionId,
        {
          taskIds: input.taskIds,
          waitMs: input.waitMs,
          waitFor: input.waitFor ?? "all",
        },
        ctx.abortSignal,
      );
      const compact = compactSnapshots(tasks);
      return {
        ok: true,
        data: compact,
        display: compact.map(formatSnapshot).join("\n\n"),
      };
    } catch (error: unknown) {
      return failureResult(error);
    }
  }
}

export class KillBackgroundTaskTool implements OrbitTool<
  z.infer<typeof KillBackgroundTaskInputSchema>,
  BackgroundTaskSnapshot
> {
  public readonly name = "kill_background_task";
  public readonly description =
    "Terminate a background task and its process tree. This is idempotent when the task has already finished.";
  public readonly inputSchema = KillBackgroundTaskInputSchema;
  public readonly risk = "execute" as const;

  public async execute(
    input: z.infer<typeof KillBackgroundTaskInputSchema>,
    ctx: ToolContext,
  ): Promise<ToolResult<BackgroundTaskSnapshot>> {
    const runtime = ctx.services?.backgroundTasks;
    if (!runtime) return unavailableResult();
    try {
      const task = await runtime.killTask(ctx.sessionId, input.taskId);
      const compact = compactSnapshot(task, 8_000);
      return {
        ok: true,
        data: compact,
        display: formatSnapshot(compact),
      };
    } catch (error: unknown) {
      return failureResult(error);
    }
  }
}

export class ListBackgroundTasksTool implements OrbitTool<
  Record<string, never>,
  BackgroundTaskSummary[]
> {
  public readonly name = "list_background_tasks";
  public readonly description =
    "List background tasks owned by the current session, including recent completed and failed tasks.";
  public readonly inputSchema = ListBackgroundTasksInputSchema;
  public readonly risk = "read" as const;

  public async execute(
    _input: Record<string, never>,
    ctx: ToolContext,
  ): Promise<ToolResult<BackgroundTaskSummary[]>> {
    const runtime = ctx.services?.backgroundTasks;
    if (!runtime) return unavailableResult();
    const summaries = runtime.listTaskSummaries(ctx.sessionId);
    return {
      ok: true,
      data: summaries,
      display:
        summaries.length > 0
          ? summaries.map(formatSummary).join("\n")
          : "No background tasks in this session.",
    };
  }
}

function formatSummary(task: BackgroundTaskSummary): string {
  return `${task.id} · ${task.status} · ${task.durationMs}ms${
    task.exitCode === null ? "" : ` · exit ${task.exitCode}`
  }${task.outputTruncated ? " · output truncated" : ""}`;
}

function compactSnapshots(
  tasks: BackgroundTaskSnapshot[],
): BackgroundTaskSnapshot[] {
  const perStreamChars = Math.max(
    500,
    Math.floor(16_000 / Math.max(1, tasks.length * 2)),
  );
  return tasks.map((task) => compactSnapshot(task, perStreamChars));
}

function compactSnapshot(
  task: BackgroundTaskSnapshot,
  maxChars: number,
): BackgroundTaskSnapshot {
  const stdout = LogTruncator.truncate(task.stdout, 150, maxChars);
  const stderr = LogTruncator.truncate(task.stderr, 150, maxChars);
  return {
    ...task,
    stdout,
    stderr,
    outputTruncated:
      task.outputTruncated ||
      stdout.length !== task.stdout.length ||
      stderr.length !== task.stderr.length,
  };
}

function formatSnapshot(task: BackgroundTaskSnapshot): string {
  return [
    `${task.id} · ${task.status} · ${task.durationMs}ms${task.exitCode === null ? "" : ` · exit ${task.exitCode}`}`,
    task.stdout ? `Stdout:\n${task.stdout}` : "",
    task.stderr ? `Stderr:\n${task.stderr}` : "",
    task.outputTruncated
      ? `Output truncated for this response${task.droppedOutputBytes > 0 ? `; the runtime discarded ${task.droppedOutputBytes} earlier byte(s)` : ""}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function unavailableResult(): ToolResult<never> {
  return {
    ok: false,
    error: "Background task runtime is unavailable in this execution mode.",
  };
}

function failureResult(error: unknown): ToolResult<never> {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
}
