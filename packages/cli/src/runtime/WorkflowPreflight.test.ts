import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ConfigSchema } from "@orbit-build/config";
import { checkWorkflowDependencies } from "./WorkflowPreflight.js";
import type { CustomCommand } from "../commands/customCommands.js";

describe("workflow dependency preflight", () => {
  let cwd: string;
  const command: CustomCommand = {
    name: "inspect",
    description: "Inspect",
    template: "Use $review.",
    source: "project",
    filePath: "inspect.md",
    skills: ["review"],
  };
  const config = () =>
    ConfigSchema.parse({ skills: { directories: [".agents/skills"] } }).skills;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-preflight-"));
    mkdirSync(join(cwd, ".agents", "skills", "review"), { recursive: true });
    writeFileSync(
      join(cwd, ".agents", "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Review code.\n---\nInspect code safely.",
    );
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it("permits installed dependencies, even with automatic activation off", async () => {
    await expect(
      checkWorkflowDependencies(cwd, command, {
        ...config(),
        activation: "explicit",
      }),
    ).resolves.toBeUndefined();
  });
  it("detects dependencies removed since the previous run", async () => {
    await expect(
      checkWorkflowDependencies(cwd, command, config()),
    ).resolves.toBeUndefined();
    rmSync(join(cwd, ".agents", "skills", "review", "SKILL.md"));
    await expect(
      checkWorkflowDependencies(cwd, command, config()),
    ).resolves.toContain("Missing Skills: review");
  });
  it("distinguishes disabled dependencies from missing ones", async () => {
    await expect(
      checkWorkflowDependencies(
        cwd,
        { ...command, skills: ["review", "missing"] },
        { ...config(), disabled: ["review"] },
      ),
    ).resolves.toMatch(/Missing Skills: missing.*Disabled Skills: review/);
  });
  it.each([{ enabled: false }, { maxActive: 0 }])(
    "blocks unavailable Skill loading: %j",
    async (patch) => {
      await expect(
        checkWorkflowDependencies(cwd, command, { ...config(), ...patch }),
      ).resolves.toContain("Skills are disabled");
    },
  );
  it("keeps plain commands working with Skills disabled", async () => {
    await expect(
      checkWorkflowDependencies(
        cwd,
        { ...command, skills: [], template: "Review $ARGUMENTS" },
        { ...config(), enabled: false },
      ),
    ).resolves.toBeUndefined();
  });
  it("checks old generated workflows without metadata", async () => {
    await expect(
      checkWorkflowDependencies(
        cwd,
        { ...command, skills: undefined },
        { ...config(), disabled: ["review"] },
      ),
    ).resolves.toContain("Disabled Skills: review");
  });
  it("blocks declared draft dependencies until approved", async () => {
    const dir = join(cwd, ".agents", "skills", "review", "agents");
    mkdirSync(dir);
    writeFileSync(
      join(dir, "openai.yaml"),
      "policy:\n  review_status: draft\n",
    );
    await expect(
      checkWorkflowDependencies(cwd, command, config()),
    ).resolves.toContain("pending review: review");
  });
});
