import picocolors from "picocolors";
import { ConfigLoader, discoverAgentProfiles } from "@orbit-build/config";

export interface AgentsCommandOptions {
  cwd?: string;
  json?: boolean;
}

/** List user/project Agent Profiles and fail CI on malformed manifests. */
export function runAgentsCommand(
  action: "list" | "validate",
  options: AgentsCommandOptions = {},
): number {
  const cwd = options.cwd ?? process.cwd();
  const config = ConfigLoader.loadSync(cwd);
  if (!config.agents.enabled) {
    if (options.json) {
      console.log(
        JSON.stringify({ enabled: false, profiles: [], diagnostics: [] }),
      );
    } else {
      console.log("Agent Profiles are disabled (agents.enabled: false).");
    }
    return 0;
  }
  const catalog = discoverAgentProfiles(cwd, config.agents);
  const errors = catalog.diagnostics.filter(
    (item) => item.severity === "error",
  );
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          schemaVersion: 1,
          enabled: true,
          directories: catalog.directories,
          profiles: catalog.profiles.map((profile) => ({
            name: profile.name,
            displayName: profile.displayName,
            description: profile.description,
            provider: profile.provider,
            model: profile.model,
            permissionMode: profile.permissionMode,
            allowedTools: profile.allowedTools,
            disallowedTools: profile.disallowedTools,
            skills: profile.skills,
            maxTurns: profile.maxTurns,
            isolation: profile.isolation,
            memory: profile.memory,
            path: profile.path,
            source: profile.source,
          })),
          diagnostics: catalog.diagnostics,
        },
        null,
        2,
      ),
    );
    return action === "validate" && errors.length > 0 ? 1 : 0;
  }
  if (catalog.profiles.length === 0)
    console.log("No Agent Profiles discovered.");
  for (const profile of catalog.profiles) {
    const model = profile.model ? ` · model=${profile.model}` : "";
    const mode = profile.permissionMode
      ? ` · mode=${profile.permissionMode}`
      : "";
    console.log(
      `${picocolors.green(profile.name)}${picocolors.gray(`${model}${mode}`)}`,
    );
    if (profile.description) console.log(`  ${profile.description}`);
    console.log(picocolors.gray(`  ${profile.source} · ${profile.path}`));
  }
  for (const diagnostic of catalog.diagnostics) {
    const paint =
      diagnostic.severity === "error" ? picocolors.red : picocolors.yellow;
    console.log(
      `${paint(diagnostic.severity)} [${diagnostic.code}] ${diagnostic.message}`,
    );
    console.log(picocolors.gray(`  ${diagnostic.path}`));
  }
  if (action === "validate") {
    if (errors.length > 0) {
      console.error(
        picocolors.red(`✖ ${errors.length} Agent Profile error(s) found.`),
      );
      return 1;
    }
    console.log(
      picocolors.green(`✔ ${catalog.profiles.length} Agent Profile(s) valid.`),
    );
  }
  return 0;
}
