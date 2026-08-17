import { z } from "zod";

/** Persisted status values for a durable multi-agent run. */
export const AGENT_RUN_STATUS_VALUES = [
  "running",
  "completed",
  "failed",
  "aborted",
] as const;

export const AGENT_STATUS_VALUES = [
  "pending",
  "running",
  "completed",
  "failed",
  "aborted",
  "blocked",
] as const;

export const AgentRunStatusSchema = z.enum(AGENT_RUN_STATUS_VALUES);
export const AgentStatusSchema = z.enum(AGENT_STATUS_VALUES);

export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

/**
 * Validate a durable run transition before writing it to disk.
 *
 * The same terminal status is idempotent so repeated cleanup paths do not
 * turn a successful run into a false failure. A different terminal status is
 * rejected because it would make receipts and recovery ambiguous.
 */
export function assertAgentRunTransition(
  current: AgentRunStatus,
  next: AgentRunStatus,
): void {
  if (current === next) return;
  if (current !== "running") {
    throw new Error(
      `Agent run cannot transition from ${current} to ${next}; terminal runs are immutable.`,
    );
  }
}

/**
 * Validate a durable child-agent transition.
 *
 * `pending -> completed` is retained for compatibility with older persisted
 * records and tests that represented a very short read-only task as a single
 * atomic operation. New orchestration code should still record `running`.
 */
export function assertAgentTransition(
  current: AgentStatus,
  next: AgentStatus,
): void {
  if (current === next) return;
  const transitions: Record<AgentStatus, readonly AgentStatus[]> = {
    pending: ["running", "completed", "failed", "aborted", "blocked"],
    running: ["completed", "failed", "aborted"],
    completed: [],
    failed: ["running"],
    aborted: ["running"],
    blocked: ["running"],
  };
  if (transitions[current].includes(next)) return;
  throw new Error(
    `Agent cannot transition from ${current} to ${next}; resume a recoverable agent explicitly before running it again.`,
  );
}
