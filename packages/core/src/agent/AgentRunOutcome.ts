import { z } from "zod";
import { redactSecrets } from "@orbit-build/shared";
const AGENT_LOOP_ERROR_MESSAGE_MAX_CHARS = 2000;

export type AgentLoopFailureCode =
  | "provider_error"
  | "execution_error"
  | "verification_failed"
  | "iteration_limit"
  | "budget_exceeded";
export type AgentLoopAbortReason = "immediate" | "interrupted" | "rollback" | "iteration_limit";

/** Stable, machine-readable evidence returned by every initialized Agent run. */
export interface AgentRunReceipt {
  modifiedFiles: string[];
  verification: "passed" | "failed" | "not_run";
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
  };
  cost: {
    known: boolean;
    usd: number | null;
  };
  plan?: {
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
  };
}

export type AgentLoopRunOutcome =
  | {
    status: "completed";
    sessionId: string;
    attempts: number;
    receipt?: AgentRunReceipt;
  }
  | {
    status: "failed";
    sessionId: string;
    attempts: number;
    error: {
      code: AgentLoopFailureCode;
      message: string;
    };
    receipt?: AgentRunReceipt;
  }
  | {
    status: "aborted";
    sessionId: string;
    attempts: number;
    reason: AgentLoopAbortReason;
    message: string;
    receipt?: AgentRunReceipt;
  };

export class AgentLoopExecutionError extends Error {
  public readonly name = "AgentLoopExecutionError";

  constructor(
    public readonly code: AgentLoopFailureCode,
    message: string,
  ) {
    super(message);
  }
}

export function safeAgentLoopErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = redactSecrets(raw)
    .replace(
      /\b(api[-_ ]?key|authorization|token|secret)(\s*[:=]\s*)["']?[^\s"',;]+/gi,
      "$1$2***REDACTED***",
    )
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const message = normalized || "Agent execution failed.";
  if (message.length <= AGENT_LOOP_ERROR_MESSAGE_MAX_CHARS) return message;
  return `${message.slice(0, AGENT_LOOP_ERROR_MESSAGE_MAX_CHARS - 1)}…`;
}

/** Render Zod tool-boundary failures as a short repair hint, not raw JSON. */
export function formatToolInputValidationError(error: z.ZodError): string {
  const issues = error.issues.slice(0, 3).map((issue) => {
    const field = issue.path.length > 0 ? issue.path.join(".") : "input";
    return `${field}: ${issue.message}`;
  });
  const remaining = Math.max(0, error.issues.length - issues.length);
  return `Invalid tool input — ${issues.join("; ")}${remaining ? `; +${remaining} more` : ""}.`;
}
