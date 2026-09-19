import {
  BackgroundTaskRuntime,
  type BackgroundTaskSnapshot,
  type StartBackgroundCommandRequest,
} from "@orbit-build/tools";

/** Own a hook's process tree until success, failure, timeout or cancellation has settled. */
export async function executeManagedHookProcess(
  request: StartBackgroundCommandRequest,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  signal?.throwIfAborted();
  const runtime = new BackgroundTaskRuntime({ workspaceRoot: request.cwd });
  let task: BackgroundTaskSnapshot | undefined;
  try {
    task = await runtime.startCommand({
      ...request,
      notifyOnCompletion: false,
    });
    while (task.status === "running") {
      signal?.throwIfAborted();
      [task] = await runtime.getTasks(
        request.sessionId,
        { taskIds: [task.id], waitMs: 1000 },
        signal,
      );
    }
    signal?.throwIfAborted();
    if (task.status !== "completed" || task.exitCode !== 0) {
      throw Object.assign(
        new Error(`Hook process ${task.status} (exit ${task.exitCode}).`),
        {
          stdout: task.stdout,
          stderr: task.stderr,
        },
      );
    }
    return { stdout: task.stdout, stderr: task.stderr };
  } finally {
    try {
      if (task?.status === "running")
        await runtime.killTask(request.sessionId, task.id);
    } finally {
      await runtime.dispose();
    }
  }
}
