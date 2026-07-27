import picocolors from "picocolors";
import { ConfigLoader } from "@orbit-build/config";
import { discoverSkills } from "@orbit-build/context-engine";

export interface SkillsCommandOptions {
  cwd?: string;
  json?: boolean;
}

/**
 * `orbit skills list` / `orbit skills validate` — the authoring feedback
 * loop outside a running session. `validate` exits non-zero on any
 * error-severity diagnostic so CI and pre-commit hooks can gate broken
 * SKILL.md files; `--json` emits a machine-readable report.
 */
export async function runSkillsCommand(
  action: "list" | "validate",
  options: SkillsCommandOptions = {},
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const config = ConfigLoader.loadSync(cwd);
  if (config.skills.enabled === false) {
    if (options.json) {
      console.log(
        JSON.stringify({ enabled: false, skills: [], diagnostics: [] }),
      );
    } else {
      console.log("Skills are disabled (skills.enabled: false).");
    }
    return 0;
  }

  const catalog = await discoverSkills(cwd, config.skills);
  const errors = catalog.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          enabled: true,
          directories: catalog.directories,
          skills: catalog.skills.map((skill) => ({
            name: skill.name,
            description: skill.description,
            path: skill.path,
            disabled: skill.disabled,
            allowImplicitInvocation: skill.allowImplicitInvocation,
            truncated: skill.truncated,
            loadedBytes: skill.loadedBytes,
          })),
          diagnostics: catalog.diagnostics,
        },
        null,
        2,
      ),
    );
    return action === "validate" && errors.length > 0 ? 1 : 0;
  }

  if (catalog.skills.length === 0) {
    console.log("No skills discovered.");
  }
  for (const skill of catalog.skills) {
    const flags = [
      skill.disabled ? "disabled" : "",
      skill.allowImplicitInvocation ? "" : "explicit-only",
      skill.truncated ? "truncated" : "",
    ]
      .filter(Boolean)
      .join(", ");
    console.log(
      `${picocolors.green(`$${skill.name}`)}${flags ? picocolors.gray(` (${flags})`) : ""}`,
    );
    console.log(`  ${skill.shortDescription || skill.description}`);
    console.log(picocolors.gray(`  ${skill.path}`));
  }
  if (catalog.diagnostics.length > 0) {
    console.log("");
    for (const diagnostic of catalog.diagnostics) {
      const paint =
        diagnostic.severity === "error" ? picocolors.red : picocolors.yellow;
      console.log(
        `${paint(diagnostic.severity)} [${diagnostic.code}] ${diagnostic.message}`,
      );
      console.log(picocolors.gray(`  ${diagnostic.path}`));
    }
  }
  if (action === "validate") {
    if (errors.length > 0) {
      console.error(picocolors.red(`✖ ${errors.length} skill error(s) found.`));
      return 1;
    }
    console.log(
      picocolors.green(
        `✔ ${catalog.skills.length} skill(s) valid` +
          (catalog.diagnostics.length
            ? ` (${catalog.diagnostics.length} warning(s))`
            : ""),
      ),
    );
  }
  return 0;
}
