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

export interface ToolResult<O = unknown> {
  ok: boolean;
  data?: O;
  error?: string;
  display?: string;
  metadata?: Record<string, unknown>;
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
  execute(input: I, ctx: ToolContext): Promise<ToolResult<O>>;
}
