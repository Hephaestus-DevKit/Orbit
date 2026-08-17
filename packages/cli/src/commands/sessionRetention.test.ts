import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionStore } from "@orbit-build/session";
import { runSessionRetention } from "./sessionRetention.js";

describe("session retention command", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-retention-command-"));
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it("prints a machine-readable dry-run plan without deleting", async () => {
    new SessionStore(cwd).createSession("deepseek", "deepseek-v4-pro");
    const write = vi.fn();
    const result = await runSessionRetention(
      cwd,
      { maxSessions: 1, json: true },
      { write },
    );
    expect(result.applied).toBe(false);
    expect(JSON.parse(write.mock.calls[0][0])).toMatchObject({
      schemaVersion: 1,
      applied: false,
    });
    expect(new SessionStore(cwd).listSessions()).toHaveLength(1);
  });

  it("requires --yes in non-interactive mode", async () => {
    const store = new SessionStore(cwd);
    const first = store.createSession("deepseek", "deepseek-v4-pro");
    store.createSession("deepseek", "deepseek-v4-flash");
    await expect(
      runSessionRetention(
        cwd,
        { maxSessions: 1, includeActive: true },
        { interactive: false },
      ),
    ).rejects.toThrow("--yes");
    expect(new SessionStore(cwd).getSession(first.id)).toBeDefined();
  });

  it("applies only after explicit confirmation", async () => {
    const store = new SessionStore(cwd);
    const first = store.createSession("deepseek", "deepseek-v4-pro");
    store.createSession("deepseek", "deepseek-v4-flash");
    const result = await runSessionRetention(
      cwd,
      { maxSessions: 1, includeActive: true },
      { confirm: async () => true, interactive: true },
    );
    expect(result.applied).toBe(true);
    expect(new SessionStore(cwd).getSession(first.id)).toBeUndefined();
  });
});
