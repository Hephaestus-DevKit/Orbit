import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
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

  it("rejects invalid persisted records", () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-agent-runs-"));
    roots.push(cwd);
    const store = new AgentRunStore(cwd);
    store.initialize();
    expect(() => store.getRun("../escape")).toThrow("Invalid agent run id");
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
