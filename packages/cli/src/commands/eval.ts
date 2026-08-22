import { exec as execCallback, execFileSync } from "child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join, relative, resolve } from "path";
import { createHash, randomUUID } from "crypto";
import { promisify } from "util";
import {
  AcceptanceSuiteSchema,
  AcceptanceReportSchema,
  compareAcceptanceReports,
  VerificationContractSchema,
  scoreAcceptanceTask,
  type AcceptanceCheckResult,
  type AcceptanceSuite,
  type AcceptanceTaskResult,
  type AcceptanceUsage,
  type AcceptanceReliability,
  type AcceptanceComparison,
  type AcceptanceReport,
  type AcceptanceSummary,
} from "@orbit-build/core";
import { DEFAULT_CONFIG } from "@orbit-build/config";
import { WorktreeManager, type WorktreeSession } from "@orbit-build/sandbox";
import { SessionStore } from "@orbit-build/session";
import {
  HIDDEN_CHILD_PROCESS_OPTIONS,
  readBoundedRegularFile,
  readBoundedRegularFileBuffer,
  redactSecrets,
  resolveSafePath,
} from "@orbit-build/shared";
import picocolors from "picocolors";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { runAgent } from "./run.js";

const exec = promisify(execCallback);
const MAX_SUITE_BYTES = 1024 * 1024;
const MAX_REPORT_BYTES = 4 * 1024 * 1024;
const MAX_FIXTURE_FILES = 10_000;
const MAX_FIXTURE_FILE_BYTES = 8 * 1024 * 1024;
const MAX_FIXTURE_TOTAL_BYTES = 64 * 1024 * 1024;
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
  baseline: z.string().trim().min(1).max(4096).optional(),
  maxDurationRegressionPercent: z.coerce
    .number()
    .finite()
    .min(0)
    .max(1000)
    .default(25),
});

export type EvalOptions = z.input<typeof EvalOptionsSchema>;

interface EvaluationReport extends AcceptanceReport {
  comparison?: AcceptanceComparison;
}

/** Run a task-level acceptance suite in disposable Git worktrees. */
export async function runEval(
  cwd: string,
  suiteFile: string,
  options: EvalOptions = {},
): Promise<EvaluationReport> {
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
      if (value.allowCommands) {
        writeAcceptanceVerificationContract(worktree.path, task);
      }
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
          security: {
            ...DEFAULT_CONFIG.security,
            // The suite commands were explicitly reviewed and authorized by
            // --allow-commands, and execute only in this disposable worktree.
            trustProjectExecutables: value.allowCommands,
          },
          agent: {
            ...DEFAULT_CONFIG.agent,
            // Acceptance tasks commonly include implementation plus their
            // verification-repair loop. Keep them bounded, but do not inherit
            // the shorter conversational default that truncates long Skills.
            maxIterations: 50,
          },
        },
        task.mode === "multi",
        {
          nonInteractive: true,
          // Eval already has explicit task, iteration, cost, worktree, and
          // verification bounds. Periodic UI prompts would otherwise abort
          // every long acceptance task without weakening tool approvals.
          autoContinueRunaway: true,
        },
      );
      const checks = value.allowCommands
        ? await runVerificationChecks(worktree.path, task.verification)
        : [];
      const changedFiles = readChangedFiles(worktree.path);
      const sessionId = outcome?.sessionId || undefined;
      let resolvedModels: string[] = [];
      let usage: AcceptanceUsage | undefined;
      let reliability: AcceptanceReliability | undefined;
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
        reliability = {
          attempts: trace.journal?.attempt ?? 0,
          toolRuns: trace.metrics.toolRuns,
          toolFailures: trace.metrics.toolFailures,
          deniedTools: trace.metrics.deniedTools,
          approvalRequests: trace.toolCalls.filter(
            (call) => call.permissionDecision === "ask",
          ).length,
          compactions: trace.metrics.compactions,
          resumedCount: trace.metrics.resumedCount,
          verificationRuns: trace.events.filter(
            (event) => event.type === "verification_ended",
          ).length,
          checkpoints: trace.events.filter(
            (event) => event.type === "checkpoint_created",
          ).length,
        };
        traceFile = writeEvaluationTrace(cwd, runId, task.id, trace);
      }
      results.push(
        scoreAcceptanceTask({
          task: {
            ...task,
            provider: task.provider || value.provider,
            model: task.model || value.model,
            limits:
              suite.defaultLimits || task.limits
                ? { ...suite.defaultLimits, ...task.limits }
                : undefined,
          },
          agentStatus: outcome?.status || "failed",
          durationMs: Date.now() - taskStartedAt,
          changedFiles,
          checks,
          resolvedModels,
          usage,
          reliability,
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
            limits:
              suite.defaultLimits || task.limits
                ? { ...suite.defaultLimits, ...task.limits }
                : undefined,
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
  const report: EvaluationReport = {
    schemaVersion: 1,
    runId,
    suite: suite.name,
    suiteMetadata: suite.metadata,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    passed: passedTasks === results.length,
    passedTasks,
    totalTasks: results.length,
    summary: buildAcceptanceSummary(results),
    results,
  };
  if (value.baseline) {
    const baseline = loadAcceptanceReport(cwd, value.baseline);
    report.comparison = compareAcceptanceReports(report, baseline, {
      maxMedianDurationIncreaseRate: value.maxDurationRegressionPercent / 100,
    });
    report.passed = report.passed && report.comparison.passed;
  }
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
    if (report.comparison) {
      console.log(
        report.comparison.passed
          ? picocolors.green(
              `✔ Baseline regression gate passed (${report.comparison.baselineRunId}).`,
            )
          : picocolors.red(
              `✖ Baseline regression gate failed: ${report.comparison.findings.join(", ")}`,
            ),
      );
    }
  }
  if (!report.passed) process.exitCode = 1;
  return report;
}

/** Aggregate objective harness signals without averaging away failed tasks. */
export function buildAcceptanceSummary(
  results: AcceptanceTaskResult[],
): AcceptanceSummary {
  const total = results.length;
  const durations = results
    .map((result) => result.durationMs)
    .sort((left, right) => left - right);
  const midpoint = Math.floor(durations.length / 2);
  const medianDurationMs =
    durations.length === 0
      ? 0
      : durations.length % 2 === 1
        ? durations[midpoint]
        : Math.round((durations[midpoint - 1] + durations[midpoint]) / 2);
  const verificationChecks = results.flatMap((result) => result.checks);
  const verificationPasses = verificationChecks.filter(
    (check) => check.passed,
  ).length;
  const sumUsage = (field: keyof AcceptanceUsage) =>
    results.reduce((sum, result) => {
      const value = result.usage?.[field];
      return sum + (typeof value === "number" ? value : 0);
    }, 0);
  return {
    completionRate:
      total > 0 ? results.filter((result) => result.passed).length / total : 0,
    verificationPassRate:
      verificationChecks.length > 0
        ? verificationPasses / verificationChecks.length
        : 0,
    crashOrAbortRate:
      total > 0
        ? results.filter((result) => result.agentStatus !== "completed")
            .length / total
        : 0,
    medianDurationMs,
    totalInputTokens: sumUsage("inputTokens"),
    totalOutputTokens: sumUsage("outputTokens"),
    totalCacheReadTokens: sumUsage("cacheReadTokens"),
    totalApprovalRequests: results.reduce(
      (sum, result) => sum + (result.reliability?.approvalRequests ?? 0),
      0,
    ),
    totalToolFailures: results.reduce(
      (sum, result) => sum + (result.reliability?.toolFailures ?? 0),
      0,
    ),
    unintendedFileChangeFindings: results.reduce(
      (sum, result) =>
        sum +
        result.failureReasons.filter((reason) =>
          reason.startsWith("forbidden_file_changed:"),
        ).length,
      0,
    ),
  };
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
  const suite = AcceptanceSuiteSchema.parse(raw);
  if (suite.metadata.fixturePaths.length === 0) return suite;
  const fixtureHash = computeAcceptanceFixtureHash(
    cwd,
    suite.metadata.fixturePaths,
  );
  if (
    suite.metadata.fixtureHash !== undefined &&
    suite.metadata.fixtureHash.toLowerCase() !== fixtureHash
  ) {
    throw new Error(
      `Acceptance fixture hash mismatch: declared ${suite.metadata.fixtureHash}, observed ${fixtureHash}.`,
    );
  }
  return AcceptanceSuiteSchema.parse({
    ...suite,
    metadata: { ...suite.metadata, fixtureHash },
  });
}

/** Hash an explicitly declared, bounded fixture tree without following links. */
export function computeAcceptanceFixtureHash(
  cwd: string,
  fixturePaths: readonly string[],
): string {
  const files: Array<{ path: string; absolutePath: string; size: number }> = [];
  const directories: string[] = [];
  let totalBytes = 0;
  const visit = (requestedPath: string, absolutePath: string): void => {
    const normalized = requestedPath.replace(/\\/g, "/").replace(/^\.\//, "");
    if (isSensitiveFixturePath(normalized)) {
      throw new Error(
        `Acceptance fixture path is sensitive or generated: ${normalized}`,
      );
    }
    const stats = lstatSync(absolutePath);
    if (stats.isSymbolicLink()) {
      throw new Error(
        `Acceptance fixtures cannot contain symbolic links: ${normalized}`,
      );
    }
    if (stats.isDirectory()) {
      directories.push(normalized.replace(/\/$/, ""));
      for (const name of readdirSync(absolutePath).sort((a, b) =>
        a.localeCompare(b, "en"),
      )) {
        visit(
          `${normalized.replace(/\/$/, "")}/${name}`,
          join(absolutePath, name),
        );
      }
      return;
    }
    if (!stats.isFile()) {
      throw new Error(
        `Acceptance fixture must be a regular file or directory: ${normalized}`,
      );
    }
    if (stats.size > MAX_FIXTURE_FILE_BYTES) {
      throw new Error(
        `Acceptance fixture file exceeds the 8 MiB limit: ${normalized}`,
      );
    }
    totalBytes += stats.size;
    if (totalBytes > MAX_FIXTURE_TOTAL_BYTES) {
      throw new Error(
        "Acceptance fixture tree exceeds the 64 MiB total limit.",
      );
    }
    files.push({ path: normalized, absolutePath, size: stats.size });
    if (files.length > MAX_FIXTURE_FILES) {
      throw new Error(
        `Acceptance fixture tree exceeds ${MAX_FIXTURE_FILES} files.`,
      );
    }
  };

  for (const requestedPath of Array.from(new Set(fixturePaths)).sort()) {
    const absolutePath = resolveSafePath(cwd, requestedPath);
    const normalized = relative(resolve(cwd), absolutePath).replace(/\\/g, "/");
    visit(normalized, absolutePath);
  }
  const digest = createHash("sha256");
  for (const directory of directories.sort()) {
    digest.update(`directory\0${directory}\0`, "utf8");
  }
  for (const file of files.sort((left, right) =>
    left.path.localeCompare(right.path, "en"),
  )) {
    const content = readBoundedRegularFileBuffer(
      file.absolutePath,
      MAX_FIXTURE_FILE_BYTES,
      { allowSymbolicLink: false },
    );
    if (content === undefined || content.byteLength !== file.size) {
      throw new Error(`Acceptance fixture changed while hashing: ${file.path}`);
    }
    digest.update(`file\0${file.path}\0${file.size}\0`, "utf8");
    digest.update(content);
    digest.update("\0", "utf8");
  }
  return digest.digest("hex");
}

function isSensitiveFixturePath(filePath: string): boolean {
  const normalized = `/${filePath.toLowerCase().replace(/\\/g, "/")}/`;
  const name = basename(filePath).toLowerCase();
  return (
    normalized.includes("/.git/") ||
    normalized.includes("/.orbit/") ||
    normalized.includes("/node_modules/") ||
    name === ".env" ||
    name.startsWith(".env.") ||
    name === ".npmrc" ||
    name === ".pypirc" ||
    name === "id_rsa" ||
    name === "id_ed25519"
  );
}

/** Load a prior bounded report for a same-workspace regression comparison. */
export function loadAcceptanceReport(
  cwd: string,
  reportFile: string,
): AcceptanceReport {
  const filePath = resolveSafePath(cwd, reportFile);
  const stats = lstatSync(filePath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error("Acceptance baseline must be a real file.");
  }
  if (stats.size > MAX_REPORT_BYTES) {
    throw new Error("Acceptance baseline exceeds the 4 MiB limit.");
  }
  const text = readBoundedRegularFile(filePath, MAX_REPORT_BYTES);
  if (text === undefined) throw new Error("Acceptance baseline was not found.");
  return AcceptanceReportSchema.parse(JSON.parse(text));
}

/**
 * Give the Agent the same reviewed verification evidence used by the outer
 * acceptance scorer. This enables its normal repair loop and completion gate
 * without treating arbitrary `node file.js` commands as globally trusted.
 */
export function writeAcceptanceVerificationContract(
  cwd: string,
  task: AcceptanceSuite["tasks"][number],
): string | undefined {
  if (task.verification.length === 0) return undefined;
  const suites = Object.fromEntries(
    task.verification.map((check, index) => [
      `${String(index + 1).padStart(2, "0")}-${check.name}`,
      check.command,
    ]),
  );
  const contract = VerificationContractSchema.parse({
    suites,
    maxRepairAttempts: 3,
  });
  const filePath = resolveSafePath(cwd, join(".orbit", "verification.json"));
  writeJsonAtomically(filePath, contract);
  return filePath;
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
