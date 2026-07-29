import { exec as execCallback, execFileSync } from "child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join } from "path";
import { randomUUID } from "crypto";
import { promisify } from "util";
import {
  AcceptanceSuiteSchema,
  scoreAcceptanceTask,
  type AcceptanceCheckResult,
  type AcceptanceSuite,
  type AcceptanceTaskResult,
  type AcceptanceUsage,
} from "@orbit-build/core";
import { DEFAULT_CONFIG } from "@orbit-build/config";
import { WorktreeManager, type WorktreeSession } from "@orbit-build/sandbox";
import { SessionStore } from "@orbit-build/session";
import {
  HIDDEN_CHILD_PROCESS_OPTIONS,
  readBoundedRegularFile,
  redactSecrets,
  resolveSafePath,
} from "@orbit-build/shared";
import picocolors from "picocolors";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { runAgent } from "./run.js";

const exec = promisify(execCallback);
const MAX_SUITE_BYTES = 1024 * 1024;
const MAX_VERIFICATION_OUTPUT = 4000;

const EvalOptionsSchema = z.object({
  provider: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  task: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
    .optional(),
  allowCommands: z.boolean().default(false),
  json: z.boolean().default(false),
});

export type EvalOptions = z.input<typeof EvalOptionsSchema>;

interface AcceptanceReport {
  schemaVersion: 1;
  runId: string;
  suite: string;
  startedAt: string;
  completedAt: string;
  passed: boolean;
  passedTasks: number;
  totalTasks: number;
  results: AcceptanceTaskResult[];
}

/** Run a task-level acceptance suite in disposable Git worktrees. */
export async function runEval(
  cwd: string,
  suiteFile: string,
  options: EvalOptions = {},
): Promise<AcceptanceReport> {
  const value = EvalOptionsSchema.parse(options);
  const suite = loadAcceptanceSuite(cwd, suiteFile);
  const tasks = value.task
    ? suite.tasks.filter((task) => task.id === value.task)
    : suite.tasks;
  if (tasks.length === 0) {
    throw new Error(`Acceptance task not found: ${value.task}`);
  }
  if (
    !value.allowCommands &&
    tasks.some((task) => task.verification.length > 0)
  ) {
    throw new Error(
      "This suite contains verification commands. Re-run with --allow-commands after reviewing the suite.",
    );
  }
  const worktrees = new WorktreeManager(cwd);
  if (!worktrees.isGitRepo()) {
    throw new Error("Orbit eval requires a Git repository for task isolation.");
  }

  const startedAt = new Date();
  const runId = `eval-${startedAt.toISOString().replace(/[:.]/g, "-")}`;
  const results: AcceptanceTaskResult[] = [];
  for (const task of tasks) {
    if (!value.json) {
      console.log(picocolors.cyan(`● Evaluating ${task.id}...`));
    }
    let worktree: WorktreeSession | undefined;
    const taskStartedAt = Date.now();
    try {
      worktree = worktrees.createWorktree(
        `eval-${task.id}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 60),
      );
      snapshotWorkspaceIntoWorktree(cwd, worktree.path);
      const outcome = await runAgent(
        worktree.path,
        task.prompt,
        {
          ...(task.provider || value.provider
            ? { provider: { default: task.provider || value.provider! } }
            : {}),
          ...(task.model || value.model
            ? { models: { default: task.model || value.model! } }
            : {}),
          permissions: {
            ...DEFAULT_CONFIG.permissions,
            mode: "auto",
            requireApprovalForWrite: false,
            requireApprovalForBash: !value.allowCommands,
          },
        },
        task.mode === "multi",
        { nonInteractive: true },
      );
      const checks = value.allowCommands
        ? await runVerificationChecks(worktree.path, task.verification)
        : [];
      const changedFiles = readChangedFiles(worktree.path);
      const sessionId = outcome?.sessionId || undefined;
      let resolvedModels: string[] = [];
      let usage: AcceptanceUsage | undefined;
      let traceFile: string | undefined;
      if (sessionId) {
        const store = new SessionStore(worktree.path);
        const trace = store.exportTrace(sessionId, { includeHistory: true });
        resolvedModels = trace.events.flatMap((event) => {
          if (
            event.type !== "provider_response_identity" ||
            typeof event.payload !== "object" ||
            event.payload === null ||
            Array.isArray(event.payload) ||
            typeof event.payload.resolvedModel !== "string"
          ) {
            return [];
          }
          return [event.payload.resolvedModel];
        });
        const inputTokens = trace.session.totalInputTokens;
        const cacheReadTokens = trace.session.totalCacheReadTokens || 0;
        usage = {
          inputTokens,
          outputTokens: trace.session.totalOutputTokens,
          cacheReadTokens,
          cacheHitRate:
            inputTokens > 0 ? Math.min(1, cacheReadTokens / inputTokens) : 0,
          costUsd: trace.session.totalCostEstimate,
        };
        traceFile = writeEvaluationTrace(cwd, runId, task.id, trace);
      }
      results.push(
        scoreAcceptanceTask({
          task: {
            ...task,
            provider: task.provider || value.provider,
            model: task.model || value.model,
          },
          agentStatus: outcome?.status || "failed",
          durationMs: Date.now() - taskStartedAt,
          changedFiles,
          checks,
          resolvedModels,
          usage,
          sessionId,
          traceFile,
        }),
      );
    } catch (error: unknown) {
      results.push(
        scoreAcceptanceTask({
          task: {
            ...task,
            provider: task.provider || value.provider,
            model: task.model || value.model,
          },
          agentStatus: "failed",
          durationMs: Date.now() - taskStartedAt,
          changedFiles: worktree ? readChangedFiles(worktree.path) : [],
          checks: [
            {
              name: "orbit_eval_runtime",
              passed: false,
              durationMs: Date.now() - taskStartedAt,
              summary: safeSummary(error),
            },
          ],
        }),
      );
    } finally {
      if (worktree) worktrees.discardWorktree(worktree);
    }
  }

  const passedTasks = results.filter((result) => result.passed).length;
  const report: AcceptanceReport = {
    schemaVersion: 1,
    runId,
    suite: suite.name,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    passed: passedTasks === results.length,
    passedTasks,
    totalTasks: results.length,
    results,
  };
  const reportPath = writeEvaluationReport(cwd, runId, report);
  if (value.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      report.passed
        ? picocolors.green(
            `✔ Acceptance passed: ${passedTasks}/${results.length} tasks.`,
          )
        : picocolors.red(
            `✖ Acceptance failed: ${passedTasks}/${results.length} tasks passed.`,
          ),
    );
    console.log(picocolors.gray(`Report: ${reportPath}`));
  }
  if (!report.passed) process.exitCode = 1;
  return report;
}

export function loadAcceptanceSuite(
  cwd: string,
  suiteFile: string,
): AcceptanceSuite {
  const filePath = resolveSafePath(cwd, suiteFile);
  const stats = lstatSync(filePath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error("Acceptance suite must be a real file.");
  }
  if (stats.size > MAX_SUITE_BYTES) {
    throw new Error("Acceptance suite exceeds the 1 MiB limit.");
  }
  const text = readBoundedRegularFile(filePath, MAX_SUITE_BYTES);
  if (text === undefined) throw new Error("Acceptance suite not found.");
  const raw = filePath.endsWith(".json") ? JSON.parse(text) : parseYaml(text);
  return AcceptanceSuiteSchema.parse(raw);
}

async function runVerificationChecks(
  cwd: string,
  checks: AcceptanceSuite["tasks"][number]["verification"],
): Promise<AcceptanceCheckResult[]> {
  const results: AcceptanceCheckResult[] = [];
  for (const check of checks) {
    const startedAt = Date.now();
    try {
      const result = await exec(check.command, {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        cwd,
        timeout: check.timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
      });
      results.push({
        name: check.name,
        passed: true,
        durationMs: Date.now() - startedAt,
        exitCode: 0,
        summary: safeSummary(`${result.stdout}\n${result.stderr}`),
      });
    } catch (error: unknown) {
      const exitCode =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "number"
          ? error.code
          : undefined;
      results.push({
        name: check.name,
        passed: false,
        durationMs: Date.now() - startedAt,
        exitCode,
        summary: safeSummary(error),
      });
    }
  }
  return results;
}

function readChangedFiles(cwd: string): string[] {
  try {
    const output = execFileSync(
      "git",
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return output
      .split("\0")
      .filter(Boolean)
      .map((entry) => entry.slice(3).split(" -> ").at(-1) || "")
      .filter(Boolean)
      .map((file) => file.replace(/\\/g, "/"));
  } catch {
    return [];
  }
}

/** Materialize the user's current dirty tree as an isolated evaluation baseline. */
function snapshotWorkspaceIntoWorktree(
  sourceCwd: string,
  worktreeCwd: string,
): void {
  const patch = execFileSync(
    "git",
    ["diff", "HEAD", "--binary", "--no-ext-diff"],
    {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      cwd: sourceCwd,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (patch.length > 0) {
    execFileSync("git", ["apply", "--whitespace=nowarn", "-"], {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      cwd: worktreeCwd,
      input: patch,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  }

  const untracked = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z"],
    {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      cwd: sourceCwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    },
  )
    .split("\0")
    .filter(Boolean);
  for (const relativePath of untracked) {
    if (isSensitiveSnapshotPath(relativePath)) continue;
    const sourcePath = resolveSafePath(sourceCwd, relativePath);
    const targetPath = resolveSafePath(worktreeCwd, relativePath);
    const stats = lstatSync(sourcePath);
    if (stats.isSymbolicLink() || !stats.isFile()) continue;
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
  }

  execFileSync("git", ["add", "-A"], {
    ...HIDDEN_CHILD_PROCESS_OPTIONS,
    cwd: worktreeCwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const dirty = execFileSync("git", ["status", "--porcelain"], {
    ...HIDDEN_CHILD_PROCESS_OPTIONS,
    cwd: worktreeCwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (!dirty) return;
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Orbit Eval",
      "-c",
      "user.email=eval@orbit.local",
      "commit",
      "--no-verify",
      "--no-gpg-sign",
      "-m",
      "orbit eval workspace snapshot",
    ],
    {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      cwd: worktreeCwd,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function isSensitiveSnapshotPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const name = basename(normalized);
  return (
    normalized.startsWith(".orbit/") ||
    normalized.includes("/.ssh/") ||
    name === "id_rsa" ||
    name === "id_ed25519" ||
    name === ".npmrc" ||
    name === ".pypirc" ||
    name === ".env" ||
    name.startsWith(".env.")
  );
}

function writeEvaluationTrace(
  cwd: string,
  runId: string,
  taskId: string,
  trace: unknown,
): string {
  const relativePath = join(
    ".orbit",
    "evaluations",
    runId,
    `${taskId}.trace.json`,
  );
  writeJsonAtomically(resolveSafePath(cwd, relativePath), trace);
  return relativePath.replace(/\\/g, "/");
}

function writeEvaluationReport(
  cwd: string,
  runId: string,
  report: AcceptanceReport,
): string {
  const filePath = resolveSafePath(
    cwd,
    join(".orbit", "evaluations", `${runId}.json`),
  );
  writeJsonAtomically(filePath, report);
  return filePath;
}

function writeJsonAtomically(filePath: string, value: unknown): void {
  const directory = dirname(filePath);
  if (existsSync(directory)) {
    const stats = lstatSync(directory);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error("Evaluation output directory must be a real directory.");
    }
  } else {
    mkdirSync(directory, { recursive: true });
  }
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, JSON.stringify(value, null, 2), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    if (existsSync(filePath)) rmSync(filePath, { force: true });
    renameSync(temporaryPath, filePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function safeSummary(value: unknown): string {
  const raw =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  return redactSecrets(raw || "unknown error")
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(-MAX_VERIFICATION_OUTPUT);
}
