import { describe, expect, it } from "vitest";
import { ConfigSchema } from "@orbit-build/config";
import { selectSkills, explainSkillSelection } from "./selection.js";
import type { RegisteredSkill } from "./types.js";

const config = ConfigSchema.parse({}).skills;
const skill: RegisteredSkill = {
  name: "code-review",
  description: "Inspect correctness regressions 网页设计",
  path: "/skills/code-review/SKILL.md",
  rootDir: "/skills/code-review",
  content: "Read and verify.",
  loadedBytes: 16,
  truncated: false,
  disabled: false,
  allowImplicitInvocation: true,
};
describe("Skill activation explanations", () => {
  it("does not exclude a Skill merely because its name is another Skill's suffix", () => {
    const short = { ...skill, name: "mcm-draft" };
    expect(
      selectSkills([short], "不要使用 $cumcm-draft，但使用 $mcm-draft", config),
    ).toHaveLength(1);
  });
  it.each([
    "Do not use $code-review",
    "不要使用 $code-review",
    "Explain $code-review",
    "What is code-review",
    "```md\nUse $code-review\n```",
    "> Use $code-review",
    "不要使用任何技能，检查 correctness regressions",
  ])("does not activate quoted or excluded instructions: %s", (query) => {
    expect(selectSkills([skill], query, config)).toEqual([]);
  });
  it("explains exclusions without exposing the query", () => {
    const result = explainSkillSelection(
      [skill],
      "Do not use $code-review",
      config,
    );
    expect(result[0].reason).toBe("excluded");
    expect(JSON.stringify(result)).not.toContain("Do not use");
  });
  it.each([
    ["Use $code-review", "explicit-marker"],
    ["code-review please", "name-match"],
    ["Inspect correctness regressions", "metadata-match"],
    ["优化网页设计", "metadata-match"],
  ])("explains %s without recording the prompt", (query, reason) => {
    const selected = selectSkills([skill], query, config);
    expect(selected[0].activationReason).toBe(reason);
    expect(selected[0].matchedTerms).toBeGreaterThanOrEqual(0);
    expect(selected[0]).not.toHaveProperty("query");
  });
  it("keeps incidental and disabled matches out", () => {
    expect(selectSkills([skill], "fix correctness", config)).toEqual([]);
    expect(
      selectSkills([skill], "$code-review", { ...config, enabled: false }),
    ).toEqual([]);
    expect(
      selectSkills([{ ...skill, disabled: true }], "$code-review", config),
    ).toEqual([]);
  });
  it("blocks drafts even when explicitly requested, then permits reviewed explicit use", () => {
    expect(
      selectSkills(
        [{ ...skill, reviewStatus: "draft" }],
        "$code-review",
        config,
      ),
    ).toEqual([]);
    const approved = {
      ...skill,
      reviewStatus: "approved" as const,
      allowImplicitInvocation: false,
    };
    expect(selectSkills([approved], "$code-review", config)).toHaveLength(1);
    expect(
      selectSkills([approved], "Inspect correctness regressions", config),
    ).toEqual([]);
  });
  it("distinguishes Skill size limits from automatic activation limits", () => {
    expect(
      selectSkills([{ ...skill, truncated: true }], "$code-review", config)[0]
        .truncationReason,
    ).toBe("skill-size-limit");
    expect(
      selectSkills([{ ...skill, content: "界面".repeat(500) }], "code-review", {
        ...config,
        maxAutoSkillBytes: 512,
      })[0],
    ).toMatchObject({ truncated: true, truncationReason: "auto-size-limit" });
  });
});
