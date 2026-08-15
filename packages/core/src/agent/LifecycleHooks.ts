import {
  ORBIT_LIFECYCLE_HOOK_EVENTS,
  type OrbitConfig,
} from "@orbit-build/config";
import { redactSecrets } from "@orbit-build/shared";
import { randomUUID } from "crypto";
import { eventBus } from "../events/EventBus.js";

export type LifecycleHookEvent = (typeof ORBIT_LIFECYCLE_HOOK_EVENTS)[number];

export interface LifecycleHookCommand {
  command: string;
  matcher?: string;
  timeoutMs: number;
  onFailure: "block" | "warn" | "ignore";
}

export interface LifecycleHookContext {
  sessionId: string;
  attempt?: number;
  toolName?: string;
  filePath?: string;
  agentRole?: string;
  status?: string;
  mode?: string;
  promptLength?: number;
  verificationPassed?: boolean;
}

export interface SelectedLifecycleHook extends LifecycleHookCommand {
  legacy: boolean;
}

export interface LifecycleHookExecutionResult {
  ok: boolean;
  output: string;
}

export interface ExecuteLifecycleHooksOptions {
  hooks: OrbitConfig["hooks"];
  event: LifecycleHookEvent;
  context: LifecycleHookContext;
  execute: (
    hook: SelectedLifecycleHook,
    environment: Record<string, string>,
  ) => Promise<LifecycleHookExecutionResult>;
  report: (message: string) => void;
}

const WRITE_TOOLS = new Set([
  "write_file",
  "edit_file",
  "replace_file_content",
  "multi_replace_file_content",
]);

/** Select typed and legacy hooks without exposing raw prompts or tool arguments. */
export function selectLifecycleHooks(
  hooks: OrbitConfig["hooks"],
  event: LifecycleHookEvent,
  context: LifecycleHookContext,
): SelectedLifecycleHook[] {
  const configured = hooks.lifecycle?.[event] ?? [];
  const selected = configured
    .filter((hook) => matchesLifecycleHook(hook.matcher, event, context))
    .map((hook) => ({ ...hook, legacy: false }));

  const isWriteTool = context.toolName
    ? WRITE_TOOLS.has(context.toolName)
    : false;
  if (
    event === "preToolUse" &&
    isWriteTool &&
    context.filePath &&
    hooks.preEdit
  ) {
    selected.unshift({
      command: hooks.preEdit,
      timeoutMs: 30_000,
      onFailure: "block",
      legacy: true,
    });
  }
  if (
    event === "postToolUse" &&
    isWriteTool &&
    context.filePath &&
    hooks.postEdit
  ) {
    selected.unshift({
      command: hooks.postEdit,
      timeoutMs: 30_000,
      onFailure: "block",
      legacy: true,
    });
  }
  return selected;
}

export function matchesLifecycleHook(
  matcher: string | undefined,
  event: LifecycleHookEvent,
  context: LifecycleHookContext,
): boolean {
  if (!matcher) return true;
  const subject =
    context.toolName ||
    context.agentRole ||
    context.filePath ||
    context.status ||
    event;
  return globMatches(matcher, subject);
}

/** Build a bounded metadata-only environment. Raw prompts and arguments are excluded. */
export function buildLifecycleHookEnvironment(
  event: LifecycleHookEvent,
  context: LifecycleHookContext,
): Record<string, string> {
  const safeContext = Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined),
  );
  const payload = redactSecrets(JSON.stringify(safeContext)).slice(0, 32_768);
  return {
    ORBIT_HOOK_EVENT: event,
    ORBIT_HOOK_PAYLOAD: payload,
    ORBIT_SESSION_ID: context.sessionId,
    ...(context.toolName ? { ORBIT_TOOL_NAME: context.toolName } : {}),
    ...(context.filePath ? { ORBIT_FILE: context.filePath } : {}),
    ...(context.agentRole ? { ORBIT_AGENT_ROLE: context.agentRole } : {}),
    ...(context.status ? { ORBIT_HOOK_STATUS: context.status } : {}),
  };
}

/** Execute selected hooks sequentially so blocking order stays deterministic. */
export async function executeLifecycleHooks(
  options: ExecuteLifecycleHooksOptions,
): Promise<{ ok: boolean; output?: string }> {
  const hooks = selectLifecycleHooks(
    options.hooks,
    options.event,
    options.context,
  );
  for (const hook of hooks) {
    const hookId = `hook_${randomUUID()}`;
    const startedAt = Date.now();
    eventBus.emitEvent("hook_started", {
      hookId,
      event: options.event,
      legacy: hook.legacy,
    });
    options.report(`● Running ${options.event} hook...`);
    const result = await options.execute(
      hook,
      buildLifecycleHookEnvironment(options.event, options.context),
    );
    if (result.ok) {
      eventBus.emitEvent("hook_completed", {
        hookId,
        event: options.event,
        success: true,
        durationMs: Date.now() - startedAt,
        action: "continue",
      });
      options.report(`✔ ${options.event} hook passed.`);
      continue;
    }

    const action =
      hook.onFailure === "block"
        ? "blocked"
        : hook.onFailure === "ignore"
          ? "ignored"
          : "warn";
    eventBus.emitEvent("hook_completed", {
      hookId,
      event: options.event,
      success: false,
      durationMs: Date.now() - startedAt,
      action,
      error: result.output,
    });
    if (hook.onFailure === "block") {
      options.report(`✖ ${options.event} hook blocked: ${result.output}`);
      return { ok: false, output: result.output };
    }
    if (hook.onFailure === "warn") {
      options.report(`⚠️ ${options.event} hook warning: ${result.output}`);
    }
  }
  return { ok: true };
}

function globMatches(pattern: string, value: string): boolean {
  let source = "^";
  for (const character of pattern) {
    if (character === "*") source += ".*";
    else if (character === "?") source += ".";
    else source += character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }
  source += "$";
  return new RegExp(source, "iu").test(value);
}
