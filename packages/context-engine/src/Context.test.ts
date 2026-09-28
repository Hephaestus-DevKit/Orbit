import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ContextPackBuilder } from "./ContextPackBuilder.js";

describe("ContextPackBuilder tests", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `orbit-context-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should load project instructions and summarize relevant files", async () => {
    writeFileSync(
      join(tempDir, "README.md"),
      "# Test Project Instruction",
      "utf8",
    );
    writeFileSync(join(tempDir, "src.js"), 'console.log("hello");', "utf8");

    const builder = new ContextPackBuilder(tempDir);
    const pack = await builder.build([
      { path: "src.js", reason: "Initial entry" },
    ]);

    expect(pack.projectInstructions).toContain("Test Project Instruction");
    expect(pack.relevantFiles.length).toBe(1);
    expect(pack.relevantFiles[0].path).toBe("src.js");
    expect(pack.relevantFiles[0].excerpt).toContain('console.log("hello");');
  });

  it("fits large instructions and file excerpts to a model-provided budget", async () => {
    writeFileSync(
      join(tempDir, "AGENTS.md"),
      `# Rules\n${"必须遵循安全边界。".repeat(1000)}`,
      "utf8",
    );
    writeFileSync(
      join(tempDir, "large.ts"),
      Array.from(
        { length: 500 },
        (_, index) => `export const value${index} = ${index};`,
      ).join("\n"),
      "utf8",
    );

    const pack = await new ContextPackBuilder(tempDir).build(
      [{ path: "large.ts", reason: "budget regression" }],
      "review",
      { maxTokens: 2000 },
    );

    expect(pack.tokenBudget.max).toBe(2000);
    expect(pack.tokenBudget.usedEstimate).toBeLessThanOrEqual(2000);
    expect(
      `${pack.projectInstructions}\n${pack.relevantFiles[0].excerpt}`,
    ).toContain("truncated to fit token budget");
  });

  it("should index skills and load matching skill instructions on demand", async () => {
    const skillDir = join(tempDir, ".orbit", "skills", "api-tuning");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(tempDir, "orbit.config.yaml"),
      "skills:\n  directories:\n    - .orbit/skills\n  maxSkillBytes: 512\n",
      "utf8",
    );
    writeFileSync(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: api-tuning",
        "description: Optimize OpenAI compatible provider throughput",
        "---",
        "",
        "Use streaming and short retry backoff for API gateways.",
      ].join("\n"),
      "utf8",
    );

    const builder = new ContextPackBuilder(tempDir);
    const pack = await builder.build([], "please use $api-tuning");

    expect(pack.skillsIndex?.map((skill) => skill.name)).toContain(
      "api-tuning",
    );
    expect(pack.activeSkills?.[0].content).toContain("short retry backoff");
    expect(pack.activeSkills?.[0].activation).toBe("explicit");
    expect(pack.activeSkills?.[0].truncated).toBe(false);
  });

  it("loads auto-triggered skills with a smaller budget", async () => {
    const skillDir = join(tempDir, ".orbit", "skills", "api-tuning");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(tempDir, "orbit.config.yaml"),
      "skills:\n  directories:\n    - .orbit/skills\n  maxSkillBytes: 512\n",
      "utf8",
    );
    writeFileSync(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: api-tuning",
        "description: Optimize OpenAI compatible provider throughput",
        "---",
        "",
        "Use streaming and short retry backoff for API gateways.",
        "This extra guidance should be truncated for automatic activation.",
        "Extended automatic guidance. ".repeat(80),
      ].join("\n"),
      "utf8",
    );

    const builder = new ContextPackBuilder(tempDir);
    const pack = await builder.build([], "optimize provider throughput");

    expect(pack.activeSkills?.[0].activation).toBe("auto");
    expect(pack.activeSkills?.[0].loadedBytes).toBeLessThanOrEqual(512);
    expect(pack.activeSkills?.[0].truncated).toBe(true);
  });

  it("discovers Claude-compatible project skills by default", async () => {
    const skillDir = join(tempDir, ".claude", "skills", "code-review");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: code-review",
        "description: Review code for regressions",
        "---",
        "",
        "Prioritize bugs, regressions, and missing tests.",
      ].join("\n"),
      "utf8",
    );

    const builder = new ContextPackBuilder(tempDir);
    const pack = await builder.build([], "please run $code-review");

    expect(pack.skillsIndex?.map((skill) => skill.name)).toContain(
      "code-review",
    );
    expect(pack.activeSkills?.[0].content).toContain("Prioritize bugs");
  });

  it("honors maxAutoSkillBytes when selecting automatic skills", async () => {
    const skillDir = join(tempDir, ".orbit", "skills", "api-tuning");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: api-tuning",
        "description: provider throughput",
        "---",
        "",
        "Use streaming. ".repeat(200),
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(tempDir, "orbit.config.yaml"),
      "skills:\n  maxAutoSkillBytes: 512\n",
      "utf8",
    );
    const builder = new ContextPackBuilder(tempDir);
    const pack = await builder.build([], "optimize provider throughput");
    const active = pack.activeSkills ?? [];

    expect(active[0].activation).toBe("auto");
    expect(active[0].loadedBytes).toBeLessThanOrEqual(512);
    expect(active[0].truncated).toBe(true);
    expect(active[0].truncationReason).toBe("auto-size-limit");
  });

  it("keeps drafts out of the index and reports an explicit blocked invocation", async () => {
    const dir = join(tempDir, ".orbit", "skills", "draft-review");
    mkdirSync(join(dir, "agents"), { recursive: true });
    writeFileSync(
      join(dir, "SKILL.md"),
      "---\nname: draft-review\ndescription: Review code\n---\nUnreviewed procedure.",
    );
    writeFileSync(
      join(dir, "agents", "openai.yaml"),
      "policy:\n  review_status: draft\n  allow_implicit_invocation: true\n",
    );
    const builder = new ContextPackBuilder(tempDir);
    const pack = await builder.build([], "$draft-review");
    expect(pack.activeSkills).toEqual([]);
    expect(
      pack.skillsIndex?.some((skill) => skill.name === "draft-review"),
    ).toBe(false);
    expect(pack.skillDiagnostics).toContainEqual(
      expect.objectContaining({ code: "review-required" }),
    );
  });
  it("attributes final Skill clipping to the shared context budget", async () => {
    const dir = join(tempDir, ".orbit", "skills", "long-review");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "SKILL.md"),
      "---\nname: long-review\ndescription: Review\n---\n" +
        "Inspect every requirement carefully. ".repeat(700),
    );
    const pack = await new ContextPackBuilder(tempDir).build(
      [],
      "$long-review",
      { maxTokens: 2000 },
    );
    expect(pack.activeSkills?.[0]).toMatchObject({
      truncated: true,
      truncationReason: "context-budget",
    });
    expect(pack.tokenBudget.usedEstimate).toBeLessThanOrEqual(2000);
  });
});
