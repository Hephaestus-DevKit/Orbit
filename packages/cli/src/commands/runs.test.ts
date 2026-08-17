import { existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentRunStore } from "@orbit-build/session";
import { runRunsCommand } from "./runs.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runs command", () => {
  it("lists and redacts durable run summaries as JSON", () => {
    const cwd = createWorkspace();
    const store = new AgentRunStore(cwd, {
      ownerInstanceId: "orbit_test-instance",
      processStartedAt: "2026-01-01T00:00:00.000Z",
    });
    store.initialize();
    store.createRun({
      task: "Inspect sk-abcdefghijklmnopqrstuvwxyz0123456789abcdef",
      budgetUsd: 1,
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    expect(runRunsCommand("list", undefined, { cwd, json: true })).toBe(0);
    const output = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(output.runs).toHaveLength(1);
    expect(output.runs[0].task).toContain("***REDACTED***");
    expect(output.runs[0].task).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
  });

  it("inspects child agents without exposing owner process details", () => {
    const cwd = createWorkspace();
    const store = new AgentRunStore(cwd, {
      ownerInstanceId: "orbit_test-instance",
      processStartedAt: "2026-01-01T00:00:00.000Z",
    });
    store.initialize();
    const run = store.createRun({ task: "Review the workspace", budgetUsd: 2 });
    store.addAgent(run.id, {
      role: "reviewer",
      task: "Check files",
      model: "deepseek-v4-pro",
      budgetUsd: 1,
      access: { mode: "read", scopes: ["workspace"] },
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    expect(runRunsCommand("inspect", run.id, { cwd, json: true })).toBe(0);
    const output = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(output.agents).toHaveLength(1);
    expect(output.owner).not.toHaveProperty("pid");
    expect(output.agents[0]).toMatchObject({
      role: "reviewer",
      status: "pending",
    });
  });

  it("rejects invalid list limits with a CI-friendly error", () => {
    const cwd = createWorkspace();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(
      runRunsCommand("list", undefined, { cwd, json: true, limit: 0 }),
    ).toBe(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0])).error).toContain(
      "--limit",
    );
  });

  it("does not create durable state while performing a read-only list", () => {
    const cwd = createWorkspace();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(runRunsCommand("list", undefined, { cwd, json: true })).toBe(0);
    expect(existsSync(join(cwd, ".orbit"))).toBe(false);
  });
});

function createWorkspace(): string {
  return mkdtempSync(join(process.env.TEMP ?? process.cwd(), "orbit-runs-"));
}
