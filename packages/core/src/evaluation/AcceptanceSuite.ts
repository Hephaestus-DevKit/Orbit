import { z } from "zod";

export const AcceptanceVerificationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  command: z.string().trim().min(1).max(4000),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(30 * 60_000)
    .default(120_000),
});

export const AcceptanceTaskSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  prompt: z.string().trim().min(1).max(20_000),
  mode: z.enum(["single", "multi"]).default("single"),
  provider: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  verification: z.array(AcceptanceVerificationSchema).max(20).default([]),
  requiredChangedFiles: z.array(z.string().trim().min(1)).max(100).default([]),
  forbiddenChangedFiles: z.array(z.string().trim().min(1)).max(100).default([]),
  maxChangedFiles: z.number().int().min(0).max(10_000).optional(),
  limits: z
    .object({
      maxDurationMs: z
        .number()
        .int()
        .min(1_000)
        .max(24 * 60 * 60_000)
        .optional(),
      maxInputTokens: z.number().int().nonnegative().optional(),
      maxOutputTokens: z.number().int().nonnegative().optional(),
      maxCostUsd: z.number().finite().nonnegative().optional(),
      minCacheHitRate: z.number().finite().min(0).max(1).optional(),
      maxToolFailures: z.number().int().nonnegative().optional(),
      maxDeniedTools: z.number().int().nonnegative().optional(),
      maxApprovalRequests: z.number().int().nonnegative().optional(),
      maxCompactions: z.number().int().nonnegative().optional(),
      maxAttempts: z.number().int().nonnegative().optional(),
      maxToolFailureRate: z.number().finite().min(0).max(1).optional(),
    })
    .optional(),
});

export const AcceptanceSuiteSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  metadata: z
    .object({
      version: z.string().trim().min(1).max(64).default("1"),
      deterministic: z.boolean().default(true),
      tags: z.array(z.string().trim().min(1).max(64)).max(32).default([]),
      fixtureHash: z
        .string()
        .regex(/^[a-f0-9]{64}$/i)
        .optional(),
      fixturePaths: z
        .array(z.string().trim().min(1).max(4_096))
        .max(32)
        .default([]),
    })
    .default({}),
  defaultLimits: AcceptanceTaskSchema.shape.limits,
  tasks: z
    .array(AcceptanceTaskSchema)
    .min(1)
    .max(100)
    .superRefine((tasks, context) => {
      const seen = new Set<string>();
      tasks.forEach((task, index) => {
        if (seen.has(task.id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "id"],
            message: `Duplicate acceptance task id: ${task.id}`,
          });
        }
        seen.add(task.id);
      });
    }),
});

export type AcceptanceTask = z.infer<typeof AcceptanceTaskSchema>;
export type AcceptanceSuite = z.infer<typeof AcceptanceSuiteSchema>;

export const AcceptanceCheckResultSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  durationMs: z.number().int().nonnegative(),
  exitCode: z.number().int().optional(),
  summary: z.string().max(4000),
});

export type AcceptanceCheckResult = z.infer<typeof AcceptanceCheckResultSchema>;

export const AcceptanceTaskResultSchema = z.object({
  taskId: z.string(),
  sessionId: z.string().optional(),
  traceFile: z.string().optional(),
  passed: z.boolean(),
  agentStatus: z.enum(["completed", "failed", "aborted"]),
  durationMs: z.number().int().nonnegative(),
  requestedProvider: z.string().optional(),
  requestedModel: z.string().optional(),
  resolvedModels: z.array(z.string()).default([]),
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      cacheReadTokens: z.number().int().nonnegative(),
      cacheHitRate: z.number().finite().min(0).max(1),
      costUsd: z.number().finite().nonnegative(),
    })
    .optional(),
  reliability: z
    .object({
      attempts: z.number().int().nonnegative(),
      toolRuns: z.number().int().nonnegative(),
      toolFailures: z.number().int().nonnegative(),
      deniedTools: z.number().int().nonnegative(),
      approvalRequests: z.number().int().nonnegative(),
      compactions: z.number().int().nonnegative(),
      resumedCount: z.number().int().nonnegative(),
      verificationRuns: z.number().int().nonnegative(),
      checkpoints: z.number().int().nonnegative(),
    })
    .optional(),
  changedFiles: z.array(z.string()),
  checks: z.array(AcceptanceCheckResultSchema),
  failureReasons: z.array(z.string()),
});

export type AcceptanceTaskResult = z.infer<typeof AcceptanceTaskResultSchema>;
export type AcceptanceUsage = NonNullable<AcceptanceTaskResult["usage"]>;
export type AcceptanceReliability = NonNullable<
  AcceptanceTaskResult["reliability"]
>;

/** Score one isolated task from objective evidence rather than model self-report. */
export function scoreAcceptanceTask(input: {
  task: AcceptanceTask;
  agentStatus: "completed" | "failed" | "aborted";
  durationMs: number;
  changedFiles: string[];
  checks: AcceptanceCheckResult[];
  resolvedModels?: string[];
  usage?: AcceptanceUsage;
  reliability?: AcceptanceReliability;
  sessionId?: string;
  traceFile?: string;
}): AcceptanceTaskResult {
  const task = AcceptanceTaskSchema.parse(input.task);
  const changedFiles = Array.from(
    new Set(input.changedFiles.map(normalizeFilePath)),
  ).sort();
  const failureReasons: string[] = [];

  if (input.agentStatus !== "completed") {
    failureReasons.push(`agent_${input.agentStatus}`);
  }
  for (const required of task.requiredChangedFiles) {
    if (!changedFiles.some((file) => matchesGlob(file, required))) {
      failureReasons.push(`required_file_missing:${required}`);
    }
  }
  for (const forbidden of task.forbiddenChangedFiles) {
    const matched = changedFiles.find((file) => matchesGlob(file, forbidden));
    if (matched) failureReasons.push(`forbidden_file_changed:${matched}`);
  }
  if (
    task.maxChangedFiles !== undefined &&
    changedFiles.length > task.maxChangedFiles
  ) {
    failureReasons.push(
      `changed_file_limit:${changedFiles.length}>${task.maxChangedFiles}`,
    );
  }
  for (const check of input.checks) {
    if (!check.passed) failureReasons.push(`verification_failed:${check.name}`);
  }
  if (task.limits) {
    if (!input.usage) {
      failureReasons.push("usage_missing");
    } else {
      if (
        task.limits.maxInputTokens !== undefined &&
        input.usage.inputTokens > task.limits.maxInputTokens
      ) {
        failureReasons.push(
          `input_token_limit:${input.usage.inputTokens}>${task.limits.maxInputTokens}`,
        );
      }
      if (
        task.limits.maxOutputTokens !== undefined &&
        input.usage.outputTokens > task.limits.maxOutputTokens
      ) {
        failureReasons.push(
          `output_token_limit:${input.usage.outputTokens}>${task.limits.maxOutputTokens}`,
        );
      }
      if (
        task.limits.maxCostUsd !== undefined &&
        input.usage.costUsd > task.limits.maxCostUsd
      ) {
        failureReasons.push(
          `cost_limit:${input.usage.costUsd}>${task.limits.maxCostUsd}`,
        );
      }
      if (
        task.limits.minCacheHitRate !== undefined &&
        input.usage.cacheHitRate < task.limits.minCacheHitRate
      ) {
        failureReasons.push(
          `cache_hit_rate:${input.usage.cacheHitRate}<${task.limits.minCacheHitRate}`,
        );
      }
    }
    if (
      task.limits.maxDurationMs !== undefined &&
      input.durationMs > task.limits.maxDurationMs
    ) {
      failureReasons.push(
        `duration_limit:${Math.round(input.durationMs)}>${task.limits.maxDurationMs}`,
      );
    }
    const reliabilityLimitsConfigured = [
      task.limits.maxToolFailures,
      task.limits.maxDeniedTools,
      task.limits.maxApprovalRequests,
      task.limits.maxCompactions,
      task.limits.maxAttempts,
      task.limits.maxToolFailureRate,
    ].some((value) => value !== undefined);
    if (reliabilityLimitsConfigured && !input.reliability) {
      failureReasons.push("reliability_missing");
    } else if (input.reliability) {
      enforceReliabilityLimits(task, input.reliability, failureReasons);
    }
  }

  return AcceptanceTaskResultSchema.parse({
    taskId: task.id,
    sessionId: input.sessionId,
    traceFile: input.traceFile,
    passed: failureReasons.length === 0,
    agentStatus: input.agentStatus,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    requestedProvider: task.provider,
    requestedModel: task.model,
    resolvedModels: Array.from(new Set(input.resolvedModels || [])),
    usage: input.usage,
    reliability: input.reliability,
    changedFiles,
    checks: input.checks,
    failureReasons,
  });
}

function enforceReliabilityLimits(
  task: AcceptanceTask,
  reliability: AcceptanceReliability,
  failureReasons: string[],
): void {
  const limits = task.limits;
  if (!limits) return;
  for (const [name, actual, maximum] of [
    ["tool_failure_limit", reliability.toolFailures, limits.maxToolFailures],
    ["denied_tool_limit", reliability.deniedTools, limits.maxDeniedTools],
    [
      "approval_request_limit",
      reliability.approvalRequests,
      limits.maxApprovalRequests,
    ],
    ["compaction_limit", reliability.compactions, limits.maxCompactions],
    ["attempt_limit", reliability.attempts, limits.maxAttempts],
  ] as const) {
    if (maximum !== undefined && actual > maximum) {
      failureReasons.push(`${name}:${actual}>${maximum}`);
    }
  }
  if (limits.maxToolFailureRate !== undefined) {
    const rate =
      reliability.toolRuns > 0
        ? reliability.toolFailures / reliability.toolRuns
        : 0;
    if (rate > limits.maxToolFailureRate) {
      failureReasons.push(
        `tool_failure_rate:${Number(rate.toFixed(6))}>${limits.maxToolFailureRate}`,
      );
    }
  }
}

function normalizeFilePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function matchesGlob(filePath: string, pattern: string): boolean {
  const normalizedPattern = normalizeFilePath(pattern);
  const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regex = escaped
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${regex}$`).test(normalizeFilePath(filePath));
}
