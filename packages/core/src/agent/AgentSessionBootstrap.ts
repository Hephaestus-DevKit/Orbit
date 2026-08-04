import { createHash } from "crypto";
import path from "path";
import { OrbitConfig } from "@orbit-build/config";
import type { ModelProvider } from "@orbit-build/model-providers";
import { PermissionEngine } from "@orbit-build/permissions";
import {
  CheckpointManager,
  RollbackManager,
  loadOrCreateCheckpointKey,
} from "@orbit-build/sandbox";
import { ensurePrivateDirectory } from "@orbit-build/shared";
import { ContextPackBuilder } from "@orbit-build/context-engine";
import { SessionManager, type TaskPlanItem } from "@orbit-build/session";
import {
  BackgroundTaskRuntime,
  type ToolRuntimeServices,
  type ToolTaskPlanUpdate,
} from "@orbit-build/tools";
import { ProjectMemoryStore } from "../memory/ProjectMemoryStore.js";
import { VerificationContractManager } from "../verification/VerificationContractManager.js";
import { eventBus } from "../events/EventBus.js";
import { createInitialState, type AgentState } from "./AgentState.js";
import { VOLATILE_CONTEXT_MESSAGE_KIND } from "./MessageBuilder.js";
import { StepRunner } from "./StepRunner.js";

/** Durable session directory for orchestrated children, separate from chats. */
export const ORCHESTRATED_AGENT_SESSION_PATH = ".orbit/agent-sessions";

export interface AgentLoopOptions {
  modelOverride?: string;
  systemPromptOverride?: string;
  allowedTools?: string[];
  disableMcp?: boolean;
  /** @deprecated Provide `interaction.progress` instead; retained for compatibility. */
  disableStatusBar?: boolean;
  sessionId?: string;
  requireSession?: boolean;
  nonInteractive?: boolean;
  /** Durable child identity for approval ownership and agent controls. */
  agent?: { id: string; role: string };
  /**
   * Persist this loop's Session independently from its execution workspace.
   * Orchestrated children use the main project while tools run in a temporary
   * worktree, keeping their threads recoverable after worktree cleanup.
   */
  sessionStorage?: { workspaceRoot: string; path: string };
}

export interface AgentSessionBootstrapResult {
  state: AgentState;
  sessionManager: SessionManager;
  checkpointManager: CheckpointManager;
  rollbackManager: RollbackManager;
  permissionEngine: PermissionEngine;
  contextBuilder: ContextPackBuilder;
  stepRunner: StepRunner;
  backgroundTasks: BackgroundTaskRuntime;
  toolRuntimeServices: ToolRuntimeServices;
  verificationManager: VerificationContractManager;
  projectMemoryStore: ProjectMemoryStore;
  userId: string;
  sessionCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
}

/**
 * Performs the explicit filesystem-backed bootstrap required by an AgentLoop.
 * Keeping this work outside the constructor makes lifecycle ordering testable
 * and prevents apparently harmless object construction from mutating sessions.
 */
export function initializeAgentSession(
  cwd: string,
  config: OrbitConfig,
  provider: ModelProvider,
  task: string,
  options: AgentLoopOptions = {},
): AgentSessionBootstrapResult {
  const sessionWorkspaceRoot = path.resolve(
    options.sessionStorage?.workspaceRoot ?? cwd,
  );
  const sessionPath =
    options.sessionStorage?.path ??
    (config.session.store === "jsonl"
      ? config.session.path
      : ".orbit/sessions");
  // Lock the workspace state root to the current user before anything writes
  // under it. Windows ACL inheritance then covers sessions, checkpoints,
  // caches, and memory without per-file work.
  ensurePrivateDirectory(path.join(cwd, ".orbit"));
  if (sessionWorkspaceRoot !== path.resolve(cwd)) {
    ensurePrivateDirectory(path.join(sessionWorkspaceRoot, ".orbit"));
  }
  const sessionManager = new SessionManager(sessionWorkspaceRoot, sessionPath);
  let session = options.sessionId
    ? sessionManager.resumeSession(options.sessionId)
    : undefined;
  if (!session && options.sessionId && options.requireSession) {
    throw new Error(`Orbit session not found: ${options.sessionId}`);
  }
  if (!session) {
    session = sessionManager.startNewSession(
      provider.id,
      options.modelOverride || config.models.default,
    );
  }

  const runtimeModel = options.modelOverride || config.models.default;
  if (session.provider !== provider.id || session.model !== runtimeModel) {
    sessionManager.setRuntime(provider.id, runtimeModel);
  }

  const state = createInitialState(
    session.id,
    task,
    resolveMaxLoopAttempts(config),
  );
  if (options.sessionId) restoreSessionHistory(sessionManager, state);

  const checkpointManager = new CheckpointManager(cwd, session.id, {
    encrypt: config.security?.encryptCheckpoints ?? true,
    keyProvider: loadOrCreateCheckpointKey,
  });
  const backgroundTasks = new BackgroundTaskRuntime({
    workspaceRoot: cwd,
    ...config.tools.backgroundTasks,
    onEvent: (event) => {
      const task = event.task;
      const payload = {
        taskId: task.id,
        sessionId: task.sessionId,
        command: task.command,
        cwd: task.cwd,
        status: task.status,
        startedAt: task.startedAt,
        ...(task.endedAt ? { endedAt: task.endedAt } : {}),
        durationMs: task.durationMs,
        exitCode: task.exitCode,
        outputTruncated: task.outputTruncated,
      };
      const type =
        event.type === "started"
          ? ("background_task_started" as const)
          : ("background_task_completed" as const);
      try {
        sessionManager
          .getSessionStore()
          .appendEvent(task.sessionId, type, payload);
      } catch {
        // A session trace failure must not hide the live lifecycle event.
      }
      if (event.type === "started") {
        eventBus.emitEvent("background_task_started", payload);
      } else {
        eventBus.emitEvent("background_task_completed", payload);
      }
    },
  });
  const toolRuntimeServices: ToolRuntimeServices = {
    updatePlan: (update) => updateSessionTaskPlan(sessionManager, update),
    backgroundTasks,
  };
  return {
    state,
    sessionManager,
    checkpointManager,
    rollbackManager: new RollbackManager(cwd),
    permissionEngine: new PermissionEngine(config, cwd),
    contextBuilder: new ContextPackBuilder(cwd),
    stepRunner: new StepRunner(cwd, session.id, config, toolRuntimeServices),
    backgroundTasks,
    toolRuntimeServices,
    verificationManager: new VerificationContractManager(
      cwd,
      session.id,
      checkpointManager,
      config.security?.trustProjectExecutables ?? false,
      config.tools.bash.timeoutMs,
    ),
    projectMemoryStore: new ProjectMemoryStore(cwd),
    userId: workspaceUserId(sessionWorkspaceRoot),
    sessionCost: session.totalCostEstimate || 0,
    totalInputTokens: session.totalInputTokens || 0,
    totalOutputTokens: session.totalOutputTokens || 0,
    totalCacheReadTokens: session.totalCacheReadTokens || 0,
  };
}

function updateSessionTaskPlan(
  sessionManager: SessionManager,
  update: ToolTaskPlanUpdate,
): unknown {
  const existing = sessionManager.getTaskPlan();
  const available = [...(existing?.items ?? [])];
  const now = new Date().toISOString();
  const items: TaskPlanItem[] = update.plan.map((entry) => {
    const matchIndex = available.findIndex((item) => item.text === entry.step);
    const previous =
      matchIndex >= 0 ? available.splice(matchIndex, 1)[0] : undefined;
    return {
      id:
        previous?.id ??
        `step_${createHash("sha256").update(`${entry.step}\0${now}`).digest("hex").slice(0, 16)}`,
      text: entry.step,
      status: entry.status,
      createdAt: previous?.createdAt ?? now,
      updatedAt: previous?.status === entry.status ? previous.updatedAt : now,
    };
  });
  const saved = sessionManager.saveTaskPlan(items, existing?.goal);
  sessionManager.logEvent("model_task_plan_update", {
    explanation: update.explanation?.slice(0, 1000),
    itemCount: items.length,
  });
  return saved;
}

function restoreSessionHistory(
  sessionManager: SessionManager,
  state: AgentState,
): void {
  const savedHistory = sessionManager.getHistory();
  if (savedHistory.length === 0) return;
  state.history = savedHistory;
  const lastUser = [...savedHistory]
    .reverse()
    .find(
      (message) =>
        message.role === "user" &&
        message.metadata?.kind !== VOLATILE_CONTEXT_MESSAGE_KIND &&
        message.metadata?.kind !== "history_compaction_summary",
    );
  if (!lastUser) return;
  state.task = lastUser.content
    .map((content) => (content.type === "text" ? content.text : ""))
    .join("");
}

function resolveMaxLoopAttempts(config: OrbitConfig): number {
  const raw = config.agent?.maxIterations;
  if (!Number.isFinite(raw)) return 24;
  return Math.max(1, Math.min(50, Math.floor(raw)));
}

function workspaceUserId(cwd: string): string {
  const workspaceIdentity = path.resolve(cwd).replace(/\\/g, "/");
  return createHash("sha256")
    .update(
      process.platform === "win32"
        ? workspaceIdentity.toLowerCase()
        : workspaceIdentity,
    )
    .digest("hex");
}
