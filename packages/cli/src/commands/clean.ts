import readline from "readline";
import picocolors from "picocolors";
import { resolve } from "path";
import { z } from "zod";
import { CredentialsManager } from "@orbit-build/config";
import {
  buildCleanupPlan,
  executeCleanupPlan,
  type CleanupPlan,
  type CleanupScope,
} from "../runtime/CleanupManager.js";

const CleanCommandOptionsSchema = z
  .object({
    user: z.boolean().prefault(false),
    project: z.union([z.boolean(), z.string().min(1).max(4096)]).optional(),
    all: z.boolean().prefault(false),
    yes: z.boolean().prefault(false),
    json: z.boolean().prefault(false),
  })
  .strict();

export interface CleanCommandOptions {
  user?: boolean;
  project?: boolean | string;
  all?: boolean;
  yes?: boolean;
  json?: boolean;
}

export interface CleanCommandDependencies {
  homeDirectory?: string;
  confirm?: (prompt: string) => Promise<boolean>;
  write?: (text: string) => void;
  interactive?: boolean;
  purgeUserCredentials?: (orbitDirectory: string) => void;
}

export interface CleanCommandResult {
  applied: boolean;
  plan: CleanupPlan;
  removed: string[];
  skipped: string[];
}

/** Preview and optionally remove Orbit-owned data without touching source files. */
export async function runClean(
  cwd: string,
  rawOptions: CleanCommandOptions,
  dependencies: CleanCommandDependencies = {},
): Promise<CleanCommandResult> {
  const options = CleanCommandOptionsSchema.parse(rawOptions);
  const scopes = resolveScopes(options);
  const projectDirectory =
    typeof options.project === "string" ? resolve(cwd, options.project) : cwd;
  const plan = buildCleanupPlan({
    cwd,
    scopes,
    homeDirectory: dependencies.homeDirectory,
    projectDirectory,
  });
  const write = dependencies.write ?? ((text: string) => console.log(text));

  if (options.json && !options.yes) {
    write(JSON.stringify({ schemaVersion: 1, applied: false, plan }));
    return { applied: false, plan, removed: [], skipped: [] };
  }
  if (!options.json) {
    printCleanupPlan(plan, write);
  }

  if (plan.targets.every((target) => !target.exists)) {
    return { applied: false, plan, removed: [], skipped: [] };
  }

  let confirmed = options.yes;
  if (!confirmed) {
    const interactive =
      dependencies.interactive ?? Boolean(process.stdin.isTTY);
    if (!interactive) {
      throw new Error(
        "Cleanup requires an interactive confirmation or the explicit --yes flag.",
      );
    }
    const confirm = dependencies.confirm ?? confirmDeletion;
    confirmed = await confirm(
      "Type DELETE to permanently remove the listed Orbit data: ",
    );
  }

  if (!confirmed) {
    if (!options.json) write(picocolors.yellow("⚠ Cleanup cancelled."));
    return { applied: false, plan, removed: [], skipped: [] };
  }

  const userTarget = plan.targets.find((target) =>
    target.scopes.includes("user"),
  );
  if (userTarget?.exists) {
    const purgeUserCredentials =
      dependencies.purgeUserCredentials ??
      ((orbitDirectory: string) =>
        new CredentialsManager({ orbitDir: orbitDirectory }).purge());
    purgeUserCredentials(userTarget.path);
  }

  const result = executeCleanupPlan(plan);
  if (options.json) {
    write(
      JSON.stringify({
        schemaVersion: 1,
        applied: true,
        plan,
        ...result,
      }),
    );
  } else {
    write(
      picocolors.green(
        `✔ Removed ${result.removed.length} Orbit data director${result.removed.length === 1 ? "y" : "ies"}.`,
      ),
    );
  }
  return { applied: true, plan, ...result };
}

function resolveScopes(
  options: z.infer<typeof CleanCommandOptionsSchema>,
): CleanupScope[] {
  const scopes: CleanupScope[] = [];
  if (options.all || options.user) scopes.push("user");
  if (options.all || options.project !== undefined) scopes.push("project");
  if (scopes.length === 0) {
    throw new Error("Choose --user, --project [path], or --all.");
  }
  return scopes;
}

function printCleanupPlan(
  plan: CleanupPlan,
  write: (text: string) => void,
): void {
  write(picocolors.bold("\nOrbit cleanup preview\n"));
  for (const target of plan.targets) {
    const scope = target.scopes.join(" + ");
    const status = target.exists
      ? `${target.files} files · ${target.directories} directories · ${formatBytes(target.bytes)}`
      : "not present";
    write(`  ${target.exists ? "●" : "○"} ${scope}: ${target.path}`);
    write(`    ${picocolors.gray(status)}`);
    for (const warning of target.warnings) {
      write(`    ${picocolors.yellow(`⚠ ${warning}`)}`);
    }
  }
  write(
    picocolors.gray(
      "\nOnly .orbit data directories are included. Project source, ORBIT.md, and orbit.config.yaml are preserved.",
    ),
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

async function confirmDeletion(prompt: string): Promise<boolean> {
  const interfaceInstance = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await new Promise<string>((resolve) =>
      interfaceInstance.question(prompt, resolve),
    );
    return answer.trim() === "DELETE";
  } finally {
    interfaceInstance.close();
  }
}
