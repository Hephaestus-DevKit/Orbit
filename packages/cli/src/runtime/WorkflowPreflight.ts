import type { OrbitConfig } from "@orbit-build/config";
import { discoverSkills } from "@orbit-build/context-engine";
import {
  getRequiredCommandSkills,
  type CustomCommand,
} from "../commands/customCommands.js";

/** Check current dependencies before a workflow prompt reaches any agent. */
export async function checkWorkflowDependencies(
  cwd: string,
  command: CustomCommand,
  config: OrbitConfig["skills"],
): Promise<string | undefined> {
  const required = getRequiredCommandSkills(command);
  if (required.length === 0) return undefined;
  if (!config.enabled || config.maxActive <= 0) {
    return "Skills are disabled. Enable Skills and set maxActive above zero before running this workflow.";
  }
  const catalog = await discoverSkills(cwd, config);
  const skills = new Map(catalog.skills.map((skill) => [skill.name, skill]));
  const missing = required.filter((name) => !skills.has(name));
  const disabled = required.filter((name) => skills.get(name)?.disabled);
  const drafts = required.filter(
    (name) => skills.get(name)?.reviewStatus === "draft",
  );
  const problems = [
    drafts.length > 0
      ? `Skills pending review: ${drafts.join(", ")}. Review SKILL.md and set policy.review_status to approved in agents/openai.yaml, then refresh Skills.`
      : "",
    missing.length > 0
      ? `Missing Skills: ${missing.join(", ")}. Install them or check Skill directories.`
      : "",
    disabled.length > 0
      ? `Disabled Skills: ${disabled.join(", ")}. Enable them before running this workflow.`
      : "",
  ].filter(Boolean);
  return problems.length > 0 ? problems.join(" ") : undefined;
}
