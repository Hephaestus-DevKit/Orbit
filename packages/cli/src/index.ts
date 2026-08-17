#!/usr/bin/env node
import { Command, Option } from "commander";
import picocolors from "picocolors";
import { redactSecrets } from "@orbit-build/shared";
import { runInit } from "./commands/init.js";
import { runConfig } from "./commands/config.js";
import { runDoctor } from "./commands/doctor.js";
import { parseBenchOptions, runBench } from "./commands/bench.js";
import { exitCodeForOutcome, runAgent } from "./commands/run.js";
import { runLSPServer } from "./commands/LSPServer.js";
import { runLogin } from "./commands/login.js";
import { runMcpLogin } from "./commands/mcp.js";
import { runSkillsCommand } from "./commands/skills.js";
import { runAgentsCommand } from "./commands/agents.js";
import { runRunsCommand } from "./commands/runs.js";
import {
  runAcpCommand,
  runAcpRegistryCommand,
  runAcpRegistryFetchCommand,
} from "./commands/acp.js";
import { runReviewCommand } from "./commands/review.js";
import { runTraceExport } from "./commands/trace.js";
import { runSessionRetention } from "./commands/sessionRetention.js";
import { runGithubReview } from "./commands/githubReview.js";
import { runGithubReviewComments } from "./commands/githubReviewComments.js";
import {
  parseGithubDispatchInputs,
  runGithubDispatch,
} from "./commands/githubDispatch.js";
import { runWorkflowExport } from "./commands/workflow.js";
import { runEval } from "./commands/eval.js";
import { runClean } from "./commands/clean.js";
import { runUpdate } from "./commands/update.js";
import { runDaemonCommand } from "./commands/daemon.js";
import {
  runBackupCreate,
  runBackupInspect,
  runBackupRestore,
} from "./commands/backup.js";
import {
  installExtension,
  listExtensions,
  removeExtension,
  validateExtension,
} from "./commands/extension.js";
import { readCliVersion } from "./runtime/CliVersion.js";
import { existsSync, realpathSync, statSync } from "fs";
import { resolve } from "path";
import { createCliRunOverrides } from "./runtime/CliRunOverrides.js";

const program = new Command();

function addDaemonRemoteOptions(command: Command): Command {
  return command
    .option(
      "--url <url>",
      "remote daemon URL; local daemon metadata is used by default",
    )
    .option(
      "--token-env <name>",
      "environment variable containing the remote daemon token",
      "ORBIT_DAEMON_TOKEN",
    );
}

function applyOutcomeExitCode(
  outcome: Awaited<ReturnType<typeof runAgent>>,
): void {
  const currentExitCode =
    typeof process.exitCode === "number" ? process.exitCode : 0;
  process.exitCode = Math.max(currentExitCode, exitCodeForOutcome(outcome));
}

program
  .name("orbit")
  .description("Orbit - Local AI Coding Agent Runtime")
  .version(readCliVersion())
  .argument("[task]", "task description for Orbit to execute")
  .option("--provider <provider>", "specify model provider")
  .option("--model <model>", "specify model name")
  .option(
    "--agent-profile <name>",
    "select a validated Agent Profile for this task",
  )
  .option(
    "--yes",
    "enable unrestricted Full Access and approve every enabled tool action",
  )
  .option("--multi", "run in multi-agent planning/coding/review mode")
  .option("--direct", "run interactive REPL in direct console streaming mode")
  .action(async (task, options) => {
    const cwd = process.cwd();
    const overrides = createCliRunOverrides({
      provider: options.provider,
      model: options.model,
      direct: !!options.direct,
      fullAccess: !!options.yes,
    });
    const outcome = await runAgent(cwd, task, overrides, !!options.multi, {
      agentProfile: options.agentProfile,
    });
    applyOutcomeExitCode(outcome);
  });

program
  .command("init")
  .description("initialize an Agent-first Orbit project contract and workflows")
  .option("--minimal", "create only ORBIT.md for legacy-compatible setup")
  .option("--json", "print the scaffold result as JSON")
  .action(async (options) => {
    await runInit(process.cwd(), {
      minimal: !!options.minimal,
      json: !!options.json,
    });
  });

program
  .command("config")
  .description("show resolved configurations")
  .action(() => {
    runConfig(process.cwd());
  });

program
  .command("extension")
  .description("validate a versioned Orbit extension manifest")
  .argument("<manifest>", "YAML or JSON manifest inside the workspace")
  .option("--json", "print the normalized manifest as JSON")
  .action((manifest, options) => {
    validateExtension(process.cwd(), manifest, { json: !!options.json });
  });

program
  .command("extension-install")
  .description("install or update a validated local Orbit extension")
  .argument("<manifest>", "YAML or JSON manifest inside the workspace")
  .option(
    "--trust",
    "approve requested process, network, credential, or write access",
  )
  .action((manifest, options) => {
    installExtension(process.cwd(), manifest, { trust: !!options.trust });
  });

program
  .command("extension-list")
  .description("list installed Orbit extensions")
  .option("--json", "print the extension registry as JSON")
  .action((options) => listExtensions({ json: !!options.json }));

program
  .command("extension-remove")
  .description(
    "remove an installed Orbit extension and its prompt contributions",
  )
  .argument("<id>", "extension ID")
  .action((id) => removeExtension(id));

program
  .command("clean")
  .description("preview and remove Orbit-owned user or project data")
  .option("--user", "include user data under ~/.orbit")
  .option(
    "--project [path]",
    "include project data under <path>/.orbit (default: current directory)",
  )
  .option("--all", "include both user and current-project Orbit data")
  .option("--yes", "apply without an interactive DELETE confirmation")
  .option("--json", "print the versioned cleanup plan and result as JSON")
  .action(async (options) => {
    await runClean(process.cwd(), {
      user: !!options.user,
      project: options.project,
      all: !!options.all,
      yes: !!options.yes,
      json: !!options.json,
    });
  });

const sessionsCommand = program
  .command("sessions")
  .description("inspect and retain local Orbit sessions");
sessionsCommand
  .command("retention")
  .description("preview or apply bounded session retention")
  .option("--older-than <days>", "remove sessions older than N days")
  .option("--max-sessions <count>", "keep at most N newest sessions")
  .option("--max-bytes <bytes>", "keep total session storage under N bytes")
  .option("--include-active", "allow active sessions to be removed")
  .option("--yes", "apply without interactive RETAIN confirmation")
  .option("--json", "print a machine-readable plan or result")
  .action(async (options) => {
    try {
      await runSessionRetention(process.cwd(), {
        olderThanDays: options.olderThan,
        maxSessions: options.maxSessions,
        maxBytes: options.maxBytes,
        includeActive: !!options.includeActive,
        yes: !!options.yes,
        json: !!options.json,
      });
    } catch (error: unknown) {
      console.error(
        picocolors.red(
          `✖ ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      process.exitCode = 1;
    }
  });

const backupCommand = program
  .command("backup")
  .description("create, inspect, or safely restore portable project data");

backupCommand
  .command("create")
  .description(
    "back up durable .orbit project data without caches or credentials",
  )
  .option("-o, --output <file>", "backup output path")
  .option("--json", "print a machine-readable summary")
  .action((options) => {
    runBackupCreate(process.cwd(), {
      output: options.output,
      json: !!options.json,
    });
  });

backupCommand
  .command("inspect")
  .description("validate and summarize an Orbit project backup")
  .argument("<file>", "backup file")
  .option("--json", "print a machine-readable summary")
  .action((file, options) => runBackupInspect(file, { json: !!options.json }));

backupCommand
  .command("restore")
  .description("restore a validated backup into the current project")
  .argument("<file>", "backup file")
  .option("--force", "replace existing durable project data")
  .option("--json", "print a machine-readable result")
  .action((file, options) =>
    runBackupRestore(process.cwd(), file, {
      force: !!options.force,
      json: !!options.json,
    }),
  );

program
  .command("update")
  .description("check for and install the latest published Orbit CLI")
  .option("--check", "check for an update without installing it")
  .option("--channel <channel>", "update channel: stable or beta", "stable")
  .option("--yes", "install an available update without prompting")
  .option("--json", "print a versioned machine-readable result")
  .action(async (options) => {
    await runUpdate(readCliVersion(), {
      check: !!options.check,
      yes: !!options.yes,
      json: !!options.json,
      channel: options.channel,
    });
  });

const skillsCommand = program
  .command("skills")
  .description("list and validate reusable Skills");
skillsCommand
  .command("list")
  .description("list discovered skills with their diagnostics")
  .option("--json", "print a machine-readable catalog")
  .action(async (options: { json?: boolean }) => {
    process.exitCode = await runSkillsCommand("list", { json: !!options.json });
  });
skillsCommand
  .command("validate")
  .description("validate SKILL.md files; non-zero exit on errors (CI-friendly)")
  .option("--json", "print a machine-readable report")
  .option(
    "-d, --directory <paths...>",
    "validate only the specified Skill source directories",
  )
  .option(
    "--deep",
    "validate bundled references, assets, and filesystem safety",
  )
  .action(
    async (options: {
      json?: boolean;
      deep?: boolean;
      directory?: string[];
    }) => {
      process.exitCode = await runSkillsCommand("validate", {
        json: !!options.json,
        deep: !!options.deep,
        directories: options.directory,
      });
    },
  );

const agentsCommand = program
  .command("agents")
  .description("list and validate reusable Agent Profiles");
agentsCommand
  .command("list")
  .description("list discovered Agent Profiles with diagnostics")
  .option("--json", "print a machine-readable catalog")
  .action((options: { json?: boolean }) => {
    process.exitCode = runAgentsCommand("list", { json: !!options.json });
  });

const runsCommand = program
  .command("runs")
  .description("inspect and recover durable Agent control-plane runs");
runsCommand
  .command("list")
  .description("list persisted Agent runs without attaching to a UI")
  .option("--limit <n>", "maximum runs to show (1-100)", "20")
  .option("--json", "print a machine-readable catalog")
  .action((options: { limit?: string; json?: boolean }) => {
    const limit =
      options.limit === undefined ? undefined : Number(options.limit);
    process.exitCode = runRunsCommand("list", undefined, {
      limit,
      json: !!options.json,
    });
  });
runsCommand
  .command("inspect <run>")
  .description("inspect one durable run and its child-agent states")
  .option("--json", "print a machine-readable snapshot")
  .action((run: string, options: { json?: boolean }) => {
    process.exitCode = runRunsCommand("inspect", run, {
      json: !!options.json,
    });
  });
runsCommand
  .command("recover")
  .description("mark runs with expired process leases as interrupted")
  .option("--json", "print a machine-readable result")
  .action((options: { json?: boolean }) => {
    process.exitCode = runRunsCommand("recover", undefined, {
      json: !!options.json,
    });
  });
agentsCommand
  .command("validate")
  .description("validate Agent Profile manifests; non-zero on errors")
  .option("--json", "print a machine-readable report")
  .action((options: { json?: boolean }) => {
    process.exitCode = runAgentsCommand("validate", { json: !!options.json });
  });

const acpCommand = program
  .command("acp")
  .description("discover, inspect, probe, and run ACP external coding agents");
acpCommand
  .command("list")
  .description("list configured ACP external agents")
  .option("--json", "print a machine-readable catalog")
  .action(async (options: { json?: boolean }) => {
    process.exitCode = await runAcpCommand("list", undefined, undefined, {
      json: !!options.json,
    });
  });
const acpRegistryCommand = acpCommand
  .command("registry")
  .description("inspect local ACP manifests without executing them");
acpRegistryCommand
  .command("list")
  .description("list user/project ACP registry entries")
  .option("--json", "print a machine-readable registry")
  .option(
    "--require-signature",
    "only discover registries with a valid configured Ed25519 signature",
  )
  .action((options: { json?: boolean; requireSignature?: boolean }) => {
    process.exitCode = runAcpRegistryCommand("list", {
      json: !!options.json,
      requireSignature: !!options.requireSignature,
    });
  });
acpRegistryCommand
  .command("validate")
  .description("validate local ACP registry manifests")
  .option("--json", "print a machine-readable validation report")
  .option(
    "--require-signature",
    "fail unless every discovered registry has a valid configured Ed25519 signature",
  )
  .action((options: { json?: boolean; requireSignature?: boolean }) => {
    process.exitCode = runAcpRegistryCommand("validate", {
      json: !!options.json,
      requireSignature: !!options.requireSignature,
    });
  });
acpRegistryCommand
  .command("fetch")
  .description("fetch and verify a hosted ACP registry into the project")
  .requiredOption("--url <url>", "HTTPS hosted registry URL")
  .option(
    "--out <path>",
    "workspace-relative output path",
    ".orbit/acp/registry.json",
  )
  .option("--registry-id <id>", "require a specific signed registry id")
  .option("--owner <owner>", "require a specific signed registry owner")
  .option("--force", "allow replacing a different or newer local registry")
  .option("--allow-unsigned", "allow a metadata-valid but unsigned registry")
  .option("--json", "print a machine-readable fetch result")
  .action(async (options) => {
    process.exitCode = await runAcpRegistryFetchCommand({
      cwd: process.cwd(),
      url: options.url,
      out: options.out,
      registryId: options.registryId,
      owner: options.owner,
      force: !!options.force,
      allowUnsigned: !!options.allowUnsigned,
      json: !!options.json,
    });
  });
acpCommand
  .command("probe <agent>")
  .description("negotiate ACP capabilities without running a task")
  .option("--json", "print a machine-readable capability snapshot")
  .action(async (agent: string, options: { json?: boolean }) => {
    process.exitCode = await runAcpCommand("probe", agent, undefined, {
      json: !!options.json,
    });
  });
acpCommand
  .command("sessions <agent>")
  .description("list durable sessions exposed by an ACP external agent")
  .option("--json", "print a machine-readable session catalog")
  .action(async (agent: string, options: { json?: boolean }) => {
    process.exitCode = await runAcpCommand("sessions", agent, undefined, {
      json: !!options.json,
    });
  });
acpCommand
  .command("import <agent> <session>")
  .description("import a bounded ACP session replay as inert Orbit history")
  .option("--title <title>", "title for the imported Orbit session")
  .option("--force", "create another snapshot even when the digest is imported")
  .option(
    "--allow-truncated",
    "explicitly import a bounded prefix when the ACP history exceeds limits",
  )
  .option("--json", "print a machine-readable import receipt")
  .action(
    async (
      agent: string,
      session: string,
      options: {
        title?: string;
        force?: boolean;
        allowTruncated?: boolean;
        json?: boolean;
      },
    ) => {
      process.exitCode = await runAcpCommand("import", agent, session, {
        title: options.title,
        force: !!options.force,
        allowTruncated: !!options.allowTruncated,
        json: !!options.json,
      });
    },
  );
acpCommand
  .command("close <agent> <session>")
  .description(
    "close an active durable ACP session and release agent resources",
  )
  .option("--json", "print a machine-readable close receipt")
  .action(
    async (agent: string, session: string, options: { json?: boolean }) => {
      process.exitCode = await runAcpCommand("close", agent, session, {
        json: !!options.json,
      });
    },
  );
acpCommand
  .command("run <agent> <prompt>")
  .description("run a prompt through one ACP external agent")
  .option("--json", "print the final result as JSON")
  .option("--jsonl", "stream sanitized ACP updates as JSONL")
  .option("--session <id>", "continue an existing durable ACP session")
  .option(
    "--restore <strategy>",
    "session restore strategy: auto, resume, or load",
    "auto",
  )
  .action(
    async (
      agent: string,
      prompt: string,
      options: {
        json?: boolean;
        jsonl?: boolean;
        session?: string;
        restore?: string;
      },
    ) => {
      const restore = options.restore;
      if (restore !== "auto" && restore !== "resume" && restore !== "load") {
        console.error(
          picocolors.red(
            `✖ Invalid ACP restore strategy: ${restore || "(empty)"}.`,
          ),
        );
        process.exitCode = 1;
        return;
      }
      process.exitCode = await runAcpCommand("run", agent, prompt, {
        json: !!options.json,
        jsonl: !!options.jsonl,
        sessionId: options.session,
        sessionRestore: restore,
      });
    },
  );

const reviewCommand = program
  .command("review")
  .description("inspect persisted review findings and dispositions");
reviewCommand
  .command("list")
  .description("list reviewer artifacts from the current project")
  .option("--json", "print a machine-readable catalog")
  .action((options: { json?: boolean }) => {
    process.exitCode = runReviewCommand("list", undefined, undefined, {
      json: !!options.json,
    });
  });
reviewCommand
  .command("show <artifact>")
  .description("show findings from one reviewer artifact")
  .option("--json", "print a machine-readable artifact")
  .action((artifact: string, options: { json?: boolean }) => {
    process.exitCode = runReviewCommand("show", artifact, undefined, {
      json: !!options.json,
    });
  });
reviewCommand
  .command("set <artifact> <finding>")
  .description("set a finding disposition without changing source files")
  .requiredOption("--disposition <value>", "open, accepted, fixed, or wont_fix")
  .option("--json", "print a machine-readable result")
  .action(
    (
      artifact: string,
      finding: string,
      options: { disposition: string; json?: boolean },
    ) => {
      process.exitCode = runReviewCommand("set", artifact, finding, {
        disposition: options.disposition as
          | "open"
          | "accepted"
          | "fixed"
          | "wont_fix",
        json: !!options.json,
      });
    },
  );
reviewCommand
  .command("verify [artifact]")
  .description("fail when an artifact has an open P0/P1 finding (CI-safe)")
  .option("--json", "print a machine-readable gate result")
  .action((artifact: string | undefined, options: { json?: boolean }) => {
    process.exitCode = runReviewCommand("verify", artifact, undefined, {
      json: !!options.json,
    });
  });
reviewCommand
  .command("export [artifact]")
  .description("export review findings for CI or code-scanning systems")
  .option("--format <format>", "json or sarif", "sarif")
  .option("-o, --out <file>", "write inside the current workspace")
  .option("--json", "print a machine-readable export receipt")
  .action(
    (
      artifact: string | undefined,
      options: { format?: string; out?: string; json?: boolean },
    ) => {
      if (options.format !== "json" && options.format !== "sarif") {
        console.error(
          picocolors.red("✖ Review export format must be json or sarif."),
        );
        process.exitCode = 1;
        return;
      }
      process.exitCode = runReviewCommand("export", artifact, undefined, {
        format: options.format,
        out: options.out,
        json: !!options.json,
      });
    },
  );
reviewCommand
  .command("github-check [artifact]")
  .description("dry-run or publish a Review result as a GitHub Check Run")
  .option(
    "--repo <owner/repository>",
    "GitHub repository; defaults to GITHUB_REPOSITORY",
  )
  .option("--sha <commit>", "head commit SHA; defaults to GITHUB_SHA")
  .option(
    "--pr <number>",
    "verify the pull request head before publishing a Check Run",
  )
  .option("--name <name>", "check run name", "Orbit Review")
  .option(
    "--token-env <name>",
    "environment variable containing the token",
    "GITHUB_TOKEN",
  )
  .option(
    "--api-base-url <url>",
    "GitHub or Enterprise API base URL",
    "https://api.github.com",
  )
  .option(
    "--allow-custom-api",
    "allow sending the token to an explicit custom HTTPS API host",
  )
  .option("--apply", "create the Check Run; default is dry-run")
  .option("--json", "print a machine-readable payload/result")
  .action(
    async (
      artifact: string | undefined,
      options: {
        repo?: string;
        sha?: string;
        pr?: string;
        name?: string;
        tokenEnv?: string;
        apiBaseUrl?: string;
        allowCustomApi?: boolean;
        apply?: boolean;
        json?: boolean;
      },
    ) => {
      try {
        await runGithubReview(process.cwd(), {
          artifact,
          repo: options.repo ?? process.env.GITHUB_REPOSITORY ?? "",
          sha: options.sha ?? process.env.GITHUB_SHA ?? "",
          pullRequest:
            options.pr === undefined ? undefined : Number(options.pr),
          name: options.name,
          tokenEnv: options.tokenEnv,
          apiBaseUrl: options.apiBaseUrl,
          allowCustomApi: !!options.allowCustomApi,
          apply: !!options.apply,
          json: !!options.json,
        });
      } catch (error: unknown) {
        console.error(
          picocolors.red(
            `✖ ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        process.exitCode = 1;
      }
    },
  );
reviewCommand
  .command("github-comment <pr> [artifact]")
  .description("dry-run or publish idempotent GitHub inline review comments")
  .requiredOption("--repo <owner/repository>", "GitHub repository")
  .requiredOption("--sha <commit>", "commit SHA for the review comments")
  .option(
    "--token-env <name>",
    "environment variable containing the token",
    "GITHUB_TOKEN",
  )
  .option(
    "--api-base-url <url>",
    "GitHub or Enterprise API base URL",
    "https://api.github.com",
  )
  .option("--allow-custom-api", "allow an explicit custom HTTPS API host")
  .option("--apply", "create comments; default is dry-run")
  .option("--json", "print a machine-readable plan/result")
  .action(
    async (
      pr: string,
      artifact: string | undefined,
      options: {
        repo: string;
        sha: string;
        tokenEnv?: string;
        apiBaseUrl?: string;
        allowCustomApi?: boolean;
        apply?: boolean;
        json?: boolean;
      },
    ) => {
      try {
        await runGithubReviewComments(process.cwd(), {
          repo: options.repo,
          pullRequest: Number(pr),
          sha: options.sha,
          artifact,
          tokenEnv: options.tokenEnv,
          apiBaseUrl: options.apiBaseUrl,
          allowCustomApi: !!options.allowCustomApi,
          apply: !!options.apply,
          json: !!options.json,
        });
      } catch (error: unknown) {
        console.error(
          picocolors.red(
            `✖ ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        process.exitCode = 1;
      }
    },
  );
reviewCommand
  .command("github-dispatch <workflow> [ref]")
  .description("dry-run or trigger a GitHub Actions workflow dispatch")
  .requiredOption("--repo <owner/repository>", "GitHub repository")
  .option(
    "--input <name=value>",
    "workflow input (repeatable)",
    (value, previous: string[] = []) => [...previous, value],
    [],
  )
  .option(
    "--token-env <name>",
    "environment variable containing the token",
    "GITHUB_TOKEN",
  )
  .option(
    "--api-base-url <url>",
    "GitHub or Enterprise API base URL",
    "https://api.github.com",
  )
  .option("--allow-custom-api", "allow an explicit custom HTTPS API host")
  .option("--apply", "trigger the workflow; default is dry-run")
  .option("--json", "print a machine-readable plan/result")
  .action(
    async (
      workflow: string,
      ref: string | undefined,
      options: {
        repo: string;
        input?: string[];
        tokenEnv?: string;
        apiBaseUrl?: string;
        allowCustomApi?: boolean;
        apply?: boolean;
        json?: boolean;
      },
    ) => {
      try {
        await runGithubDispatch({
          repo: options.repo,
          workflow,
          ref,
          inputs: parseGithubDispatchInputs(options.input),
          tokenEnv: options.tokenEnv,
          apiBaseUrl: options.apiBaseUrl,
          allowCustomApi: !!options.allowCustomApi,
          apply: !!options.apply,
          json: !!options.json,
        });
      } catch (error: unknown) {
        console.error(
          picocolors.red(
            `✖ ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        process.exitCode = 1;
      }
    },
  );

const mcpCommand = program
  .command("mcp")
  .description("manage Model Context Protocol servers");
mcpCommand
  .command("login <server>")
  .description("authorize an MCP server via OAuth (PKCE) and save the login")
  .option("--port <port>", "fixed loopback port for the OAuth redirect")
  .action(async (server: string, options: { port?: string }) => {
    const port = options.port ? Number.parseInt(options.port, 10) : undefined;
    if (
      options.port &&
      (!Number.isInteger(port) || port! < 1 || port! > 65_535)
    ) {
      console.error(picocolors.red("✖ --port must be an integer in 1-65535."));
      process.exitCode = 1;
      return;
    }
    process.exitCode = await runMcpLogin(server, { port });
  });

program
  .command("login")
  .description("manage secure provider logins and model catalogs")
  .option("--list", "list saved provider logins")
  .option("--delete <provider>", "delete a saved provider login")
  .option("--service <provider>", "configure a provider profile")
  .option("--name <name>", "set the provider display name")
  .option(
    "--base-url <url>",
    "set the exact API base URL (include /v1 when required)",
  )
  .option("--no-activate", "save without making this provider active")
  .action(async (options) => {
    await runLogin({
      list: !!options.list,
      deleteProvider: options.delete,
      provider: options.service,
      name: options.name,
      baseUrl: options.baseUrl,
      activate: options.activate,
    });
  });

program
  .command("doctor")
  .description("diagnose local environment and API configs")
  .option("--probe", "perform a lightweight live provider capability probe")
  .option(
    "--deepseek",
    "include DeepSeek V4 endpoint, model, alias, and cache diagnostics",
  )
  .option("--json", "print a redacted machine-readable diagnostic snapshot")
  .option("--strict", "return a non-zero status for warnings or errors")
  .action(async (_localOptions, command) => {
    const options = command.optsWithGlobals();
    await runDoctor(process.cwd(), {
      probe: !!options.probe,
      deepseek: !!options.deepseek,
      json: !!options.json,
      strict: !!options.strict,
      provider: options.provider,
    });
  });

program
  .command("bench")
  .description(
    "measure first model/answer latency, decode throughput, and cache telemetry",
  )
  .option("--provider <provider>", "provider id to benchmark")
  .option("--model <model>", "model to benchmark")
  .option("--models <models>", "comma-separated models to benchmark")
  .option("--prompt <prompt>", "custom benchmark prompt")
  .option(
    "--repeat <n>",
    "samples to record: 1-20 (default: 1; cache profile minimum: 3)",
  )
  .option(
    "--max-tokens <n>",
    "completion cap: 1-16384 (defaults: disabled=256, high=4096, max=8192)",
  )
  .option(
    "--cache-profile",
    "run a repeated stable-prefix DeepSeek cache profile (minimum 3 samples)",
  )
  .option(
    "--thinking <mode>",
    "thinking mode: disabled, low, high, or max (DeepSeek V4 exposes native high/max; provider default: high)",
  )
  .option(
    "--min-cache-hit <ratio>",
    "fail when repeated-sample average cache hit is below ratio, e.g. 0.75 or 75",
  )
  .option(
    "--max-first-delta-ms <ms>",
    "fail when p90 first model delta exceeds this latency",
  )
  .option(
    "--max-first-text-ms <ms>",
    "fail when p90 first answer exceeds this latency",
  )
  .option(
    "--min-throughput <tokensPerSecond>",
    "fail when p50 decode throughput is below this rate",
  )
  .option(
    "--max-error-rate <ratio>",
    "fail when sample error rate exceeds a ratio or percentage",
  )
  .option("--json", "print benchmark samples as JSON")
  .action(async (_localOptions, command) => {
    // Commander stores options shared with the parent command (notably
    // --model and --provider) on the parent even when they appear after
    // `bench`. Read the merged view so an explicit benchmark model wins over
    // the configured fast-model fallback.
    const options = parseBenchOptions(command.optsWithGlobals());
    await runBench(process.cwd(), {
      provider: options.provider,
      model: options.model,
      models: options.models,
      prompt: options.prompt,
      repeat: options.repeat,
      maxTokens: options.maxTokens,
      cacheProfile: !!options.cacheProfile,
      thinking: options.thinking,
      minCacheHit: options.minCacheHit,
      maxFirstDeltaMs: options.maxFirstDeltaMs,
      maxFirstTextMs: options.maxFirstTextMs,
      minThroughput: options.minThroughput,
      maxErrorRate: options.maxErrorRate,
      json: !!options.json,
    });
  });

program
  .command("eval")
  .description("run a task-level coding acceptance suite in isolated worktrees")
  .argument("<suite>", "YAML or JSON acceptance suite inside the workspace")
  .option("--provider <provider>", "provider override for every task")
  .option("--model <model>", "model override for every task")
  .option("--task <id>", "run one task from the suite")
  .option(
    "--allow-commands",
    "run the suite's reviewed verification commands inside worktrees",
  )
  .option("--json", "print the versioned evaluation report as JSON")
  .action(async (suite, localOptions, command) => {
    const options = command.optsWithGlobals();
    await runEval(process.cwd(), suite, {
      provider: localOptions.provider || options.provider,
      model: localOptions.model || options.model,
      task: localOptions.task,
      allowCommands: !!localOptions.allowCommands,
      json: !!localOptions.json,
    });
  });

program
  .command("trace")
  .description("export a redacted, versioned session audit trace")
  .argument("<session>", "session id to export")
  .option("--full", "include redacted conversation history")
  .option("--out <path>", "write inside the workspace instead of stdout")
  .action((session, options) => {
    const output = runTraceExport(process.cwd(), session, {
      full: !!options.full,
      out: options.out,
    });
    if (output) console.log(`Trace exported to ${output}`);
  });

program
  .command("workflow-export")
  .description("compile a redacted session trace into a reviewable Skill")
  .argument("<session>", "session id to compile")
  .requiredOption("--name <name>", "lowercase kebab-case Skill name")
  .option("--description <text>", "short reusable workflow description")
  .option("--scope <scope>", "local or versioned", "local")
  .option("--json", "print a machine-readable result")
  .action(async (session, options) => {
    const result = await runWorkflowExport(process.cwd(), session, {
      name: options.name,
      description: options.description,
      scope: options.scope,
      json: !!options.json,
    });
    if (!options.json) console.log(`✔ Workflow Skill created: ${result.path}`);
  });

program
  .command("lsp")
  .description("start the local LSP autocomplete server")
  .action(async () => {
    await runLSPServer(process.cwd());
  });

program
  .command("webui")
  .description("start Orbit as a browser-first local coding workspace")
  .option("--port <port>", "preferred loopback port (default: 6047)")
  .option("--cwd <path>", "open a specific project directory")
  .addOption(new Option("--no-open").hideHelp())
  .action(async (localOptions, command) => {
    const options = command.optsWithGlobals();
    const rawPort = localOptions.port;
    const port = rawPort === undefined ? undefined : Number(rawPort);
    if (
      port !== undefined &&
      (!Number.isInteger(port) || port < 0 || port > 65535)
    ) {
      throw new Error("Web UI port must be an integer from 0 to 65535.");
    }
    const overrides = createCliRunOverrides({
      provider: options.provider,
      model: options.model,
      direct: true,
      fullAccess: !!options.yes,
    });
    const requestedCwd = resolve(localOptions.cwd || process.cwd());
    if (!existsSync(requestedCwd) || !statSync(requestedCwd).isDirectory()) {
      throw new Error(
        `Web UI project directory does not exist: ${requestedCwd}`,
      );
    }
    // Windows can hand us an 8.3 short path (for example through %TEMP%).
    // libuv's recursive watcher expects the watched root and event paths to
    // use the same canonical spelling, otherwise the process can abort.
    const cwd = realpathSync.native(requestedCwd);
    const outcome = await runAgent(cwd, undefined, overrides, false, {
      webUi: { port },
    });
    applyOutcomeExitCode(outcome);
  });

const daemonCommand = program
  .command("daemon")
  .description("start and control the authenticated durable task daemon");
daemonCommand
  .command("start")
  .description("run the daemon in the foreground or detach it")
  .option("--host <host>", "listener host (loopback by default)", "127.0.0.1")
  .option("--port <port>", "listener port (0 chooses an available port)", "0")
  .option(
    "--root <paths...>",
    "allowed project roots (defaults to the current directory)",
  )
  .option("--background", "detach the daemon after starting")
  .option("--cert <file>", "TLS certificate for non-loopback listeners")
  .option("--key <file>", "TLS private key for non-loopback listeners")
  .option(
    "--jwks <file>",
    "offline JWKS file for optional JWT organization identity",
  )
  .option(
    "--issuer <url>",
    "required JWT issuer for daemon organization identity",
  )
  .option(
    "--audience <name>",
    "required JWT audience for daemon organization identity",
  )
  .option("--json", "print a machine-readable startup result")
  .action(async (options) => {
    const port = Number(options.port);
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      throw new Error("Daemon port must be an integer from 0 to 65535.");
    }
    if ((options.cert && !options.key) || (!options.cert && options.key)) {
      throw new Error("Daemon TLS requires both --cert and --key.");
    }
    process.exitCode = await runDaemonCommand("start", {
      host: options.host,
      port,
      root: options.root,
      background: !!options.background,
      cert: options.cert,
      key: options.key,
      jwks: options.jwks,
      issuer: options.issuer,
      audience: options.audience,
      json: !!options.json,
    });
  });
for (const action of ["status", "stop", "tasks"] as const) {
  const command = daemonCommand
    .command(action)
    .description(
      action === "status"
        ? "inspect daemon health"
        : action === "stop"
          ? "stop the daemon through its authenticated control endpoint"
          : "list durable daemon tasks",
    )
    .option("--json", "print a machine-readable result");
  if (action === "tasks") {
    command.option("--limit <n>", "maximum durable tasks to return", "100");
  }
  addDaemonRemoteOptions(command);
  command.action(async (options) => {
    const limit =
      options.limit === undefined ? undefined : Number(options.limit);
    if (
      limit !== undefined &&
      (!Number.isInteger(limit) || limit < 1 || limit > 500)
    ) {
      throw new Error("Daemon task limit must be an integer from 1 to 500.");
    }
    process.exitCode = await runDaemonCommand(action, {
      json: !!options.json,
      limit,
      remoteUrl: options.url,
      tokenEnv: options.tokenEnv,
    });
  });
}

const daemonAuditCommand = daemonCommand
  .command("audit")
  .description("inspect the verified, redacted daemon audit chain")
  .option("--limit <n>", "maximum audit entries to return", "500")
  .option("--json", "print a machine-readable result");
addDaemonRemoteOptions(daemonAuditCommand).action(async (options) => {
  const limit = Number(options.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("Daemon audit limit must be an integer from 1 to 500.");
  }
  process.exitCode = await runDaemonCommand("audit", {
    limit,
    json: !!options.json,
    remoteUrl: options.url,
    tokenEnv: options.tokenEnv,
  });
});

const daemonSubmitCommand = daemonCommand
  .command("submit <prompt>")
  .description("submit a durable task to the authenticated daemon")
  .option("--cwd <path>", "task workspace (defaults to current directory)")
  .option("--provider <provider>", "provider override for this task")
  .option("--model <model>", "model override for this task")
  .option("--agent-profile <name>", "Agent Profile override for this task")
  .option("--full-access", "request unrestricted Full Access for this task")
  .option("--json", "print the durable task record as JSON");
addDaemonRemoteOptions(daemonSubmitCommand).action(
  async (prompt, localOptions, command) => {
    const options = { ...command.optsWithGlobals(), ...localOptions };
    process.exitCode = await runDaemonCommand("submit", {
      prompt,
      taskCwd: options.cwd,
      provider: options.provider,
      model: options.model,
      agentProfile: options.agentProfile,
      fullAccess: !!(options.fullAccess || options.yes),
      json: !!options.json,
      remoteUrl: options.url,
      tokenEnv: options.tokenEnv,
    });
  },
);

const daemonInspectCommand = daemonCommand
  .command("inspect <task>")
  .description("inspect one durable daemon task")
  .option("--json", "print the durable task record as JSON");
addDaemonRemoteOptions(daemonInspectCommand).action(async (task, options) => {
  process.exitCode = await runDaemonCommand("inspect", {
    taskId: task,
    json: !!options.json,
    remoteUrl: options.url,
    tokenEnv: options.tokenEnv,
  });
});

const daemonEventsCommand = daemonCommand
  .command("events <task>")
  .description("replay or follow one task's bounded event journal")
  .option("--after <sequence>", "replay events after this sequence", "0")
  .option("--limit <n>", "maximum replayed events", "200")
  .option("--follow", "keep streaming until the task reaches a terminal state")
  .option("--json", "print a replay snapshot as JSON")
  .option("--jsonl", "stream each event as one JSON line");
addDaemonRemoteOptions(daemonEventsCommand).action(async (task, options) => {
  const after = Number(options.after);
  const limit = Number(options.limit);
  if (!Number.isInteger(after) || after < 0 || after > 5_000) {
    throw new Error("Daemon event sequence must be an integer from 0 to 5000.");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("Daemon event limit must be an integer from 1 to 500.");
  }
  if (options.json && options.jsonl) {
    throw new Error("Choose either --json or --jsonl for daemon events.");
  }
  process.exitCode = await runDaemonCommand("events", {
    taskId: task,
    after,
    limit,
    follow: !!options.follow,
    json: !!options.json,
    jsonl: !!options.jsonl,
    remoteUrl: options.url,
    tokenEnv: options.tokenEnv,
  });
});

for (const action of ["cancel", "resume", "remove"] as const) {
  const command = daemonCommand
    .command(`${action} <task>`)
    .description(
      action === "cancel"
        ? "cancel a queued or running daemon task"
        : action === "resume"
          ? "explicitly resume an interrupted or terminal daemon task"
          : "remove one explicitly selected terminal daemon task and its journal",
    )
    .option("--json", "print the resulting durable task record as JSON");
  addDaemonRemoteOptions(command).action(async (task, options) => {
    process.exitCode = await runDaemonCommand(action, {
      taskId: task,
      json: !!options.json,
      remoteUrl: options.url,
      tokenEnv: options.tokenEnv,
    });
  });
}

program
  .command("exec")
  .description("run a task in non-interactive mode and stream events as JSONL")
  .argument("<prompt>", "the task prompt to execute")
  .option("--provider <provider>", "specify model provider")
  .option("--model <model>", "specify model name")
  .option(
    "--agent-profile <name>",
    "select a validated Agent Profile for this task",
  )
  .option("--resume <session>", "resume a persisted Orbit session")
  .option("--jsonl", "output event logs in JSONL format")
  .action(async (prompt, localOptions, command) => {
    // Commander may store options shared with the root command on the parent
    // even when they appear after `exec`; always consume the merged view.
    const options = { ...command.optsWithGlobals(), ...localOptions };
    const cwd = process.cwd();
    const overrides = createCliRunOverrides({
      provider: options.provider,
      model: options.model,
      fullAccess: !!options.yes,
    });
    const outcome = await runAgent(cwd, prompt, overrides, false, {
      nonInteractive: true,
      jsonl: !!options.jsonl,
      resumeSessionId: options.resume,
      agentProfile: options.agentProfile,
    });
    applyOutcomeExitCode(outcome);
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    picocolors.red(`✖ Orbit command failed: ${redactSecrets(message)}`),
  );
  process.exitCode = 1;
}
