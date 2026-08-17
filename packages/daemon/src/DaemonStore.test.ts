import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DaemonStore } from "./DaemonStore.js";
import { DaemonTokenStore } from "./DaemonTokenStore.js";

describe("DaemonStore", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0))
      rmSync(root, { recursive: true, force: true });
  });

  it("persists bounded task state and replayable event sequences", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-daemon-store-"));
    roots.push(root);
    const workspace = mkdtempSync(join(tmpdir(), "orbit-daemon-workspace-"));
    roots.push(workspace);
    const store = new DaemonStore(root);
    store.initialize();
    const task = store.createTask({
      cwd: workspace,
      prompt: "inspect",
      options: {},
    });
    expect(task.state).toBe("queued");
    expect(() => store.resumeTask(task.id)).toThrow(/queued/);
    store.claimTask(task.id);
    store.appendEvent(task.id, "agent_started", { detail: "safe" });
    store.appendEvent(task.id, "tool_result", { output: "redacted" });

    const page = store.readEvents(task.id, 1);
    expect(page.resyncRequired).toBe(false);
    expect(page.events).toHaveLength(1);
    expect(page.events[0]).toMatchObject({ sequence: 2, type: "tool_result" });
    expect(store.getTask(task.id)).toMatchObject({
      state: "running",
      eventCount: 2,
    });
    const canceled = store.cancelTask(task.id);
    expect(canceled.state).toBe("canceled");
    expect(canceled.owner).toBeUndefined();
    expect(store.removeTask(task.id).id).toBe(task.id);
    expect(store.getTask(task.id)).toBeUndefined();
  });

  it("marks a prior daemon owner orphaned instead of claiming success", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-daemon-recovery-"));
    roots.push(root);
    const workspace = mkdtempSync(
      join(tmpdir(), "orbit-daemon-recovery-workspace-"),
    );
    roots.push(workspace);
    const first = new DaemonStore(root);
    first.initialize();
    const task = first.createTask({
      cwd: workspace,
      prompt: "recover",
      options: {},
    });
    first.claimTask(task.id);

    const restarted = new DaemonStore(root);
    restarted.initialize();
    expect(restarted.getTask(task.id)).toMatchObject({
      state: "orphaned",
      error: expect.stringContaining("resume explicitly"),
    });
    expect(restarted.resumeTask(task.id)).toMatchObject({
      state: "queued",
      attempt: 2,
    });
  });

  it("rejects stale owner completion after explicit cross-process recovery", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-daemon-lease-"));
    roots.push(root);
    const workspace = mkdtempSync(
      join(tmpdir(), "orbit-daemon-lease-workspace-"),
    );
    roots.push(workspace);
    const first = new DaemonStore(root);
    first.initialize();
    const task = first.createTask({
      cwd: workspace,
      prompt: "lease",
      options: {},
    });
    const firstAttempt = first.claimTask(task.id);
    const staleLease = firstAttempt.owner?.leaseId;
    expect(staleLease).toMatch(/^lease_[a-f0-9]{32}$/);
    if (!staleLease) throw new Error("first attempt did not receive a lease");

    const restarted = new DaemonStore(root);
    restarted.initialize();
    restarted.resumeTask(task.id);
    const secondAttempt = restarted.claimTask(task.id);
    const currentLease = secondAttempt.owner?.leaseId;
    expect(currentLease).toMatch(/^lease_[a-f0-9]{32}$/);
    if (!currentLease)
      throw new Error("second attempt did not receive a lease");
    expect(currentLease).not.toBe(staleLease);

    expect(() =>
      first.finishTask(task.id, "completed", {
        ownerLeaseId: staleLease,
      }),
    ).toThrow(/stale or missing ownership lease/);
    expect(first.appendEvent(task.id, "stale_update", {}, staleLease)).toBe(
      undefined,
    );
    expect(
      restarted.finishTask(task.id, "completed", {
        ownerLeaseId: currentLease,
      }).state,
    ).toBe("completed");
  });

  it("serializes task transitions and reclaims only bounded stale locks", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-daemon-lock-"));
    roots.push(root);
    const workspace = mkdtempSync(
      join(tmpdir(), "orbit-daemon-lock-workspace-"),
    );
    roots.push(workspace);
    const store = new DaemonStore(root);
    store.initialize();
    const task = store.createTask({
      cwd: workspace,
      prompt: "lock",
      options: {},
    });
    const lockPath = join(root, "tasks", `${task.id}.lock`);
    writeFileSync(lockPath, "active");
    expect(() => store.claimTask(task.id)).toThrow(/busy in another process/);
    const stale = new Date(Date.now() - 60_000);
    utimesSync(lockPath, stale, stale);
    expect(store.claimTask(task.id).state).toBe("running");
  });

  it("creates a persistent constant-time-comparable token", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-daemon-token-"));
    roots.push(root);
    const path = join(root, "token");
    const store = new DaemonTokenStore(path);
    const token = store.loadOrCreate();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(store.loadOrCreate()).toBe(token);
    expect(store.matches(`Bearer ${token}`, token)).toBe(false);
    expect(store.matches(token, token)).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  it.skipIf(process.platform === "win32")(
    "never follows a symlinked event journal",
    () => {
      const root = mkdtempSync(join(tmpdir(), "orbit-daemon-journal-"));
      roots.push(root);
      const workspace = mkdtempSync(
        join(tmpdir(), "orbit-daemon-journal-workspace-"),
      );
      roots.push(workspace);
      const store = new DaemonStore(root);
      store.initialize();
      const task = store.createTask({
        cwd: workspace,
        prompt: "safe",
        options: {},
      });
      const outside = join(root, "outside.log");
      writeFileSync(outside, "must remain untouched\n");
      symlinkSync(outside, join(root, "tasks", `${task.id}.events.jsonl`));

      expect(() => store.appendEvent(task.id, "unsafe_write")).toThrow(
        /regular file/,
      );
      expect(readFileSync(outside, "utf8")).toBe("must remain untouched\n");
    },
  );
});
