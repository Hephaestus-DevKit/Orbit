import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createProjectCapability } from "./CapabilityScaffolder.js";

describe("createProjectCapability", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-capability-"));
  });

  afterEach(() => {
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
  });

  it("creates a workflow that explicitly composes selected Skills", async () => {
    const result = await createProjectCapability(cwd, {
      kind: "workflow",
      name: "mcm-draft",
      description: "Draft a mathematical modeling paper.",
      instructions: "Analyze the supplied materials and produce a paper draft.",
      skills: ["data-review", "paper-writing"],
    });

    const content = readFileSync(join(cwd, result.path), "utf8");
    expect(content).toContain("Use $data-review. Use $paper-writing.");
    expect(content).toContain("$ARGUMENTS");
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

  it("removes presentation metadata when the primary Skill file cannot be created", async () => {
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
  });
});
