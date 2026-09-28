import { mkdtempSync, readFileSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SessionStore } from "@orbit-build/session";
import { afterEach, describe, expect, it } from "vitest";
import { runWorkflowExport } from "./workflow.js";
import { ConfigSchema } from "@orbit-build/config";
import { discoverSkills, selectSkills } from "@orbit-build/context-engine";
import { writeFileSync } from "fs";

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
    expect(result.reviewStatus).toBe("draft");
    const policyPath = join(
      cwd,
      ".orbit/skills/verified-repair/agents/openai.yaml",
    );
    const policy = readFileSync(policyPath, "utf8");
    expect(policy).toContain("allow_implicit_invocation: false");
    expect(policy).toContain("review_status: draft");
    const config = ConfigSchema.parse({
      skills: { directories: [".orbit/skills"] },
    }).skills;
    const before = await discoverSkills(cwd, config);
    expect(selectSkills(before.skills, "$verified-repair", config)).toEqual([]);
    writeFileSync(
      policyPath,
      policy.replace("review_status: draft", "review_status: approved"),
    );
    const after = await discoverSkills(cwd, config);
    expect(selectSkills(after.skills, "$verified-repair", config)).toHaveLength(
      1,
    );
    expect(after.skills[0].allowImplicitInvocation).toBe(false);
  });

  it("never overwrites an existing exported workflow", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-workflow-command-"));
    roots.push(cwd);
    const session = new SessionStore(cwd).createSession(
      "deepseek",
      "deepseek-flash",
    );
    const options = { name: "safe-repeat", scope: "local" as const };

    await runWorkflowExport(cwd, session.id, options);
    await expect(runWorkflowExport(cwd, session.id, options)).rejects.toThrow(
      /already exists/i,
    );
  });

  it("validates portable names before accessing the source session", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-workflow-command-"));
    roots.push(cwd);
    await expect(
      runWorkflowExport(cwd, "missing-session", { name: "con" }),
    ).rejects.toThrow(/reserved Windows device names/);
    expect(readdirSync(cwd)).toEqual([]);
  });
});
