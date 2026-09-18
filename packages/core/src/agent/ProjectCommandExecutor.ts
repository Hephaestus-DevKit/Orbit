import { randomUUID } from "crypto";
import { isFullAccessEnabled, type OrbitConfig } from "@orbit-build/config";
import type { PermissionEngine } from "@orbit-build/permissions";
import type { BackgroundTaskService } from "@orbit-build/tools";
import {
  buildInheritedChildEnvironment,
  buildSanitizedChildEnvironment,
  redactSecrets,
} from "@orbit-build/shared";
import { eventBus } from "../events/EventBus.js";
import type { UserInteraction } from "./AgentInteraction.js";

export interface ProjectCommand {
  command: string;
  invocation?: { file: string; args: string[] };
}

export type ProjectCommandRunner = (
  request: ProjectCommand,
) => Promise<{ stdout: string; stderr: string }>;

export interface ProjectCommandContext {
  cwd: string;
  sessionId: string;
  config: OrbitConfig;
  permissions: PermissionEngine;
  interaction: Pick<UserInteraction, "askApproval">;
  runtime: BackgroundTaskService;
  signal?: AbortSignal;
}

/** Project-owned code uses the same policy, process owner and cancellation boundary as tools. */
export async function executeProjectCommand(
  context: ProjectCommandContext,
  request: ProjectCommand,
): Promise<{ stdout: string; stderr: string }> {
  const { config, signal, sessionId, runtime } = context;
  signal?.throwIfAborted();
  const fullAccess = isFullAccessEnabled(config);
  if (!fullAccess && !config.tools.bash.enabled) {
    throw new Error("Project commands are disabled by the bash tool policy.");
  }
  if (!fullAccess && !config.security.trustProjectExecutables) {
    throw new Error(
      "Project executable trust is required before running project commands.",
    );
  }
  const toolCallId = `project_${randomUUID()}`;
  const command = redactSecrets(request.command);
  eventBus.emitEvent("tool_proposal", {
    toolCallId,
    toolName: "project_command",
    arguments: { command },
    explanation: "Run project-owned verification or formatting code.",
  });
  const decision = context.permissions.evaluate(
    "bash",
    { command: request.command },
    "execute",
  );
  const approved =
    decision.action === "allow" ||
    (decision.action === "ask" &&
      (await context.interaction.askApproval(decision.reason, command)));
  eventBus.emitEvent("tool_approval", {
    toolCallId,
    approved,
    reason: decision.reason,
  });
  try {
    signal?.throwIfAborted();
    if (!approved)
      throw new Error(`Project command was not approved: ${decision.reason}`);
    let task = await runtime.startCommand({
      ...request,
      notifyOnCompletion: false,
      cwd: context.cwd,
      sessionId,
      timeoutMs: config.tools.bash.timeoutMs,
      environment: fullAccess
        ? buildInheritedChildEnvironment()
        : buildSanitizedChildEnvironment(),
      sandbox: {
        mode: fullAccess ? "off" : config.tools.bash.sandbox,
        network: config.tools.bash.network,
        trustRoots: config.security.windowsSandboxTrustRoots,
      },
    });
    try {
      while (task.status === "running") {
        signal?.throwIfAborted();
        [task] = await runtime.getTasks(
          sessionId,
          { taskIds: [task.id], waitMs: 1_000 },
          signal,
        );
      }
      signal?.throwIfAborted();
    } finally {
      if (task.status === "running") await runtime.killTask(sessionId, task.id);
    }
    if (task.status !== "completed" || task.exitCode !== 0) {
      throw Object.assign(
        new Error(`Project command ${task.status} (exit ${task.exitCode}).`),
        {
          stdout: task.stdout,
          stderr: task.stderr,
        },
      );
    }
    eventBus.emitEvent("tool_result", {
      toolCallId,
      toolName: "project_command",
      result: { ok: true },
    });
    return { stdout: task.stdout, stderr: task.stderr };
  } catch (error: unknown) {
    eventBus.emitEvent("tool_result", {
      toolCallId,
      toolName: "project_command",
      error: redactSecrets(
        error instanceof Error ? error.message : String(error),
      ),
    });
    throw error;
  }
}
