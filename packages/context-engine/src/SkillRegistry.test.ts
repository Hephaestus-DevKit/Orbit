import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { ConfigSchema } from "@orbit-build/config";
import { discoverSkills, selectSkills } from "./SkillRegistry.js";

describe("SkillRegistry", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-skills-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function config() {
    return ConfigSchema.parse({
      skills: { directories: [".orbit/skills"], maxSkillBytes: 512 },
    }).skills;
  }

  it("parses CRLF YAML frontmatter and respects UTF-8 byte limits", async () => {
    const directory = join(cwd, ".orbit", "skills", "web-design");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "SKILL.md"),
      [
        "---",
        "name: web-design",
        "description: |",
        "  优化 WebUI 设计、响应式布局与交互体验。",
        "---",
        "",
        "界面规范。".repeat(200),
      ].join("\r\n"),
    );

    const catalog = await discoverSkills(cwd, config());

    expect(catalog.diagnostics).toEqual([]);
    expect(catalog.skills[0]).toMatchObject({
      name: "web-design",
      truncated: true,
    });
    expect(catalog.skills[0].loadedBytes).toBeLessThanOrEqual(512);
  });

  it("reports invalid and duplicate skills instead of silently ignoring them", async () => {
    for (const name of ["first", "second"]) {
      const directory = join(cwd, ".orbit", "skills", name);
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, "SKILL.md"),
        `---\nname: shared\ndescription: Shared workflow\n---\nUse it.\n`,
      );
    }
    const invalid = join(cwd, ".orbit", "skills", "invalid");
    mkdirSync(invalid, { recursive: true });
    writeFileSync(join(invalid, "SKILL.md"), "No frontmatter.");

    const catalog = await discoverSkills(cwd, config());

    expect(catalog.skills).toHaveLength(1);
    expect(catalog.diagnostics.map((item) => item.severity)).toEqual([
      "error",
      "warning",
    ]);
  });

  it("supports Chinese automatic matching and individual disabling", async () => {
    const directory = join(cwd, ".orbit", "skills", "web-design");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "SKILL.md"),
      "---\nname: web-design\ndescription: 优化网页设计和交互体验\n---\nKeep the UI focused.\n",
    );
    const base = config();
    const catalog = await discoverSkills(cwd, base);

    expect(
      selectSkills(catalog.skills, "帮我优化一下网页设计", base),
    ).toHaveLength(1);
    const disabled = { ...base, disabled: ["web-design"] };
    const disabledCatalog = await discoverSkills(cwd, disabled);
    expect(
      selectSkills(disabledCatalog.skills, "使用 $web-design", disabled),
    ).toEqual([]);
  });

  it("loads standard UI metadata and honors explicit-only policy", async () => {
    const directory = join(cwd, ".orbit", "skills", "release");
    mkdirSync(join(directory, "agents"), { recursive: true });
    writeFileSync(
      join(directory, "SKILL.md"),
      "---\nname: release\ndescription: Prepare a project release\n---\nVerify the artifact.\n",
    );
    writeFileSync(
      join(directory, "agents", "openai.yaml"),
      [
        "interface:",
        '  display_name: "Release Readiness"',
        '  short_description: "Verify a safe release"',
        '  default_prompt: "Use $release to prepare this version."',
        "policy:",
        "  allow_implicit_invocation: false",
      ].join("\n"),
    );

    const base = config();
    const catalog = await discoverSkills(cwd, base);

    expect(catalog.skills[0]).toMatchObject({
      displayName: "Release Readiness",
      shortDescription: "Verify a safe release",
      defaultPrompt: "Use $release to prepare this version.",
      allowImplicitInvocation: false,
    });
    expect(
      selectSkills(catalog.skills, "prepare a project release", base),
    ).toEqual([]);
    expect(selectSkills(catalog.skills, "use $release", base)).toHaveLength(1);
  });

  it("discovers every versioned first-party Orbit skill", async () => {
    const repositoryRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../..",
    );
    const builtinConfig = ConfigSchema.parse({
      skills: { directories: [".agents/skills"] },
    }).skills;

    const catalog = await discoverSkills(repositoryRoot, builtinConfig);

    expect(catalog.diagnostics).toEqual([]);
    expect(catalog.skills.map((skill) => skill.name)).toEqual([
      "orbit-release-readiness",
      "orbit-skill-workflows",
      "orbit-verify-change",
      "orbit-webui-craft",
    ]);
    expect(catalog.skills.every((skill) => skill.displayName)).toBe(true);
    expect(catalog.skills.every((skill) => skill.defaultPrompt)).toBe(true);
  });
});
