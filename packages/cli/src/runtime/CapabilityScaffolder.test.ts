import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  promises as fs,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createProjectCapability } from "./CapabilityScaffolder.js";
import { loadCustomCommands } from "../commands/customCommands.js";
import { ConfigSchema } from "@orbit-build/config";
import {
  discoverSkills,
  validateSkillCatalogBundles,
} from "@orbit-build/context-engine";

describe("createProjectCapability", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-capability-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(cwd, { recursive: true, force: true });
  });

  it("creates a discoverable project-local Skill", async () => {
    const result = await createProjectCapability(cwd, {
      kind: "skill",
      name: "data-review",
      description: "Review tabular data and surface anomalies.",
      instructions:
        "Inspect inputs, validate assumptions, and report evidence.",
    });

    expect(result.path).toBe(".orbit/skills/data-review/SKILL.md");
    expect(readFileSync(join(cwd, result.path), "utf8")).toContain(
      "name: data-review",
    );
    expect(
      readFileSync(
        join(cwd, ".orbit/skills/data-review/agents/openai.yaml"),
        "utf8",
      ),
    ).toContain("default_prompt");
    for (const directory of ["references", "scripts", "assets"]) {
      expect(
        existsSync(join(cwd, ".orbit", "skills", "data-review", directory)),
      ).toBe(true);
    }
  });

  it("creates a complete versioned Skill bundle", async () => {
    const result = await createProjectCapability(cwd, {
      kind: "skill",
      name: "release-review",
      description: "Review a release before publishing.",
      instructions: "Validate the release and report blockers.",
      scope: "versioned",
    });

    expect(result.path).toBe(".agents/skills/release-review/SKILL.md");
    for (const directory of ["agents", "references", "scripts", "assets"]) {
      expect(
        existsSync(join(cwd, ".agents", "skills", "release-review", directory)),
      ).toBe(true);
    }
  });

  it("creates a workflow that explicitly composes selected Skills", async () => {
    const result = await createProjectCapability(cwd, {
      kind: "workflow",
      name: "mcm-draft",
      description: "Draft a mathematical modeling paper.",
      instructions: "Analyze the supplied materials and produce a paper draft.",
      skills: ["data-review", "paper-writing"],
      argumentHint: "<problem.pdf> <data.csv> [requirements]",
    });

    const content = readFileSync(join(cwd, result.path), "utf8");
    expect(content).toContain("Use $data-review. Use $paper-writing.");
    expect(content).toContain(
      "argument-hint: <problem.pdf> <data.csv> [requirements]",
    );
    expect(content).toContain("$ARGUMENTS");
    expect(content).toContain("---\n\nUse $data-review.");
    expect(content.endsWith("\n")).toBe(true);
    expect(
      loadCustomCommands(cwd, [], { homeDir: cwd, builtinDir: false })[0]
        .skills,
    ).toEqual(["data-review", "paper-writing"]);
  });

  it.each([120, 121, 160])(
    "round-trips a %i-character argument hint",
    async (length) => {
      const longSkillName = "s".repeat(64);
      await createProjectCapability(cwd, {
        kind: "workflow",
        name: "review",
        description: "Review",
        instructions: "Inspect.",
        skills: [longSkillName],
        argumentHint: "x".repeat(length),
      });
      expect(
        loadCustomCommands(cwd, [], { homeDir: cwd, builtinDir: false })[0],
      ).toMatchObject({
        argumentHint: "x".repeat(length),
        skills: [longSkillName],
      });
    },
  );

  it("rejects an oversized argument hint before writing", async () => {
    await expect(
      createProjectCapability(cwd, {
        kind: "workflow",
        name: "review",
        description: "Review",
        instructions: "Inspect.",
        skills: [],
        argumentHint: "x".repeat(161),
      }),
    ).rejects.toThrow();
    expect(existsSync(join(cwd, ".orbit", "commands", "review.md"))).toBe(
      false,
    );
  });

  it("never overwrites an existing capability", async () => {
    const request = {
      kind: "workflow" as const,
      name: "release",
      description: "Prepare a release.",
      instructions: "Verify it.",
      skills: [],
    };
    await createProjectCapability(cwd, request);
    await expect(createProjectCapability(cwd, request)).rejects.toThrow(
      "already exists",
    );
  });

  it("validates names and composed Skills at the scaffolder boundary", async () => {
    await expect(
      createProjectCapability(cwd, {
        kind: "skill",
        name: "../escape",
        description: "Invalid name.",
        instructions: "Do not write.",
      }),
    ).rejects.toThrow(/kebab-case/i);
    await expect(
      createProjectCapability(cwd, {
        kind: "workflow",
        name: "review",
        description: "Review safely.",
        instructions: "Review.",
        skills: ["data-review", "data-review"],
      }),
    ).rejects.toThrow(/unique/i);
    expect(existsSync(join(cwd, "escape"))).toBe(false);
  });

  it.each(["con", "prn", "aux", "nul", "com1", "com9", "lpt1", "lpt9"])(
    "rejects the reserved name %s before creating any directories",
    async (name) => {
      for (const kind of ["skill", "workflow"] as const) {
        await expect(
          createProjectCapability(cwd, {
            kind,
            name,
            description: "Portable capability.",
            instructions: "Inspect safely.",
            skills: [],
          }),
        ).rejects.toThrow(/reserved Windows device names/);
      }
      expect(readdirSync(cwd)).toEqual([]);
    },
  );

  it.each(["con-review", "auxiliary", "com10", "lpt0"])(
    "allows portable names related to device names: %s",
    async (name) => {
      const result = await createProjectCapability(cwd, {
        kind: "skill",
        name,
        description: "Review a change.",
        instructions: "Review it.",
      });
      expect(existsSync(join(cwd, result.path))).toBe(true);
    },
  );

  it.each(["local", "versioned"] as const)(
    "creates deeply valid %s Skill bundles with a preserved review policy",
    async (scope) => {
      await createProjectCapability(cwd, {
        kind: "skill",
        name: "review-change",
        description:
          "Review source changes. Use for code reviews and regression audits.",
        instructions:
          "Inspect the diff and report actionable findings with evidence.",
        scope,
        reviewStatus: "draft",
      });
      const config = ConfigSchema.parse({
        skills: {
          directories: [
            scope === "versioned" ? ".agents/skills" : ".orbit/skills",
          ],
        },
      }).skills;
      const catalog = await discoverSkills(cwd, config);
      expect(catalog.diagnostics).toEqual([
        expect.objectContaining({
          code: "review-required",
          severity: "warning",
        }),
      ]);
      expect(catalog.skills).toHaveLength(1);
      expect(catalog.skills[0]).toMatchObject({
        name: "review-change",
        reviewStatus: "draft",
        allowImplicitInvocation: false,
      });
      expect(await validateSkillCatalogBundles(catalog.skills)).toEqual([]);
    },
  );

  it.each(["skill", "workflow"] as const)(
    "cleans up a partial %s write and allows retry",
    async (kind) => {
      const originalOpen = fs.open.bind(fs);
      const open = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
        const file = await originalOpen(...args);
        if (
          String(args[0]).endsWith(kind === "skill" ? "SKILL.md" : "retry.md")
        ) {
          const write = file.writeFile.bind(file);
          vi.spyOn(file, "writeFile").mockImplementationOnce(async () => {
            await write("incomplete", "utf8");
            throw new Error("Simulated write failure");
          });
        }
        return file;
      });
      const request = {
        kind,
        name: "retry",
        description: "Retry safely.",
        instructions: "Inspect the change.",
        skills: [],
      };

      await expect(createProjectCapability(cwd, request)).rejects.toThrow(
        "Simulated write failure",
      );

      const parent = join(
        cwd,
        ".orbit",
        kind === "skill" ? "skills" : "commands",
      );
      expect(readdirSync(parent)).toEqual([]);
      expect(
        readdirSync(join(cwd, ".orbit")).some((name) =>
          name.startsWith(".orbit-stage-"),
        ),
      ).toBe(false);
      open.mockRestore();
      const result = await createProjectCapability(cwd, request);
      expect(readFileSync(join(cwd, result.path), "utf8")).toContain(
        "Inspect the change.",
      );
    },
  );

  it.each(["skill", "workflow"] as const)(
    "publishes only one winner for concurrent %s creation",
    async (kind) => {
      const results = await Promise.allSettled(
        ["First", "Second"].map((instructions) =>
          createProjectCapability(cwd, {
            kind,
            name: "concurrent",
            description: "Concurrent creation.",
            instructions,
            skills: [],
          }),
        ),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const winner = results.findIndex(
        (result) => result.status === "fulfilled",
      );
      const result = results[winner];
      if (result.status !== "fulfilled") throw new Error("Missing winner");
      expect(readFileSync(join(cwd, result.value.path), "utf8")).toContain(
        winner === 0 ? "First" : "Second",
      );
      expect(
        readdirSync(join(cwd, ".orbit")).some((name) =>
          name.startsWith(".orbit-stage-"),
        ),
      ).toBe(false);
    },
  );

  it("rejects capability directories linked outside the workspace before writing", async () => {
    const outside = mkdtempSync(join(tmpdir(), "orbit-capability-outside-"));
    try {
      mkdirSync(join(cwd, ".orbit"), { recursive: true });
      symlinkSync(
        outside,
        join(cwd, ".orbit", "skills"),
        process.platform === "win32" ? "junction" : "dir",
      );

      await expect(
        createProjectCapability(cwd, {
          kind: "skill",
          name: "outside-write",
          description: "Must stay inside the workspace.",
          instructions: "Do not escape.",
        }),
      ).rejects.toThrow(/symbolic link|junction|outside workspace/i);
      expect(existsSync(join(outside, "outside-write"))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("preserves an existing Skill without adding presentation metadata", async () => {
    const skillDirectory = join(cwd, ".orbit", "skills", "partial");
    mkdirSync(skillDirectory, { recursive: true });
    writeFileSync(join(skillDirectory, "SKILL.md"), "existing\n");

    await expect(
      createProjectCapability(cwd, {
        kind: "skill",
        name: "partial",
        description: "Do not leave partial metadata.",
        instructions: "Remain atomic.",
      }),
    ).rejects.toThrow("already exists");
    expect(existsSync(join(skillDirectory, "agents", "openai.yaml"))).toBe(
      false,
    );
    expect(
      readdirSync(join(cwd, ".orbit")).some((name) =>
        name.startsWith(".orbit-stage-partial-"),
      ),
    ).toBe(false);
  });
});
