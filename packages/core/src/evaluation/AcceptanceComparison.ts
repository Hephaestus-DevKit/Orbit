import { z } from "zod";
import {
  AcceptanceSuiteSchema,
  AcceptanceTaskResultSchema,
} from "./AcceptanceSuite.js";

export const AcceptanceSummarySchema = z.object({
  completionRate: z.number().finite().min(0).max(1),
  verificationPassRate: z.number().finite().min(0).max(1),
  crashOrAbortRate: z.number().finite().min(0).max(1),
  medianDurationMs: z.number().int().nonnegative(),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  totalCacheReadTokens: z.number().int().nonnegative(),
  totalApprovalRequests: z.number().int().nonnegative(),
  totalToolFailures: z.number().int().nonnegative(),
  unintendedFileChangeFindings: z.number().int().nonnegative(),
});

export type AcceptanceSummary = z.infer<typeof AcceptanceSummarySchema>;

export const AcceptanceReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().trim().min(1).max(200),
    suite: z.string().trim().min(1).max(200),
    suiteMetadata: AcceptanceSuiteSchema.shape.metadata,
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    passed: z.boolean(),
    passedTasks: z.number().int().nonnegative(),
    totalTasks: z.number().int().nonnegative(),
    summary: AcceptanceSummarySchema,
    results: z.array(AcceptanceTaskResultSchema).max(100),
  })
  .superRefine((report, context) => {
    const taskIds = new Set<string>();
    report.results.forEach((result, index) => {
      if (taskIds.has(result.taskId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["results", index, "taskId"],
          message: `Duplicate acceptance result task id: ${result.taskId}`,
        });
      }
      taskIds.add(result.taskId);
    });
    if (report.totalTasks !== report.results.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["totalTasks"],
        message: "Acceptance totalTasks must equal the result count.",
      });
    }
    const observedPassedTasks = report.results.filter(
      (result) => result.passed,
    ).length;
    if (report.passedTasks !== observedPassedTasks) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["passedTasks"],
        message: "Acceptance passedTasks must equal the passing result count.",
      });
    }
    if (report.passed && observedPassedTasks !== report.results.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["passed"],
        message: "A passing acceptance report cannot contain a failed task.",
      });
    }
    if (Date.parse(report.completedAt) < Date.parse(report.startedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "Acceptance completion time cannot precede its start time.",
      });
    }
  });

export type AcceptanceReport = z.infer<typeof AcceptanceReportSchema>;

export const AcceptanceRegressionThresholdsSchema = z.object({
  maxCompletionRateDrop: z.number().finite().min(0).max(1).default(0),
  maxVerificationPassRateDrop: z.number().finite().min(0).max(1).default(0),
  maxCrashOrAbortRateIncrease: z.number().finite().min(0).max(1).default(0),
  maxMedianDurationIncreaseRate: z
    .number()
    .finite()
    .min(0)
    .max(10)
    .default(0.25),
  maxToolFailuresIncrease: z.number().int().nonnegative().default(0),
  maxApprovalRequestsIncrease: z.number().int().nonnegative().default(0),
});

export type AcceptanceRegressionThresholds = z.input<
  typeof AcceptanceRegressionThresholdsSchema
>;

export interface AcceptanceComparison {
  readonly baselineRunId: string;
  readonly compatible: boolean;
  readonly passed: boolean;
  readonly findings: readonly string[];
  readonly regressedTasks: readonly string[];
  readonly deltas: {
    readonly completionRate: number;
    readonly verificationPassRate: number;
    readonly crashOrAbortRate: number;
    readonly medianDurationIncreaseRate: number | null;
    readonly toolFailures: number;
    readonly approvalRequests: number;
  };
}

/** Compare equivalent acceptance runs without hiding task-level regressions. */
export function compareAcceptanceReports(
  currentInput: AcceptanceReport,
  baselineInput: AcceptanceReport,
  thresholdInput: AcceptanceRegressionThresholds = {},
): AcceptanceComparison {
  const current = AcceptanceReportSchema.parse(currentInput);
  const baseline = AcceptanceReportSchema.parse(baselineInput);
  const thresholds = AcceptanceRegressionThresholdsSchema.parse(thresholdInput);
  const findings: string[] = [];

  if (current.suite !== baseline.suite) findings.push("incompatible:suite");
  if (current.suiteMetadata.version !== baseline.suiteMetadata.version) {
    findings.push("incompatible:suite_version");
  }
  if (
    current.suiteMetadata.fixtureHash !== baseline.suiteMetadata.fixtureHash
  ) {
    findings.push("incompatible:fixture_hash");
  }

  const currentByTask = new Map(
    current.results.map((result) => [result.taskId, result]),
  );
  const baselineTaskIds = baseline.results
    .map((result) => result.taskId)
    .sort();
  const currentTaskIds = current.results.map((result) => result.taskId).sort();
  if (baselineTaskIds.join("\0") !== currentTaskIds.join("\0")) {
    findings.push("incompatible:task_set");
  }
  const regressedTasks = baseline.results
    .filter(
      (result) => result.passed && !currentByTask.get(result.taskId)?.passed,
    )
    .map((result) => result.taskId)
    .sort();
  findings.push(...regressedTasks.map((taskId) => `task_regressed:${taskId}`));

  const deltas = {
    completionRate: roundRate(
      current.summary.completionRate - baseline.summary.completionRate,
    ),
    verificationPassRate: roundRate(
      current.summary.verificationPassRate -
        baseline.summary.verificationPassRate,
    ),
    crashOrAbortRate: roundRate(
      current.summary.crashOrAbortRate - baseline.summary.crashOrAbortRate,
    ),
    medianDurationIncreaseRate:
      baseline.summary.medianDurationMs > 0
        ? roundRate(
            current.summary.medianDurationMs /
              baseline.summary.medianDurationMs -
              1,
          )
        : null,
    toolFailures:
      current.summary.totalToolFailures - baseline.summary.totalToolFailures,
    approvalRequests:
      current.summary.totalApprovalRequests -
      baseline.summary.totalApprovalRequests,
  };

  addRateFinding(
    findings,
    "completion_rate_drop",
    -deltas.completionRate,
    thresholds.maxCompletionRateDrop,
  );
  addRateFinding(
    findings,
    "verification_pass_rate_drop",
    -deltas.verificationPassRate,
    thresholds.maxVerificationPassRateDrop,
  );
  addRateFinding(
    findings,
    "crash_or_abort_rate_increase",
    deltas.crashOrAbortRate,
    thresholds.maxCrashOrAbortRateIncrease,
  );
  if (
    deltas.medianDurationIncreaseRate !== null &&
    deltas.medianDurationIncreaseRate > thresholds.maxMedianDurationIncreaseRate
  ) {
    findings.push(
      `median_duration_increase:${deltas.medianDurationIncreaseRate}>${thresholds.maxMedianDurationIncreaseRate}`,
    );
  }
  if (deltas.toolFailures > thresholds.maxToolFailuresIncrease) {
    findings.push(
      `tool_failures_increase:${deltas.toolFailures}>${thresholds.maxToolFailuresIncrease}`,
    );
  }
  if (deltas.approvalRequests > thresholds.maxApprovalRequestsIncrease) {
    findings.push(
      `approval_requests_increase:${deltas.approvalRequests}>${thresholds.maxApprovalRequestsIncrease}`,
    );
  }

  const compatible = !findings.some((finding) =>
    finding.startsWith("incompatible:"),
  );
  return {
    baselineRunId: baseline.runId,
    compatible,
    passed: compatible && findings.length === 0,
    findings: Object.freeze(findings),
    regressedTasks: Object.freeze(regressedTasks),
    deltas,
  };
}

function addRateFinding(
  findings: string[],
  name: string,
  actual: number,
  allowed: number,
): void {
  if (actual > allowed)
    findings.push(`${name}:${roundRate(actual)}>${allowed}`);
}

function roundRate(value: number): number {
  return Number(value.toFixed(6));
}
