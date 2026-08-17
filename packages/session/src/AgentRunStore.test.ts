import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentRunStore } from "./AgentRunStore.js";

describe("AgentRunStore", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps construction side-effect free and persists bounded agent state", () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-agent-runs-"));
    roots.push(cwd);
    const store = new AgentRunStore(cwd);
    expect(() =>
      store.createRun({ task: "Review authentication", budgetUsd: 2 }),
    ).toThrow("initialize");

    store.initialize();
    const run = store.createRun({
      task: "Review authentication",
      budgetUsd: 2,
    });
    const agent = store.addAgent(run.id, {
      role: "security-reviewer",
      task: "Inspect trust boundaries",
      model: "reviewer-model",
      budgetUsd: 0.5,
      access: { mode: "read", scopes: ["packages/auth"] },
    });
    store.updateAgent(run.id, agent.id, {
      status: "completed",
      sessionId: "sess_friendly-panda-123",
      costUsd: 0.12,
      startedAt: "2026-07-25T00:00:00.000Z",
      endedAt: "2026-07-25T00:01:00.000Z",
    });
    const steered = store.recordAgentSteering(
      run.id,
      agent.id,
      "2026-07-25T00:00:30.000Z",
    );
    const completed = store.finishRun(run.id, "completed");

    expect(steered.steering).toEqual({
      count: 1,
      lastAt: "2026-07-25T00:00:30.000Z",
    });
    expect(steered.sessionId).toBe("sess_friendly-panda-123");
    expect(completed.costUsd).toBe(0.12);
    expect(store.listRuns()).toEqual([completed]);
  });

  it("rejects stale child-agent transitions and keeps terminal run cleanup idempotent", () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-agent-runs-"));
    roots.push(cwd);
    const store = new AgentRunStore(cwd);
    store.initialize();
    const run = store.createRun({ task: "Guard lifecycle", budgetUsd: 1 });
    const agent = store.addAgent(run.id, {
      role: "reviewer",
      task: "Review the diff",
      model: "reviewer-model",
      budgetUsd: 1,
      access: { mode: "read", scopes: ["workspace"] },
    });
    store.updateAgent(run.id, agent.id, { status: "running" });
    store.updateAgent(run.id, agent.id, { status: "completed" });

    expect(() =>
      store.updateAgent(run.id, agent.id, { status: "failed" }),
    ).toThrow("resume");

    const completed = store.finishRun(run.id, "completed");
    expect(store.finishRun(run.id, "completed")).toEqual(completed);
    expect(() => store.finishRun(run.id, "failed")).toThrow("terminal");
  });

  it("rejects invalid persisted records", () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-agent-runs-"));
    roots.push(cwd);
    const store = new AgentRunStore(cwd);
    store.initialize();
    expect(() => store.getRun("../escape")).toThrow("Invalid agent run id");
  });

  it("does not create agent-run data through an ancestor directory link", () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-agent-runs-"));
    const outside = mkdtempSync(join(tmpdir(), "orbit-agent-runs-outside-"));
    roots.push(cwd, outside);
    symlinkSync(
      outside,
      join(cwd, ".orbit"),
      process.platform === "win32" ? "junction" : "dir",
    );

    expect(() => new AgentRunStore(cwd).initialize()).toThrow(
      /outside workspace boundary|symbolic link|junction/,
    );
    expect(readdirSync(outside)).toEqual([]);
  });

  it("recovers dead-process agents and explicitly reopens persisted children", () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-agent-runs-"));
    roots.push(cwd);
    const store = new AgentRunStore(cwd);
    store.initialize();
    const run = store.createRun({ task: "Recover child", budgetUsd: 2 });
    const agent = store.addAgent(run.id, {
      role: "coder:1",
      task: "Continue implementation",
      model: "coder-model",
      budgetUsd: 1,
      access: { mode: "write", scopes: ["workspace"] },
    });
    store.updateAgent(run.id, agent.id, {
      status: "running",
      sessionId: "sess_friendly-panda-123",
      startedAt: "2026-08-09T00:00:00.000Z",
    });

    const runFile = join(cwd, ".orbit", "agent-runs", `${run.id}.json`);
    const persisted = JSON.parse(readFileSync(runFile, "utf8")) as {
      ownerPid?: number;
      owner?: unknown;
    };
    delete persisted.owner;
    persisted.ownerPid = 2_147_483_647;
    writeFileSync(runFile, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");

    expect(store.recoverInterruptedRuns()).toBe(1);
    expect(store.getRun(run.id)?.agents[0]).toMatchObject({
      status: "failed",
      sessionId: "sess_friendly-panda-123",
      error: expect.stringContaining("can be resumed"),
    });

    expect(store.resumeAgent(run.id, agent.id)).toMatchObject({
      status: "running",
      sessionId: "sess_friendly-panda-123",
    });
    expect(store.getRun(run.id)).toMatchObject({
      status: "running",
      ownerPid: process.pid,
    });
    expect(() => store.resumeAgent(run.id, agent.id)).toThrow(
      "still owned by a live process",
    );
  });

  it("recovers interrupted runs older than the public history window", () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-agent-runs-"));
    roots.push(cwd);
    const startedAt = new Date("2026-08-09T00:00:00.000Z");
    const store = new AgentRunStore(cwd, {
      now: () => startedAt,
      isProcessAlive: () => false,
    });
    store.initialize();
    const interrupted = store.createRun({
      task: "Recover the oldest interrupted run",
      budgetUsd: 1,
    });
    const runDirectory = join(cwd, ".orbit", "agent-runs");

    for (let index = 0; index < 100; index += 1) {
      const timestamp = new Date(
        startedAt.getTime() + (index + 1) * 1_000,
      ).toISOString();
      const completed = {
        ...interrupted,
        id: `run_filler-${index}`,
        status: "completed",
        createdAt: timestamp,
        updatedAt: timestamp,
        owner: undefined,
        ownerPid: undefined,
      };
      writeFileSync(
        join(runDirectory, `${completed.id}.json`),
        `${JSON.stringify(completed, null, 2)}\n`,
        "utf8",
      );
    }

    expect(store.listRuns(100)).toHaveLength(100);
    expect(store.listRuns(100).some((run) => run.id === interrupted.id)).toBe(
      false,
    );
    expect(store.recoverInterruptedRuns()).toBe(1);
    expect(store.getRun(interrupted.id)?.status).toBe("failed");
  });

  it("expires stale instance leases and rejects writes from the previous owner", () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-agent-runs-"));
    roots.push(cwd);
    let now = new Date("2026-08-09T00:00:00.000Z");
    const common = {
      now: () => now,
      ownerPid: 42,
      processStartedAt: "2026-08-08T23:59:00.000Z",
      leaseDurationMs: 5_000,
      isProcessAlive: () => true,
    };
    const original = new AgentRunStore(cwd, {
      ...common,
      ownerInstanceId: "orbit_instance-a",
    });
    original.initialize();
    const run = original.createRun({ task: "Lease takeover", budgetUsd: 1 });
    const agent = original.addAgent(run.id, {
      role: "coder",
      task: "Continue safely",
      model: "coder-model",
      budgetUsd: 1,
      access: { mode: "write", scopes: ["workspace"] },
    });
    original.updateAgent(run.id, agent.id, {
      status: "running",
      sessionId: "sess_friendly-panda-123",
    });

    const successor = new AgentRunStore(cwd, {
      ...common,
      ownerInstanceId: "orbit_instance-b",
    });
    successor.initialize();
    expect(successor.recoverInterruptedRuns()).toBe(0);

    now = new Date("2026-08-09T00:00:06.000Z");
    expect(successor.recoverInterruptedRuns()).toBe(1);
    expect(successor.resumeAgent(run.id, agent.id)).toMatchObject({
      status: "running",
    });
    expect(successor.getRun(run.id)?.owner?.instanceId).toBe(
      "orbit_instance-b",
    );
    expect(() =>
      original.updateAgent(run.id, agent.id, { status: "failed" }),
    ).toThrow("another Orbit instance");
  });

  it("surfaces lease heartbeat loss to the owner instead of failing silently", () => {
    vi.useFakeTimers();
    try {
      const cwd = mkdtempSync(join(tmpdir(), "orbit-agent-runs-"));
      roots.push(cwd);
      const store = new AgentRunStore(cwd, { leaseDurationMs: 5_000 });
      store.initialize();
      const run = store.createRun({
        task: "Heartbeat diagnostics",
        budgetUsd: 1,
      });
      const lockLoss = vi.fn();
      const stop = store.startLeaseHeartbeat(run.id, { onLeaseLost: lockLoss });
      rmSync(join(cwd, ".orbit", "agent-runs", `${run.id}.json`));

      vi.advanceTimersByTime(2_000);

      expect(lockLoss).toHaveBeenCalledOnce();
      expect(String(lockLoss.mock.calls[0]?.[0])).toContain("not found");
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it.skipIf(process.platform === "win32")(
    "rejects a symbolic-link agent-run directory",
    () => {
      const cwd = mkdtempSync(join(tmpdir(), "orbit-agent-runs-"));
      roots.push(cwd);
      const target = join(cwd, "external-runs");
      mkdirSync(target);
      mkdirSync(join(cwd, ".orbit"));
      symlinkSync(target, join(cwd, ".orbit", "agent-runs"), "dir");

      expect(() => new AgentRunStore(cwd).initialize()).toThrow(
        "real directory",
      );
    },
  );
});
