import {
  discoverSkills,
  type RegisteredSkill,
} from "@orbit-build/context-engine";
import type { OrbitConfig } from "@orbit-build/config";
import {
  getRequiredCommandSkills,
  type CustomCommand,
} from "../../commands/customCommands.js";
import {
  workflowSkillDependencies,
  type WorkflowStage,
} from "../workflows/WorkflowSchema.js";
import type { WebUiOptions } from "./WebUiContracts.js";

/** Browser-safe dependency state; execution still performs authoritative preflight. */
export function summarizeWorkflowDependencies(
  command: CustomCommand,
  skills: RegisteredSkill[],
  config: OrbitConfig["skills"],
) {
  const requiredSkills = workflowSkillDependencies(
    getRequiredCommandSkills(command),
    command.stages,
  );
  const available = new Map(skills.map((skill) => [skill.name, skill]));
  const dependencyProblems = requiredSkills.flatMap((name) => {
    const skill = available.get(name);
    const reason = !skill
      ? "missing"
      : skill.reviewStatus === "draft"
        ? "draft"
        : skill.disabled
          ? "disabled"
          : undefined;
    return reason ? [{ name, reason }] : [];
  });
  return {
    requiredSkills,
    dependencyProblems,
    skillsUnavailable:
      requiredSkills.length > 0 && (!config.enabled || config.maxActive <= 0),
  };
}

/** Creation checks existence; execution separately checks enabled/review status. */
export async function missingWorkflowSkills(
  options: WebUiOptions,
  request: { skills: string[]; stages?: WorkflowStage[] },
): Promise<string[]> {
  const required = workflowSkillDependencies(request.skills, request.stages);
  if (!required.length) return [];
  // The presentation catalog is capped at 200 rows; dependency validation must
  // inspect the complete registry and must not run unrelated bundle validation.
  const catalog = await discoverSkills(options.cwd, options.config.skills);
  const available = new Set(catalog.skills.map((skill) => skill.name));
  return required.filter((skill) => !available.has(skill));
}
