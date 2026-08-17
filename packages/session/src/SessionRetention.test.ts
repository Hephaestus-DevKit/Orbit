import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionStore } from "./SessionStore.js";
import {
  applySessionRetention,
  planSessionRetention,
} from "./SessionRetention.js";

describe("session retention", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-session-retention-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("plans age/count/size cleanup while protecting active sessions", () => {
    const store = new SessionStore(cwd);
    const first = store.createSession("deepseek", "deepseek-v4-pro");
    const second = store.createSession("deepseek", "deepseek-v4-flash");
    const active = store.createSession("deepseek", "deepseek-v4-pro");
    store.updateSession({
      ...store.getSession(first.id)!,
      status: "completed",
    });
    store.updateSession({
      ...store.getSession(second.id)!,
      status: "failed",
    });
    const plan = planSessionRetention(
      cwd,
      { olderThanDays: 1, maxSessions: 2, maxBytes: 1, keepActive: true },
      new Date(Date.now() + 3 * 24 * 60 * 60 * 1_000),
    );
    expect(plan.totalSessions).toBe(3);
    expect(plan.protectedActiveSessions).toBe(1);
    expect(plan.candidates.map((candidate) => candidate.id)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    );
    expect(plan.candidates.map((candidate) => candidate.id)).not.toContain(
      active.id,
    );
    expect(plan.candidates[0].reasons).toEqual(expect.arrayContaining(["age"]));
  });

  it("applies a plan and rechecks changed sessions before deletion", () => {
    const store = new SessionStore(cwd);
    const first = store.createSession("deepseek", "deepseek-v4-pro");
    const second = store.createSession("deepseek", "deepseek-v4-flash");
    store.updateSession({
      ...store.getSession(first.id)!,
      status: "completed",
    });
    store.updateSession({
      ...store.getSession(second.id)!,
      status: "completed",
    });
    const plan = planSessionRetention(cwd, {
      maxSessions: 1,
      keepActive: false,
    });
    expect(plan.candidates).toHaveLength(1);
    store.updateSession({
      ...store.getSession(plan.candidates[0].id)!,
      goal: "changed",
    });
    const result = applySessionRetention(cwd, plan);
    expect(result.deleted).toHaveLength(0);
    expect(result.skipped).toMatchObject([
      { id: plan.candidates[0].id, reason: "changed" },
    ]);
    expect(new SessionStore(cwd).getSession(first.id)).toBeDefined();
    expect(new SessionStore(cwd).getSession(second.id)).toBeDefined();
  });

  it("deletes unchanged candidates and leaves protected active records", () => {
    const store = new SessionStore(cwd);
    const completed = store.createSession("deepseek", "deepseek-v4-pro");
    store.updateSession({
      ...store.getSession(completed.id)!,
      status: "completed",
    });
    const active = store.createSession("deepseek", "deepseek-v4-flash");
    const plan = planSessionRetention(
      cwd,
      {
        olderThanDays: 1,
        keepActive: true,
      },
      new Date(Date.now() + 3 * 24 * 60 * 60 * 1_000),
    );
    const result = applySessionRetention(cwd, plan);
    expect(result.deleted).toContain(completed.id);
    expect(new SessionStore(cwd).getSession(completed.id)).toBeUndefined();
    expect(new SessionStore(cwd).getSession(active.id)).toBeDefined();
  });
});
