import { afterEach, describe, expect, it } from "vitest";
import { BackgroundTaskRuntime } from "./BackgroundTaskRuntime.js";
import {
  GetBackgroundTaskOutputInputSchema,
  GetBackgroundTaskOutputTool,
  KillBackgroundTaskTool,
  ListBackgroundTasksTool,
} from "./backgroundTaskTools.js";

const runtimes: BackgroundTaskRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});

describe("background task tools", () => {
  it("caps an oversized wait instead of rejecting the tool call", () => {
    expect(
      GetBackgroundTaskOutputInputSchema.parse({
        taskIds: ["bg_0123456789abcdef"],
        waitMs: 60_000,
      }).waitMs,
    ).toBe(30_000);
  });

  it("lists, waits for, and returns bounded task output", async () => {
    const runtime = track(
      new BackgroundTaskRuntime({ workspaceRoot: process.cwd() }),
    );
    const task = await runtime.startCommand({
      command: nodeCommand("console.log('foundation')"),
      cwd: process.cwd(),
      sessionId: "session-a",
    });
    const context = {
      cwd: process.cwd(),
      sessionId: "session-a",
      services: { backgroundTasks: runtime },
    };

    const listed = await new ListBackgroundTasksTool().execute({}, context);
    expect(listed.data?.[0]?.id).toBe(task.id);

    const output = await new GetBackgroundTaskOutputTool().execute(
      { taskIds: [task.id], waitMs: 10_000, waitFor: "all" },
      context,
    );
    expect(output).toMatchObject({ ok: true });
    expect(output.data?.[0]).toMatchObject({
      status: "completed",
      stdout: expect.stringContaining("foundation"),
    });
  });

  it("terminates only tasks owned by the current session", async () => {
    const runtime = track(
      new BackgroundTaskRuntime({
        workspaceRoot: process.cwd(),
        terminateGraceMs: 250,
      }),
    );
    const task = await runtime.startCommand({
      command: nodeCommand("setInterval(() => {}, 1000)"),
      cwd: process.cwd(),
      sessionId: "session-a",
    });
    const tool = new KillBackgroundTaskTool();

    const denied = await tool.execute(
      { taskId: task.id },
      {
        cwd: process.cwd(),
        sessionId: "session-b",
        services: { backgroundTasks: runtime },
      },
    );
    expect(denied).toMatchObject({ ok: false });

    const killed = await tool.execute(
      { taskId: task.id },
      {
        cwd: process.cwd(),
        sessionId: "session-a",
        services: { backgroundTasks: runtime },
      },
    );
    expect(killed.data?.status).toBe("killed");
  });
});

function track(runtime: BackgroundTaskRuntime): BackgroundTaskRuntime {
  runtimes.push(runtime);
  return runtime;
}

function nodeCommand(script: string): string {
  const encoded = Buffer.from(script, "utf8").toString("base64");
  if (process.platform === "win32") {
    const executable = process.execPath.replace(/'/g, "''");
    return `& '${executable}' -e "eval(Buffer.from('${encoded}','base64').toString())"`;
  }
  const escapedExecutable = process.execPath.replace(/"/g, '\\"');
  return `"${escapedExecutable}" -e "eval(Buffer.from('${encoded}','base64').toString())"`;
}
