import { afterEach, describe, expect, it, vi } from "vitest";
import path from "path";
import { performance } from "perf_hooks";
import { BackgroundTaskRuntime } from "./BackgroundTaskRuntime.js";

const runtimes: BackgroundTaskRuntime[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});

describe("BackgroundTaskRuntime", () => {
  it("returns immediately and captures a completed command", async () => {
    const runtime = track(
      new BackgroundTaskRuntime({ workspaceRoot: process.cwd() }),
    );
    const startedAt = performance.now();
    const started = await runtime.startCommand({
      command: nodeCommand("setTimeout(() => console.log('ready'), 5000)"),
      cwd: process.cwd(),
      sessionId: "session-a",
    });

    expect(started.status).toBe("running");
    expect(performance.now() - startedAt).toBeLessThan(4_000);

    const [completed] = await runtime.getTasks("session-a", {
      taskIds: [started.id],
      waitMs: 10_000,
    });
    expect(completed).toMatchObject({
      status: "completed",
      exitCode: 0,
    });
    expect(completed.stdout).toContain("ready");
  });

  it("bounds retained output and reports dropped bytes", async () => {
    const runtime = track(
      new BackgroundTaskRuntime({
        workspaceRoot: process.cwd(),
        maxOutputBytes: 16 * 1024,
      }),
    );
    const started = await runtime.startCommand({
      command: nodeCommand("process.stdout.write('x'.repeat(40000))"),
      cwd: process.cwd(),
      sessionId: "session-a",
    });

    const [completed] = await runtime.getTasks("session-a", {
      taskIds: [started.id],
      waitMs: 2_000,
    });
    expect(completed.status).toBe("completed");
    expect(Buffer.byteLength(completed.stdout, "utf8")).toBeLessThanOrEqual(
      16 * 1024,
    );
    expect(completed.outputTruncated).toBe(true);
    expect(completed.droppedOutputBytes).toBeGreaterThan(0);
  });

  it("lists lightweight metadata without command or retained output", async () => {
    const runtime = track(
      new BackgroundTaskRuntime({ workspaceRoot: process.cwd() }),
    );
    const started = await runtime.startCommand({
      command: nodeCommand("console.log('private output')"),
      cwd: process.cwd(),
      sessionId: "session-a",
    });
    await runtime.getTasks("session-a", {
      taskIds: [started.id],
      waitMs: 2_000,
    });

    const [summary] = runtime.listTaskSummaries("session-a");
    expect(summary).toMatchObject({ id: started.id, status: "completed" });
    expect(summary).not.toHaveProperty("command");
    expect(summary).not.toHaveProperty("cwd");
    expect(summary).not.toHaveProperty("stdout");
    expect(summary).not.toHaveProperty("stderr");
  });

  it("projects workspace metadata without weakening session-scoped access", async () => {
    const runtime = track(
      new BackgroundTaskRuntime({ workspaceRoot: process.cwd() }),
    );
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const first = await runtime.startCommand({
      command: nodeCommand("setTimeout(() => {}, 1000)"),
      cwd: process.cwd(),
      sessionId: "session-a",
    });
    const second = await runtime.startCommand({
      command: nodeCommand("setTimeout(() => {}, 1000)"),
      cwd: process.cwd(),
      sessionId: "session-b",
    });
    vi.restoreAllMocks();

    expect(runtime.listWorkspaceTaskSummaries().map((task) => task.id)).toEqual(
      [second.id, first.id],
    );
    expect(
      runtime.listTaskSummaries("session-a").map((task) => task.id),
    ).toEqual([first.id]);
    await expect(
      runtime.getTasks("session-a", { taskIds: [second.id] }),
    ).rejects.toThrow("not found in this session");
  });

  it("returns when any selected task settles without waiting for the slowest", async () => {
    const runtime = track(
      new BackgroundTaskRuntime({
        workspaceRoot: process.cwd(),
        terminateGraceMs: 100,
      }),
    );
    const fast = await runtime.startCommand({
      command: nodeCommand("setTimeout(() => {}, 30000)"),
      cwd: process.cwd(),
      sessionId: "session-a",
    });
    const slow = await runtime.startCommand({
      command: nodeCommand("setTimeout(() => {}, 30000)"),
      cwd: process.cwd(),
      sessionId: "session-a",
    });

    const waiting = runtime.getTasks("session-a", {
      taskIds: [fast.id, slow.id],
      waitMs: 5_000,
      waitFor: "any",
    });
    const stopped = await runtime.killTask("session-a", fast.id);
    const tasks = await waiting;

    expect(stopped.status).toBe("killed");
    expect(tasks[0].status).toBe("killed");
    expect(tasks[1].status).toBe("running");
  });

  it("enforces the configured active-task limit", async () => {
    const runtime = track(
      new BackgroundTaskRuntime({
        workspaceRoot: process.cwd(),
        maxConcurrentTasks: 1,
      }),
    );
    await runtime.startCommand({
      command: nodeCommand("setTimeout(() => {}, 2000)"),
      cwd: process.cwd(),
      sessionId: "session-a",
    });

    await expect(
      runtime.startCommand({
        command: nodeCommand("console.log('second')"),
        cwd: process.cwd(),
        sessionId: "session-a",
      }),
    ).rejects.toThrow("Background task limit reached (1)");
  });

  it("kills a running process tree idempotently", async () => {
    const runtime = track(
      new BackgroundTaskRuntime({
        workspaceRoot: process.cwd(),
        terminateGraceMs: 250,
      }),
    );
    const started = await runtime.startCommand({
      command: nodeCommand("setInterval(() => {}, 1000)"),
      cwd: process.cwd(),
      sessionId: "session-a",
    });

    const killed = await runtime.killTask("session-a", started.id);
    expect(killed.status).toBe("killed");
    await expect(
      runtime.killTask("session-a", started.id),
    ).resolves.toMatchObject({ status: "killed" });
  });

  it("isolates task lookup by session", async () => {
    const runtime = track(
      new BackgroundTaskRuntime({ workspaceRoot: process.cwd() }),
    );
    const started = await runtime.startCommand({
      command: nodeCommand("setTimeout(() => {}, 1000)"),
      cwd: process.cwd(),
      sessionId: "session-a",
    });

    await expect(
      runtime.getTasks("session-b", { taskIds: [started.id] }),
    ).rejects.toThrow("not found in this session");
  });

  it("lets user cancellation interrupt a bounded background wait", async () => {
    const runtime = track(
      new BackgroundTaskRuntime({ workspaceRoot: process.cwd() }),
    );
    const started = await runtime.startCommand({
      command: nodeCommand("setTimeout(() => {}, 5000)"),
      cwd: process.cwd(),
      sessionId: "session-a",
    });
    const controller = new AbortController();
    const waiting = runtime.getTasks(
      "session-a",
      { taskIds: [started.id], waitMs: 30_000 },
      controller.signal,
    );

    controller.abort();

    await expect(waiting).resolves.toEqual([
      expect.objectContaining({ id: started.id, status: "running" }),
    ]);
  });

  it("rejects a working directory outside the runtime workspace", async () => {
    const runtime = track(
      new BackgroundTaskRuntime({ workspaceRoot: process.cwd() }),
    );

    await expect(
      runtime.startCommand({
        command: nodeCommand("console.log('escape')"),
        cwd: path.resolve(process.cwd(), ".."),
        sessionId: "session-a",
      }),
    ).rejects.toThrow("outside workspace boundary");
  });

  it("emits one completion notification and reaps tasks on dispose", async () => {
    const events: string[] = [];
    const runtime = track(
      new BackgroundTaskRuntime({
        workspaceRoot: process.cwd(),
        terminateGraceMs: 250,
        onEvent: (event) => events.push(event.type),
      }),
    );
    const started = await runtime.startCommand({
      command: nodeCommand("setInterval(() => {}, 1000)"),
      cwd: process.cwd(),
      sessionId: "session-a",
    });

    await runtime.dispose();

    expect(events).toEqual(["started", "completed"]);
    expect(runtime.listTasks("session-a")[0]).toMatchObject({
      id: started.id,
      status: "killed",
    });
    expect(runtime.drainNotifications("session-a")).toHaveLength(1);
    expect(runtime.drainNotifications("session-a")).toHaveLength(0);
  });
});

function track(runtime: BackgroundTaskRuntime): BackgroundTaskRuntime {
  runtimes.push(runtime);
  return runtime;
}

function nodeCommand(script: string): string {
  const escapedExecutable = process.execPath.replace(/"/g, '\\"');
  const encoded = Buffer.from(script, "utf8").toString("base64");
  return `"${escapedExecutable}" -e "eval(Buffer.from('${encoded}','base64').toString())"`;
}
