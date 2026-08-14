import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSkillsCommand } from "./skills.js";

describe("skills command", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-skills-command-"));
    mkdirSync(join(cwd, ".agents", "skills", "paper-draft"), {
      recursive: true,
    });
    writeFileSync(
      join(cwd, "orbit.config.yaml"),
      "skills:\n  directories:\n    - .agents/skills\n",
    );
    writeFileSync(
      join(cwd, ".agents", "skills", "paper-draft", "SKILL.md"),
      [
        "---",
        "name: paper-draft",
        "description: Draft a paper.",
        "---",
        "Read [rules](references/missing.md).",
      ].join("\n"),
    );
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(cwd, { recursive: true, force: true });
  });

  it("uses deep validation to reject a missing bundled resource", async () => {
    await expect(
      runSkillsCommand("validate", { cwd, deep: false, json: true }),
    ).resolves.toBe(0);
    await expect(
      runSkillsCommand("validate", { cwd, deep: true, json: true }),
    ).resolves.toBe(1);
  });

  it("validates a targeted source Skill even when a duplicate wins normal discovery", async () => {
    const preferredRoot = join(cwd, "preferred-skills", "paper-draft");
    mkdirSync(preferredRoot, { recursive: true });
    writeFileSync(
      join(preferredRoot, "SKILL.md"),
      [
        "---",
        "name: paper-draft",
        "description: Preferred installed copy.",
        "---",
        "Valid body.",
      ].join("\n"),
    );
    writeFileSync(
      join(cwd, "orbit.config.yaml"),
      [
        "skills:",
        "  directories:",
        "    - preferred-skills",
        "    - .agents/skills",
      ].join("\n"),
    );

    await expect(
      runSkillsCommand("validate", {
        cwd,
        deep: true,
        json: true,
        directories: [
          join(cwd, "preferred-skills"),
          join(cwd, ".agents", "skills"),
        ],
      }),
    ).resolves.toBe(0);
    await expect(
      runSkillsCommand("validate", {
        cwd,
        deep: true,
        json: true,
        directories: [join(cwd, ".agents", "skills", "paper-draft")],
      }),
    ).resolves.toBe(1);
  });
});
