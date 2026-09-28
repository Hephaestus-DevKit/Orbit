import { ConfigSchema } from "@orbit-build/config";
import {
  discoverSkills,
  hasExplicitMarker,
  type RegisteredSkill,
} from "@orbit-build/context-engine";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadCustomCommands,
  type CustomCommand,
} from "../../commands/customCommands.js";
import { collectWebUiSkills } from "./WebUiData.js";
import { CapabilityCreateSchema } from "./WebUiRequestSchemas.js";
import {
  missingWorkflowSkills,
  summarizeWorkflowDependencies,
} from "./WebUiWorkflowDependencies.js";

vi.mock("@orbit-build/context-engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@orbit-build/context-engine")>()),
  discoverSkills: vi.fn(),
  validateSkillCatalogBundles: vi.fn(async () => []),
}));
vi.mock("../../commands/customCommands.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../commands/customCommands.js")
  >()),
  loadCustomCommands: vi.fn(() => []),
}));

function skill(
  name: string,
  patch: Partial<RegisteredSkill> = {},
): RegisteredSkill {
  return {
    name,
    description: "Review code",
    path: `/repo/.agents/skills/${name}/SKILL.md`,
    rootDir: `/repo/.agents/skills/${name}`,
    content: "Review",
    loadedBytes: 6,
    truncated: false,
    disabled: false,
    allowImplicitInvocation: false,
    ...patch,
  };
}
function command(patch: Partial<CustomCommand> = {}): CustomCommand {
  return {
    name: "review",
    description: "Review code",
    template: "Review $ARGUMENTS",
    source: "project",
    filePath: "/repo/.orbit/commands/review.md",
    ...patch,
  };
}
const stage = {
  id: "verify",
  title: "Verify",
  prompt: "Check code",
  skills: ["stage-only"],
  artifacts: [],
  verification: true,
};

beforeEach(() => {
  vi.mocked(discoverSkills).mockResolvedValue({
    skills: [],
    diagnostics: [],
    directories: [],
  });
  vi.mocked(loadCustomCommands).mockReturnValue([]);
  vi.clearAllMocks();
});

describe("WebUI Skill integration", () => {
  it("reports stage-only, missing, disabled and draft dependencies without leaking contents", () => {
    const result = summarizeWorkflowDependencies(
      command({
        skills: ["ready", "disabled", "draft", "absent"],
        stages: [stage],
      }),
      [
        skill("ready"),
        skill("disabled", { disabled: true }),
        skill("draft", {
          reviewStatus: "draft",
          content: "private instructions",
        }),
      ],
      ConfigSchema.parse({}).skills,
    );
    expect(result).toEqual({
      requiredSkills: ["ready", "disabled", "draft", "absent", "stage-only"],
      dependencyProblems: [
        { name: "disabled", reason: "disabled" },
        { name: "draft", reason: "draft" },
        { name: "absent", reason: "missing" },
        { name: "stage-only", reason: "missing" },
      ],
      skillsUnavailable: false,
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it.each([{ enabled: false }, { maxActive: 0 }])(
    "disables only workflows that require Skills when %j",
    (patch) => {
      const config = ConfigSchema.parse({ skills: patch }).skills;
      expect(
        summarizeWorkflowDependencies(
          command({ stages: [stage] }),
          [skill("stage-only")],
          config,
        ).skillsUnavailable,
      ).toBe(true);
      expect(
        summarizeWorkflowDependencies(command(), [], config).skillsUnavailable,
      ).toBe(false);
    },
  );

  it("recognizes the previous creator's generated dependency prefix", () => {
    expect(
      summarizeWorkflowDependencies(
        command({ template: "Use $review. Do the work." }),
        [],
        ConfigSchema.parse({}).skills,
      ).requiredSkills,
    ).toEqual(["review"]);
  });

  it("validates dependencies beyond the display cap, allowing disabled and draft definitions", async () => {
    vi.mocked(discoverSkills).mockResolvedValue({
      skills: Array.from({ length: 205 }, (_, index) =>
        skill(`skill-${index}`, { reviewStatus: "draft", disabled: true }),
      ),
      diagnostics: [],
      directories: [],
    });
    expect(
      await missingWorkflowSkills(
        { cwd: "/repo", config: ConfigSchema.parse({}) },
        {
          skills: ["skill-204"],
          stages: [{ ...stage, skills: ["skill-203", "missing", "missing"] }],
        },
      ),
    ).toEqual(["missing"]);
  });

  it("skips registry and bundle scans for dependency-free creation", async () => {
    expect(
      await missingWorkflowSkills(
        { cwd: "/repo", config: ConfigSchema.parse({}) },
        { skills: [] },
      ),
    ).toEqual([]);
    expect(discoverSkills).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    "Review the code carefully.",
    "Use $review to audit this change.",
    "```text\n$review\n```\nReview this code.",
  ])("keeps the one-click prompt explicit: %s", async (defaultPrompt) => {
    vi.mocked(discoverSkills).mockResolvedValue({
      skills: [skill("review", { defaultPrompt })],
      diagnostics: [],
      directories: [],
    });
    const result = await collectWebUiSkills({
      cwd: "/repo",
      config: ConfigSchema.parse({ skills: { activation: "explicit" } }),
    });
    expect(hasExplicitMarker(result.skills[0].defaultPrompt, "review")).toBe(
      true,
    );
    if (defaultPrompt?.startsWith("Use"))
      expect(result.skills[0].defaultPrompt).toBe(defaultPrompt);
  });

  it("bounds and redacts prompts while preserving the invocation marker", async () => {
    vi.mocked(discoverSkills).mockResolvedValue({
      skills: [
        skill("review", {
          defaultPrompt: "Bearer secret-token\n" + "a".repeat(3000),
        }),
      ],
      diagnostics: [],
      directories: [],
    });
    const result = await collectWebUiSkills({
      cwd: "/repo",
      config: ConfigSchema.parse({}),
    });
    expect(result.skills[0].defaultPrompt).not.toContain("secret-token");
    expect(result.skills[0].defaultPrompt).toMatch(/^\$review\n/);
    expect(result.skills[0].defaultPrompt.length).toBeLessThanOrEqual(2008);
  });

  it("separates display limits from dependency readiness and saved disabled settings", async () => {
    const skills = Array.from({ length: 205 }, (_, index) =>
      skill(`skill-${index}`),
    );
    vi.mocked(discoverSkills).mockResolvedValue({
      skills,
      diagnostics: [],
      directories: [],
    });
    vi.mocked(loadCustomCommands).mockReturnValue([
      command({ skills: ["skill-204"] }),
    ]);
    const result = await collectWebUiSkills({
      cwd: "/repo",
      config: ConfigSchema.parse({ skills: { disabled: ["not-installed"] } }),
    });
    expect(result.skills).toHaveLength(200);
    expect(result).toMatchObject({
      totalSkills: 205,
      skillsTruncated: true,
      disabledSkills: ["not-installed"],
    });
    expect(result.workflows[0]).toMatchObject({
      requiredSkills: ["skill-204"],
      dependencyProblems: [],
      skillsUnavailable: false,
    });
  });

  it.each(["-review", "review-", "a".repeat(49), "con", "nul", "com1", "lpt9"])(
    "rejects names the scaffolder cannot create: %s",
    (name) => {
      expect(
        CapabilityCreateSchema.safeParse({
          kind: "skill",
          name,
          description: "Review",
          instructions: "Review",
        }).success,
      ).toBe(false);
    },
  );
});
