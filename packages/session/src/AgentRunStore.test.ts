import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "fs";
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
