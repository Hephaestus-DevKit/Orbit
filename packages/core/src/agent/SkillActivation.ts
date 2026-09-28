import type { ActiveSkill } from "@orbit-build/context-engine";

/** Refresh observers when routing or the effective loaded context changes. */
export function skillActivationSignature(skills: ActiveSkill[]): string {
  return JSON.stringify(
    skills.map((skill) => [
      skill.name,
      skill.activation,
      skill.activationReason,
      skill.matchedTerms,
      skill.loadedBytes,
      skill.truncated,
      skill.truncationReason,
    ]),
  );
}

/** Describe routing and clipping without copying the user's prompt into logs. */
export function describeSkillActivation(skill: ActiveSkill): string {
  const reason =
    skill.activationReason === "metadata-match"
      ? `metadata match (${skill.matchedTerms ?? 0} terms)`
      : skill.activationReason === "name-match"
        ? "name match"
        : skill.activation === "explicit"
          ? "explicit invocation"
          : "automatic match";
  const limit =
    skill.truncationReason === "context-budget"
      ? "context token budget"
      : skill.truncationReason === "auto-size-limit"
        ? "automatic Skill byte limit"
        : "Skill byte limit";
  return (
    `Skill $${skill.name}: ${reason}; loaded ${skill.loadedBytes} bytes.` +
    (skill.truncated
      ? ` Truncated by ${limit}. Read skill://${skill.name}/SKILL.md in full before using this procedure; if it cannot be read completely, stop and report the limitation.`
      : "")
  );
}
