import { describe, expect, it } from "vitest";
import {
  AcceptanceReportSchema,
  compareAcceptanceReports,
  type AcceptanceReport,
} from "./AcceptanceComparison.js";

function report(overrides: {
  runId: string;
  passed?: boolean;
  duration?: number;
  taskId?: string;
  suite?: string;
  suiteVersion?: string;
  toolFailures?: number;
}): AcceptanceReport {
  const passed = overrides.passed ?? true;
  return {
    schemaVersion: 1,
    runId: overrides.runId,
    suite: overrides.suite ?? "offline coding",
    suiteMetadata: {
      version: overrides.suiteVersion ?? "1",
      deterministic: true,
      tags: ["offline"],
      fixtureHash: "a".repeat(64),
      fixturePaths: ["evals/fixtures/offline"],
    },
    startedAt: "2026-08-20T00:00:00.000Z",
    completedAt: "2026-08-20T00:00:01.000Z",
    passed,
    passedTasks: passed ? 1 : 0,
    totalTasks: 1,
    summary: {
      completionRate: passed ? 1 : 0,
      verificationPassRate: passed ? 1 : 0,
      crashOrAbortRate: passed ? 0 : 1,
      medianDurationMs: overrides.duration ?? 100,
      totalInputTokens: 10,
      totalOutputTokens: 5,
      totalCacheReadTokens: 0,
      totalApprovalRequests: 0,
      totalToolFailures: overrides.toolFailures ?? 0,
      unintendedFileChangeFindings: 0,
    },
    results: [
      {
        taskId: overrides.taskId ?? "repair",
        passed,
        agentStatus: passed ? "completed" : "failed",
        durationMs: overrides.duration ?? 100,
        resolvedModels: ["fixture-model"],
        changedFiles: [],
        checks: [],
        failureReasons: passed ? [] : ["agent_failed"],
      },
    ],
  };
}

describe("acceptance report comparison", () => {
  it("passes an equivalent run within the duration tolerance", () => {
    const baseline = report({ runId: "baseline", duration: 100 });
    const current = report({ runId: "current", duration: 120 });

    expect(compareAcceptanceReports(current, baseline)).toMatchObject({
      compatible: true,
      passed: true,
      findings: [],
      deltas: { medianDurationIncreaseRate: 0.2 },
    });
  });

  it("reports task, aggregate, reliability, and duration regressions", () => {
    const baseline = report({ runId: "baseline", duration: 100 });
    const current = report({
      runId: "current",
      passed: false,
      duration: 140,
      toolFailures: 2,
    });

    const comparison = compareAcceptanceReports(current, baseline);

    expect(comparison.passed).toBe(false);
    expect(comparison.regressedTasks).toEqual(["repair"]);
    expect(comparison.findings).toEqual(
      expect.arrayContaining([
        "task_regressed:repair",
        "completion_rate_drop:1>0",
        "verification_pass_rate_drop:1>0",
        "crash_or_abort_rate_increase:1>0",
        "median_duration_increase:0.4>0.25",
        "tool_failures_increase:2>0",
      ]),
    );
  });

  it("fails closed for a different suite version or task set", () => {
    const comparison = compareAcceptanceReports(
      report({ runId: "current", taskId: "new-task", suiteVersion: "2" }),
      report({ runId: "baseline" }),
    );

    expect(comparison.compatible).toBe(false);
    expect(comparison.findings).toEqual(
      expect.arrayContaining([
        "incompatible:suite_version",
        "incompatible:task_set",
      ]),
    );
  });

  it("rejects inconsistent or duplicate report evidence", () => {
    const baseline = report({ runId: "baseline" });
    expect(() =>
      AcceptanceReportSchema.parse({ ...baseline, passedTasks: 0 }),
    ).toThrow(/passedTasks/);
    expect(() =>
      AcceptanceReportSchema.parse({
        ...baseline,
        totalTasks: 2,
        results: [baseline.results[0], baseline.results[0]],
      }),
    ).toThrow(/Duplicate acceptance result task id/);
    expect(() =>
      AcceptanceReportSchema.parse({
        ...baseline,
        completedAt: "2026-08-19T23:59:59.000Z",
      }),
    ).toThrow(/cannot precede/);
  });
});
