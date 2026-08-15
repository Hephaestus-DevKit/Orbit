import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SessionStore } from "@orbit-build/session";
import { afterEach, describe, expect, it } from "vitest";
import { runWorkflowExport } from "./workflow.js";

describe("workflow export command", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates a reviewable local Skill from a redacted trace", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-workflow-command-"));
    roots.push(cwd);
    const store = new SessionStore(cwd);
    const session = store.createSession("deepseek", "deepseek-v4-pro");
    store.appendEvent(session.id, "verification_ended", { success: true });

    const result = await runWorkflowExport(cwd, session.id, {
      name: "verified-repair",
      description: "Repeat a verified repair workflow",
      scope: "local",
    });

    expect(result.path).toBe(".orbit/skills/verified-repair/SKILL.md");
    const content = readFileSync(join(cwd, result.path), "utf8");
    expect(content).toContain("name: verified-repair");
    expect(content).toContain("Never replay a recorded shell command");
    expect(content).toContain("Verification runs observed: 1");
  });

  it("never overwrites an existing exported workflow", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-workflow-command-"));
    roots.push(cwd);
    const session = new SessionStore(cwd).createSession(
      "deepseek",
      "deepseek-v4-flash",
    );
    const options = { name: "safe-repeat", scope: "local" as const };

    await runWorkflowExport(cwd, session.id, options);
    await expect(runWorkflowExport(cwd, session.id, options)).rejects.toThrow(
      /already exists/i,
    );
  });
});
