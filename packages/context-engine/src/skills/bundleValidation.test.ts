import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { RegisteredSkill } from "./types.js";
import {
  extractBundledResourceReferences,
  validateSkillBundle,
} from "./bundleValidation.js";

describe("Skill bundle validation", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "orbit-skill-bundle-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("accepts existing linked references and presentation assets", async () => {
    mkdirSync(join(root, "references"), { recursive: true });
    mkdirSync(join(root, "assets"), { recursive: true });
    mkdirSync(join(root, "agents"), { recursive: true });
    writeFileSync(join(root, "references", "rules.md"), "Rules.\n");
    writeFileSync(join(root, "assets", "icon.svg"), "<svg />\n");
    writeFileSync(
      join(root, "SKILL.md"),
      [
        "---",
        "name: paper-draft",
        "description: Draft a paper.",
        "---",
        "Read [rules](references/rules.md).",
        "Copy `assets/icon.svg` when needed.",
      ].join("\n"),
    );
    writeFileSync(
      join(root, "agents", "openai.yaml"),
      [
        "interface:",
        '  icon_small: "./assets/icon.svg"',
        '  default_prompt: "Use $paper-draft to draft a paper."',
      ].join("\n"),
    );

    expect(await validateSkillBundle(skill(root))).toEqual([]);
  });

  it("reports missing, escaping, and cross-Skill references", async () => {
    writeFileSync(
      join(root, "SKILL.md"),
      [
        "---",
        "name: paper-draft",
        "description: Draft a paper.",
        "---",
        "[missing](assets/missing.tex)",
        "[escape](../outside.md)",
        "[other](skill://other-skill/assets/file.md)",
      ].join("\n"),
    );

    const diagnostics = await validateSkillBundle(skill(root));

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing-resource" }),
        expect.objectContaining({
          code: "unsafe-resource",
          message: expect.stringContaining("../outside.md"),
        }),
        expect.objectContaining({
          code: "unsafe-resource",
          message: expect.stringContaining("other-skill"),
        }),
      ]),
    );
  });

  it("reports symbolic links inside the bundle", async () => {
    const outside = mkdtempSync(join(tmpdir(), "orbit-skill-outside-"));
    try {
      writeFileSync(join(outside, "secret.md"), "secret\n");
      symlinkSync(
        outside,
        join(root, "references"),
        process.platform === "win32" ? "junction" : "dir",
      );
      writeFileSync(
        join(root, "SKILL.md"),
        "---\nname: paper-draft\ndescription: Draft a paper.\n---\n",
      );

      expect(await validateSkillBundle(skill(root))).toContainEqual(
        expect.objectContaining({
          code: "unsafe-resource",
          message: expect.stringContaining("symbolic links"),
        }),
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("extracts Markdown and inline bundled resource paths once", () => {
    expect(
      extractBundledResourceReferences(
        [
          "[rules](references/rules.md)",
          "[rules again](references/rules.md)",
          "`scripts/check.py`",
          "[site](https://example.com)",
          "[section](#part)",
        ].join("\n"),
      ),
    ).toEqual(["references/rules.md", "scripts/check.py"]);
  });
});

function skill(root: string): RegisteredSkill {
  return {
    name: "paper-draft",
    description: "Draft a paper.",
    path: join(root, "SKILL.md"),
    content: "",
    loadedBytes: 0,
    truncated: false,
    disabled: false,
    allowImplicitInvocation: true,
    rootDir: root,
  };
}
