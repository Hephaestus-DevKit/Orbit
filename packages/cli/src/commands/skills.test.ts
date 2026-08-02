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
});
