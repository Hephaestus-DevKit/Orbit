import { z } from "zod";
import { LifecycleHookEventSchema } from "@orbit-build/config";

/** Public event-envelope version consumed by the TUI, Web UI and JSONL API. */
export const ORBIT_EVENT_SCHEMA_VERSION = 1 as const;

// --- Model Request & Response Events ---
export const ModelRequestEventSchema = z.object({
  type: z.literal("model_request"),
  payload: z.object({
    model: z.string(),
    messages: z.array(z.unknown()),
  }),
});

export const ModelResponseEventSchema = z.object({
  type: z.literal("model_response"),
  payload: z.object({
    model: z.string(),
    requestedModel: z.string().optional(),
    resolvedModel: z.string().optional(),
    providerRequestId: z.string().optional(),
    apiFormat: z
      .enum(["chat-completions", "responses", "anthropic"])
      .optional(),
    modelVersion: z.string().optional(),
    apiFormatFallback: z
      .object({
        from: z.enum(["chat-completions", "responses", "anthropic"]),
        status: z.number().int().min(100).max(599),
      })
      .optional(),
    text: z.string().optional(),
    reasoning_content: z.string().optional(),
    usage: z
      .object({
        inputTokens: z.number(),
        outputTokens: z.number(),
        totalTokens: z.number().optional(),
        cacheReadTokens: z.number().optional(),
        cacheMissTokens: z.number().optional(),
        cacheWriteTokens: z.number().optional(),
        reasoningTokens: z.number().optional(),
      })
      .optional(),
    toolCalls: z.array(z.unknown()).optional(),
  }),
});

// --- Agent Lifecycle Events ---
export const AgentStartEventSchema = z.object({
  type: z.literal("agent_start"),
  payload: z.object({
    taskId: z.string(),
    task: z.string(),
  }),
});

export const AgentSpawnEventSchema = z.object({
  type: z.literal("agent_spawn"),
  payload: z.object({
    parentId: z.string(),
    childId: z.string(),
    role: z.string(),
    task: z.string(),
  }),
});

export const AgentStatusEventSchema = z.object({
  type: z.literal("agent_status"),
  payload: z.object({
    taskId: z.string(),
    status: z.string(),
    detail: z.string().optional(),
  }),
});

export const AgentCompletedEventSchema = z.object({
  type: z.literal("agent_completed"),
  payload: z.object({
    taskId: z.string(),
    success: z.boolean(),
    status: z.enum(["completed", "failed", "aborted"]).optional(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }),
});

// --- User-facing turn lifecycle ---
// These events describe the outer interaction owned by a UI surface. They are
// intentionally separate from agent lifecycle events because orchestrated
// runs can start and complete several internal agents for one user turn.
export const UiTurnStartedEventSchema = z.object({
  type: z.literal("ui_turn_started"),
  payload: z.object({
    turnId: z.string(),
    source: z.enum(["terminal", "web"]),
    prompt: z.string(),
  }),
});

export const UiTurnCompletedEventSchema = z.object({
  type: z.literal("ui_turn_completed"),
  payload: z.object({
    turnId: z.string(),
    source: z.enum(["terminal", "web"]),
    status: z.enum(["completed", "failed", "aborted"]),
    message: z.string().optional(),
  }),
});

const AgentInputQueuePayloadSchema = z.object({
  inputId: z.string(),
  sessionId: z.string(),
  mode: z.enum(["follow_up", "steer"]),
  source: z.enum(["terminal", "web", "api"]),
  remaining: z.number().int().nonnegative(),
});

export const AgentInputQueuedEventSchema = z.object({
  type: z.literal("agent_input_queued"),
  payload: AgentInputQueuePayloadSchema,
});

export const AgentInputConsumedEventSchema = z.object({
  type: z.literal("agent_input_consumed"),
  payload: AgentInputQueuePayloadSchema,
});

export const AgentInputRemovedEventSchema = z.object({
  type: z.literal("agent_input_removed"),
  payload: AgentInputQueuePayloadSchema,
});

export const AgentInputUpdatedEventSchema = z.object({
  type: z.literal("agent_input_updated"),
  payload: AgentInputQueuePayloadSchema,
});

export const AgentInputMovedEventSchema = z.object({
  type: z.literal("agent_input_moved"),
  payload: AgentInputQueuePayloadSchema.extend({
    fromIndex: z.number().int().nonnegative(),
    toIndex: z.number().int().nonnegative(),
  }),
});

export const AgentInputQueueClearedEventSchema = z.object({
  type: z.literal("agent_input_queue_cleared"),
  payload: z.object({
    sessionId: z.string(),
    removed: z.number().int().nonnegative(),
  }),
});

export const LoopStartEventSchema = z.object({
  type: z.literal("loop_start"),
  payload: z.object({
    attempt: z.number(),
  }),
});

// --- Streaming Delta Events ---
export const ModelDeltaEventSchema = z.object({
  type: z.literal("model_delta"),
  payload: z.object({
    text: z.string(),
  }),
});

export const ThinkingDeltaEventSchema = z.object({
  type: z.literal("thinking_delta"),
  payload: z.object({
    text: z.string(),
  }),
});

// --- Cost & Tokens Events ---
export const CostUpdateEventSchema = z.object({
  type: z.literal("cost_update"),
  payload: z.object({
    turnCost: z.number(),
    sessionCost: z.number(),
    costKnown: z.boolean().default(true),
    totalInputTokens: z.number(),
    totalCacheReadTokens: z.number(),
    totalOutputTokens: z.number(),
  }),
});

export const CacheUpdateEventSchema = z.object({
  type: z.literal("cache_update"),
  payload: z.object({
    slabHash: z.string(),
    slabTokenEstimate: z.number(),
    hitTokens: z.number(),
    missTokens: z.number(),
    inputTokens: z.number(),
    hitRate: z.number(),
    degraded: z.boolean(),
  }),
});

export const ModelRoutingEventSchema = z.object({
  type: z.literal("model_routing"),
  payload: z.object({
    model: z.string(),
    lane: z.enum(["locked", "fallback", "fast", "balanced", "quality"]),
    reason: z.string(),
    confidence: z.enum(["high", "medium"]),
  }),
});

// --- Tool Proposal, Approval & Execution Events ---
export const ToolProposalEventSchema = z.object({
  type: z.literal("tool_proposal"),
  payload: z.object({
    toolCallId: z.string().optional(),
    toolName: z.string(),
    arguments: z.unknown(),
    explanation: z.string().optional(),
  }),
});

export const ToolApprovalEventSchema = z.object({
  type: z.literal("tool_approval"),
  payload: z.object({
    toolCallId: z.string().optional(),
    approved: z.boolean(),
    reason: z.string().optional(),
  }),
});

export const ToolResultEventSchema = z.object({
  type: z.literal("tool_result"),
  payload: z.object({
    toolCallId: z.string().optional(),
    toolName: z.string(),
    result: z.unknown().optional(),
    display: z.string().optional(),
    error: z.string().optional(),
  }),
});

const BackgroundTaskLifecyclePayloadSchema = z.object({
  taskId: z.string(),
  sessionId: z.string(),
  command: z.string(),
  cwd: z.string(),
  status: z.enum(["running", "completed", "failed", "killed", "timed_out"]),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  durationMs: z.number().nonnegative(),
  exitCode: z.number().int().nullable(),
  outputTruncated: z.boolean(),
});

export const BackgroundTaskStartedEventSchema = z.object({
  type: z.literal("background_task_started"),
  payload: BackgroundTaskLifecyclePayloadSchema,
});

export const BackgroundTaskCompletedEventSchema = z.object({
  type: z.literal("background_task_completed"),
  payload: BackgroundTaskLifecyclePayloadSchema,
});

export const WebApprovalRequestedEventSchema = z.object({
  type: z.literal("web_approval_requested"),
  payload: z.object({
    approvalId: z.string(),
    kind: z.enum(["tool", "change", "action"]),
    title: z.string(),
    toolCallId: z.string().optional(),
    agentId: z
      .string()
      .regex(/^agent_[a-z0-9-]+$/)
      .optional(),
    agentRole: z.string().max(80).optional(),
  }),
});

export const WebApprovalResolvedEventSchema = z.object({
  type: z.literal("web_approval_resolved"),
  payload: z.object({
    approvalId: z.string(),
    approved: z.boolean(),
  }),
});

// --- Skills Events ---
export const SkillActivatedEventSchema = z.object({
  type: z.literal("skill_activated"),
  payload: z.object({
    name: z.string(),
    activation: z.enum(["explicit", "auto"]),
    loadedBytes: z.number(),
    truncated: z.boolean(),
  }),
});

// --- File Changes & Checkpoints Events ---
export const FileDiffEventSchema = z.object({
  type: z.literal("file_diff"),
  payload: z.object({
    filePath: z.string(),
    diff: z.string(),
  }),
});

export const FileChangeEventSchema = z.object({
  type: z.literal("file_change"),
  payload: z.object({
    filePath: z.string(),
    type: z.enum(["write", "edit", "create", "delete"]),
    explanation: z.string().optional(),
  }),
});

export const CheckpointCreatedEventSchema = z.object({
  type: z.literal("checkpoint_created"),
  payload: z.object({
    checkpointId: z.string(),
    timestamp: z.string(),
    message: z.string().optional(),
  }),
});

// --- Verification Events ---
export const VerificationStartedEventSchema = z.object({
  type: z.literal("verification_started"),
  payload: z.object({
    type: z.string(),
  }),
});

export const VerificationEndedEventSchema = z.object({
  type: z.literal("verification_ended"),
  payload: z.object({
    success: z.boolean(),
    results: z.unknown().optional(),
  }),
});

// --- Typed lifecycle hooks ---
export const HookStartedEventSchema = z.object({
  type: z.literal("hook_started"),
  payload: z.object({
    hookId: z.string(),
    event: LifecycleHookEventSchema,
    legacy: z.boolean(),
  }),
});

export const HookCompletedEventSchema = z.object({
  type: z.literal("hook_completed"),
  payload: z.object({
    hookId: z.string(),
    event: LifecycleHookEventSchema,
    success: z.boolean(),
    durationMs: z.number().nonnegative(),
    action: z.enum(["continue", "warn", "blocked", "ignored"]),
    error: z.string().optional(),
  }),
});

// --- Session Lifecycle Events ---
export const SessionForkEventSchema = z.object({
  type: z.literal("session_fork"),
  payload: z.object({
    parentSessionId: z.string(),
    childSessionId: z.string(),
  }),
});

export const SessionEndedEventSchema = z.object({
  type: z.literal("session_ended"),
  payload: z.object({
    sessionId: z.string(),
  }),
});

// --- Logging & Error Events ---
export const InfoEventSchema = z.object({
  type: z.literal("info"),
  payload: z.object({
    message: z.string(),
  }),
});

export const WarningEventSchema = z.object({
  type: z.literal("warning"),
  payload: z.object({
    message: z.string(),
  }),
});

export const ErrorEventSchema = z.object({
  type: z.literal("error"),
  payload: z.object({
    message: z.string(),
    stack: z.string().optional(),
  }),
});

// --- Discriminated Union ---
export const OrbitEventSchema = z.discriminatedUnion("type", [
  ModelRequestEventSchema,
  ModelResponseEventSchema,
  AgentStartEventSchema,
  AgentSpawnEventSchema,
  AgentStatusEventSchema,
  AgentCompletedEventSchema,
  UiTurnStartedEventSchema,
  UiTurnCompletedEventSchema,
  AgentInputQueuedEventSchema,
  AgentInputConsumedEventSchema,
  AgentInputRemovedEventSchema,
  AgentInputUpdatedEventSchema,
  AgentInputMovedEventSchema,
  AgentInputQueueClearedEventSchema,
  LoopStartEventSchema,
  ModelDeltaEventSchema,
  ThinkingDeltaEventSchema,
  CostUpdateEventSchema,
  CacheUpdateEventSchema,
  ModelRoutingEventSchema,
  ToolProposalEventSchema,
  ToolApprovalEventSchema,
  ToolResultEventSchema,
  BackgroundTaskStartedEventSchema,
  BackgroundTaskCompletedEventSchema,
  WebApprovalRequestedEventSchema,
  WebApprovalResolvedEventSchema,
  SkillActivatedEventSchema,
  FileDiffEventSchema,
  FileChangeEventSchema,
  CheckpointCreatedEventSchema,
  VerificationStartedEventSchema,
  VerificationEndedEventSchema,
  HookStartedEventSchema,
  HookCompletedEventSchema,
  SessionForkEventSchema,
  SessionEndedEventSchema,
  InfoEventSchema,
  WarningEventSchema,
  ErrorEventSchema,
]);

export type OrbitEvent = z.infer<typeof OrbitEventSchema>;

/**
 * Stable transport envelope for every wildcard event subscriber. Type-specific
 * EventEmitter listeners intentionally continue receiving only their payload.
 */
export const OrbitEventEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(ORBIT_EVENT_SCHEMA_VERSION),
    eventId: z.string().min(1),
    timestamp: z.string().datetime(),
  })
  .and(OrbitEventSchema);

export type OrbitEventEnvelope = z.infer<typeof OrbitEventEnvelopeSchema>;
