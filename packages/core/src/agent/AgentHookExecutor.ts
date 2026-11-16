import { randomUUID } from "node:crypto";
import type { OrbitConfig } from "@orbit-build/config";
import type { PermissionEngine } from "@orbit-build/permissions";
import { sandboxInvocation } from "@orbit-build/sandbox";
import { resolveCommandShellInvocation } from "@orbit-build/tools";
import {
  buildSanitizedChildEnvironment,
  redactSecrets,
} from "@orbit-build/shared";
import { eventBus } from "../events/EventBus.js";
import type { UserInteraction } from "./AgentInteraction.js";
import { resolveLifecycleHookSandboxMode } from "./LifecycleHooks.js";
import { executeManagedHookProcess } from "./ManagedHookProcess.js";
import { safeHookOutput, hookErrorOutput } from "./AgentTextTransforms.js";

export interface AgentHookExecutionContext {
  cwd: string;
  config: OrbitConfig;
  sessionId: string;
  permissionEngine: Pick<PermissionEngine, "evaluate">;
  interaction: Pick<UserInteraction, "askApproval">;
  signal?: AbortSignal;
  buildChildEnvironment(extra: Record<string, string>): NodeJS.ProcessEnv;
}

/** Execute a lifecycle hook with explicit approval, environment and cancellation authority. */
export async function executeAgentHook(
  context: AgentHookExecutionContext,
  hookCommand: string,
  environment: Record<string, string>,
  timeoutMs: number,
  abortable = true,
  extension?: { id: string; root: string },
): Promise<{ ok: boolean; output: string }> {
  if (hookCommand.includes("{file}")) {
    return {
      ok: false,
      output:
        'Unsafe hook placeholder "{file}" is no longer supported. Read the ORBIT_FILE environment variable instead.',
    };
  }

  const toolCallId = `hook_${randomUUID()}`;
  eventBus.emitEvent("tool_proposal", {
    toolCallId,
    toolName: "hook",
    arguments: {
      event: environment.ORBIT_HOOK_EVENT || "legacy",
      filePath: environment.ORBIT_FILE,
      ...(extension ? { extensionId: extension.id } : {}),
    },
    explanation: "Run a configured Orbit lifecycle hook.",
  });
  const decision = context.permissionEngine.evaluate(
    "bash",
    { command: hookCommand },
    "execute",
  );
  if (decision.action === "deny") {
    eventBus.emitEvent("tool_approval", {
      toolCallId,
      approved: false,
      reason: decision.reason,
    });
    eventBus.emitEvent("tool_result", {
      toolCallId,
      toolName: "hook",
      error: decision.reason,
    });
    return { ok: false, output: decision.reason };
  }
  if (decision.action === "ask") {
    const approved = await context.interaction.askApproval(
      decision.reason,
      redactSecrets(hookCommand),
    );
    eventBus.emitEvent("tool_approval", {
      toolCallId,
      approved,
      reason: decision.reason,
    });
    if (!approved) {
      const output = "Hook execution was not approved.";
      eventBus.emitEvent("tool_result", {
        toolCallId,
        toolName: "hook",
        error: output,
      });
      return { ok: false, output };
    }
  } else {
    eventBus.emitEvent("tool_approval", {
      toolCallId,
      approved: true,
      reason: decision.reason,
    });
  }

  try {
    const childEnvironment = extension
      ? buildSanitizedChildEnvironment({
          mode: "minimal",
          extra: {
            ...environment,
            ORBIT_EXTENSION_ID: extension.id,
            ORBIT_EXTENSION_ROOT: extension.root,
            ORBIT_WORKSPACE_ROOT: context.cwd,
          },
        })
      : context.buildChildEnvironment(environment);
    const shell = resolveCommandShellInvocation(hookCommand, {
      environment: childEnvironment,
    });
    const sandboxed = sandboxInvocation(shell, {
      cwd: extension?.root ?? context.cwd,
      mode: resolveLifecycleHookSandboxMode(extension, context.config),
      network: extension ? "deny" : context.config.tools.bash.network,
      environment: childEnvironment,
      trustRoots: context.config.security.windowsSandboxTrustRoots,
      ...(extension
        ? {
            readOnlyRoots: [extension.root],
            writableRoots: [],
          }
        : {}),
    });
    const { stdout, stderr } = await executeManagedHookProcess(
      {
        command: hookCommand,
        invocation: sandboxed,
        sessionId: context.sessionId,
        cwd: extension?.root ?? context.cwd,
        environment: childEnvironment,
        timeoutMs: Math.min(timeoutMs, context.config.tools.bash.timeoutMs),
        sandbox: { mode: "off", network: "inherit" }, // Already sandboxed above.
      },
      abortable ? context.signal : undefined,
    );
    const output = safeHookOutput(stdout + stderr);
    eventBus.emitEvent("tool_result", {
      toolCallId,
      toolName: "hook",
      result: { ok: true },
    });
    return { ok: true, output };
  } catch (error: unknown) {
    const output = safeHookOutput(hookErrorOutput(error));
    eventBus.emitEvent("tool_result", {
      toolCallId,
      toolName: "hook",
      error: output,
    });
    if (error instanceof Error && error.name === "AbortError") throw error;
    return { ok: false, output };
  }
}
