import { z } from "zod";

export const ORBIT_LIFECYCLE_HOOK_EVENTS = [
  "sessionStart",
  "promptSubmit",
  "permissionRequest",
  "preToolUse",
  "postToolUse",
  "postToolFailure",
  "preCompact",
  "postCompact",
  "verificationStart",
  "verificationEnd",
  "subagentStart",
  "subagentStop",
  "stop",
] as const;

export const LifecycleHookEventSchema = z.enum(ORBIT_LIFECYCLE_HOOK_EVENTS);
export type LifecycleHookEvent = z.infer<typeof LifecycleHookEventSchema>;

export const LifecycleHookCommandSchema = z.object({
  command: z.string().trim().min(1).max(20_000),
  /** Safe glob matched against the tool name, agent role, or lifecycle subject. */
  matcher: z.string().trim().min(1).max(256).optional(),
  timeoutMs: z.number().int().min(100).max(600_000).default(30_000),
  onFailure: z.enum(["block", "warn", "ignore"]).default("warn"),
  /**
   * Set only for a trusted installed extension contribution. This metadata is
   * intentionally optional so existing project/profile hook JSON stays byte
   * compatible; the runtime treats it as a stricter execution boundary, never
   * as an authority grant.
   */
  extension: z
    .object({
      id: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,127}$/),
      root: z.string().trim().min(1).max(4096),
    })
    .optional(),
});

/** Shared lifecycle contract used by project config and Agent Profiles. */
export const LifecycleHooksSchema = z
  .object(
    Object.fromEntries(
      ORBIT_LIFECYCLE_HOOK_EVENTS.map((event) => [
        event,
        z.array(LifecycleHookCommandSchema).max(16).optional(),
      ]),
    ) as Record<
      (typeof ORBIT_LIFECYCLE_HOOK_EVENTS)[number],
      z.ZodOptional<z.ZodArray<typeof LifecycleHookCommandSchema>>
    >,
  )
  .strict();

export type LifecycleHooksConfig = z.infer<typeof LifecycleHooksSchema>;
