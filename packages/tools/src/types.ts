import { z } from "zod";
import { ToolRisk } from "@orbit-build/shared";
import type { OrbitConfig } from "@orbit-build/config";
import type { BackgroundTaskService } from "./runtime/BackgroundTaskRuntime.js";

export interface ToolContext {
  cwd: string;
  sessionId: string;
  config?: OrbitConfig;
  logger?: ToolLogger;
  abortSignal?: AbortSignal;
  services?: ToolRuntimeServices;
  /**
   * Extra read-only roots (e.g. registered skill directories under the user
   * home) that read tools may access in addition to the workspace. Write
   * tools must never consult this list.
   */
  readRoots?: Array<string | ToolReadRoot>;
}

export interface ToolReadRoot {
  /** Stable Skill name used by skill://name/path resource addresses. */
  name: string;
  /** Canonical directory containing the active Skill's SKILL.md. */
  path: string;
}

export interface ToolTaskPlanItem {
  step: string;
  status: "pending" | "in_progress" | "completed";
}

export interface ToolTaskPlanUpdate {
  explanation?: string;
  plan: ToolTaskPlanItem[];
}

/** Loop-scoped capabilities that tools may use without importing core state. */
export interface ToolRuntimeServices {
  updatePlan?(update: ToolTaskPlanUpdate): Promise<unknown> | unknown;
  /** Session-scoped lifecycle for long-running commands and future monitors. */
  backgroundTasks?: BackgroundTaskService;
}

export interface ToolLogger {
  debug?(message: string, metadata?: Record<string, unknown>): void;
  info?(message: string, metadata?: Record<string, unknown>): void;
  warn?(message: string, metadata?: Record<string, unknown>): void;
  error?(message: string, metadata?: Record<string, unknown>): void;
}

export type ToolFailureCode =
  | "cancelled"
  | "timeout"
  | "invalid_input"
  | "invalid_output"
  | "execution_error"
  | "unavailable";

/** Machine-readable failure details while preserving the stable text error. */
export interface ToolFailure {
  code: ToolFailureCode | (string & {});
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface ToolResult<O = unknown> {
  ok: boolean;
  data?: O;
  error?: string;
  failure?: ToolFailure;
  display?: string;
  metadata?: Record<string, unknown>;
}

export type ToolConcurrencyMode = "exclusive" | "parallel";
export type ToolCancellationMode = "boundary" | "cooperative";

/**
 * Versioned execution semantics used by the scheduler and runtime boundary.
 *
 * Omitted contracts remain exclusive and non-idempotent for compatibility.
 * Parallel execution is therefore always explicit and fails closed.
 */
export interface ToolExecutionContract<O = unknown> {
  version: 2;
  readOnly: boolean;
  idempotent: boolean;
  concurrency: ToolConcurrencyMode;
  cancellation: ToolCancellationMode;
  /** Default upper bound; runtime policy may impose a lower limit. */
  timeoutMs?: number;
  /** Validate successful `data` before it crosses the runtime boundary. */
  outputSchema?: z.ZodType<O>;
  /** Optional protocol-facing equivalent for SDK and server generation. */
  outputJsonSchema?: Record<string, unknown>;
  presentation?: {
    modelMaxChars?: number;
    userMaxChars?: number;
  };
}

export interface OrbitTool<I = unknown, O = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  /**
   * Optional provider-facing JSON Schema. Dynamic tools such as MCP tools use
   * this to preserve the server-declared contract while still validating the
   * execution boundary with `inputSchema`.
   */
  inputJsonSchema?: Record<string, unknown>;
  risk: ToolRisk;
  execution?: ToolExecutionContract<O>;
  execute(input: I, ctx: ToolContext): Promise<ToolResult<O>>;
}
