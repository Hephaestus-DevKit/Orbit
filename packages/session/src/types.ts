import { z } from "zod";

const SafeObjectKeySchema = z
  .string()
  .refine(
    (key) => !["__proto__", "constructor", "prototype"].includes(key),
    "Unsafe object key.",
  );

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Validates values that can be persisted as JSON without lossy coercion. */
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(SafeObjectKeySchema, JsonValueSchema),
  ]),
);

/** Validates text that contains a safe JSON value. */
export const JsonTextSchema = z.string().superRefine((value, context) => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (JsonValueSchema.safeParse(parsed).success) return;
  } catch {
    // Report a single stable issue below.
  }
  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: "Expected valid, safe JSON text.",
  });
});

export const SessionIdSchema = z
  .string()
  .regex(/^sess_[a-z]+-[a-z]+-\d{3}$/, "Invalid Orbit session id.");

export const SessionSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: SessionIdSchema,
  cwd: z.string().min(1),
  title: z.string(),
  goal: z.string().trim().min(1).max(4000).optional(),
  status: z.enum(["active", "completed", "failed", "aborted"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  provider: z.string().min(1),
  model: z.string().min(1),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  totalCostEstimate: z.number().finite().nonnegative(),
  costEstimateKnown: z.boolean().optional(),
  totalCacheReadTokens: z.number().int().nonnegative().optional(),
  archivedAt: z.string().datetime().optional(),
});

export type Session = z.infer<typeof SessionSchema>;

export const SessionEventSchema = z.object({
  id: z.string().min(1),
  sessionId: SessionIdSchema,
  type: z.string().min(1),
  payload: JsonValueSchema,
  createdAt: z.string().datetime(),
});

export type SessionEvent = z.infer<typeof SessionEventSchema>;

export const TaskPlanItemSchema = z.object({
  id: z.string().regex(/^step_[a-z0-9-]+$/, "Invalid task-plan item id."),
  text: z.string().trim().min(1).max(1000),
  status: z.enum(["pending", "in_progress", "completed"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const TaskPlanSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  sessionId: SessionIdSchema,
  goal: z.string().trim().min(1).max(4000).optional(),
  items: z.array(TaskPlanItemSchema).max(100),
  updatedAt: z.string().datetime(),
});

export type TaskPlanItem = z.infer<typeof TaskPlanItemSchema>;
export type TaskPlan = z.infer<typeof TaskPlanSchema>;

export const QueuedAgentInputSchema = z.object({
  id: z.string().regex(/^input_[a-zA-Z0-9_-]+$/, "Invalid queued-input id."),
  sessionId: SessionIdSchema,
  mode: z.enum(["follow_up", "steer"]),
  source: z.enum(["terminal", "web", "api"]),
  text: z.string().trim().min(1).max(100_000),
  attachments: z
    .array(
      z.object({
        type: z.literal("image"),
        mediaType: z.enum([
          "image/png",
          "image/jpeg",
          "image/gif",
          "image/webp",
        ]),
        data: z.string().max(8_000_000),
        name: z.string().max(255).optional(),
      }),
    )
    .max(4)
    .superRefine((attachments, context) => {
      const encodedBytes = attachments.reduce(
        (total, attachment) => total + attachment.data.length,
        0,
      );
      if (encodedBytes > 30_000_000) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Queued image attachments exceed the 30 MB encoded limit.",
        });
      }
    })
    .default([]),
  createdAt: z.string().datetime(),
});

export const AgentInputQueueSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    sessionId: SessionIdSchema,
    items: z.array(QueuedAgentInputSchema).max(12),
    updatedAt: z.string().datetime(),
  })
  .superRefine((queue, context) => {
    const encodedBytes = queue.items.reduce(
      (total, item) =>
        total +
        item.text.length +
        item.attachments.reduce(
          (attachmentTotal, attachment) =>
            attachmentTotal + attachment.data.length,
          0,
        ),
      0,
    );
    if (encodedBytes > 64_000_000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The queued-input snapshot exceeds the 64 MB limit.",
      });
    }
  });

export type QueuedAgentInput = z.infer<typeof QueuedAgentInputSchema>;
export type AgentInputQueue = z.infer<typeof AgentInputQueueSchema>;

export const SessionMetricsSchema = z.object({
  sessionId: SessionIdSchema,
  eventCount: z.number().int().nonnegative(),
  toolRuns: z.number().int().nonnegative(),
  toolFailures: z.number().int().nonnegative(),
  deniedTools: z.number().int().nonnegative(),
  filesChanged: z.number().int().nonnegative(),
  modelSwitches: z.number().int().nonnegative(),
  routingDecisions: z.number().int().nonnegative(),
  fastRoutes: z.number().int().nonnegative(),
  qualityRoutes: z.number().int().nonnegative(),
  compactions: z.number().int().nonnegative(),
  resumedCount: z.number().int().nonnegative(),
});

export type SessionMetrics = z.infer<typeof SessionMetricsSchema>;

export const RunJournalSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  sessionId: SessionIdSchema,
  state: z.enum([
    "running",
    "awaiting_approval",
    "verifying",
    "completed",
    "failed",
    "aborted",
    "interrupted",
  ]),
  phase: z.string().trim().min(1).max(200),
  attempt: z.number().int().nonnegative().default(0),
  activeToolCallId: z.string().min(1).max(512).optional(),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  recoveryCount: z.number().int().nonnegative().default(0),
});

export type RunJournal = z.infer<typeof RunJournalSchema>;

export const SessionRecoveryReportSchema = z.object({
  sessionId: SessionIdSchema,
  previousState: RunJournalSchema.shape.state,
  previousPhase: z.string().trim().min(1).max(200),
  attempt: z.number().int().nonnegative(),
  recoveryCount: z.number().int().positive(),
  repairedToolCalls: z.number().int().nonnegative(),
  resetPlanItems: z.number().int().nonnegative(),
  recoveredAt: z.string().datetime(),
});

export type SessionRecoveryReport = z.infer<typeof SessionRecoveryReportSchema>;

const StoredToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  arguments: JsonTextSchema,
});

const StoredToolResultSchema = z.object({
  toolCallId: z.string().min(1),
  name: z.string().min(1),
  content: z.string(),
  isError: z.boolean().optional(),
});

export const StoredContentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("image"),
    mediaType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
    data: z.string().max(8_000_000),
    name: z.string().max(255).optional(),
  }),
  z.object({ type: z.literal("tool_call"), toolCall: StoredToolCallSchema }),
  z.object({
    type: z.literal("tool_result"),
    toolResult: StoredToolResultSchema,
  }),
  z.object({
    type: z.literal("thinking"),
    text: z.string(),
    signature: z.string().optional(),
  }),
]);

export const StoredHistoryMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.array(StoredContentBlockSchema).max(10_000),
  createdAt: z.string().datetime(),
  metadata: z.record(SafeObjectKeySchema, JsonValueSchema).optional(),
});

export const StoredHistorySchema = z
  .array(StoredHistoryMessageSchema)
  .max(100_000);
export type StoredHistoryMessage = z.infer<typeof StoredHistoryMessageSchema>;

export const ToolCallRecordSchema = z.object({
  id: z.string().min(1),
  sessionId: SessionIdSchema,
  toolName: z.string().min(1),
  inputJson: JsonTextSchema,
  outputJson: JsonTextSchema.optional(),
  risk: z.string().min(1),
  permissionDecision: z.string().min(1),
  status: z.enum(["pending", "success", "failed", "denied"]),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
});

export type ToolCallRecord = z.infer<typeof ToolCallRecordSchema>;

export const FileChangeRecordSchema = z.object({
  id: z.string().min(1),
  sessionId: SessionIdSchema,
  path: z.string().min(1),
  beforeHash: z.string().optional(),
  afterHash: z.string().optional(),
  diff: z.string(),
  createdAt: z.string().datetime(),
});

export type FileChangeRecord = z.infer<typeof FileChangeRecordSchema>;

/** Stable, credential-redacted session trace suitable for local support and replay tooling. */
export const SessionTraceBundleSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.string().datetime(),
  workspace: z.object({
    id: z.string().regex(/^[a-f0-9]{16}$/),
    path: z.literal("<workspace>"),
  }),
  session: SessionSchema.omit({ cwd: true }).extend({
    cwd: z.literal("<workspace>"),
  }),
  journal: RunJournalSchema.optional(),
  plan: TaskPlanSchema.optional(),
  metrics: SessionMetricsSchema,
  events: z.array(SessionEventSchema).max(100_000),
  toolCalls: z.array(ToolCallRecordSchema).max(100_000),
  fileChanges: z.array(FileChangeRecordSchema).max(100_000),
  history: z.array(JsonValueSchema).max(100_000).optional(),
});

export type SessionTraceBundle = z.infer<typeof SessionTraceBundleSchema>;
