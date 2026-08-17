import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DaemonServer } from "./DaemonServer.js";
import { DaemonStore } from "./DaemonStore.js";
import { DaemonTokenStore } from "./DaemonTokenStore.js";
import { DaemonAuditLog } from "./DaemonAudit.js";
import type { DaemonTaskRunner } from "./DaemonServer.js";

describe("DaemonServer", () => {
  const roots: string[] = [];
  let server: DaemonServer | undefined;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
    for (const root of roots.splice(0))
      rmSync(root, { recursive: true, force: true });
  });

  it("requires bearer auth and executes a durable task through the control plane", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-daemon-server-"));
    const workspace = mkdtempSync(
      join(tmpdir(), "orbit-daemon-server-workspace-"),
    );
    roots.push(root, workspace);
    const runner: DaemonTaskRunner = {
      async run(task, emit, signal) {
        emit("agent_started", { promptLength: task.prompt.length });
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 10);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
        return signal.aborted
          ? { state: "aborted", error: "cancelled" }
          : { state: "completed", exitCode: 0 };
      },
    };
    server = new DaemonServer({
      store: new DaemonStore(join(root, "state")),
      tokenStore: new DaemonTokenStore(join(root, "token")),
      runner,
      allowedRoots: [workspace],
      auditLog: new DaemonAuditLog("audit/events.jsonl", root),
      requireAudit: true,
      port: 0,
    });
    const address = await server.start();
    const base = `${address.protocol}://${address.host}:${address.port}`;
    const unauthorized = await fetch(`${base}/v1/health`);
    expect(unauthorized.status).toBe(401);

    const headers = {
      Authorization: `Bearer ${server.getToken()}`,
      "Content-Type": "application/json",
    };
    const started = await fetch(`${base}/v1/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ cwd: workspace, prompt: "hello", options: {} }),
    });
    expect(started.status).toBe(202);
    const startedBody = (await started.json()) as { task: { id: string } };
    const taskId = startedBody.task.id;

    await new Promise((resolve) => setTimeout(resolve, 50));
    const inspected = await fetch(`${base}/v1/tasks/${taskId}`, { headers });
    expect(inspected.status).toBe(200);
    const inspectedBody = (await inspected.json()) as {
      task: { state: string; eventCount: number; owner?: { leaseId?: string } };
    };
    expect(inspectedBody.task).toMatchObject({
      state: "completed",
      eventCount: 2,
    });
    expect(inspectedBody.task.owner?.leaseId).toBeUndefined();

    const replay = await fetch(`${base}/v1/tasks/${taskId}/events?after=0`, {
      headers,
    });
    expect(replay.status).toBe(200);
    expect(await replay.text()).toContain("agent_started");
    const audit = await fetch(`${base}/v1/audit?limit=20`, { headers });
    expect(audit.status).toBe(200);
    expect((await audit.json()).verification.valid).toBe(true);
  });

  it("rejects non-loopback listeners without TLS", () => {
    expect(
      () =>
        new DaemonServer({
          store: new DaemonStore(join(tmpdir(), "orbit-daemon-policy-state")),
          tokenStore: new DaemonTokenStore(
            join(tmpdir(), "orbit-daemon-policy-token"),
          ),
          runner: { run: async () => ({ state: "completed" }) },
          allowedRoots: [process.cwd()],
          host: "0.0.0.0",
        }),
    ).toThrow(/TLS/);
  });

  it("enforces scoped principals instead of treating every bearer as admin", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-daemon-rbac-"));
    const workspace = mkdtempSync(
      join(tmpdir(), "orbit-daemon-rbac-workspace-"),
    );
    roots.push(root, workspace);
    const viewer = "v".repeat(64);
    const submitter = "s".repeat(64);
    server = new DaemonServer({
      store: new DaemonStore(join(root, "state")),
      tokenStore: new DaemonTokenStore(join(root, "token")),
      allowedRoots: [workspace],
      principals: [
        { id: "viewer", token: viewer, scopes: ["read"] },
        { id: "submitter", token: submitter, scopes: ["read", "submit"] },
      ],
      runner: { run: async () => ({ state: "completed", exitCode: 0 }) },
      port: 0,
    });
    const address = await server.start();
    const base = `${address.protocol}://${address.host}:${address.port}`;
    const readHeaders = {
      Authorization: `Bearer ${viewer}`,
      "Content-Type": "application/json",
    };
    const submitHeaders = {
      Authorization: `Bearer ${submitter}`,
      "Content-Type": "application/json",
    };
    expect(
      (await fetch(`${base}/v1/health`, { headers: readHeaders })).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${base}/v1/tasks`, {
          method: "POST",
          headers: readHeaders,
          body: JSON.stringify({
            cwd: workspace,
            prompt: "denied",
            options: {},
          }),
        })
      ).status,
    ).toBe(403);
    const submitted = await fetch(`${base}/v1/tasks`, {
      method: "POST",
      headers: submitHeaders,
      body: JSON.stringify({ cwd: workspace, prompt: "allowed", options: {} }),
    });
    expect(submitted.status).toBe(202);
    const taskId = ((await submitted.json()) as { task: { id: string } }).task
      .id;
    expect(
      (
        await fetch(`${base}/v1/tasks/${taskId}`, {
          method: "DELETE",
          headers: submitHeaders,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${base}/v1/shutdown`, {
          method: "POST",
          headers: submitHeaders,
          body: "{}",
        })
      ).status,
    ).toBe(403);
  });

  it("enforces workspace, replay, cancellation, and terminal removal boundaries", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-daemon-boundaries-"));
    const workspace = mkdtempSync(
      join(tmpdir(), "orbit-daemon-boundaries-workspace-"),
    );
    const outside = mkdtempSync(
      join(tmpdir(), "orbit-daemon-boundaries-outside-"),
    );
    roots.push(root, workspace, outside);
    server = new DaemonServer({
      store: new DaemonStore(join(root, "state")),
      tokenStore: new DaemonTokenStore(join(root, "token")),
      allowedRoots: [workspace],
      runner: {
        async run(_task, emit, signal) {
          emit("agent_started", {});
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
    const base = `${address.protocol}://${address.host}:${address.port}`;
    const headers = {
      Authorization: `Bearer ${server.getToken()}`,
      "Content-Type": "application/json",
    };

    const rejected = await fetch(`${base}/v1/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ cwd: outside, prompt: "reject", options: {} }),
    });
    expect(rejected.status).toBe(400);
    expect((await fetch(`${base}/v1/tasks?limit=0`, { headers })).status).toBe(
      400,
    );

    const started = await fetch(`${base}/v1/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ cwd: workspace, prompt: "control", options: {} }),
    });
    const taskId = ((await started.json()) as { task: { id: string } }).task.id;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const replay = await fetch(
      `${base}/v1/tasks/${taskId}/events?follow=false`,
      { headers },
    );
    expect(await replay.text()).toContain("agent_started");
    expect(
      (
        await fetch(`${base}/v1/tasks/${taskId}`, {
          method: "DELETE",
          headers,
        })
      ).status,
    ).toBe(409);

    expect(
      (
        await fetch(`${base}/v1/tasks/${taskId}/cancel`, {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
    ).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const canceled = await fetch(`${base}/v1/tasks/${taskId}`, { headers });
    expect((await canceled.json()).task).toMatchObject({ state: "canceled" });
    expect(
      (
        await fetch(`${base}/v1/tasks/${taskId}`, {
          method: "DELETE",
          headers,
        })
      ).status,
    ).toBe(200);
    expect(
      (await fetch(`${base}/v1/tasks/${taskId}`, { headers })).status,
    ).toBe(404);
  });

  it("does not double-finish a task when daemon shutdown aborts its runner", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-daemon-stop-"));
    const workspace = mkdtempSync(
      join(tmpdir(), "orbit-daemon-stop-workspace-"),
    );
    roots.push(root, workspace);
    const store = new DaemonStore(join(root, "state"));
    server = new DaemonServer({
      store,
      tokenStore: new DaemonTokenStore(join(root, "token")),
      allowedRoots: [workspace],
      runner: {
        async run(_task, _emit, signal) {
          await new Promise<void>((resolve) => {
            if (signal.aborted) return resolve();
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
          return { state: "aborted", error: "shutdown" };
        },
      },
      port: 0,
    });
    const address = await server.start();
    const headers = {
      Authorization: `Bearer ${server.getToken()}`,
      "Content-Type": "application/json",
    };
    const response = await fetch(
      `${address.protocol}://${address.host}:${address.port}/v1/tasks`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          cwd: workspace,
          prompt: "shutdown",
          options: {},
        }),
      },
    );
    const taskId = ((await response.json()) as { task: { id: string } }).task
      .id;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await server.stop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.getTask(taskId)).toMatchObject({
      state: "aborted",
      eventCount: 1,
    });
  });
});
