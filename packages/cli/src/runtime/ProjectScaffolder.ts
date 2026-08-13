import { existsSync, promises as fs } from "fs";
import { dirname, join, relative, resolve } from "path";
import { z } from "zod";
import { readBoundedRegularFile, resolveSafePath } from "@orbit-build/shared";

const MAX_PROJECT_MANIFEST_BYTES = 1024 * 1024;

const PackageManifestSchema = z
  .object({
    scripts: z.record(z.string().max(20_000)).optional(),
  })
  .passthrough();

export interface ProjectScaffoldOptions {
  /** Preserve the pre-0.7.6 behavior and create only ORBIT.md. */
  minimal?: boolean;
}

export interface ProjectScaffoldFile {
  path: string;
  status: "created" | "existing";
  purpose: "agent-contract" | "verification" | "workflow";
}

export interface ProjectScaffoldResult {
  files: ProjectScaffoldFile[];
  ecosystems: string[];
  verificationSuites: string[];
  warnings: string[];
}

/** Create a safe, non-destructive project contract for Orbit's agent runtime. */
export async function scaffoldAgentProject(
  cwd: string,
  options: ProjectScaffoldOptions = {},
): Promise<ProjectScaffoldResult> {
  const workspace = await fs.realpath(resolve(cwd));
  const project = await inspectProject(workspace);
  const files: ProjectScaffoldFile[] = [];
  const warnings: string[] = [];

  files.push(
    await writeScaffoldFile(
      workspace,
      "ORBIT.md",
      renderAgentContract(project.ecosystems, project.suites),
      "agent-contract",
    ),
  );

  if (!options.minimal) {
    if (Object.keys(project.suites).length > 0) {
      files.push(
        await writeScaffoldFile(
          workspace,
          ".orbit/verification.json",
          `${JSON.stringify(
            { suites: project.suites, maxRepairAttempts: 3 },
            null,
            2,
          )}\n`,
          "verification",
        ),
      );
      warnings.push(
        "Review the generated verification commands, then enable security.trustProjectExecutables in orbit.config.yaml before Orbit may execute them.",
      );
    }
    files.push(
      await writeScaffoldFile(
        workspace,
        ".orbit/commands/implement.md",
        IMPLEMENT_WORKFLOW,
        "workflow",
      ),
      await writeScaffoldFile(
        workspace,
        ".orbit/commands/review.md",
        REVIEW_WORKFLOW,
        "workflow",
      ),
    );
  }

  return {
    files,
    ecosystems: project.ecosystems,
    verificationSuites: Object.keys(project.suites),
    warnings,
  };
}

async function inspectProject(workspace: string): Promise<{
  ecosystems: string[];
  suites: Record<string, string>;
}> {
  const ecosystems: string[] = [];
  const suites: Record<string, string> = {};
  const packagePath = join(workspace, "package.json");
  if (existsSync(packagePath)) {
    const content = readBoundedRegularFile(
      packagePath,
      MAX_PROJECT_MANIFEST_BYTES,
    );
    if (content !== undefined) {
      try {
        const parsed = PackageManifestSchema.safeParse(JSON.parse(content));
        if (parsed.success) {
          ecosystems.push("Node.js");
          const runner = detectPackageRunner(workspace);
          for (const script of [
            "lint",
            "typecheck",
            "test",
            "build",
          ] as const) {
            const command = parsed.data.scripts?.[script];
            if (!command || isPlaceholderTest(script, command)) continue;
            suites[script] = packageScriptCommand(runner, script);
          }
        }
      } catch {
        // A malformed project manifest is user-owned. Initialization remains
        // useful, but no executable verification command is guessed from it.
      }
    }
  }

  if (existsSync(join(workspace, "Cargo.toml"))) {
    ecosystems.push("Rust");
    suites["rust-check"] = "cargo check";
    suites["rust-test"] = "cargo test";
  }
  if (existsSync(join(workspace, "go.mod"))) {
    ecosystems.push("Go");
    suites["go-test"] = "go test ./...";
  }
  if (
    existsSync(join(workspace, "pytest.ini")) ||
    manifestMentionsPytest(workspace)
  ) {
    ecosystems.push("Python");
    suites["python-test"] = "python -m pytest";
  } else if (
    existsSync(join(workspace, "pyproject.toml")) ||
    existsSync(join(workspace, "requirements.txt"))
  ) {
    ecosystems.push("Python");
  }

  return { ecosystems: [...new Set(ecosystems)], suites };
}

function detectPackageRunner(
  workspace: string,
): "pnpm" | "yarn" | "bun" | "npm" {
  if (existsSync(join(workspace, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(workspace, "yarn.lock"))) return "yarn";
  if (
    existsSync(join(workspace, "bun.lock")) ||
    existsSync(join(workspace, "bun.lockb"))
  ) {
    return "bun";
  }
  return "npm";
}

function packageScriptCommand(
  runner: "pnpm" | "yarn" | "bun" | "npm",
  script: string,
): string {
  if (runner === "pnpm") return `pnpm ${script}`;
  if (runner === "yarn") return `yarn ${script}`;
  if (runner === "bun") return `bun run ${script}`;
  return `npm run ${script}`;
}

function isPlaceholderTest(script: string, command: string): boolean {
  return script === "test" && /no test specified/i.test(command);
}

function manifestMentionsPytest(workspace: string): boolean {
  for (const filename of ["pyproject.toml", "requirements.txt"]) {
    const path = join(workspace, filename);
    if (!existsSync(path)) continue;
    const content = readBoundedRegularFile(path, MAX_PROJECT_MANIFEST_BYTES);
    if (content && /(?:^|[^a-z])pytest(?:[^a-z]|$)/i.test(content)) return true;
  }
  return false;
}

async function writeScaffoldFile(
  workspace: string,
  relativePath: string,
  content: string,
  purpose: ProjectScaffoldFile["purpose"],
): Promise<ProjectScaffoldFile> {
  const target = resolveSafePath(workspace, relativePath);
  if (existsSync(target)) {
    return { path: normalizePath(relativePath), status: "existing", purpose };
  }
  const parent = resolveSafePath(workspace, dirname(target));
  await fs.mkdir(parent, { recursive: true });
  const canonicalParent = await fs.realpath(parent);
  resolveSafePath(workspace, canonicalParent);
  try {
    await fs.writeFile(target, content, { encoding: "utf8", flag: "wx" });
    return {
      path: normalizePath(relative(workspace, target)),
      status: "created",
      purpose,
    };
  } catch (error: unknown) {
    if (isAlreadyExists(error)) {
      return {
        path: normalizePath(relative(workspace, target)),
        status: "existing",
        purpose,
      };
    }
    throw error;
  }
}

function renderAgentContract(
  ecosystems: string[],
  suites: Record<string, string>,
): string {
  const detected =
    ecosystems.length > 0 ? ecosystems.join(", ") : "not detected";
  const verification =
    Object.entries(suites)
      .map(([name, command]) => `- ${name}: \`${command}\``)
      .join("\n") ||
    "- No safe command was inferred; inspect the project before choosing verification.";
  return `# Orbit Agent Contract

Orbit is an engineering agent for this project. Treat each request as an outcome to deliver, not merely a message to answer.

## Execution loop

1. Inspect the relevant code, configuration, tests, and current Git state before editing.
2. For multi-step work, maintain a short task plan with exactly one active step.
3. Make bounded changes that respect existing architecture, ownership, security, and style.
4. Use native tools for filesystem, shell, planning, and verification actions; never simulate execution in prose.
5. Run the narrowest meaningful check first, repair failures, then expand verification in proportion to risk.
6. Do not declare completion until requested artifacts exist and verification evidence has been recorded.
7. Report the outcome, changed files, verification performed, remaining risks, and any action still requiring user authority.

## Project signals

- Detected ecosystems: ${detected}
- Generated verification candidates:
${verification}

## Safety and quality

- Keep all file operations inside this workspace and preserve unrelated user changes.
- Never expose credentials or place them in source, generated artifacts, logs, or commits.
- Keep constructors free of I/O; validate external boundaries; prefer deterministic scripts for fragile repeated work.
- External publication, destructive operations, and irreversible actions require explicit authorization.
`;
}

const IMPLEMENT_WORKFLOW = `---
description: Deliver an engineering task through inspection, implementation, and verification
argument-hint: <objective and acceptance criteria>
---

Treat $ARGUMENTS as a concrete agent objective. Inspect the workspace, state a short plan when the work is multi-step, implement the complete bounded change, run risk-appropriate verification, repair failures, and finish with an evidence-backed delivery receipt. Do not stop at advice when the requested outcome requires code or artifacts.
`;

const REVIEW_WORKFLOW = `---
description: Audit an implementation without changing it
argument-hint: <scope, diff, or acceptance criteria>
---

Review $ARGUMENTS as a read-only engineering audit. Inspect relevant code and tests, prioritize correctness, security, regressions, recovery, and missing verification, and report findings with precise file references. Do not modify files unless the user separately authorizes a fix.
`;

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}
