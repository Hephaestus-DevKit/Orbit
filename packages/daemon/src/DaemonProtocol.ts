import { z } from "zod";

export const REMOTE_DAEMON_PROTOCOL_VERSION = 1 as const;
export const MAX_DAEMON_BODY_BYTES = 1 * 1024 * 1024;
export const MAX_DAEMON_EVENT_BYTES = 64 * 1024;
export const MAX_DAEMON_EVENTS = 5_000;
export const MAX_DAEMON_TASKS = 500;

export const DaemonTaskIdSchema = z
  .string()
  .regex(/^task_[a-f0-9]{24,64}$/, "Invalid daemon task id.");
export type DaemonTaskId = z.infer<typeof DaemonTaskIdSchema>;

/** Per-attempt capability; it is never exposed as a CLI argument. */
export const DaemonLeaseIdSchema = z
  .string()
  .regex(/^lease_[a-f0-9]{32}$/, "Invalid daemon lease id.");
export type DaemonLeaseId = z.infer<typeof DaemonLeaseIdSchema>;

export const DaemonScopeSchema = z.enum(["read", "submit", "control", "admin"]);
export type DaemonScope = z.infer<typeof DaemonScopeSchema>;

export const DaemonPrincipalSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
    token: z.string().min(32).max(256),
    scopes: z.array(DaemonScopeSchema).min(1).max(4),
  })
  .strict();
export type DaemonPrincipal = z.infer<typeof DaemonPrincipalSchema>;

/** Authenticated request identity used by static tokens and external IdPs. */
export const DaemonIdentitySchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/),
    scopes: z.array(DaemonScopeSchema).min(1).max(4),
    authMethod: z.string().regex(/^[a-z][a-z0-9._:-]{0,63}$/),
    issuer: z.string().url().max(2_048).optional(),
    keyId: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,128}$/)
      .optional(),
  })
  .strict();
export type DaemonIdentity = z.infer<typeof DaemonIdentitySchema>;

export const DaemonTaskStateSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "aborted",
  "canceled",
  "orphaned",
]);
export type DaemonTaskState = z.infer<typeof DaemonTaskStateSchema>;

const DaemonRunOptionsSchema = z
  .object({
    provider: z.string().trim().min(1).max(256).optional(),
    model: z.string().trim().min(1).max(256).optional(),
    agentProfile: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9-]*$/)
      .optional(),
    fullAccess: z.boolean().default(false),
    fullAccessConfirmed: z.boolean().default(false),
    resumeSessionId: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[a-zA-Z0-9_-]+$/)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.fullAccess && !value.fullAccessConfirmed) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fullAccessConfirmed"],
        message: "Full Access requires explicit confirmation.",
      });
    }
  });

export const DaemonStartTaskSchema = z
  .object({
    cwd: z
      .string()
      .trim()
      .min(1)
      .max(4_096)
      .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
        message: "Task workspace cannot contain control characters.",
      }),
    prompt: z.string().trim().min(1).max(100_000),
    options: DaemonRunOptionsSchema.default({}),
  })
  .strict();
export type DaemonStartTask = z.infer<typeof DaemonStartTaskSchema>;

export const DaemonTaskRecordSchema = z.object({
  schemaVersion: z.literal(1),
  id: DaemonTaskIdSchema,
  cwd: z.string().min(1).max(4_096),
  prompt: z.string().min(1).max(100_000),
  options: DaemonRunOptionsSchema,
  state: DaemonTaskStateSchema,
  attempt: z.number().int().min(1).max(100),
  sessionId: z.string().min(1).max(200).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().optional(),
  exitCode: z.number().int().min(0).max(255).optional(),
  error: z.string().max(4_000).optional(),
  owner: z
    .object({
      instanceId: z.string().regex(/^daemon_[a-f0-9]{24,64}$/),
      /** Optional for backward-compatible reads of pre-lease v1 records. */
      leaseId: DaemonLeaseIdSchema.optional(),
      pid: z.number().int().positive(),
      startedAt: z.string().datetime(),
      leaseExpiresAt: z.string().datetime(),
    })
    .optional(),
  eventCount: z.number().int().nonnegative().max(MAX_DAEMON_EVENTS),
});
export type DaemonTaskRecord = z.infer<typeof DaemonTaskRecordSchema>;

export const DaemonEventSchema = z.object({
  schemaVersion: z.literal(1),
  taskId: DaemonTaskIdSchema,
  sequence: z.number().int().positive().max(MAX_DAEMON_EVENTS),
  timestamp: z.string().datetime(),
  type: z.string().regex(/^[a-z][a-z0-9_:-]{0,127}$/),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type DaemonEvent = z.infer<typeof DaemonEventSchema>;

export interface DaemonEventPage {
  events: DaemonEvent[];
  firstSequence?: number;
  lastSequence?: number;
  resyncRequired: boolean;
}

export const DaemonErrorSchema = z.object({
  schemaVersion: z.literal(REMOTE_DAEMON_PROTOCOL_VERSION),
  ok: z.literal(false),
  error: z.object({
    code: z.string().regex(/^[a-z][a-z0-9_:-]{0,63}$/),
    message: z.string().max(4_000),
  }),
});

export function daemonTaskIdFromRandomBytes(bytes: Uint8Array): DaemonTaskId {
  const value = Buffer.from(bytes).toString("hex").slice(0, 32);
  if (value.length < 24) throw new Error("Daemon task entropy is too short.");
  return `task_${value}`;
}
