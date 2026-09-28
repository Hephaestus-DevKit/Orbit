import { describe, expect, it } from "vitest";
import {
  describeSkillActivation,
  skillActivationSignature,
} from "./SkillActivation.js";
import type { ActiveSkill } from "@orbit-build/context-engine";

const skill: ActiveSkill = {
  name: "review",
  description: "Review",
  path: "/review/SKILL.md",
  rootDir: "/review",
  content: "Read.",
  loadedBytes: 5,
  truncated: false,
  activation: "explicit",
};
describe("Skill activation status", () => {
  it("changes the event signature when clipping changes for the same Skill", () => {
    expect(skillActivationSignature([skill])).not.toBe(
      skillActivationSignature([
        { ...skill, truncated: true, truncationReason: "context-budget" },
      ]),
    );
    expect(skillActivationSignature([skill])).toBe(
      skillActivationSignature([{ ...skill }]),
    );
  });
  it("explains legacy events and metadata matches without user text", () => {
    expect(describeSkillActivation(skill)).toContain("explicit invocation");
    expect(
      describeSkillActivation({
        ...skill,
        activation: "auto",
        activationReason: "metadata-match",
        matchedTerms: 3,
      }),
    ).toContain("metadata match (3 terms)");
  });
  it.each(["skill-size-limit", "auto-size-limit", "context-budget"] as const)(
    "warns about %s with a complete-read requirement",
    (truncationReason) => {
      const message = describeSkillActivation({
        ...skill,
        truncated: true,
        truncationReason,
      });
      expect(message).toContain("Read skill://review/SKILL.md in full");
      expect(message).toContain("stop and report");
    },
  );
});
