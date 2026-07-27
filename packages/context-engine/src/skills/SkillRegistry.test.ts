import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { ConfigSchema } from "@orbit-build/config";
import { discoverSkills } from "./SkillRegistry.js";
import { selectSkills } from "./selection.js";

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

  it("accepts Claude-format frontmatter keys instead of rejecting the skill", async () => {
    const directory = join(cwd, ".claude", "skills", "pdf");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "SKILL.md"),
      [
        "---",
        "name: pdf",
        "description: Work with PDF files",
        "license: Apache-2.0",
        "allowed-tools: [bash, read_file]",
        "metadata:",
        "  version: 1.0.0",
        "totally-custom-key: value",
        "---",
        "",
        "Extract text with the bundled scripts.",
      ].join("\n"),
    );
    const claudeConfig = ConfigSchema.parse({
      skills: { directories: [".claude/skills"] },
    }).skills;

    const catalog = await discoverSkills(cwd, claudeConfig);

    expect(catalog.skills.map((skill) => skill.name)).toEqual(["pdf"]);
    expect(catalog.skills[0].content).not.toContain("---");
    expect(catalog.skills[0].content).toContain("Extract text");
    const unknown = catalog.diagnostics.filter(
      (item) => item.code === "unknown-keys",
    );
    expect(unknown).toHaveLength(1);
    expect(unknown[0].severity).toBe("warning");
    expect(unknown[0].message).toContain("totally-custom-key");
    expect(unknown[0].message).not.toContain("license");
  });

  it("honors disable-model-invocation from Claude-format frontmatter", async () => {
    const directory = join(cwd, ".orbit", "skills", "deploy");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "SKILL.md"),
      [
        "---",
        "name: deploy",
        "description: Deploy the service to production safely",
        "disable-model-invocation: true",
        "---",
        "Deployment checklist.",
      ].join("\n"),
    );
    const base = config();
    const catalog = await discoverSkills(cwd, base);

    expect(catalog.skills[0].allowImplicitInvocation).toBe(false);
    expect(
      selectSkills(catalog.skills, "deploy the service to production", base),
    ).toEqual([]);
    expect(selectSkills(catalog.skills, "run $deploy now", base)).toHaveLength(
      1,
    );
  });

  it("anchors explicit markers at word boundaries", async () => {
    for (const [name, description] of [
      ["test", "Run the unit test suite"],
      ["test-runner", "Configure the automated test runner"],
    ] as const) {
      const directory = join(cwd, ".orbit", "skills", name);
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${description}\n---\nBody.\n`,
      );
    }
    const base = config();
    const catalog = await discoverSkills(cwd, base);

    const selected = selectSkills(catalog.skills, "use $test-runner", base);
    expect(selected.map((skill) => skill.name)).toEqual(["test-runner"]);
    expect(selected[0].activation).toBe("explicit");
  });

  it("requires a minimum score before auto-activating a skill", async () => {
    const directory = join(cwd, ".orbit", "skills", "gateway-tuning");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "SKILL.md"),
      "---\nname: gateway-tuning\ndescription: Tune the api gateway rate limits\n---\nBody.\n",
    );
    const base = config();
    const catalog = await discoverSkills(cwd, base);

    // A single weak 3-letter overlap ("api") must not pull the skill in;
    // a real topical overlap must.
    expect(
      selectSkills(catalog.skills, "check the api response shape", base),
    ).toEqual([]);
    expect(
      selectSkills(catalog.skills, "tune the api gateway limits", base),
    ).toHaveLength(1);
  });

  it("deduplicates configured directories on their resolved paths", async () => {
    const directory = join(cwd, ".orbit", "skills", "single");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "SKILL.md"),
      "---\nname: single\ndescription: Exactly one copy\n---\nBody.\n",
    );
    const doubled = ConfigSchema.parse({
      skills: { directories: [".orbit/skills", "./.orbit/skills"] },
    }).skills;

    const catalog = await discoverSkills(cwd, doubled);

    expect(catalog.skills).toHaveLength(1);
    expect(catalog.diagnostics).toEqual([]);
  });

  it("discovers every versioned first-party Orbit skill", async () => {
    const repositoryRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../..",
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
