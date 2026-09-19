import { z } from "zod";
import {
  MAX_AGENT_MAX_ITERATIONS,
  OrbitLanguageSchema,
} from "@orbit-build/config";

/** Runtime-validated HTTP request contracts shared by every WebUI route. */
export const WebTurnIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const AttachmentIdsSchema = z
  .array(WebTurnIdSchema)
  .max(4)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Attachment IDs must be unique.",
  });
export const MessagePageQuerySchema = z
  .object({
    before: z.coerce.number().int().min(1).max(10_000_000).optional(),
    limit: z.coerce.number().int().min(20).max(100).optional(),
  })
  .strict();
export const ChatRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(100_000),
    turnId: WebTurnIdSchema.optional(),
    attachmentIds: AttachmentIdsSchema.optional(),
  })
  .strict();
export const InputQueueIdSchema = z
  .string()
  .trim()
  .regex(/^input_[a-zA-Z0-9_-]+$/)
  .max(200);
export const InputQueueActionSchema = z
  .discriminatedUnion("action", [
    z
      .object({
        action: z.literal("enqueue"),
        prompt: z.string().trim().min(1).max(100_000),
        mode: z.enum(["follow_up", "steer"]).default("follow_up"),
        attachmentIds: AttachmentIdsSchema.optional(),
      })
      .strict(),
    z
      .object({
        action: z.literal("update"),
        inputId: InputQueueIdSchema,
        prompt: z.string().trim().min(1).max(100_000).optional(),
        mode: z.enum(["follow_up", "steer"]).optional(),
      })
      .strict(),
    z
      .object({
        action: z.literal("move"),
        inputId: InputQueueIdSchema,
        direction: z.enum(["up", "down"]),
      })
      .strict(),
    z
      .object({
        action: z.literal("remove"),
        inputId: InputQueueIdSchema,
      })
      .strict(),
    z.object({ action: z.literal("clear") }).strict(),
  ])
  .superRefine((action, context) => {
    if (
      action.action === "update" &&
      action.prompt === undefined &&
      action.mode === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A queued-input update must change the prompt or mode.",
      });
    }
  });
export const CancelRequestSchema = z
  .object({ turnId: WebTurnIdSchema.nullish() })
  .strict();
export const ApprovalDecisionSchema = z
  .object({
    id: WebTurnIdSchema,
    approved: z.boolean(),
  })
  .strict();
export const SettingsPatchSchema = z
  .object({
    language: OrbitLanguageSchema.optional(),
    provider: z.string().trim().min(1).max(256).optional(),
    model: z.string().trim().min(1).max(200).optional(),
    agentProfile: z
      .string()
      .trim()
      .max(64)
      .regex(/^$|^[a-z0-9][a-z0-9-]*$/)
      .optional(),
    permissionMode: z.enum(["strict", "normal", "auto", "plan"]).optional(),
    fullAccessConfirmed: z.literal(true).optional(),
    agentMaxIterations: z
      .number()
      .int()
      .min(1)
      .max(MAX_AGENT_MAX_ITERATIONS)
      .optional(),
    webSearchEnabled: z.boolean().optional(),
    webSearchProvider: z
      .enum(["auto", "searxng", "tavily", "bing", "duckduckgo"])
      .optional(),
    webSearchMaxResults: z.number().int().min(1).max(20).optional(),
    skillsEnabled: z.boolean().optional(),
    skillsActivation: z.enum(["auto", "explicit"]).optional(),
    skillsMaxActive: z.number().int().min(0).max(8).optional(),
    skillsDisabled: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/))
      .max(200)
      .optional(),
  })
  .strict()
  .superRefine((patch, context) => {
    if (patch.permissionMode === "auto" && patch.fullAccessConfirmed !== true) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fullAccessConfirmed"],
        message: "Full Access requires explicit confirmation.",
      });
    }
  });
export const CapabilityNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
export const CapabilityCreateSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("skill"),
      name: CapabilityNameSchema,
      description: z.string().trim().min(1).max(2_000),
      instructions: z.string().trim().min(1).max(24_000),
      scope: z.enum(["local", "versioned"]).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("workflow"),
      name: CapabilityNameSchema,
      description: z.string().trim().min(1).max(240),
      instructions: z.string().trim().min(1).max(24_000),
      skills: z.array(CapabilityNameSchema).max(8),
      argumentHint: z.string().trim().min(1).max(160).optional(),
    })
    .strict(),
]);
export const SessionActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("new") }).strict(),
  ...(["resume", "archive", "restore", "delete"] as const).map((action) =>
    z
      .object({
        action: z.literal(action),
        sessionId: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .regex(/^[a-zA-Z0-9_-]+$/),
      })
      .strict(),
  ),
]);
export const ProjectPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    message: "Project paths cannot contain control characters.",
  });
export const ProjectActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pick") }).strict(),
  z
    .object({
      action: z.enum(["open", "create"]),
      path: ProjectPathSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("remove"),
      projectId: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .regex(/^[a-zA-Z0-9_-]+$/),
    })
    .strict(),
]);
export const ReviewActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("rollback-file"),
      path: z.string().trim().min(1).max(4096),
    })
    .strict(),
  z
    .object({
      action: z.literal("rewind"),
      checkpointId: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .regex(/^[a-zA-Z0-9_-]+$/),
    })
    .strict(),
]);
export const WebAgentIdSchema = z
  .string()
  .regex(/^agent_[a-z0-9-]+$/)
  .max(128);
export const WebAgentRunIdSchema = z
  .string()
  .regex(/^run_[a-z0-9-]+$/)
  .max(128);
export const AgentActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("abort"), agentId: WebAgentIdSchema }).strict(),
  z
    .object({
      action: z.literal("steer"),
      agentId: WebAgentIdSchema,
      prompt: z.string().trim().min(1).max(8_000),
    })
    .strict(),
  z
    .object({
      action: z.literal("resume"),
      runId: WebAgentRunIdSchema,
      agentId: WebAgentIdSchema,
    })
    .strict(),
]);
export const TaskActionSchema = z
  .object({
    action: z.enum(["plan", "parallel-improve"]),
    turnId: WebTurnIdSchema.optional(),
  })
  .strict();
export const CompletionQuerySchema = z.string().trim().max(200);
