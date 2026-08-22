import { describe, expect, it } from "vitest";
import {
  AcceptanceSuiteSchema,
  scoreAcceptanceTask,
} from "./AcceptanceSuite.js";

describe("acceptance suite", () => {
  const task = AcceptanceSuiteSchema.parse({
    schemaVersion: 1,
    name: "DeepSeek coding acceptance",
    tasks: [
      {
        id: "repair-build",
        prompt: "Repair the failing build.",
        requiredChangedFiles: ["src/**/*.ts"],
        forbiddenChangedFiles: [".env*", "package-lock.json"],
        maxChangedFiles: 4,
        limits: {
          maxDurationMs: 5_000,
          maxInputTokens: 10_000,
          maxOutputTokens: 2_000,
          maxCostUsd: 0.1,
          minCacheHitRate: 0.5,
        },
        verification: [{ name: "tests", command: "pnpm test" }],
      },
    ],
  }).tasks[0];

  it("passes only from agent, file, and verification evidence", () => {
    const result = scoreAcceptanceTask({
      task,
      agentStatus: "completed",
      durationMs: 1234.5,
      changedFiles: ["src/runtime/fix.ts"],
      checks: [
        {
          name: "tests",
          passed: true,
          durationMs: 120,
          exitCode: 0,
          summary: "passed",
        },
      ],
      resolvedModels: ["deepseek-v4-pro", "deepseek-v4-pro"],
      usage: {
        inputTokens: 5_000,
        outputTokens: 500,
        cacheReadTokens: 3_000,
        cacheHitRate: 0.6,
        costUsd: 0.02,
      },
    });

    expect(result).toMatchObject({
      passed: true,
      durationMs: 1235,
      resolvedModels: ["deepseek-v4-pro"],
      usage: expect.objectContaining({ cacheHitRate: 0.6 }),
    });
  });

  it("reports every independent failure reason", () => {
    const result = scoreAcceptanceTask({
      task,
      agentStatus: "failed",
      durationMs: 10,
      changedFiles: [".env.local", "docs/a.md"],
      checks: [
        {
          name: "tests",
          passed: false,
          durationMs: 4,
          exitCode: 1,
          summary: "failed",
        },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.failureReasons).toEqual(
      expect.arrayContaining([
        "agent_failed",
        "required_file_missing:src/**/*.ts",
        "forbidden_file_changed:.env.local",
        "verification_failed:tests",
        "usage_missing",
      ]),
    );
  });

  it("enforces measured context, cost, cache and duration limits", () => {
    const result = scoreAcceptanceTask({
      task,
      agentStatus: "completed",
      durationMs: 6_000,
      changedFiles: ["src/runtime/fix.ts"],
      checks: [],
      usage: {
        inputTokens: 11_000,
        outputTokens: 2_001,
        cacheReadTokens: 1_000,
        cacheHitRate: 0.1,
        costUsd: 0.11,
      },
    });

    expect(result.failureReasons).toEqual(
      expect.arrayContaining([
        "input_token_limit:11000>10000",
        "output_token_limit:2001>2000",
        "cost_limit:0.11>0.1",
        "cache_hit_rate:0.1<0.5",
        "duration_limit:6000>5000",
      ]),
    );
  });

  it("enforces harness reliability and approval budgets", () => {
    const result = scoreAcceptanceTask({
      task: {
        ...task,
        limits: {
          maxToolFailures: 1,
          maxDeniedTools: 0,
          maxApprovalRequests: 2,
          maxCompactions: 1,
          maxAttempts: 5,
          maxToolFailureRate: 0.2,
        },
      },
      agentStatus: "completed",
      durationMs: 100,
      changedFiles: ["src/runtime/fix.ts"],
      checks: [],
      reliability: {
        attempts: 7,
        toolRuns: 4,
        toolFailures: 2,
        deniedTools: 1,
        approvalRequests: 3,
        compactions: 2,
        resumedCount: 0,
        verificationRuns: 1,
        checkpoints: 1,
      },
    });

    expect(result.failureReasons).toEqual(
      expect.arrayContaining([
        "tool_failure_limit:2>1",
        "denied_tool_limit:1>0",
        "approval_request_limit:3>2",
        "compaction_limit:2>1",
        "attempt_limit:7>5",
        "tool_failure_rate:0.5>0.2",
      ]),
    );
  });

  it("rejects duplicate task identifiers before a suite can run", () => {
    expect(() =>
      AcceptanceSuiteSchema.parse({
        schemaVersion: 1,
        name: "ambiguous",
        tasks: [
          { id: "same-task", prompt: "First task." },
          { id: "same-task", prompt: "Second task." },
        ],
      }),
    ).toThrow(/Duplicate acceptance task id/);
  });
});
