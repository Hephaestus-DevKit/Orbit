import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DaemonClient } from "./DaemonClient.js";
import { DaemonServer } from "./DaemonServer.js";
import { DaemonStore } from "./DaemonStore.js";
import { DaemonTokenStore } from "./DaemonTokenStore.js";

describe("DaemonClient", () => {
  const roots: string[] = [];
  let server: DaemonServer | undefined;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("shares typed health, task, replay, follow, cancellation, and removal semantics", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-daemon-client-"));
    const workspace = mkdtempSync(
      join(tmpdir(), "orbit-daemon-client-workspace-"),
    );
    roots.push(root, workspace);
    server = new DaemonServer({
      store: new DaemonStore(join(root, "state")),
      tokenStore: new DaemonTokenStore(join(root, "token")),
      allowedRoots: [workspace],
      runner: {
        async run(_task, emit, signal) {
          emit("agent_started", { source: "client-test" });
          await new Promise<void>((resolve) => {
            if (signal.aborted) return resolve();
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
          return { state: "aborted" };
        },
      },
      port: 0,
    });
    const address = await server.start();
    const client = new DaemonClient({
      baseUrl: `${address.protocol}://${address.host}:${address.port}`,
      token: server.getToken(),
    });
    expect((await client.health()).activeTasks).toBe(0);
    const task = await client.startTask({
      cwd: workspace,
      prompt: "client control",
      options: {},
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await client.getTask(task.id)).state).toBe("running");
    expect((await client.listTasks()).map((item) => item.id)).toContain(
      task.id,
    );
    expect((await client.readEvents(task.id)).events[0]?.type).toBe(
      "agent_started",
    );

    const followed: string[] = [];
    const follow = client.followEvents(task.id, (event) => {
      if ("type" in event) followed.push(event.type);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await client.cancelTask(task.id);
    await follow;
    expect(followed).toContain("daemon_task_terminal");
    expect((await client.getTask(task.id)).state).toBe("canceled");
    expect((await client.removeTask(task.id)).id).toBe(task.id);
    await expect(client.getTask(task.id)).rejects.toThrow(/not_found/);
    await expect(client.readEvents(task.id)).rejects.toThrow(/not_found/);
    await expect(client.readEvents(task.id, { after: -1 })).rejects.toThrow();
    await expect(
      new DaemonClient({
        baseUrl: `${address.protocol}://${address.host}:${address.port}`,
        token: "wrong-token",
      }).health(),
    ).rejects.toThrow(/unauthorized/);
  });
});
