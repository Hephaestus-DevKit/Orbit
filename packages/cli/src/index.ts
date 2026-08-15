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
import { runTraceExport } from "./commands/trace.js";
import { runWorkflowExport } from "./commands/workflow.js";
import { runEval } from "./commands/eval.js";
import { runClean } from "./commands/clean.js";
import { runUpdate } from "./commands/update.js";
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
agentsCommand
  .command("validate")
  .description("validate Agent Profile manifests; non-zero on errors")
  .option("--json", "print a machine-readable report")
  .action((options: { json?: boolean }) => {
    process.exitCode = runAgentsCommand("validate", { json: !!options.json });
  });

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
