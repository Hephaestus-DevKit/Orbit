import {
  isFullAccessEnabled,
  ORBIT_LIFECYCLE_HOOK_EVENTS,
  type AgentProfile,
  type OrbitConfig,
  validateManagedRuntimeChange,
} from "@orbit-build/config";
import {
  resolveModelCanonicalName,
  resolveModelThinkingPolicy,
  resolveModelCapabilities,
  isProviderError,
  ModelProvider,
  ModelApiFormat,
  ModelChatInput,
  OrbitMessage,
  OrbitContentBlock,
  OrbitToolCall,
  TokenUsage,
} from "@orbit-build/model-providers";
import { PermissionEngine } from "@orbit-build/permissions";
import {
  CheckpointManager,
  RollbackManager,
  sandboxInvocation,
} from "@orbit-build/sandbox";
import {
  ContextPackBuilder,
  SymbolIndexer,
  ContextPack,
} from "@orbit-build/context-engine";
import {
  SessionManager,
  Session,
  type SessionMetrics,
  type SessionTraceBundle,
  type TaskPlan,
  type TaskPlanItem,
  type QueuedAgentInput,
} from "@orbit-build/session";
import {
  type BackgroundTaskRuntime,
  type BackgroundTaskSnapshot,
  type OrbitTool,
  type ToolResult,
  type ToolRuntimeServices,
  type ToolRegistry,
  resolveCommandShellInvocation,
} from "@orbit-build/tools";
import { type UserInteraction } from "./AgentInteraction.js";
import { AgentInputQueueController } from "./AgentInputQueueController.js";
import { AgentState, createInitialState } from "./AgentState.js";
import { LoopProgressGuard } from "./LoopProgressGuard.js";
import { countRepairAttemptsForCurrentTask } from "./RepairBudget.js";
import { z } from "zod";
import {
  MessageBuilder,
  VOLATILE_CONTEXT_MESSAGE_KIND,
} from "./MessageBuilder.js";
import { PromptCacheSlab, PromptCacheSlabBuilder } from "./PromptCacheSlab.js";
import { StepRunner } from "./StepRunner.js";
import { Planner } from "./Planner.js";
import { classifyTaskComplexity, routeModel } from "./ModelRouter.js";
import {
  ProjectMemoryStore,
  type ProjectMemory,
  type ProjectMemoryEntry,
} from "../memory/ProjectMemoryStore.js";
import { eventBus } from "../events/EventBus.js";
import picocolors from "picocolors";
import path from "path";
import { pathToFileURL } from "url";
import fs from "fs";
import { randomUUID } from "crypto";
import { exec, execFile } from "child_process";
import { promisify } from "util";
const execPromise = promisify(exec);
const execFilePromise = promisify(execFile);
import {
  estimateTokenCount,
  HIDDEN_CHILD_PROCESS_OPTIONS,
  readBoundedRegularFile,
  redactSecrets,
  redactSensitiveValue,
  buildInheritedChildEnvironment,
  buildSanitizedChildEnvironment,
  resolveSafePath,
} from "@orbit-build/shared";
import { VerificationContractManager } from "../verification/VerificationContractManager.js";
import {
  buildSemanticCompactionSummary,
  compactHistoryMessages,
  isContextWindowError,
  isOutputTokenLimitError,
  resolveContextWindowStatus,
  type ContextWindowStatus,
  type HistoryCompactionStats,
} from "./ContextWindowManager.js";
import { buildAuditDiff, isFileMutationTool, sha256 } from "./AgentAudit.js";
import {
  captureWorkspaceMutationSnapshot,
  compareWorkspaceMutationSnapshots,
  type WorkspaceMutationDelta,
} from "./WorkspaceMutationTracker.js";
import { prepareIsolatedGitCommit } from "./IsolatedGitCommit.js";
import {
  cleanAndTruncateTestLog,
  parseSearchReplaceBlocks,
} from "./AgentTextTransforms.js";
import {
  generateNativeToolsPrompt,
  generateXMLToolsPrompt,
  parseTextToolCalls,
  parseXMLToolCalls,
} from "./AgentToolProtocol.js";
import {
  executeLocalPackageBinary,
  isValidPackageName,
} from "./LocalPackageBinary.js";
import { McpRuntimeManager } from "./McpRuntimeManager.js";
import type {
  MCPInteractionHandlers,
  MCPServerInteractionRequest,
  MCPRootsList,
} from "@orbit-build/mcp";
import {
  initializeAgentSession,
  createSessionCheckpointManager,
  resolveAgentMaxLoopAttempts,
  type AgentLoopOptions,
  type AgentSessionBootstrapResult,
} from "./AgentSessionBootstrap.js";
import {
  buildToolResultContent,
  TOOL_STATUS_MAX_CHARS,
  truncateToolText,
} from "./ToolResultContent.js";
import {
  executeLifecycleHooks,
  type LifecycleHookContext,
  type LifecycleHookEvent,
} from "./LifecycleHooks.js";

const DEEPSEEK_CACHE_DEGRADED_HIT_RATE = 0.85;
const DEEPSEEK_VERBOSE_CACHE_ENV = "ORBIT_DEEPSEEK_VERBOSE_CACHE";
const AGENT_LOOP_ERROR_MESSAGE_MAX_CHARS = 2000;
const AGENT_EDIT_FILE_MAX_BYTES = 16 * 1024 * 1024;

export type AgentLoopFailureCode =
  | "provider_error"
  | "execution_error"
  | "verification_failed"
  | "iteration_limit"
  | "budget_exceeded";
export type AgentLoopAbortReason =
  | "immediate"
  | "interrupted"
  | "rollback"
  | "iteration_limit";

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

export interface HistoryCompactionResult
  extends ContextWindowStatus, HistoryCompactionStats {}

class AgentLoopExecutionError extends Error {
  public readonly name = "AgentLoopExecutionError";

  constructor(
    public readonly code: AgentLoopFailureCode,
    message: string,
  ) {
    super(message);
  }
}

function safeAgentLoopErrorMessage(error: unknown): string {
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

function waitForAgentRetry(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    // Provider retry is foreground Agent work. An unreferenced timer can make
    // Node exit while the top-level Agent promise is still awaiting recovery.
    const onAbort = () => {
      clearTimeout(timeout);
      cleanup();
      reject(
        signal?.reason ??
          new DOMException("The user aborted a request.", "AbortError"),
      );
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function resolveScheduledModelPrice(
  price: OrbitConfig["pricing"][string],
  now = new Date(),
): OrbitConfig["pricing"][string] {
  const scheduled = price.scheduled;
  if (!scheduled || now.getTime() < Date.parse(scheduled.effectiveAt)) {
    return price;
  }
  const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
  const isPeak = scheduled.peakHoursUtc.some((window) => {
    const [start, end] = window.split("-");
    const [startHour, startMinute] = start.split(":").map(Number);
    const [endHour, endMinute] = end.split(":").map(Number);
    const startValue = startHour * 60 + startMinute;
    const endValue = endHour * 60 + endMinute;
    return minuteOfDay >= startValue && minuteOfDay < endValue;
  });
  return isPeak ? scheduled.peak : scheduled.offPeak;
}

function safeHookOutput(value: unknown): string {
  return redactSecrets(String(value ?? ""))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, " ")
    .trim()
    .slice(0, 4000);
}

function hookErrorOutput(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error);
  const record = error as Record<string, unknown>;
  const output = `${typeof record.stdout === "string" ? record.stdout : ""}${
    typeof record.stderr === "string" ? record.stderr : ""
  }`;
  if (output.trim()) return output;
  return typeof record.message === "string" ? record.message : String(error);
}

function hasSuccessfulWorkspaceFileMutations(
  history: OrbitMessage[],
  cwd: string,
): boolean {
  const mutationCallIds = new Set<string>();

  for (const message of history) {
    for (const block of message.content) {
      if (
        block.type === "tool_call" &&
        isFileMutationTool(block.toolCall.name)
      ) {
        try {
          const args = toUnknownRecord(JSON.parse(block.toolCall.arguments));
          const targetPath = firstStringValue(
            args.path,
            args.TargetFile,
            args.filePath,
            args.file,
          );
          if (!targetPath) continue;
          resolveSafePath(cwd, targetPath);
          mutationCallIds.add(block.toolCall.id);
        } catch {
          // Outside-workspace and malformed paths do not enter workspace gates.
        }
      }
    }
  }

  if (mutationCallIds.size === 0) return false;

  return history.some((message) =>
    message.content.some(
      (block) =>
        block.type === "tool_result" &&
        mutationCallIds.has(block.toolResult.toolCallId) &&
        block.toolResult.isError !== true,
    ),
  );
}

export type { UserInteraction } from "./AgentInteraction.js";

interface SessionReviewSnapshot {
  fileChanges: SessionTraceBundle["fileChanges"];
  toolCalls: SessionTraceBundle["toolCalls"];
  checkpoints: ReturnType<AgentLoop["getCheckpoints"]>;
  verification: Array<{
    timestamp: string;
    success?: boolean;
    detail?: string;
  }>;
}

export class AgentLoop {
  private state: AgentState;
  public sessionManager: SessionManager;
  private checkpointManager: CheckpointManager;
  private rollbackManager: RollbackManager;
  private permissionEngine: PermissionEngine;
  private contextBuilder: ContextPackBuilder;
  private stepRunner: StepRunner;
  private readonly backgroundTasks: BackgroundTaskRuntime;
  private readonly toolRuntimeServices: ToolRuntimeServices;
  private readonly inputQueue: AgentInputQueueController;
  private verificationManager: VerificationContractManager;
  private readonly toolRegistry: ToolRegistry;
  private readonly mcpRuntimeManager: McpRuntimeManager;
  private mcpInitialization: Promise<
    Awaited<ReturnType<McpRuntimeManager["start"]>>
  > | null = null;
  private mcpStartResult: Awaited<
    ReturnType<McpRuntimeManager["start"]>
  > | null = null;
  private reportedSkillActivations = "";
  private reportedSkillErrors = "";

  /**
   * Surface the turn's skill decisions: activation events for observers,
   * read roots so bundled skill resources are readable, and one warning per
   * unique set of discovery errors so a broken SKILL.md is not silent.
   */
  private reportSkillContext(contextPack: ContextPack): void {
    const active = contextPack.activeSkills ?? [];
    this.stepRunner.setReadRoots(
      active.map((skill) => ({ name: skill.name, path: skill.rootDir })),
    );
    this.permissionEngine.setTrustedRoots(active.map((skill) => skill.rootDir));

    const signature = JSON.stringify(
      active.map((skill) => [skill.name, skill.activation]),
    );
    if (signature !== this.reportedSkillActivations) {
      this.reportedSkillActivations = signature;
      for (const skill of active) {
        eventBus.emitEvent("skill_activated", {
          name: skill.name,
          activation: skill.activation,
          loadedBytes: skill.loadedBytes,
          truncated: skill.truncated,
        });
      }
    }

    const errors = (contextPack.skillDiagnostics ?? []).filter(
      (diagnostic) => diagnostic.severity === "error",
    );
    const errorSignature = JSON.stringify(errors.map((item) => item.path));
    if (errors.length > 0 && errorSignature !== this.reportedSkillErrors) {
      this.reportedSkillErrors = errorSignature;
      eventBus.emitEvent("warning", {
        message: `${errors.length} skill file(s) failed to load; run /skills for details.`,
      });
    }
  }

  /** Drop the skill discovery cache so newly created skills load at once. */
  public invalidateSkillsCache(): void {
    this.contextBuilder.invalidateSkillsCache();
    this.cachedContextPack = null;
  }

  /** Prompts discovered on running MCP servers, for slash-command surfaces. */
  public listMcpPrompts(): ReturnType<McpRuntimeManager["listPrompts"]> {
    return this.mcpRuntimeManager.listPrompts();
  }

  /** Expand one discovered MCP prompt into user-turn text. */
  public expandMcpPrompt(
    serverName: string,
    promptName: string,
    args?: Record<string, string>,
  ): Promise<string> {
    return this.mcpRuntimeManager.expandPrompt(serverName, promptName, args);
  }

  /** Browser/terminal-safe MCP health snapshots. */
  public listMcpHealth(): ReturnType<McpRuntimeManager["listHealth"]> {
    return this.mcpRuntimeManager.listHealth();
  }

  /** Refresh tool, resource, and prompt catalogs without restarting servers. */
  public refreshMcpCatalogs(
    serverName?: string,
  ): ReturnType<McpRuntimeManager["refreshCatalogs"]> {
    return this.mcpRuntimeManager.refreshCatalogs(serverName);
  }

  /** Start configured MCP servers once and retain them for this loop's lifetime. */
  public async initializeMcp(): Promise<
    Awaited<ReturnType<McpRuntimeManager["start"]>>
  > {
    if (this.mcpStartResult) return this.mcpStartResult;
    if (this.mcpInitialization) return this.mcpInitialization;
    const servers =
      !this.options?.disableMcp && this.config.tools.mcp.enabled
        ? selectProfileMcpServers(
            this.config.mcpServers,
            this.options.mcpServers,
          )
        : undefined;
    if (this.options.mcpServers) {
      const missing = this.options.mcpServers.filter(
        (name) =>
          !Object.prototype.hasOwnProperty.call(this.config.mcpServers, name),
      );
      if (missing.length > 0) {
        this.interaction.showText(
          `⚠️ Agent Profile MCP selection ignored unavailable server(s): ${missing.join(", ")}`,
        );
      }
    }
    if (!servers || Object.keys(servers).length === 0) {
      this.mcpStartResult = {
        startedServers: 0,
        registeredTools: 0,
        failures: [],
      };
      return this.mcpStartResult;
    }

    eventBus.emitEvent("agent_status", {
      taskId: this.state.sessionId,
      status: "initializing_mcp",
      detail: `${Object.keys(servers).length} configured server(s)`,
    });
    this.interaction.showText("● Initializing MCP servers...");
    this.mcpInitialization = this.mcpRuntimeManager
      .start(servers, (message) => this.interaction.showText(message))
      .then((result) => {
        this.mcpStartResult = result;
        eventBus.emitEvent("agent_status", {
          taskId: this.state.sessionId,
          status: result.failures.length === 0 ? "mcp_ready" : "mcp_degraded",
          detail: `${result.startedServers} server(s), ${result.registeredTools} tool(s), ${result.failures.length} failure(s)`,
        });
        return result;
      })
      .finally(() => {
        this.mcpInitialization = null;
      });
    return this.mcpInitialization;
  }

  private abortController: AbortController | null = null;
  private interruptMode: "prompt" | "abort" = "prompt";
  private sessionCost = 0;
  private sessionCostKnown = true;
  private unknownPricingModels = new Set<string>();
  private totalInputTokens = 0;
  private totalCacheReadTokens = 0;
  private totalOutputTokens = 0;
  private cachedRepoMapText = "";
  private lastSymbolsMtime = 0;
  private cachedContextPack: ContextPack | null = null;
  private cachedRepoMapTextForRun: string | null = null;
  private readonly progressGuard = new LoopProgressGuard();
  private activeModelForRun: string | null = null;
  private fallbackModelForRun: string | null = null;
  private fallbackExpiresAfterAttempt = 0;
  private contextOverflowRetriesForRun = 0;
  private outputLimitRetriesForRun = 0;
  private providerRetriesForRun = 0;
  private completionVerificationNudgedForRun = false;
  private finalResponseOnlyReason: string | null = null;
  private approvedToolScopes = new Set<string>();
  private terminalFailure: {
    code: AgentLoopFailureCode;
    message: string;
  } | null = null;
  private verificationStatus: "not_run" | "passed" | "failed" = "not_run";
  private workspaceMutationRevision = 0;
  private verifiedMutationRevision = -1;
  private sessionReviewCache:
    | { expiresAt: number; value: SessionReviewSnapshot }
    | undefined;
  private userId: string;
  private readonly projectMemoryStore: ProjectMemoryStore;

  private formatSessionCost(): string {
    return this.sessionCostKnown
      ? `$${this.sessionCost.toFixed(4)}`
      : "unknown (pricing not configured)";
  }

  private resolvePricing(
    model: string,
  ): OrbitConfig["pricing"][string] | undefined {
    const cleanModel = model.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
    const pricingModel = resolveModelCanonicalName(cleanModel);
    const direct = this.config.pricing?.[pricingModel];
    if (direct) return resolveScheduledModelPrice(direct);
    for (const key of Object.keys(this.config.pricing || {})) {
      if (key.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "") === pricingModel) {
        return resolveScheduledModelPrice(this.config.pricing[key]);
      }
    }
    return undefined;
  }

  private noteUnknownPricing(model: string): void {
    const cleanModel = model.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
    this.sessionCostKnown = false;
    if (this.unknownPricingModels.has(cleanModel)) return;
    this.unknownPricingModels.add(cleanModel);
    this.sessionManager.logEvent("model_pricing_unknown", {
      model: cleanModel,
    });
    this.interaction.showText(
      picocolors.yellow(
        `⚠ Pricing is not configured for ${cleanModel}; Orbit will report token usage but cannot enforce the dollar budget. Add an entry to ~/.orbit/pricing.json to enable cost accounting.`,
      ),
    );
  }

  private recordVerificationResult(passed: boolean): void {
    this.verificationStatus = passed ? "passed" : "failed";
    this.verifiedMutationRevision = passed
      ? this.workspaceMutationRevision
      : -1;
  }

  private registerWorkspaceMutation(
    paths: string[],
    source: string,
    delta?: WorkspaceMutationDelta,
  ): void {
    this.workspaceMutationRevision += 1;
    this.verificationStatus = "not_run";
    this.verifiedMutationRevision = -1;

    if (delta) {
      for (const filePath of paths) {
        this.sessionManager.recordFileModification(
          filePath,
          [
            `--- a/${filePath}`,
            `+++ b/${filePath}`,
            `@@ Orbit detected a workspace mutation during ${source} @@`,
          ].join("\n"),
          delta.beforeFingerprint,
          delta.afterFingerprint,
        );
      }
    }
    this.sessionManager.logEvent("workspace_mutation_detected", {
      source,
      paths,
      revision: this.workspaceMutationRevision,
    });
  }

  private hasCurrentVerification(): boolean {
    return (
      this.verificationStatus === "passed" &&
      this.verifiedMutationRevision === this.workspaceMutationRevision
    );
  }

  private verificationFailureMessage(): string {
    return this.verificationStatus === "failed"
      ? "The final verification check failed."
      : "Modified files were not verified before completion.";
  }

  private verificationSummary(): "passed" | "failed" | "not run" {
    if (this.hasCurrentVerification()) return "passed";
    return this.verificationStatus === "failed" ? "failed" : "not run";
  }

  public static initialize(
    cwd: string,
    config: OrbitConfig,
    provider: ModelProvider,
    task: string,
    interaction: UserInteraction,
    options: AgentLoopOptions = {},
  ): AgentLoop {
    return new AgentLoop(
      cwd,
      config,
      provider,
      interaction,
      options,
      initializeAgentSession(cwd, config, provider, task, options),
    );
  }

  private constructor(
    private cwd: string,
    private config: OrbitConfig,
    private provider: ModelProvider,
    private interaction: UserInteraction,
    private options: AgentLoopOptions,
    bootstrap: AgentSessionBootstrapResult,
  ) {
    this.state = bootstrap.state;
    this.sessionManager = bootstrap.sessionManager;
    this.checkpointManager = bootstrap.checkpointManager;
    this.rollbackManager = bootstrap.rollbackManager;
    this.permissionEngine = bootstrap.permissionEngine;
    this.contextBuilder = bootstrap.contextBuilder;
    this.stepRunner = bootstrap.stepRunner;
    this.backgroundTasks = bootstrap.backgroundTasks;
    this.toolRuntimeServices = bootstrap.toolRuntimeServices;
    this.toolRegistry = bootstrap.toolRegistry;
    this.mcpRuntimeManager = new McpRuntimeManager(
      this.toolRegistry,
      undefined,
      { interactions: this.createMcpInteractionHandlers() },
    );
    this.inputQueue = new AgentInputQueueController(this.sessionManager);
    this.verificationManager = bootstrap.verificationManager;
    this.projectMemoryStore = bootstrap.projectMemoryStore;
    this.userId = bootstrap.userId;
    this.sessionCost = bootstrap.sessionCost;
    this.sessionCostKnown =
      this.sessionManager.getActiveSession()?.costEstimateKnown !== false;
    this.totalInputTokens = bootstrap.totalInputTokens;
    this.totalOutputTokens = bootstrap.totalOutputTokens;
    this.totalCacheReadTokens = bootstrap.totalCacheReadTokens;
  }

  public abort(mode: "prompt" | "immediate" = "prompt"): void {
    this.interruptMode = mode === "immediate" ? "abort" : "prompt";
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /** Replace the active interaction surface while the shared loop is idle. */
  public setUserInteraction(interaction: UserInteraction): void {
    this.interaction = interaction;
  }

  private askSelect(
    message: string,
    options: Array<{ value: string; label: string; hint?: string }>,
  ): Promise<string | null> {
    return (
      this.interaction.prompt?.askSelect(message, options) ??
      Promise.resolve(null)
    );
  }

  private askText(
    message: string,
    initialValue?: string,
  ): Promise<string | null> {
    return (
      this.interaction.prompt?.askText(message, initialValue) ??
      Promise.resolve(null)
    );
  }

  private askMultiSelect(
    message: string,
    options: Array<{ value: string; label: string; hint?: string }>,
  ): Promise<string[] | null> {
    return (
      this.interaction.prompt?.askMultiSelect(message, options) ??
      Promise.resolve(null)
    );
  }

  /** Host MCP interactions through the same approval and prompt surface as native Agent work. */
  private createMcpInteractionHandlers(): MCPInteractionHandlers {
    return {
      onElicitation: (request, signal) =>
        this.handleMcpElicitation(request, signal),
      onRootsList: (_request, signal) => this.handleMcpRoots(signal),
      onSampling: (request, signal) => this.handleMcpSampling(request, signal),
    };
  }

  private async handleMcpRoots(signal: AbortSignal): Promise<MCPRootsList> {
    if (signal.aborted) {
      throw new DOMException("MCP roots request cancelled.", "AbortError");
    }
    const root = path.resolve(this.cwd);
    return {
      roots: [
        { uri: pathToFileURL(root).href, name: path.basename(root) || root },
      ],
    };
  }

  private async handleMcpElicitation(
    request: MCPServerInteractionRequest,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const params = request.params;
    const message = boundedInteractionText(
      params.message,
      "MCP server requested additional information.",
    );
    const serverLabel = request.serverName
      ? ` from "${request.serverName}"`
      : "";
    const mode = params.mode === "url" ? "url" : "form";
    if (!this.interaction.prompt) return { action: "cancel" };

    if (mode === "url") {
      const url = typeof params.url === "string" ? params.url : "";
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error("MCP URL elicitation contained an invalid URL.");
      }
      if (!/^https?:$/.test(parsed.protocol)) {
        throw new Error("MCP URL elicitation requires an HTTP(S) URL.");
      }
      const approved = await this.awaitMcpInteraction(
        this.interaction.askApproval(
          `MCP server${serverLabel} requests an external interaction. Review the full URL before opening it:\n${parsed.href}\n\n${message}`,
        ),
        signal,
      );
      return { action: approved ? "accept" : "decline" };
    }

    const schema = isRecord(params.requestedSchema)
      ? params.requestedSchema
      : undefined;
    const properties =
      schema && isRecord(schema.properties) ? schema.properties : {};
    const required = new Set(
      Array.isArray(schema?.required)
        ? schema.required.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
    );
    const content: Record<string, unknown> = {};
    for (const [key, rawDefinition] of Object.entries(properties).slice(
      0,
      25,
    )) {
      const definition = isRecord(rawDefinition) ? rawDefinition : {};
      if (
        /(password|passcode|token|secret|api[-_ ]?key|credential)/i.test(key)
      ) {
        return { action: "decline" };
      }
      const description = boundedInteractionText(definition.description, key);
      const options = enumOptions(definition);
      const answer =
        options.length > 0
          ? await this.awaitMcpInteraction(
              this.askSelect(
                `${message}\n${description}${required.has(key) ? " (required)" : " (optional)"}`,
                options.map((value) => ({ value, label: value })),
              ),
              signal,
            )
          : await this.awaitMcpInteraction(
              this.askText(
                `${message}\n${description}${required.has(key) ? " (required)" : " (optional)"}`,
                primitiveDefault(definition.default),
              ),
              signal,
            );
      if (answer === null) return { action: "cancel" };
      if (answer === "" && !required.has(key)) continue;
      if (answer === "" && required.has(key)) return { action: "cancel" };
      const converted = convertElicitationValue(answer, definition.type);
      if (converted === undefined) {
        if (required.has(key)) return { action: "decline" };
        continue;
      }
      content[key] = converted;
    }

    const approved = await this.awaitMcpInteraction(
      this.interaction.askApproval(
        `Submit the reviewed response to MCP server${serverLabel}?\n${JSON.stringify(content)}`,
      ),
      signal,
    );
    return approved ? { action: "accept", content } : { action: "decline" };
  }

  private async handleMcpSampling(
    request: MCPServerInteractionRequest,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const params = request.params;
    if (Array.isArray(params.tools) && params.tools.length > 0) {
      throw new Error(
        "MCP sampling with tools is not enabled for this host yet.",
      );
    }
    const messages = parseMcpSamplingMessages(params.messages);
    if (messages.length === 0) {
      throw new Error("MCP sampling requires at least one text message.");
    }
    const serverLabel = request.serverName
      ? ` from "${request.serverName}"`
      : "";
    const approved = await this.awaitMcpInteraction(
      this.interaction.askApproval(
        `Allow MCP server${serverLabel} to use the active model for a nested sampling request?\n${truncateInteractionText(messages.map((item) => item.content.map((block) => (block.type === "text" ? block.text : "[multimodal]")).join(" ")).join("\n"), 2_000)}`,
      ),
      signal,
    );
    if (!approved)
      throw new Error("MCP sampling request was denied by the user.");
    const model = this.options.modelOverride ?? this.config.models.default;
    const input: ModelChatInput = {
      model,
      messages,
      system:
        typeof params.systemPrompt === "string"
          ? params.systemPrompt.slice(0, 20_000)
          : undefined,
      maxTokens:
        typeof params.maxTokens === "number" &&
        Number.isFinite(params.maxTokens)
          ? Math.max(1, Math.min(Math.floor(params.maxTokens), 32_000))
          : undefined,
      stream: true,
      abortSignal: signal,
    };
    let text = "";
    let resolvedModel = model;
    for await (const event of this.provider.chat(input)) {
      if (signal.aborted) {
        throw new DOMException("MCP sampling request cancelled.", "AbortError");
      }
      if (event.type === "text_delta") text += event.text;
      else if (event.type === "response_metadata") {
        resolvedModel = event.resolvedModel ?? event.requestedModel;
      } else if (event.type === "tool_call") {
        throw new Error(
          "MCP sampling provider returned an unexpected tool call.",
        );
      } else if (event.type === "error") {
        throw event.error instanceof Error
          ? event.error
          : new Error(String(event.error));
      }
    }
    if (!text.trim())
      throw new Error("MCP sampling provider returned no text.");
    return {
      role: "assistant",
      content: { type: "text", text: truncateInteractionText(text, 64_000) },
      model: resolvedModel,
      stopReason: "endTurn",
    };
  }

  private async awaitMcpInteraction<T>(
    promise: Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    if (signal.aborted) {
      throw new DOMException("MCP interaction cancelled.", "AbortError");
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = () =>
        reject(new DOMException("MCP interaction cancelled.", "AbortError"));
      signal.addEventListener("abort", onAbort, { once: true });
      promise
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", onAbort));
    });
  }

  private getRunawayPromptInterval(): number {
    // Always finite so the guard actually fires under the default config;
    // a small cap would otherwise burn out before any prompt appears.
    return Math.max(6, Math.min(20, Math.floor(this.state.maxAttempts / 2)));
  }

  private getReusableApprovalScope(
    toolName: string,
    risk?: string,
  ): string | null {
    if (
      (toolName === "web_search" || toolName === "web_fetch") &&
      risk === "network"
    ) {
      return "network:web";
    }
    return null;
  }

  private appendBackgroundTaskNotification(
    tasks: BackgroundTaskSnapshot[],
    remainingRunning = 0,
  ): OrbitMessage {
    const message: OrbitMessage = {
      id: `msg_background_tasks_${randomUUID().replace(/-/g, "")}`,
      role: "user",
      createdAt: new Date().toISOString(),
      content: [
        {
          type: "text",
          text: [
            "### Background task runtime notification",
            "The following tasks changed state. Use get_background_task_output for bounded output when needed; do not poll with sleep commands.",
            ...tasks.map(
              (task) =>
                `- ${task.id}: ${task.status}; exit=${task.exitCode ?? "none"}; duration=${task.durationMs}ms${task.outputTruncated ? "; earlier output was truncated" : ""}`,
            ),
            remainingRunning > 0
              ? `${remainingRunning} background task(s) are still running. Do not claim the task is complete until their result is accounted for.`
              : "All observed background work has reached a terminal state. Account for its result before completing the task.",
          ].join("\n"),
        },
      ],
      metadata: { kind: "background_task_notification" },
    };
    this.state.history.push(message);
    this.sessionManager.saveHistory(this.state.history);
    return message;
  }

  /** Keep the agent alive until background work is observed or explicitly disabled. */
  private async reconcileBackgroundTasksBeforeCompletion(): Promise<boolean> {
    const initialNotifications = this.backgroundTasks.drainNotifications(
      this.state.sessionId,
    );
    const running = this.backgroundTasks
      .listTaskSummaries(this.state.sessionId)
      .filter((task) => task.status === "running");
    if (initialNotifications.length === 0 && running.length === 0) return false;

    let observed = initialNotifications;
    if (
      running.length > 0 &&
      this.config.tools.backgroundTasks.awaitOnCompletion
    ) {
      this.sessionManager.setRunState("running", "background_wait", {
        attempt: this.state.attemptCount,
      });
      this.interaction.showText(
        `● Waiting for ${running.length} background task(s) before finalizing...`,
      );
      const snapshots = await this.backgroundTasks.getTasks(
        this.state.sessionId,
        {
          taskIds: running.map((task) => task.id),
          waitMs: this.config.tools.backgroundTasks.completionWaitMs,
          waitFor: "any",
        },
        this.abortController?.signal,
      );
      if (this.abortController?.signal.aborted) {
        const error = new Error("Background task wait was interrupted.");
        error.name = "AbortError";
        throw error;
      }
      const completedDuringWait = this.backgroundTasks.drainNotifications(
        this.state.sessionId,
      );
      observed = [...observed, ...completedDuringWait];
      if (observed.length === 0) observed = snapshots;
    } else if (running.length > 0 && initialNotifications.length === 0) {
      return false;
    }

    const unique = new Map(observed.map((task) => [task.id, task]));
    const remainingRunning = this.backgroundTasks
      .listTaskSummaries(this.state.sessionId)
      .filter((task) => task.status === "running").length;
    this.appendBackgroundTaskNotification(
      [...unique.values()],
      remainingRunning,
    );
    return true;
  }

  public async run(): Promise<AgentLoopRunOutcome> {
    let outcome: AgentLoopRunOutcome;
    try {
      if (this.isImmediateAbortRequested()) {
        this.interruptMode = "prompt";
        outcome = this.createAbortedOutcome(
          "immediate",
          "Execution was aborted before it started.",
        );
      } else {
        try {
          outcome = await this.executeRun();
        } catch (error: unknown) {
          if (
            (error instanceof Error && error.name === "AbortError") ||
            this.isImmediateAbortRequested()
          ) {
            this.interruptMode = "prompt";
            outcome = this.createAbortedOutcome(
              "interrupted",
              "Execution was interrupted.",
            );
          } else {
            const code =
              error instanceof AgentLoopExecutionError
                ? error.code
                : "execution_error";
            outcome = this.createFailedOutcome(
              code,
              safeAgentLoopErrorMessage(error),
            );
          }
        }
      }
    } finally {
      await this.contextBuilder.settleBackgroundWork().catch(() => undefined);
    }

    if (this.options.agent?.role) {
      const subagentStopHooks = await this.runLifecycleHooks("subagentStop", {
        sessionId: this.state.sessionId,
        attempt: this.state.attemptCount,
        agentRole: this.options.agent.role,
        status: outcome.status,
      });
      if (!subagentStopHooks.ok && outcome.status === "completed") {
        outcome = this.createFailedOutcome(
          "execution_error",
          subagentStopHooks.output || "A blocking subagent-stop hook failed.",
        );
      }
    }
    const stopHooks = await this.runLifecycleHooks("stop", {
      sessionId: this.state.sessionId,
      attempt: this.state.attemptCount,
      status: outcome.status,
    });
    if (!stopHooks.ok && outcome.status === "completed") {
      outcome = this.createFailedOutcome(
        "execution_error",
        stopHooks.output || "A blocking stop hook failed.",
      );
    }

    this.finalizeOutcome(outcome);
    return outcome;
  }

  private async executeRun(): Promise<AgentLoopRunOutcome> {
    const runStartedAt = new Date();
    const isNewSession = this.state.history.length === 0;
    let iterationLimitReached = false;
    eventBus.emitEvent("agent_start", {
      taskId: this.state.sessionId,
      task: this.state.task,
    });
    this.cachedContextPack = null;
    this.cachedRepoMapTextForRun = null;
    this.activeModelForRun = null;
    this.fallbackModelForRun = null;
    this.fallbackExpiresAfterAttempt = 0;
    this.contextOverflowRetriesForRun = 0;
    this.outputLimitRetriesForRun = 0;
    this.providerRetriesForRun = 0;
    this.completionVerificationNudgedForRun = false;
    this.approvedToolScopes.clear();
    this.terminalFailure = null;
    this.finalResponseOnlyReason = this.pendingTerminalCompletionReason();
    this.verificationStatus = "not_run";
    this.workspaceMutationRevision = 0;
    this.verifiedMutationRevision = -1;
    this.sessionManager.setStatus("active");
    this.sessionManager.setRunState("running", "initializing", {
      attempt: this.state.attemptCount,
    });
    this.verificationManager.initialize();
    this.sessionManager.saveHistory(this.state.history);
    try {
      await this.provider.initialize?.();
    } catch (error: unknown) {
      const message = safeAgentLoopErrorMessage(error);
      this.sessionManager.logEvent("provider_initialization_failed", {
        provider: this.provider.id,
        message,
      });
      this.interaction.showText(
        picocolors.red(`✖ Provider initialization failed: ${message}`),
      );
      return this.createFailedOutcome("provider_error", message);
    }

    if (isNewSession) {
      const sessionHooks = await this.runLifecycleHooks("sessionStart", {
        sessionId: this.state.sessionId,
        attempt: this.state.attemptCount,
      });
      if (!sessionHooks.ok) {
        return this.createFailedOutcome(
          "execution_error",
          sessionHooks.output || "A blocking session-start hook failed.",
        );
      }
    }
    const promptHooks = await this.runLifecycleHooks("promptSubmit", {
      sessionId: this.state.sessionId,
      attempt: this.state.attemptCount,
      promptLength: this.state.task.length,
    });
    if (!promptHooks.ok) {
      return this.createFailedOutcome(
        "execution_error",
        promptHooks.output || "A blocking prompt hook failed.",
      );
    }
    if (this.options.agent?.role) {
      const subagentStartHooks = await this.runLifecycleHooks("subagentStart", {
        sessionId: this.state.sessionId,
        attempt: this.state.attemptCount,
        agentRole: this.options.agent.role,
      });
      if (!subagentStartHooks.ok) {
        return this.createFailedOutcome(
          "execution_error",
          subagentStartHooks.output || "A blocking subagent-start hook failed.",
        );
      }
    }

    // Prewarm through the workspace-owned retrieval lifecycle so indexing is
    // coalesced with prompt retrieval and drained when this run finishes.
    void this.contextBuilder.warmCodebaseRetrieval().catch(() => undefined);

    const mcpWasInitialized = Boolean(this.mcpStartResult);
    await this.initializeMcp();
    if (mcpWasInitialized) {
      await this.refreshMcpCatalogs();
    }

    const sigintListener = () => {
      if (this.abortController) {
        this.interaction.showText(
          "\n● Interrupt received. Aborting current execution...",
        );
        this.abortController.abort();
      }
    };
    process.on("SIGINT", sigintListener);

    const exitListener = () => {
      void this.mcpRuntimeManager.stop();
    };
    process.on("exit", exitListener);

    try {
      if (this.state.history.length === 0) {
        const initPack = await this.contextBuilder.build([]);
        this.interaction.showText(
          `● Workspace profiles: ${initPack.projectIndex.detectedLanguages.join(", ")} project detected.`,
        );
        this.state.history.push({
          id: `msg_user_init_${Date.now()}`,
          role: "user",
          createdAt: new Date().toISOString(),
          content: [{ type: "text", text: this.state.task }],
        });
        this.sessionManager.saveHistory(this.state.history);
      }

      while (
        !this.state.done &&
        this.state.attemptCount < this.state.maxAttempts
      ) {
        // Steering never mutates an in-flight provider request or tool call.
        // It is persisted immediately, then enters history only here at a
        // protocol-safe boundary before the next model request.
        this.applyPendingSteeringInputs();

        // Compact only near the model's real context limit. V4 supports 1M
        // tokens, so message-count thresholds would destroy useful cache
        // prefixes long before compaction is necessary.
        if (this.config.context.autoCompact && this.shouldCompactHistory()) {
          this.interaction.showText(
            "● Dialogue history is too long. Auto-compacting older history to save tokens...",
          );
          const result = await this.compactHistory("automatic");
          this.showAutomaticCompactionResult(result);
        }

        if (
          this.sessionCostKnown &&
          this.sessionCost > this.config.budgetLimit
        ) {
          this.interaction.showText(
            picocolors.red(
              `\n✖ Budget Exceeded: The session cost has reached $${this.sessionCost.toFixed(4)}, which exceeds the limit of $${this.config.budgetLimit.toFixed(2)}.`,
            ),
          );
          const confirm = await this.interaction.askApproval(
            `Session cost limit reached. Do you want to increase the budget limit by $10.00 and continue?`,
          );
          if (confirm) {
            this.config.budgetLimit += 10.0;
          } else {
            this.terminalFailure = {
              code: "budget_exceeded",
              message: `Session cost exceeded the configured budget limit of $${this.config.budgetLimit.toFixed(2)}.`,
            };
            this.state.done = true;
            break;
          }
        }

        this.state.attemptCount++;
        // Degraded-lane recovery: after the cooldown, drop the fallback so
        // routing can return to the quality lane instead of finishing the
        // whole run on the fast model.
        if (
          this.fallbackModelForRun &&
          this.state.attemptCount > this.fallbackExpiresAfterAttempt
        ) {
          this.fallbackModelForRun = null;
          this.activeModelForRun = null;
          this.interaction.showText(
            picocolors.gray(
              "● Provider pressure window passed; returning to the primary model lane.",
            ),
          );
        }
        this.sessionManager.setRunState("running", "model_request", {
          attempt: this.state.attemptCount,
        });
        eventBus.emitEvent("loop_start", {
          attempt: this.state.attemptCount,
        });

        // Runaway Iteration Guard
        if (
          this.state.attemptCount > 1 &&
          Number.isFinite(this.getRunawayPromptInterval()) &&
          (this.state.attemptCount - 1) % this.getRunawayPromptInterval() === 0
        ) {
          const completedIterations = this.state.attemptCount - 1;
          const fullAccess = isFullAccessEnabled(this.config);
          const autoContinue =
            fullAccess || this.options.autoContinueRunaway === true;
          const continueExec = autoContinue
            ? true
            : await this.interaction.askApproval(
                `Agent loop has run for ${completedIterations} iterations. Continue executing to prevent runaway costs?`,
              );
          if (autoContinue) {
            this.sessionManager.logEvent("runaway_checkpoint", {
              completedIterations,
              continuedAutomatically: true,
              reason: fullAccess ? "full_access" : "bounded_automation",
            });
          }
          if (this.options.autoContinueRunaway && !fullAccess) {
            this.interaction.showText(
              picocolors.gray(
                `● Automated evaluation checkpoint: continuing after ${completedIterations} iterations within configured limits.`,
              ),
            );
          }
          if (!continueExec) {
            this.interaction.showText(
              "● Terminated by user to prevent runaway iterations.",
            );
            return this.createAbortedOutcome(
              "interrupted",
              "Execution was stopped by the user at the runaway-iteration guard.",
            );
          }
        }

        // Repository Tree builder (Hierarchical Summary via PageRank Repo Map)
        let repoMapText = "";
        if (this.cachedRepoMapTextForRun !== null) {
          repoMapText = this.cachedRepoMapTextForRun;
        } else {
          try {
            const indexer = new SymbolIndexer(this.cwd);
            const indexPath = indexer.indexPath;
            if (fs.existsSync(indexPath)) {
              const stat = fs.statSync(indexPath);
              if (
                stat.mtimeMs === this.lastSymbolsMtime &&
                this.cachedRepoMapText
              ) {
                repoMapText = this.cachedRepoMapText;
              } else {
                const landmarkMap = await indexer.getRepoMapText(2048);
                if (landmarkMap) {
                  repoMapText = `\n\n${landmarkMap}\n\nNote: To find where a symbol (class, function, etc.) is declared or referenced, use the "search_symbols" and "find_symbol_references" tools dynamically.`;
                  this.cachedRepoMapText = repoMapText;
                  this.lastSymbolsMtime = stat.mtimeMs;
                }
              }
            }
          } catch {
            // Ignore
          }
          this.cachedRepoMapTextForRun = repoMapText;
        }

        // 1. Dynamic routing selection
        // Explore vs. Write/Repair phase detection
        let nextModel =
          this.options?.modelOverride || this.config.models.default;

        // Verification repair turns require the quality lane (V4 Pro by default).
        const isRepairTurn =
          this.state.history.length > 0 &&
          this.state.history[this.state.history.length - 1].role === "user" &&
          this.state.history[this.state.history.length - 1].content.some(
            (b) =>
              b.type === "text" && b.text.includes("[Verification Failed]"),
          );

        // Route from the current user turn only. Older complex requests must not
        // permanently force later simple turns onto the slower thinking lane.
        const currentUserMessage = [...this.state.history]
          .reverse()
          .find(
            (message) =>
              message.role === "user" &&
              message.metadata?.kind !== VOLATILE_CONTEXT_MESSAGE_KIND &&
              message.metadata?.kind !== "history_compaction_summary",
          );
        const userQueryText = (
          currentUserMessage?.content
            .filter((block) => block.type === "text")
            .map((block) => (block.type === "text" ? block.text : ""))
            .join("\n") || this.state.task
        ).toLowerCase();

        // Check if the user request has tool execution or is complex
        const currentTurnStartIndex = currentUserMessage
          ? this.state.history.lastIndexOf(currentUserMessage)
          : 0;
        const writeCalls = this.state.history
          .slice(Math.max(0, currentTurnStartIndex))
          .flatMap((message) =>
            message.role === "assistant"
              ? message.content.filter(
                  (block) =>
                    block.type === "tool_call" &&
                    (block.toolCall.name === "write_file" ||
                      block.toolCall.name === "edit_file"),
                )
              : [],
          );
        const hasWrittenFiles = writeCalls.length > 0;
        const affectedFileCount = new Set(
          writeCalls
            .map((block) => {
              if (block.type !== "tool_call") return "";
              try {
                const pathValue = toUnknownRecord(
                  JSON.parse(block.toolCall.arguments),
                ).path;
                return typeof pathValue === "string" ? pathValue : "";
              } catch {
                return "";
              }
            })
            .filter(Boolean),
        ).size;

        const routingDecision = routeModel({
          query: userQueryText,
          defaultModel: this.config.models.default,
          fastModel: this.config.models.fast,
          qualityModel: this.config.models.coder || this.config.models.default,
          lockedModel: this.options?.modelOverride,
          fallbackModel: this.fallbackModelForRun || undefined,
          activeModel: this.activeModelForRun || undefined,
          repairTurn: isRepairTurn,
          hasWrittenFiles,
          affectedFileCount,
        });
        const isComplexTask =
          classifyTaskComplexity({
            query: userQueryText,
            repairTurn: isRepairTurn,
            hasWrittenFiles,
            affectedFileCount,
          }) === "complex";
        nextModel = routingDecision.model;
        if (!this.options?.modelOverride && !this.fallbackModelForRun) {
          this.activeModelForRun = nextModel;
        }
        eventBus.emitEvent("model_routing", routingDecision);
        this.sessionManager.logEvent("model_routing", routingDecision);

        const activeModel = nextModel;
        if (!this.cachedContextPack) {
          // Find the initiating user message of the current turn (the last user message in history)
          let latestUserQuery = this.state.task;
          for (let i = this.state.history.length - 1; i >= 0; i--) {
            const message = this.state.history[i];
            if (
              message.role === "user" &&
              message.metadata?.kind !== VOLATILE_CONTEXT_MESSAGE_KIND &&
              message.metadata?.kind !== "history_compaction_summary"
            ) {
              const text = message.content
                .filter((b) => b.type === "text")
                .map((b) => b.text)
                .join("\n");
              if (text.trim()) {
                latestUserQuery = text;
                break;
              }
            }
          }

          this.cachedContextPack = await this.contextBuilder.build(
            this.state.relevantFiles,
            latestUserQuery,
            {
              maxTokens: Math.min(
                128_000,
                Math.max(
                  512,
                  Math.floor(
                    this.getContextWindowStatus(activeModel).compactAtTokens *
                      0.4,
                  ),
                ),
              ),
              forcedSkills: this.options?.forcedSkills,
            },
          );
          this.reportSkillContext(this.cachedContextPack);
        }
        let toolDefs = this.toolRegistry.getDefinitions();
        if (!this.config.tools.webSearch.enabled) {
          toolDefs = toolDefs.filter(
            (tool) => tool.name !== "web_search" && tool.name !== "web_fetch",
          );
        }
        if (!this.config.tools.bash.enabled) {
          toolDefs = toolDefs.filter(
            (tool) =>
              ![
                "bash",
                "run_tests",
                "get_background_task_output",
                "kill_background_task",
                "list_background_tasks",
              ].includes(tool.name),
          );
        }
        if (this.options?.allowedTools) {
          toolDefs = toolDefs.filter((t) =>
            this.options!.allowedTools!.includes(t.name),
          );
        }
        if (this.options?.disallowedTools) {
          const deniedTools = new Set(this.options.disallowedTools);
          toolDefs = toolDefs.filter((tool) => !deniedTools.has(tool.name));
        }
        if (this.finalResponseOnlyReason) {
          toolDefs = [];
        }
        toolDefs.sort((a, b) => a.name.localeCompare(b.name));

        const capabilities = resolveModelCapabilities(
          this.provider,
          activeModel,
        );

        // DeepSeek cache-aware layering:
        // Stable system: core rules + canonical tool prompt + project profile.
        // Turn context (RAG, repo map, file excerpts) is persisted immediately
        // before the current user request so older conversation prefixes remain
        // byte-stable across future turns.
        const projectMemory =
          this.options?.memoryMode === "none"
            ? undefined
            : this.projectMemoryStore.read();
        const taskPlan = this.sessionManager.getTaskPlan();
        const baseSystemPrompt =
          this.options?.systemPromptOverride ||
          Planner.makeSystemPrompt(
            activeModel,
            this.config.language,
            this.provider.id,
            undefined,
            undefined,
            undefined,
            capabilities.thinking,
          );
        const toolsPrompt = capabilities.toolCalls
          ? generateNativeToolsPrompt(toolDefs)
          : generateXMLToolsPrompt(toolDefs);
        const contextPack = this.cachedContextPack;
        const cacheSlab = PromptCacheSlabBuilder.build({
          cwd: this.cwd,
          provider: this.provider.id,
          model: activeModel,
          baseSystemPrompt,
          toolsPrompt,
          tools: toolDefs,
          repoMapText,
          contextPack,
        });
        let builtMessages = MessageBuilder.build(
          cacheSlab.text,
          this.state,
          contextPack,
          {
            now: runStartedAt,
            repoMapText,
            sessionGoal: this.sessionManager.getActiveSession()?.goal,
            projectMemory: projectMemory?.enabled
              ? projectMemory.entries.map((entry) => entry.text)
              : [],
            taskPlan: taskPlan?.items.map(
              (item) => `[${item.status}] ${item.text}`,
            ),
          },
        );
        const system = builtMessages.system;
        if (builtMessages.contextMessageAdded) {
          this.state.history = builtMessages.messages;
          this.sessionManager.saveHistory(this.state.history);
        }
        if (this.config.context.autoCompact) {
          const requestCompaction = await this.compactOversizedRequest(
            activeModel,
            builtMessages.system,
            builtMessages.messages,
          );
          if (requestCompaction?.changed) {
            this.showAutomaticCompactionResult(requestCompaction);
            builtMessages = MessageBuilder.build(
              cacheSlab.text,
              this.state,
              contextPack,
              {
                now: runStartedAt,
                repoMapText,
                sessionGoal: this.sessionManager.getActiveSession()?.goal,
                projectMemory: projectMemory?.enabled
                  ? projectMemory.entries.map((entry) => entry.text)
                  : [],
                taskPlan: taskPlan?.items.map(
                  (item) => `[${item.status}] ${item.text}`,
                ),
              },
            );
            this.state.history = builtMessages.messages;
            this.sessionManager.saveHistory(this.state.history);
          }
        }
        // Keep the provider request array immutable while history grows with the
        // assistant response and tool results.
        const messages = [...builtMessages.messages];
        const taskNotifications = this.backgroundTasks.drainNotifications(
          this.state.sessionId,
        );
        if (taskNotifications.length > 0) {
          messages.push(
            this.appendBackgroundTaskNotification(taskNotifications),
          );
        }
        const supportsThinking = capabilities.thinking;
        const thinkingPolicy = resolveModelThinkingPolicy(activeModel, {
          isComplexTask,
          isRepairTurn,
          requestedEffort: this.options?.thinkingEffort,
        });
        const thinkingEnabled = supportsThinking
          ? (thinkingPolicy?.enabled ?? Boolean(isRepairTurn || isComplexTask))
          : false;

        if (!this.resolvePricing(activeModel)) {
          this.noteUnknownPricing(activeModel);
        }
        this.interaction.progress?.start(
          `Calling ${activeModel}... | Cost: ${this.formatSessionCost()}`,
        );

        this.abortController = new AbortController();
        if (this.interruptMode === "abort") {
          this.abortController.abort();
        }

        // 2. Dynamic thinking budget configuration based on complexity
        let thinkingBudget = thinkingPolicy?.budgetTokens ?? 1024;
        if (!thinkingPolicy && isRepairTurn) {
          thinkingBudget = 8192; // Max thinking budget for repair
        } else if (!thinkingPolicy && isComplexTask) {
          thinkingBudget = 4096; // Standard high thinking budget
        }

        eventBus.emitEvent("model_request", {
          model: activeModel,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        });

        const stream = this.provider.chat({
          model: activeModel,
          messages,
          system,
          tools: toolDefs,
          stream: true,
          maxTokens:
            this.getContextWindowStatus(activeModel).reservedOutputTokens,
          userId: this.userId,
          abortSignal: this.abortController.signal,
          // The Agent owns the retry budget and fallback policy. Prevent a
          // provider transport from nesting its own retries inside the loop.
          retryBudget: 0,
          thinking: supportsThinking
            ? {
                enabled: thinkingEnabled,
                budgetTokens: thinkingBudget,
                ...(thinkingPolicy ? { effort: thinkingPolicy.effort } : {}),
              }
            : undefined,
        });

        let responseText = "";
        let thinkingText = "";
        let thinkingSignature = "";
        let finalUsage: TokenUsage | undefined;
        let resolvedModel: string | undefined;
        let providerRequestId: string | undefined;
        let apiFormat: ModelApiFormat | undefined;
        let modelVersion: string | undefined;
        let apiFormatFallback:
          | { from: ModelApiFormat; status: number }
          | undefined;
        const toolCallsToExecute: OrbitToolCall[] = [];
        const toolCallProtocolErrors = new Map<string, string>();

        try {
          for await (const event of stream) {
            this.interaction.progress?.stop();
            if (event.type === "response_metadata") {
              resolvedModel = event.resolvedModel;
              providerRequestId = event.providerRequestId;
              apiFormat = event.apiFormat;
              modelVersion = event.modelVersion;
              apiFormatFallback = event.apiFormatFallback;
              this.sessionManager.logEvent("provider_response_identity", {
                provider: this.provider.id,
                requestedModel: event.requestedModel,
                resolvedModel: event.resolvedModel || null,
                providerRequestId: event.providerRequestId || null,
                apiFormat: event.apiFormat || null,
                modelVersion: event.modelVersion || null,
                apiFormatFallback: event.apiFormatFallback || null,
              });
            } else if (event.type === "text_delta") {
              responseText += event.text;
              eventBus.emitEvent("model_delta", { text: event.text });
            } else if (event.type === "thinking_delta") {
              if (event.text) {
                thinkingText += event.text;
                eventBus.emitEvent("thinking_delta", { text: event.text });
              }
              if (event.signature) {
                thinkingSignature += event.signature;
              }
            } else if (event.type === "usage") {
              this.accumulateCost(activeModel, event.usage);
              finalUsage = event.usage;
              if (capabilities.promptCaching) {
                this.emitCacheTelemetry(cacheSlab, event.usage);
              }
            } else if (event.type === "tool_call") {
              toolCallsToExecute.push(event.toolCall);
            } else if (event.type === "error") {
              throw event.error;
            }
          }
        } catch (chatError: unknown) {
          const chatErrorName =
            chatError instanceof Error ? chatError.name : "Error";
          const chatErrorMessage =
            chatError instanceof Error ? chatError.message : String(chatError);
          if (chatErrorName === "AbortError") {
            if (!this.abortController?.signal.aborted) {
              this.persistAbortedAssistantMessage(
                activeModel,
                responseText,
                thinkingText,
                thinkingSignature,
              );
              return this.createAbortedOutcome(
                "interrupted",
                "The model request was aborted.",
              );
            }
            // User-initiated aborts are handled below so prompt-mode
            // interruptions can still be resumed.
          } else if (this.abortController?.signal.aborted) {
            // User-initiated abort, handled below.
          } else {
            const providerFailure = isProviderError(chatError)
              ? chatError
              : undefined;
            const requestHasPartialOutput =
              Boolean(responseText || thinkingText) ||
              toolCallsToExecute.length > 0;
            if (
              providerFailure?.retryable &&
              !providerFailure.partialOutput &&
              !requestHasPartialOutput &&
              this.providerRetriesForRun < 2
            ) {
              this.providerRetriesForRun++;
              const retryDelayMs = Math.min(
                10_000,
                providerFailure.retryAfterMs ??
                  250 * 2 ** this.providerRetriesForRun +
                    Math.floor(Math.random() * 250),
              );
              this.sessionManager.logEvent("provider_retry_scheduled", {
                providerId: this.provider.id,
                model: activeModel,
                code: providerFailure.code,
                status: providerFailure.status,
                requestId: providerFailure.requestId,
                attempt: this.providerRetriesForRun,
                delayMs: retryDelayMs,
              });
              this.interaction.showText(
                picocolors.yellow(
                  `⚠ ${activeModel} request failed transiently; retrying in ${Math.ceil(retryDelayMs / 1000)}s (${this.providerRetriesForRun}/2).`,
                ),
              );
              await waitForAgentRetry(
                retryDelayMs,
                this.abortController?.signal,
              );
              continue;
            }
            const outputLimitReached = isOutputTokenLimitError(chatError);
            if (outputLimitReached && this.outputLimitRetriesForRun < 2) {
              this.outputLimitRetriesForRun++;
              this.state.history.push({
                id: `msg_output_limit_recovery_${Date.now()}`,
                role: "user",
                createdAt: new Date().toISOString(),
                content: [
                  {
                    type: "text",
                    text: [
                      "Orbit recovery instruction: the previous response exceeded the model's output-token allowance before its actions could be completed.",
                      "Continue the same task without repeating discovery. Emit at most four tool calls in this response, keep each write bounded, and split remaining work across later turns.",
                      "Do not stop at an outline; execute the next concrete batch now.",
                    ].join(" "),
                  },
                ],
                metadata: { kind: "output_limit_recovery" },
              });
              this.sessionManager.saveHistory(this.state.history);
              this.interaction.showText(
                picocolors.yellow(
                  `⚠ ${activeModel} exceeded its output limit; retrying with a bounded action batch (${this.outputLimitRetriesForRun}/2).`,
                ),
              );
              continue;
            }
            const contextWindowRejected =
              this.config.context.autoCompact &&
              this.contextOverflowRetriesForRun < 2 &&
              isContextWindowError(chatError);
            if (contextWindowRejected) {
              this.contextOverflowRetriesForRun++;
              const retryStatus = this.getContextWindowStatus(activeModel);
              const adaptiveRatio =
                this.contextOverflowRetriesForRun === 1 ? 0.6 : 0.4;
              const compacted = await this.compactHistory(
                "automatic",
                Math.max(
                  256,
                  Math.floor(
                    Math.min(
                      retryStatus.compactAtTokens * 0.5,
                      retryStatus.estimatedHistoryTokens * adaptiveRatio,
                    ),
                  ),
                ),
              );
              if (compacted.changed) {
                this.interaction.showText(
                  picocolors.yellow(
                    `⚠ ${activeModel} rejected the context length; Orbit compacted it and is retrying (${this.contextOverflowRetriesForRun}/2).`,
                  ),
                );
                this.showAutomaticCompactionResult(compacted);
                continue;
              }
            }
            const canFallbackToFlash =
              !this.fallbackModelForRun &&
              activeModel !== this.config.models.fast &&
              Boolean(this.config.models.fast) &&
              !requestHasPartialOutput &&
              (providerFailure
                ? [
                    "RATE_LIMIT",
                    "SERVER",
                    "OVERLOADED",
                    "TIMEOUT",
                    "TRANSPORT",
                    "STREAM_CLOSED",
                  ].includes(providerFailure.code)
                : /(?:insufficient_system_resource|resources were insufficient|overloaded|temporarily unavailable|HTTP 429|HTTP 500|HTTP 503|timed out)/i.test(
                    chatErrorMessage,
                  ));
            if (canFallbackToFlash) {
              this.fallbackModelForRun = this.config.models.fast;
              // Degradation is temporary: hold the fast lane for two more
              // attempts, then let routing try the quality lane again.
              this.fallbackExpiresAfterAttempt = this.state.attemptCount + 2;
              this.activeModelForRun = this.config.models.fast;
              this.interaction.showText(
                picocolors.yellow(
                  `⚠ ${activeModel} is temporarily unavailable; retrying this turn with ${this.config.models.fast}.`,
                ),
              );
              continue;
            }
            const safeMessage = safeAgentLoopErrorMessage(chatError);
            this.interaction.showText(
              `[Error] LLM Call failed: ${safeMessage}`,
            );
            throw new AgentLoopExecutionError("provider_error", safeMessage);
          }
        } finally {
          this.interaction.progress?.stop();
        }

        // Recovery limits are consecutive-request guards. A successful stream
        // proves the smaller request/response shape worked and rearms them for
        // a later, independently recoverable turn.
        this.contextOverflowRetriesForRun = 0;
        this.outputLimitRetriesForRun = 0;
        this.providerRetriesForRun = 0;

        // Plain assistant text never acquires execution semantics when the
        // selected model supports native tools. Text recovery is retained only
        // for explicitly tool-incapable local/legacy transports.
        if (
          toolCallsToExecute.length === 0 &&
          responseText &&
          !capabilities.toolCalls &&
          !this.finalResponseOnlyReason
        ) {
          const xmlToolCalls = parseXMLToolCalls(responseText);
          const textToolCalls =
            xmlToolCalls.length > 0
              ? []
              : parseTextToolCalls(
                  responseText,
                  (name) => this.toolRegistry.get(name) !== undefined,
                );
          if (xmlToolCalls.length > 0) {
            toolCallsToExecute.push(...xmlToolCalls);
          } else if (textToolCalls.length > 0) {
            toolCallsToExecute.push(...textToolCalls);
            this.sessionManager.logEvent("text_tool_call_recovered", {
              count: textToolCalls.length,
              tools: textToolCalls.map((toolCall) => toolCall.name),
            });
          } else {
            const srBlocks = parseSearchReplaceBlocks(responseText);
            let idCounter = 1;
            for (const block of srBlocks) {
              toolCallsToExecute.push({
                id: `sr_call_${idCounter++}_${Date.now()}`,
                name: "edit_file",
                arguments: JSON.stringify({
                  path: block.filePath,
                  oldText: block.oldText,
                  newText: block.newText,
                }),
              });
            }
          }
        }

        if (toolCallsToExecute.length > 1) {
          const seenToolCallIds = new Set<string>();
          const uniqueToolCalls: OrbitToolCall[] = [];
          for (const toolCall of toolCallsToExecute) {
            if (seenToolCallIds.has(toolCall.id)) {
              const message = `Ignored duplicate tool call id "${toolCall.id}" from the model response.`;
              this.interaction.showText(picocolors.yellow(`⚠ ${message}`));
              this.sessionManager.logEvent("duplicate_tool_call_ignored", {
                toolCallId: toolCall.id,
                toolName: toolCall.name,
              });
              continue;
            }
            seenToolCallIds.add(toolCall.id);
            uniqueToolCalls.push(toolCall);
          }
          toolCallsToExecute.splice(
            0,
            toolCallsToExecute.length,
            ...uniqueToolCalls,
          );
        }

        for (const toolCall of toolCallsToExecute) {
          try {
            JSON.parse(toolCall.arguments);
          } catch (error: unknown) {
            toolCallProtocolErrors.set(
              toolCall.id,
              `Tool input JSON parse failed: ${safeAgentLoopErrorMessage(error)}`,
            );
            // Keep persisted/provider history protocol-valid. The original
            // parse failure is returned as this call's tool result below.
            toolCall.arguments = "{}";
          }
        }

        eventBus.emitEvent("model_response", {
          model: activeModel,
          requestedModel: activeModel,
          resolvedModel,
          providerRequestId,
          apiFormat,
          modelVersion,
          apiFormatFallback,
          text: responseText || undefined,
          reasoning_content: thinkingText || undefined,
          usage: finalUsage
            ? {
                inputTokens: finalUsage.inputTokens,
                outputTokens: finalUsage.outputTokens,
                totalTokens: finalUsage.totalTokens,
                cacheReadTokens: finalUsage.cacheReadTokens,
                cacheMissTokens: finalUsage.cacheMissTokens,
                cacheWriteTokens: finalUsage.cacheWriteTokens,
                reasoningTokens: finalUsage.reasoningTokens,
              }
            : undefined,
          toolCalls:
            toolCallsToExecute.length > 0 ? toolCallsToExecute : undefined,
        });

        if (this.abortController?.signal.aborted) {
          const action = await this.handleInterrupt();
          if (action === "continue") {
            this.interaction.showText("● Resuming execution...");
            this.abortController = null;
            continue;
          } else if (action === "rollback_exit") {
            this.persistAbortedAssistantMessage(
              activeModel,
              responseText,
              thinkingText,
              thinkingSignature,
            );
            await this.rollbackLastCheckpoint();
            this.state.done = true;
            return this.createAbortedOutcome(
              "rollback",
              "Execution was interrupted and the last checkpoint was rolled back.",
            );
          } else {
            this.persistAbortedAssistantMessage(
              activeModel,
              responseText,
              thinkingText,
              thinkingSignature,
            );
            this.interaction.showText("● Aborted. Returning to REPL prompt.");
            this.state.done = true;
            return this.createAbortedOutcome(
              "interrupted",
              "Execution was interrupted by the user.",
            );
          }
        }

        const assistantBlocks: OrbitContentBlock[] = [];
        if (thinkingText) {
          assistantBlocks.push({
            type: "thinking",
            text: thinkingText,
            ...(thinkingSignature ? { signature: thinkingSignature } : {}),
          });
        }
        if (responseText) {
          assistantBlocks.push({ type: "text", text: responseText });
        }
        for (const tc of toolCallsToExecute) {
          assistantBlocks.push({ type: "tool_call", toolCall: tc });
        }

        const assistantMsg: OrbitMessage = {
          id: `msg_asst_${Date.now()}`,
          role: "assistant",
          createdAt: new Date().toISOString(),
          content: assistantBlocks,
          metadata: {
            model: activeModel,
            requestedModel: activeModel,
            resolvedModel: resolvedModel || activeModel,
            ...(providerRequestId ? { providerRequestId } : {}),
            ...(apiFormat ? { apiFormat } : {}),
            ...(modelVersion ? { modelVersion } : {}),
            ...(apiFormatFallback ? { apiFormatFallback } : {}),
          },
        };
        this.state.history.push(assistantMsg);
        this.sessionManager.saveHistory(this.state.history);

        if (responseText) {
          if (toolCallsToExecute.length > 0) {
            this.interaction.showText(
              this.interaction.formatThought?.(responseText) || responseText,
            );
          } else {
            this.interaction.showText(
              `\nOrbit: ${this.interaction.formatMarkdown?.(responseText) || responseText}`,
            );
          }
        }

        if (toolCallsToExecute.length === 0) {
          const steeringApplied = this.applyPendingSteeringInputs();
          const backgroundReconciled =
            await this.reconcileBackgroundTasksBeforeCompletion();
          if (steeringApplied || backgroundReconciled) continue;
        }

        if (toolCallsToExecute.length === 0) {
          const hasEdits =
            this.workspaceMutationRevision > 0 ||
            hasSuccessfulWorkspaceFileMutations(this.state.history, this.cwd);

          if (hasEdits) {
            if (this.verificationManager.hasContract()) {
              this.sessionManager.setRunState("verifying", "verification", {
                attempt: this.state.attemptCount,
              });
              this.interaction.showText(
                "\n● Verification: Running contract verification checks...",
              );
              const verificationStartHooks = await this.runLifecycleHooks(
                "verificationStart",
                {
                  sessionId: this.state.sessionId,
                  attempt: this.state.attemptCount,
                  status: "contract",
                },
              );
              if (!verificationStartHooks.ok) {
                return this.createFailedOutcome(
                  "verification_failed",
                  verificationStartHooks.output ||
                    "A blocking verification-start hook failed.",
                );
              }
              const verificationWorkspaceBefore =
                await captureWorkspaceMutationSnapshot(this.cwd);
              const verifyResult =
                await this.verificationManager.runVerification();
              const verificationWorkspaceAfter =
                await captureWorkspaceMutationSnapshot(this.cwd);
              const verificationDelta = compareWorkspaceMutationSnapshots(
                verificationWorkspaceBefore,
                verificationWorkspaceAfter,
              );
              if (verificationDelta) {
                this.registerWorkspaceMutation(
                  verificationDelta.paths,
                  "verification contract",
                  verificationDelta,
                );
              }
              this.recordVerificationResult(verifyResult.success);
              const verificationEndHooks = await this.runLifecycleHooks(
                "verificationEnd",
                {
                  sessionId: this.state.sessionId,
                  attempt: this.state.attemptCount,
                  status: verifyResult.success ? "passed" : "failed",
                  verificationPassed: verifyResult.success,
                },
              );
              if (!verificationEndHooks.ok) {
                return this.createFailedOutcome(
                  "verification_failed",
                  verificationEndHooks.output ||
                    "A blocking verification-end hook failed.",
                );
              }
              if (!verifyResult.success) {
                const maxRepairAttempts =
                  this.verificationManager.getMaxRepairAttempts();
                const repairAttempts = countRepairAttemptsForCurrentTask(
                  this.state.history,
                );

                if (
                  repairAttempts >= maxRepairAttempts ||
                  !this.config.context.autoRepair
                ) {
                  this.interaction.showText(
                    picocolors.red(
                      `\n✖ Verification Failed: Workspace violates contract. Rolling back all changes for safety...`,
                    ),
                  );
                  await this.rollbackLastCheckpoint();
                  this.terminalFailure = {
                    code: "verification_failed",
                    message: safeAgentLoopErrorMessage(
                      verifyResult.error ||
                        "The workspace failed its verification contract.",
                    ),
                  };
                  this.state.done = true;
                  break;
                }

                this.interaction.showText(
                  picocolors.red(
                    `✖ Verification failed! Entering auto-repair loop (Attempt ${repairAttempts + 1}/${maxRepairAttempts})...`,
                  ),
                );

                const feedbackPrompt = `[Verification Failed] The changes made failed the verification contract. Details:\n\n${verifyResult.error}\n\nPlease analyze this failure, fix the codebase, and ensure it passes the verification contract.`;

                const systemMsg: OrbitMessage = {
                  id: `msg_validation_err_${Date.now()}`,
                  role: "user",
                  createdAt: new Date().toISOString(),
                  content: [{ type: "text", text: feedbackPrompt }],
                };
                this.state.history.push(systemMsg);
                this.sessionManager.saveHistory(this.state.history);
                continue;
              } else {
                this.interaction.showText(
                  picocolors.green(
                    `✔ Verification contract passed successfully.`,
                  ),
                );
              }
            } else if (this.config.context.autoRepair) {
              const testTool = this.toolRegistry.get("run_tests");
              if (testTool) {
                this.interaction.showText(
                  "\n● Auto-Repair: Running project tests to verify changes...",
                );
                const preferredCommand = this.config.context.testCommands?.[0];
                const verificationWorkspaceBefore =
                  await captureWorkspaceMutationSnapshot(this.cwd);
                const result = await testTool.execute(
                  { command: preferredCommand },
                  {
                    cwd: this.cwd,
                    sessionId: this.state.sessionId,
                    config: this.config,
                    abortSignal: this.abortController?.signal,
                    services: this.toolRuntimeServices,
                  },
                );
                const verificationWorkspaceAfter =
                  await captureWorkspaceMutationSnapshot(this.cwd);
                const verificationDelta = compareWorkspaceMutationSnapshots(
                  verificationWorkspaceBefore,
                  verificationWorkspaceAfter,
                );
                if (verificationDelta) {
                  this.registerWorkspaceMutation(
                    verificationDelta.paths,
                    "automatic verification",
                    verificationDelta,
                  );
                }
                const verificationPassed =
                  result.ok && result.metadata?.verificationEvidence === true;
                this.recordVerificationResult(verificationPassed);

                if (!verificationPassed) {
                  const maxRepairAttempts =
                    this.config.context.maxRepairAttempts;
                  const repairAttempts = countRepairAttemptsForCurrentTask(
                    this.state.history,
                  );

                  if (repairAttempts >= maxRepairAttempts) {
                    this.interaction.showText(
                      picocolors.red(
                        `\n✖ Auto-Repair: Max attempts (${maxRepairAttempts}) reached. Codebase is unstable. Rolling back all changes for safety...`,
                      ),
                    );
                    await this.rollbackLastCheckpoint();
                    this.terminalFailure = {
                      code: "verification_failed",
                      message: safeAgentLoopErrorMessage(
                        result.error ||
                          result.display ||
                          "Project tests failed after automatic repair attempts.",
                      ),
                    };
                    this.state.done = true;
                    break;
                  }

                  this.interaction.showText(
                    picocolors.red(
                      `✖ Tests failed! Entering auto-repair loop (Attempt ${repairAttempts + 1}/${maxRepairAttempts})...`,
                    ),
                  );
                  const rawLog =
                    result.error ||
                    (result.ok
                      ? "The configured command succeeded but is not a recognized standalone verification command."
                      : result.display) ||
                    "";
                  let errLog = cleanAndTruncateTestLog(rawLog);

                  // 3. Pre-Analysis Error Distillation via V4-Flash
                  if (this.config.models.fast) {
                    this.interaction.showText(
                      `● Auto-Repair: Compressing test failure logs using ${this.config.models.fast}...`,
                    );
                    try {
                      const fastModel = this.config.models.fast;
                      const distillationPrompt = `Extract and summarize the core compile error or assertion failure from the following test logs. Keep the output extremely dense and precise. Specify only:
1. The exact file path and line number of the failure.
2. The failing test description.
3. The assert details (e.g. Expected X, Got Y).
Do not include any other markdown formatting or conversational text. Output ONLY the summary:

${errLog}`;
                      const distStream = this.provider.chat({
                        model: fastModel,
                        messages: [
                          {
                            id: `msg_distill_${Date.now()}`,
                            role: "user",
                            createdAt: new Date().toISOString(),
                            content: [
                              { type: "text", text: distillationPrompt },
                            ],
                          },
                        ],
                        tools: [],
                      });
                      let distilledLog = "";
                      for await (const event of distStream) {
                        if (event.type === "text_delta") {
                          distilledLog += event.text;
                        }
                      }
                      if (distilledLog.trim()) {
                        errLog = distilledLog.trim();
                        this.interaction.showText(
                          picocolors.gray(`● Compressed logs:\n${errLog}`),
                        );
                      }
                    } catch {
                      // Fallback to normal cleaned log on distillation failure
                    }
                  }

                  const feedbackPrompt = `[Verification Failed] The changes made caused test failures. Test command: "${preferredCommand || "auto-detected runner"}". Output:\n\n${errLog}\n\nPlease analyze this failure log, locate the files causing assertion or compile errors, and fix the codebase so that the tests pass successfully.`;

                  const systemMsg: OrbitMessage = {
                    id: `msg_validation_err_${Date.now()}`,
                    role: "user",
                    createdAt: new Date().toISOString(),
                    content: [{ type: "text", text: feedbackPrompt }],
                  };
                  this.state.history.push(systemMsg);
                  this.sessionManager.saveHistory(this.state.history);
                  continue;
                } else {
                  this.interaction.showText(
                    picocolors.green(
                      `✔ All tests passed successfully! Verification green.`,
                    ),
                  );
                }
              }
            }
          }

          if (
            hasEdits &&
            this.verificationStatus === "not_run" &&
            !this.completionVerificationNudgedForRun
          ) {
            this.completionVerificationNudgedForRun = true;
            this.state.history.push({
              id: `msg_completion_verification_${Date.now()}`,
              role: "user",
              createdAt: new Date().toISOString(),
              content: [
                {
                  type: "text",
                  text: [
                    "Orbit completion gate: files were modified, but no verification has run.",
                    "Use run_tests now with the smallest relevant build, test, compile, or syntax check for the changed files.",
                    "If it fails, repair the root cause before claiming completion. Do not repeat discovery.",
                  ].join(" "),
                },
              ],
              metadata: { kind: "completion_verification" },
            });
            this.sessionManager.saveHistory(this.state.history);
            this.interaction.showText(
              picocolors.yellow(
                "\n⚠ Completion gate: modified files require a verification check before Orbit can finish.",
              ),
            );
            continue;
          }

          if (hasEdits && !this.hasCurrentVerification()) {
            this.terminalFailure = {
              code: "verification_failed",
              message: this.verificationFailureMessage(),
            };
          }
          this.state.done = true;
          break;
        }

        const toolResultBlocks: OrbitContentBlock[] = [];
        const rejectInvalidToolCall = (
          toolCall: OrbitToolCall,
          message: string,
          risk = "read",
          startedAt = new Date().toISOString(),
        ): void => {
          const error = safeAgentLoopErrorMessage(message);
          this.interaction.showText(`  ${picocolors.red("✖")} ${error}`);
          eventBus.emitEvent("tool_result", {
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            error,
          });
          toolResultBlocks.push({
            type: "tool_result",
            toolResult: {
              toolCallId: toolCall.id,
              name: toolCall.name,
              content: error,
              isError: true,
            },
          });
          this.sessionManager.recordToolExecution(
            toolCall.name,
            toolCall,
            { ok: false, error },
            risk,
            "invalid",
            "failed",
            { startedAt },
          );
        };
        let terminalSuccessReachedThisBatch: string | undefined;
        for (const tc of toolCallsToExecute) {
          const toolStartedAt = new Date().toISOString();
          if (this.finalResponseOnlyReason) {
            rejectInvalidToolCall(
              tc,
              "A trusted finalizer already completed the delivery. Tool execution is locked; return the final delivery report now.",
              "read",
              toolStartedAt,
            );
            continue;
          }
          let argSummary = "";
          try {
            const parsed = JSON.parse(tc.arguments);
            if (
              tc.name === "write_file" ||
              tc.name === "edit_file" ||
              tc.name === "replace_file_content"
            ) {
              argSummary =
                parsed.path ||
                parsed.TargetFile ||
                parsed.filePath ||
                parsed.file ||
                "";
            } else if (tc.name === "multi_replace_file_content") {
              argSummary = parsed.TargetFile || "";
            } else if (tc.name === "read_file") {
              argSummary = parsed.path || parsed.AbsolutePath || "";
            } else if (tc.name === "bash") {
              argSummary = parsed.command || parsed.CommandLine || "";
            } else if (tc.name === "run_tests") {
              argSummary = parsed.command || "";
            } else if (tc.name === "grep") {
              argSummary = `"${parsed.query || parsed.Query}" in ${parsed.path || parsed.SearchPath || ""}`;
            } else if (tc.name === "glob") {
              argSummary = `"${parsed.pattern || parsed.Pattern}" in ${parsed.path || parsed.DirectoryPath || ""}`;
            } else if (tc.name === "web_search") {
              argSummary = parsed.query || "";
            } else {
              argSummary = tc.arguments;
            }
          } catch {
            argSummary = tc.arguments;
          }

          if (argSummary.length > 80) {
            argSummary = argSummary.substring(0, 77) + "...";
          }
          this.interaction.showText(
            `\n  ${picocolors.cyan("✦")} ${picocolors.bold(picocolors.white(tc.name))} ${picocolors.gray(argSummary)}`,
          );

          const registeredTool = this.toolRegistry.get(tc.name);
          if (!registeredTool) {
            rejectInvalidToolCall(
              tc,
              `Tool "${tc.name}" was not found in the registry.`,
              "read",
              toolStartedAt,
            );
            continue;
          }
          const declaredRisk = registeredTool?.risk;
          const protocolError = toolCallProtocolErrors.get(tc.id);
          if (protocolError) {
            rejectInvalidToolCall(
              tc,
              protocolError,
              declaredRisk,
              toolStartedAt,
            );
            continue;
          }
          let preflightArgs: unknown;
          try {
            preflightArgs = JSON.parse(tc.arguments) as unknown;
          } catch (error: unknown) {
            rejectInvalidToolCall(
              tc,
              `Tool input JSON parse failed: ${safeAgentLoopErrorMessage(error)}`,
              declaredRisk,
              toolStartedAt,
            );
            continue;
          }
          const validation =
            registeredTool.inputSchema.safeParse(preflightArgs);
          if (!validation.success) {
            rejectInvalidToolCall(
              tc,
              formatToolInputValidationError(validation.error),
              declaredRisk,
              toolStartedAt,
            );
            continue;
          }
          const evalArgs = validation.data;
          const evalArgsRecord = toUnknownRecord(evalArgs);

          eventBus.emitEvent("tool_proposal", {
            toolCallId: tc.id,
            toolName: tc.name,
            arguments: evalArgs,
          });

          let decision = this.permissionEngine.evaluate(
            tc.name,
            evalArgs,
            declaredRisk,
          );

          if (
            tc.name === "write_file" ||
            tc.name === "edit_file" ||
            tc.name === "replace_file_content" ||
            tc.name === "multi_replace_file_content"
          ) {
            const targetPath = firstStringValue(
              evalArgsRecord.path,
              evalArgsRecord.TargetFile,
              evalArgsRecord.filePath,
              evalArgsRecord.file,
            );
            if (targetPath && !isFullAccessEnabled(this.config)) {
              const relPath = path
                .relative(this.cwd, path.resolve(this.cwd, targetPath))
                .replace(/\\/g, "/");
              const foundFile = this.state.relevantFiles.find(
                (f) => f.path === relPath,
              );
              if (foundFile && foundFile.readOnly) {
                decision = {
                  action: "deny",
                  reason: `File "${relPath}" is marked as READ-ONLY reference and cannot be modified.`,
                  risk: "write",
                };
              }
            }
          }

          const reusableApprovalScope = this.getReusableApprovalScope(
            tc.name,
            decision.risk,
          );
          const reusedApproval =
            decision.action === "ask" &&
            reusableApprovalScope !== null &&
            this.approvedToolScopes.has(reusableApprovalScope);
          if (reusedApproval) {
            decision = {
              action: "allow",
              reason: `Previously approved "${tc.name}" for this task.`,
              risk: decision.risk,
            };
          }

          if (decision.action === "ask") {
            const permissionHooks = await this.runLifecycleHooks(
              "permissionRequest",
              {
                sessionId: this.state.sessionId,
                attempt: this.state.attemptCount,
                toolName: tc.name,
                filePath: firstStringValue(
                  evalArgsRecord.path,
                  evalArgsRecord.TargetFile,
                  evalArgsRecord.filePath,
                  evalArgsRecord.file,
                ),
                status: decision.risk,
              },
            );
            if (!permissionHooks.ok) {
              decision = {
                action: "deny",
                reason:
                  permissionHooks.output ||
                  `A blocking permission hook rejected ${tc.name}.`,
                risk: decision.risk,
              };
            }
          }

          if (decision.action === "deny") {
            this.interaction.showText(`✖ Blocked: ${decision.reason}`);
            eventBus.emitEvent("tool_approval", {
              toolCallId: tc.id,
              approved: false,
              reason: `Blocked by safety policy: ${decision.reason}`,
            });
            eventBus.emitEvent("tool_result", {
              toolCallId: tc.id,
              toolName: tc.name,
              error: `Blocked by safety policy: ${decision.reason}`,
            });
            toolResultBlocks.push({
              type: "tool_result",
              toolResult: {
                toolCallId: tc.id,
                name: tc.name,
                content: `Blocked by safety policy: ${decision.reason}`,
                isError: true,
              },
            });
            this.sessionManager.recordToolExecution(
              tc.name,
              tc,
              null,
              decision.risk || "read",
              decision.action,
              "denied",
              { startedAt: toolStartedAt },
            );
            continue;
          }

          if (decision.action === "ask") {
            this.sessionManager.setRunState(
              "awaiting_approval",
              `tool:${tc.name}`,
              {
                attempt: this.state.attemptCount,
                activeToolCallId: tc.id,
              },
            );
            let approved = false;
            let currentArgs = tc.arguments;
            if (this.interaction.askToolApproval) {
              approved = await this.interaction.askToolApproval({
                toolCallId: tc.id,
                toolName: tc.name,
                reason: decision.reason,
                preview: argSummary || tc.arguments,
                agentId: this.options.agent?.id,
                agentRole: this.options.agent?.role,
              });
              if (approved && reusableApprovalScope) {
                this.approvedToolScopes.add(reusableApprovalScope);
              }
            } else if (this.options?.nonInteractive) {
              approved = await this.interaction.askApproval(
                `Tool "${tc.name}" requires approval: ${decision.reason}`,
                argSummary || tc.arguments,
              );
            } else if (reusableApprovalScope) {
              approved = await this.interaction.askApproval(
                `Allow "${tc.name}" for this task?`,
                argSummary || decision.reason,
              );
              if (approved) {
                this.approvedToolScopes.add(reusableApprovalScope);
              }
            } else {
              while (true) {
                const choice = await this.askSelect(
                  `Confirm execution of tool "${tc.name}"? Reason: ${decision.reason}`,
                  [
                    { value: "approve", label: "Approve execution" },
                    { value: "edit", label: "Edit tool arguments" },
                    { value: "deny", label: "Deny execution" },
                  ],
                );
                if (choice === "approve") {
                  approved = true;
                  break;
                } else if (choice === "edit") {
                  let edited: string | null = null;
                  const isObjectSchema =
                    registeredTool?.inputSchema instanceof z.ZodObject;

                  if (isObjectSchema) {
                    const editChoice = await this.askSelect(
                      "Choose edit mode:",
                      [
                        {
                          value: "form",
                          label: "(Recommended) Interactive form fields editor",
                        },
                        { value: "json", label: "Raw JSON string editor" },
                        { value: "cancel", label: "Cancel" },
                      ],
                    );
                    if (editChoice === "form") {
                      edited = await this.promptSchemaGuided(
                        registeredTool,
                        currentArgs,
                      );
                    } else if (editChoice === "json") {
                      edited = await this.askText(
                        "Edit tool arguments (JSON string):",
                        currentArgs,
                      );
                    }
                  } else {
                    edited = await this.askText(
                      "Edit tool arguments (JSON string):",
                      currentArgs,
                    );
                  }

                  if (edited === null) {
                    continue;
                  }
                  try {
                    const parsed = JSON.parse(edited);
                    if (registeredTool && registeredTool.inputSchema) {
                      const validation =
                        registeredTool.inputSchema.safeParse(parsed);
                      if (!validation.success) {
                        const errorMsgs = validation.error.errors
                          .map(
                            (e) =>
                              `${e.path.join(".") || "root"}: ${e.message}`,
                          )
                          .join(", ");
                        this.interaction.showText(
                          `✖ Schema validation failed: ${errorMsgs}`,
                        );
                        continue;
                      }
                    }
                    currentArgs = edited;
                    tc.arguments = edited;
                    this.interaction.showText(`✔ Arguments updated.`);
                    approved = true;
                    break;
                  } catch (error: unknown) {
                    this.interaction.showText(
                      `✖ Invalid JSON: ${safeAgentLoopErrorMessage(error)}. Please try again.`,
                    );
                  }
                } else {
                  break;
                }
              }
            }

            if (!approved) {
              this.interaction.showText(`✖ Rejected by user.`);
              eventBus.emitEvent("tool_approval", {
                toolCallId: tc.id,
                approved: false,
                reason: "Rejected by user",
              });
              eventBus.emitEvent("tool_result", {
                toolCallId: tc.id,
                toolName: tc.name,
                error: "Rejected by user",
              });
              toolResultBlocks.push({
                type: "tool_result",
                toolResult: {
                  toolCallId: tc.id,
                  name: tc.name,
                  content: "Rejected by user",
                  isError: true,
                },
              });
              this.sessionManager.recordToolExecution(
                tc.name,
                tc,
                null,
                decision.risk || "read",
                decision.action,
                "denied",
                { startedAt: toolStartedAt },
              );
              continue;
            } else {
              eventBus.emitEvent("tool_approval", {
                toolCallId: tc.id,
                approved: true,
                reason: "Approved by user",
              });
            }
          } else {
            eventBus.emitEvent("tool_approval", {
              toolCallId: tc.id,
              approved: true,
              reason: reusedApproval
                ? "Approved by earlier user confirmation"
                : "Auto-approved by policy",
            });
          }

          this.sessionManager.setRunState("running", `tool:${tc.name}`, {
            attempt: this.state.attemptCount,
            activeToolCallId: tc.id,
          });

          let beforeContent: string | null = null;
          let targetPath: string | undefined;
          const fullAccess = isFullAccessEnabled(this.config);
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = toUnknownRecord(JSON.parse(tc.arguments));
            targetPath = firstStringValue(
              parsedArgs.path,
              parsedArgs.TargetFile,
              parsedArgs.filePath,
              parsedArgs.file,
            );
          } catch {
            // Ignored
          }
          let absoluteTargetPath: string | undefined;
          let workspaceTargetPath: string | undefined;
          if (targetPath) {
            try {
              workspaceTargetPath = resolveSafePath(this.cwd, targetPath);
              absoluteTargetPath = workspaceTargetPath;
            } catch {
              absoluteTargetPath = fullAccess
                ? path.resolve(this.cwd, targetPath)
                : undefined;
            }
          }

          let skipToolExecution = false;
          let hookResult: ToolResult | undefined;

          // Milestone 22: Git Auto-Commits with LLM Commit Messages & Pre-Commit Checks
          if (tc.name === "git_commit") {
            // 1. Pre-commit verification checks (run tests if available)
            if (
              contextPack.projectIndex.testCommands &&
              contextPack.projectIndex.testCommands.length > 0
            ) {
              this.interaction.showText(
                `● Pre-commit checks: running verification tests...`,
              );
              const testCmd = contextPack.projectIndex.testCommands[0];
              try {
                await execPromise(testCmd, {
                  ...HIDDEN_CHILD_PROCESS_OPTIONS,
                  cwd: this.cwd,
                  env: this.buildChildProcessEnvironment(),
                });
                this.interaction.showText(`✔ Pre-commit checks passed.`);
              } catch (error: unknown) {
                const commandError = hookErrorOutput(error);
                this.interaction.showText(
                  picocolors.red(
                    `✖ Pre-commit checks failed. Verification tests failed.`,
                  ),
                );

                const choice = fullAccess
                  ? "yes"
                  : this.options?.nonInteractive
                    ? "no"
                    : await this.askSelect(
                        `Pre-commit verification tests failed. How would you like to proceed?`,
                        [
                          {
                            value: "yes",
                            label: "Proceed with the commit anyway",
                          },
                          {
                            value: "diagnose",
                            label:
                              "Let Agent auto-repair the failures (diagnose)",
                          },
                          { value: "no", label: "Abort the commit entirely" },
                        ],
                      );

                if (fullAccess) {
                  this.interaction.showText(
                    picocolors.yellow(
                      "⚠ Full Access: proceeding with the approved commit despite failed pre-commit verification.",
                    ),
                  );
                }

                if (choice === "diagnose") {
                  eventBus.emitEvent("tool_result", {
                    toolCallId: tc.id,
                    toolName: tc.name,
                    error: `Commit aborted. Verification tests failed: ${commandError}`,
                  });
                  toolResultBlocks.push({
                    type: "tool_result",
                    toolResult: {
                      toolCallId: tc.id,
                      name: tc.name,
                      content: `Commit aborted. Verification tests failed with the following log. Please diagnose and fix the codebase first:\n\n${commandError}`,
                      isError: true,
                    },
                  });
                  continue;
                } else if (choice !== "yes") {
                  eventBus.emitEvent("tool_result", {
                    toolCallId: tc.id,
                    toolName: tc.name,
                    error:
                      "Commit aborted by user due to pre-commit test failures.",
                  });
                  toolResultBlocks.push({
                    type: "tool_result",
                    toolResult: {
                      toolCallId: tc.id,
                      name: tc.name,
                      content:
                        "Commit aborted by user due to pre-commit test failures.",
                      isError: true,
                    },
                  });
                  continue;
                }
              }
            }

            // 2. Generate Commit Message via LLM if not provided
            if (!parsedArgs.message) {
              this.interaction.showText(
                `● Git Commit: generating commit message via LLM...`,
              );
              try {
                const { stdout } = await execPromise("git diff --cached", {
                  ...HIDDEN_CHILD_PROCESS_OPTIONS,
                  cwd: this.cwd,
                  env: this.buildChildProcessEnvironment(),
                });
                if (!stdout.trim()) {
                  this.interaction.showText(
                    `⚠ Warning: No staged changes found to commit.`,
                  );
                } else {
                  const fastModel =
                    this.config.models.fast || this.config.models.default;
                  const stream = this.provider.chat({
                    model: fastModel,
                    messages: [
                      {
                        id: `msg_commit_${Date.now()}`,
                        role: "user",
                        createdAt: new Date().toISOString(),
                        content: [
                          {
                            type: "text",
                            text: `Generate a concise, high-quality conventional git commit message (e.g. feat(cli): add autocomplete) from the following change summary. Output ONLY the commit message, no formatting, no markdown, no quotes, just the text:\n\n${buildCommitContextForModel(stdout)}`,
                          },
                        ],
                      },
                    ],
                    tools: [],
                  });

                  let generatedMessage = "";
                  for await (const event of stream) {
                    if (event.type === "text_delta") {
                      generatedMessage += event.text;
                    }
                  }

                  generatedMessage = generatedMessage
                    .trim()
                    .replace(/^["']|["']$/g, "");
                  if (generatedMessage) {
                    parsedArgs.message = generatedMessage;
                    tc.arguments = JSON.stringify(parsedArgs);
                    this.interaction.showText(
                      `● Generated Commit Message: "${generatedMessage}"`,
                    );
                  }
                }
              } catch (error: unknown) {
                this.interaction.showText(
                  `⚠ Failed to generate commit message: ${safeAgentLoopErrorMessage(error)}`,
                );
              }
            }
          }

          if (
            (tc.name === "write_file" ||
              tc.name === "edit_file" ||
              tc.name === "replace_file_content" ||
              tc.name === "multi_replace_file_content") &&
            targetPath &&
            workspaceTargetPath
          ) {
            try {
              const checkpoint =
                await this.checkpointManager.captureBeforeState(
                  tc.id,
                  targetPath,
                );
              beforeContent = checkpoint.backups[0].originalContent;

              eventBus.emitEvent("checkpoint_created", {
                checkpointId: checkpoint.id,
                timestamp: checkpoint.timestamp,
                message: `Before executing ${tc.name} on ${targetPath}`,
              });
            } catch (error: unknown) {
              if (!fullAccess) throw error;
              this.interaction.showText(
                picocolors.yellow(
                  `⚠ Full Access: checkpoint unavailable for ${targetPath}; proceeding without Orbit rollback coverage. ${safeAgentLoopErrorMessage(error)}`,
                ),
              );
            }
          }

          const preToolHooks = await this.runLifecycleHooks("preToolUse", {
            sessionId: this.state.sessionId,
            attempt: this.state.attemptCount,
            toolName: tc.name,
            filePath: targetPath,
            agentRole: this.options.agent?.role,
          });
          if (!preToolHooks.ok) {
            hookResult = {
              ok: false,
              error:
                preToolHooks.output ||
                `A blocking pre-tool hook rejected ${tc.name}.`,
            };
            skipToolExecution = true;
          }

          this.interaction.progress?.start(
            `Executing tool: ${tc.name}... | Cost: ${this.formatSessionCost()}`,
          );
          const executionWorkspaceBefore =
            !skipToolExecution &&
            (tc.name === "bash" || tc.name === "run_tests")
              ? await captureWorkspaceMutationSnapshot(this.cwd)
              : undefined;
          const result = skipToolExecution
            ? (hookResult ?? {
                ok: false,
                error: "Pre-edit hook prevented tool execution.",
              })
            : await this.stepRunner.run(tc, this.abortController?.signal);
          this.interaction.progress?.stop();

          if (this.abortController?.signal.aborted) {
            const action = await this.handleInterrupt();
            if (action === "continue") {
              this.interaction.showText("● Resuming execution...");
              this.abortController = null;
              eventBus.emitEvent("tool_result", {
                toolCallId: tc.id,
                toolName: tc.name,
                error: "Interrupted by user",
              });
              toolResultBlocks.push({
                type: "tool_result",
                toolResult: {
                  toolCallId: tc.id,
                  name: tc.name,
                  content: "Interrupted by user",
                  isError: true,
                },
              });
              continue;
            } else if (action === "rollback_exit") {
              await this.rollbackLastCheckpoint();
              this.state.done = true;
              return this.createAbortedOutcome(
                "rollback",
                "Execution was interrupted and the last checkpoint was rolled back.",
              );
            } else {
              this.interaction.showText("● Aborted. Returning to REPL prompt.");
              this.state.done = true;
              return this.createAbortedOutcome(
                "interrupted",
                "Execution was interrupted by the user.",
              );
            }
          }

          let finalResult = result;
          if (!skipToolExecution) {
            const postToolHooks = await this.runLifecycleHooks(
              result.ok ? "postToolUse" : "postToolFailure",
              {
                sessionId: this.state.sessionId,
                attempt: this.state.attemptCount,
                toolName: tc.name,
                filePath: targetPath,
                agentRole: this.options.agent?.role,
                status: result.ok ? "success" : "failure",
              },
            );
            if (!postToolHooks.ok) {
              finalResult = {
                ok: false,
                error:
                  postToolHooks.output ||
                  `A blocking post-tool hook failed for ${tc.name}.`,
              };
            }
          }

          // Type & Lint Guard Rails check
          if (
            finalResult.ok &&
            targetPath &&
            absoluteTargetPath &&
            (tc.name === "write_file" ||
              tc.name === "edit_file" ||
              tc.name === "replace_file_content" ||
              tc.name === "multi_replace_file_content")
          ) {
            // Run Auto-Formatters (Prettier / Biome / ESLint Fix)
            try {
              if (
                fs.existsSync(path.join(this.cwd, "biome.json")) ||
                fs.existsSync(path.join(this.cwd, "biome.jsonc"))
              ) {
                this.interaction.showText(`● Running Biome Auto-Format...`);
                await executeLocalPackageBinary(
                  this.cwd,
                  "@biomejs/biome",
                  "biome",
                  ["format", "--write", absoluteTargetPath],
                  this.buildChildProcessEnvironment(),
                );
              } else {
                const prettierCandidates = [
                  ".prettierrc",
                  ".prettierrc.json",
                  ".prettierrc.yml",
                  ".prettierrc.yaml",
                  ".prettierrc.js",
                  "prettier.config.js",
                ];
                let hasPrettierConfig = false;
                for (const c of prettierCandidates) {
                  if (fs.existsSync(path.join(this.cwd, c))) {
                    hasPrettierConfig = true;
                    break;
                  }
                }
                if (hasPrettierConfig) {
                  this.interaction.showText(
                    `● Running Prettier Auto-Format...`,
                  );
                  await executeLocalPackageBinary(
                    this.cwd,
                    "prettier",
                    "prettier",
                    ["--write", absoluteTargetPath],
                    this.buildChildProcessEnvironment(),
                  );
                }
              }
              const eslintCandidates = [
                ".eslintrc",
                ".eslintrc.json",
                ".eslintrc.js",
                "eslint.config.js",
              ];
              let hasEslintConfig = false;
              for (const c of eslintCandidates) {
                if (fs.existsSync(path.join(this.cwd, c))) {
                  hasEslintConfig = true;
                  break;
                }
              }
              if (hasEslintConfig) {
                await executeLocalPackageBinary(
                  this.cwd,
                  "eslint",
                  "eslint",
                  ["--fix", absoluteTargetPath],
                  this.buildChildProcessEnvironment(),
                );
              }
            } catch {
              // Ignore formatting failures
            }

            if (
              targetPath.endsWith(".ts") ||
              targetPath.endsWith(".tsx") ||
              targetPath.endsWith(".js") ||
              targetPath.endsWith(".jsx")
            ) {
              try {
                let lintPackage = "eslint";
                let lintBinary = "eslint";
                let lintArgs = ["--quiet", absoluteTargetPath];
                if (
                  fs.existsSync(path.join(this.cwd, "biome.json")) ||
                  fs.existsSync(path.join(this.cwd, "biome.jsonc"))
                ) {
                  lintPackage = "@biomejs/biome";
                  lintBinary = "biome";
                  lintArgs = ["lint", absoluteTargetPath];
                }
                this.interaction.showText(
                  `● Verifying file syntax & type safety for ${targetPath}...`,
                );
                await executeLocalPackageBinary(
                  this.cwd,
                  lintPackage,
                  lintBinary,
                  lintArgs,
                  this.buildChildProcessEnvironment(),
                );
                this.interaction.showText(`✔ Syntax verification passed.`);
              } catch (error: unknown) {
                let lintError = hookErrorOutput(error);
                this.interaction.showText(
                  picocolors.yellow(
                    `⚠ Syntax/Lint validation warning for ${targetPath}:`,
                  ),
                );
                this.interaction.showText(picocolors.red(lintError));

                let checkPassedAfterAutoInstall = false;
                const outputText = lintError;

                try {
                  const missingModules: string[] = [];
                  const moduleMatch1 = [
                    ...outputText.matchAll(/Cannot find module '([^']+)'/g),
                  ];
                  for (const m of moduleMatch1) {
                    if (m[1]) missingModules.push(m[1]);
                  }
                  const moduleMatch2 = [
                    ...outputText.matchAll(/Cannot find name '([^']+)'/g),
                  ];
                  for (const m of moduleMatch2) {
                    if (
                      m[1] &&
                      (m[1].toLowerCase() === m[1] || m[1].startsWith("@"))
                    ) {
                      missingModules.push(m[1]);
                    }
                  }
                  const typesMatch = [
                    ...outputText.matchAll(
                      /Could not find a declaration file for module '([^']+)'/g,
                    ),
                  ];
                  for (const m of typesMatch) {
                    if (m[1]) missingModules.push(`@types/${m[1]}`);
                  }

                  if (missingModules.length > 0) {
                    const uniqueModules = Array.from(new Set(missingModules));
                    let dependenciesInstalled = false;
                    for (const pkg of uniqueModules) {
                      const installPkg =
                        fullAccess ||
                        (await this.interaction.askApproval(
                          `Missing dependency "${pkg}" detected. Install it automatically?`,
                        ));
                      if (installPkg) {
                        this.interaction.showText(`● Installing "${pkg}"...`);
                        const isPnpm = fs.existsSync(
                          path.join(this.cwd, "pnpm-lock.yaml"),
                        );
                        const isYarn = fs.existsSync(
                          path.join(this.cwd, "yarn.lock"),
                        );
                        try {
                          if (!isValidPackageName(pkg)) {
                            throw new Error(
                              `Rejected invalid package name: ${pkg}`,
                            );
                          }
                          const executable = isPnpm
                            ? "pnpm"
                            : isYarn
                              ? "yarn"
                              : "npm";
                          const args =
                            isPnpm || isYarn
                              ? ["add", "-D", pkg]
                              : ["install", "--save-dev", pkg];
                          await execFilePromise(executable, args, {
                            ...HIDDEN_CHILD_PROCESS_OPTIONS,
                            cwd: this.cwd,
                            env: this.buildChildProcessEnvironment(),
                          });
                          this.interaction.showText(
                            `✔ Installed "${pkg}" successfully.`,
                          );
                          dependenciesInstalled = true;
                        } catch (installError: unknown) {
                          this.interaction.showText(
                            picocolors.red(
                              `✖ Failed to install "${pkg}": ${safeAgentLoopErrorMessage(installError)}`,
                            ),
                          );
                        }
                      }
                    }

                    if (dependenciesInstalled) {
                      try {
                        this.interaction.showText(
                          `● Re-verifying syntax after dependency installation...`,
                        );
                        await executeLocalPackageBinary(
                          this.cwd,
                          "eslint",
                          "eslint",
                          ["--quiet", absoluteTargetPath],
                          this.buildChildProcessEnvironment(),
                        );
                        this.interaction.showText(
                          `✔ Syntax verification passed after dependency installation.`,
                        );
                        checkPassedAfterAutoInstall = true;
                      } catch (recheckError: unknown) {
                        lintError = hookErrorOutput(recheckError);
                      }
                    }
                  }
                } catch {
                  // Ignore installer issues
                }

                let autoImported = false;
                if (!checkPassedAfterAutoInstall) {
                  try {
                    const missingSymbols: string[] = [];
                    const currentOutput = lintError;
                    const match1 = [
                      ...currentOutput.matchAll(/'([^']+)' is not defined/g),
                    ];
                    for (const m of match1) {
                      if (m[1]) missingSymbols.push(m[1]);
                    }
                    const match2 = [
                      ...currentOutput.matchAll(/Cannot find name '([^']+)'/g),
                    ];
                    for (const m of match2) {
                      if (m[1]) missingSymbols.push(m[1]);
                    }

                    if (missingSymbols.length > 0) {
                      const symbolIndexer = new SymbolIndexer(this.cwd);
                      const fileContent = readBoundedRegularFile(
                        absoluteTargetPath,
                        AGENT_EDIT_FILE_MAX_BYTES,
                      );
                      if (fileContent !== undefined) {
                        let newImports = "";
                        for (const symbol of new Set(missingSymbols)) {
                          const match = (
                            await symbolIndexer.search(symbol)
                          ).find((candidate) => candidate.name === symbol);
                          if (!match) continue;
                          const exportFileAbs = resolveSafePath(
                            this.cwd,
                            match.filePath,
                          );
                          if (exportFileAbs === absoluteTargetPath) continue;
                          const targetDir = path.dirname(absoluteTargetPath);
                          let relPath = path
                            .relative(targetDir, exportFileAbs)
                            .replace(/\\/g, "/");
                          if (
                            !relPath.startsWith("./") &&
                            !relPath.startsWith("../")
                          ) {
                            relPath = `./${relPath}`;
                          }
                          relPath = relPath.replace(
                            /\.(ts|tsx|js|jsx)$/,
                            ".js",
                          );
                          newImports += `import { ${symbol} } from '${relPath}';\n`;
                        }

                        if (newImports) {
                          fs.writeFileSync(
                            absoluteTargetPath,
                            newImports + fileContent,
                            "utf8",
                          );
                          this.interaction.showText(
                            `● Automatically resolved missing imports...`,
                          );
                          autoImported = true;
                        }
                      }
                    }
                  } catch {
                    // Ignore autofix errors
                  }
                }

                let checkPassedAfterAutofix = false;
                if (autoImported) {
                  try {
                    this.interaction.showText(
                      `● Re-verifying syntax after auto-imports injection...`,
                    );
                    await executeLocalPackageBinary(
                      this.cwd,
                      "eslint",
                      "eslint",
                      ["--quiet", absoluteTargetPath],
                      this.buildChildProcessEnvironment(),
                    );
                    this.interaction.showText(
                      `✔ Syntax verification passed after auto-imports injection.`,
                    );
                    checkPassedAfterAutofix = true;
                  } catch (recheckError: unknown) {
                    this.interaction.showText(
                      picocolors.yellow(
                        `⚠ Syntax/Lint validation still failed after auto-imports:`,
                      ),
                    );
                    this.interaction.showText(
                      picocolors.red(hookErrorOutput(recheckError)),
                    );
                  }
                }

                if (!checkPassedAfterAutofix) {
                  const autoFix =
                    fullAccess ||
                    (await this.interaction.askApproval(
                      `Lint/Syntax verification failed. Let Agent auto-repair the file?`,
                    ));
                  if (autoFix) {
                    finalResult = {
                      ok: false,
                      error: `Syntax or Lint verification failed on file edit: ${lintError}. Please fix the syntax/import errors.`,
                    };
                  }
                }
              }
            }
          }

          // Phase 5: Interactive Diff Acceptance Check
          if (
            finalResult.ok &&
            targetPath &&
            absoluteTargetPath &&
            (tc.name === "write_file" ||
              tc.name === "edit_file" ||
              tc.name === "replace_file_content" ||
              tc.name === "multi_replace_file_content")
          ) {
            let afterContent = "";
            try {
              afterContent =
                readBoundedRegularFile(
                  absoluteTargetPath,
                  AGENT_EDIT_FILE_MAX_BYTES,
                ) ?? "";
            } catch {
              try {
                const afterArgs = JSON.parse(tc.arguments);
                afterContent = afterArgs.content || afterArgs.newText || "";
              } catch {}
            }
            try {
              await this.interaction.showDiff(
                targetPath,
                beforeContent,
                afterContent,
              );
            } catch {
              // Ignored
            }

            let accepted = false;
            const choice = fullAccess
              ? "yes"
              : this.options?.nonInteractive
                ? "yes"
                : this.interaction.reviewFileChange
                  ? (await this.interaction.reviewFileChange({
                      filePath: targetPath,
                      before: beforeContent,
                      after: afterContent,
                      agentId: this.options.agent?.id,
                      agentRole: this.options.agent?.role,
                    }))
                    ? "yes"
                    : "no"
                  : await this.askSelect(`Accept changes to ${targetPath}?`, [
                      { value: "yes", label: "Accept all changes" },
                      {
                        value: "hunks",
                        label: "Review and accept by hunk/block",
                      },
                      { value: "no", label: "Reject and rollback all changes" },
                    ]);

            if (choice === "yes") {
              accepted = true;
            } else if (choice === "hunks") {
              try {
                const linesBefore = beforeContent
                  ? beforeContent.split("\n")
                  : [];
                const linesAfter = afterContent.split("\n");

                interface Hunk {
                  startB: number;
                  endB: number;
                  startA: number;
                  endA: number;
                  linesB: string[];
                  linesA: string[];
                }
                const hunks: Hunk[] = [];
                let iB = 0;
                let iA = 0;

                while (iB < linesBefore.length || iA < linesAfter.length) {
                  if (
                    iB < linesBefore.length &&
                    iA < linesAfter.length &&
                    linesBefore[iB] === linesAfter[iA]
                  ) {
                    iB++;
                    iA++;
                    continue;
                  }

                  const startB = iB;
                  const startA = iA;

                  let bestDB = -1;
                  let bestDA = -1;
                  let minSum = Infinity;

                  const maxLookahead = 20;
                  for (let dB = 0; dB <= maxLookahead; dB++) {
                    for (let dA = 0; dA <= maxLookahead; dA++) {
                      if (dB === 0 && dA === 0) continue;
                      const posB = iB + dB;
                      const posA = iA + dA;

                      if (posB > linesBefore.length || posA > linesAfter.length)
                        continue;

                      const isEndB = posB === linesBefore.length;
                      const isEndA = posA === linesAfter.length;

                      let isMatch = false;
                      if (isEndB && isEndA) {
                        isMatch = true;
                      } else if (!isEndB && !isEndA) {
                        isMatch = linesBefore[posB] === linesAfter[posA];
                      }

                      if (isMatch) {
                        const sum = dB + dA;
                        if (sum < minSum) {
                          minSum = sum;
                          bestDB = dB;
                          bestDA = dA;
                        }
                      }
                    }
                  }

                  if (bestDB !== -1 && bestDA !== -1) {
                    const linesB = linesBefore.slice(startB, startB + bestDB);
                    const linesA = linesAfter.slice(startA, startA + bestDA);
                    iB += bestDB;
                    iA += bestDA;

                    hunks.push({
                      startB,
                      endB: iB,
                      startA,
                      endA: iA,
                      linesB,
                      linesA,
                    });
                  } else {
                    const linesB = linesBefore.slice(startB);
                    const linesA = linesAfter.slice(startA);
                    iB = linesBefore.length;
                    iA = linesAfter.length;

                    hunks.push({
                      startB,
                      endB: iB,
                      startA,
                      endA: iA,
                      linesB,
                      linesA,
                    });
                  }
                }

                if (hunks.length === 0) {
                  accepted = true;
                } else {
                  const previewLines = [
                    `\n● Reviewing ${hunks.length} hunks in ${targetPath}:`,
                  ];
                  for (let hIdx = 0; hIdx < hunks.length; hIdx++) {
                    const hunk = hunks[hIdx];
                    previewLines.push(
                      picocolors.cyan(
                        `\n--- Hunk #${hIdx + 1}/${hunks.length} ---`,
                      ),
                    );
                    for (const line of hunk.linesB) {
                      previewLines.push(`  ${picocolors.red(`- ${line}`)}`);
                    }
                    for (const line of hunk.linesA) {
                      previewLines.push(`  ${picocolors.green(`+ ${line}`)}`);
                    }
                    previewLines.push(
                      picocolors.cyan(
                        "----------------------------------------",
                      ),
                    );
                  }
                  this.interaction.showText(previewLines.join("\n"));

                  const selectedHunkIndices = await this.askMultiSelect(
                    `Select the hunks to apply to ${targetPath}:`,
                    hunks.map((h, idx) => ({
                      value: idx.toString(),
                      label: `Apply Hunk #${idx + 1}`,
                      hint: `-${h.linesB.length} lines, +${h.linesA.length} lines`,
                    })),
                  );

                  if (selectedHunkIndices === null) {
                    accepted = false;
                  } else {
                    const mergedLines: string[] = [];
                    let lastB = 0;
                    for (let hIdx = 0; hIdx < hunks.length; hIdx++) {
                      const hunk = hunks[hIdx];
                      mergedLines.push(
                        ...linesBefore.slice(lastB, hunk.startB),
                      );
                      if (selectedHunkIndices.includes(hIdx.toString())) {
                        mergedLines.push(...hunk.linesA);
                      } else {
                        mergedLines.push(...hunk.linesB);
                      }
                      lastB = hunk.endB;
                    }
                    mergedLines.push(...linesBefore.slice(lastB));

                    fs.writeFileSync(
                      absoluteTargetPath,
                      mergedLines.join("\n"),
                      "utf8",
                    );
                    this.interaction.showText(
                      picocolors.green(
                        `✔ Selected hunks merged and saved to ${targetPath}.`,
                      ),
                    );
                    accepted = true;
                  }
                }
              } catch (hunkError: unknown) {
                this.interaction.showText(
                  picocolors.red(
                    `✖ Hunk merge failed: ${safeAgentLoopErrorMessage(hunkError)}. Accepting all instead.`,
                  ),
                );
                accepted = true;
              }
            }

            if (!accepted) {
              this.interaction.showText(
                picocolors.yellow(
                  `● Rejected changes. Reverting ${targetPath}...`,
                ),
              );
              await this.rollbackLastCheckpoint();
              finalResult = {
                ok: false,
                error: `Edits to ${targetPath} rejected and rolled back by user.`,
              };
            }
          }

          if (
            finalResult.ok &&
            targetPath &&
            absoluteTargetPath &&
            workspaceTargetPath &&
            isFileMutationTool(tc.name)
          ) {
            const auditedTargetPath = path
              .relative(this.cwd, workspaceTargetPath)
              .replace(/\\/g, "/");
            this.registerWorkspaceMutation([auditedTargetPath], tc.name);
            try {
              const afterContent = readBoundedRegularFile(
                absoluteTargetPath,
                AGENT_EDIT_FILE_MAX_BYTES,
              );
              if (afterContent === undefined) {
                throw new Error("Edited file disappeared before audit.");
              }
              this.sessionManager.recordFileModification(
                auditedTargetPath,
                buildAuditDiff(targetPath, beforeContent, afterContent),
                beforeContent === null ? undefined : sha256(beforeContent),
                sha256(afterContent),
              );
            } catch (error: unknown) {
              this.sessionManager.logEvent("file_audit_failed", {
                path: targetPath,
                message: safeAgentLoopErrorMessage(error),
              });
            }
          }

          const executionWorkspaceAfter = executionWorkspaceBefore
            ? await captureWorkspaceMutationSnapshot(this.cwd)
            : undefined;
          const executionDelta = compareWorkspaceMutationSnapshots(
            executionWorkspaceBefore,
            executionWorkspaceAfter,
          );
          if (executionDelta) {
            this.registerWorkspaceMutation(
              executionDelta.paths,
              tc.name,
              executionDelta,
            );
          }

          const status = finalResult.ok
            ? ("success" as const)
            : ("failed" as const);
          this.sessionManager.recordToolExecution(
            tc.name,
            tc,
            finalResult,
            decision.risk || "read",
            decision.action,
            status,
            { startedAt: toolStartedAt },
          );

          if (tc.name === "run_tests") {
            const isVerificationEvidence =
              finalResult.metadata?.verificationEvidence === true;
            if (!finalResult.ok) {
              this.recordVerificationResult(false);
            } else if (isVerificationEvidence) {
              this.recordVerificationResult(true);
            } else {
              this.interaction.showText(
                picocolors.yellow(
                  "  ⚠ Command succeeded, but it is not a recognized standalone verification command and does not satisfy the completion gate.",
                ),
              );
            }
          }

          const terminalSuccess =
            finalResult.ok &&
            tc.name === "run_tests" &&
            finalResult.metadata?.terminalSuccess === "cumcm-finalizer"
              ? "cumcm-finalizer"
              : undefined;
          if (terminalSuccess) {
            terminalSuccessReachedThisBatch = terminalSuccess;
            this.finalResponseOnlyReason = terminalSuccess;
            this.sessionManager.logEvent("terminal_completion_latched", {
              toolName: tc.name,
              kind: terminalSuccess,
            });
          }

          const modelVisibleToolResult = buildToolResultContent(
            tc.name,
            finalResult,
          );
          if (finalResult.ok) {
            const statusText = truncateToolText(
              redactSecrets(finalResult.display || "Done"),
              TOOL_STATUS_MAX_CHARS,
            );
            this.interaction.showText(
              `  ${picocolors.green("✔")} Success: ${picocolors.gray(statusText)}`,
            );

            if (targetPath && workspaceTargetPath) {
              this.addRelevantFile(targetPath, `Modified by ${tc.name}`);
            }
            if (tc.name === "write_file" || tc.name === "edit_file") {
              this.contextBuilder.invalidateCodebaseRetrieval();
              void this.contextBuilder
                .warmCodebaseRetrieval()
                .catch(() => undefined);
            }
          } else {
            const statusError = truncateToolText(
              modelVisibleToolResult,
              TOOL_STATUS_MAX_CHARS,
            );
            this.interaction.showText(
              `  ${picocolors.red("✖")} Failed: ${picocolors.red(statusError)}`,
            );
          }

          eventBus.emitEvent("tool_result", {
            toolCallId: tc.id,
            toolName: tc.name,
            result: finalResult.ok
              ? redactSensitiveValue(finalResult.data)
              : undefined,
            display: finalResult.ok
              ? redactSecrets(finalResult.display || "")
              : undefined,
            error: finalResult.ok ? undefined : modelVisibleToolResult,
          });

          const guardNudge = this.progressGuard.record({
            name: tc.name,
            arguments: tc.arguments,
            ok: finalResult.ok,
          });
          if (guardNudge) {
            this.interaction.showText(
              picocolors.yellow(
                `⚠ Loop guard: "${tc.name}" repeated ${guardNudge.repeatCount}× with identical arguments.`,
              ),
            );
            this.sessionManager.logEvent("loop_guard_nudge", {
              toolName: tc.name,
              reason: guardNudge.reason,
              repeatCount: guardNudge.repeatCount,
            });
          }

          toolResultBlocks.push({
            type: "tool_result",
            toolResult: {
              toolCallId: tc.id,
              name: tc.name,
              content:
                modelVisibleToolResult +
                (guardNudge ? `\n\n${guardNudge.message}` : ""),
              isError: !finalResult.ok,
            },
          });
        }

        const toolMsg: OrbitMessage = {
          id: `msg_tool_${Date.now()}`,
          role: "tool",
          createdAt: new Date().toISOString(),
          content: toolResultBlocks,
        };
        this.state.history.push(toolMsg);
        if (terminalSuccessReachedThisBatch) {
          this.state.history.push({
            id: `msg_terminal_completion_${Date.now()}`,
            role: "user",
            createdAt: new Date().toISOString(),
            content: [
              {
                type: "text",
                text: [
                  "Orbit terminal completion contract: the trusted project finalizer succeeded.",
                  "Do not call or describe any further tools, edits, probes, builds, or verification.",
                  "Return only the concise final delivery report required by the active Skill, using the verified artifacts already present.",
                ].join(" "),
              },
            ],
            metadata: {
              kind: "terminal_completion",
              terminalSuccess: terminalSuccessReachedThisBatch,
            },
          });
        }
        this.abortController = null;
        this.sessionManager.saveHistory(this.state.history);
      }

      if (
        this.state.attemptCount >= this.state.maxAttempts &&
        !this.state.done
      ) {
        iterationLimitReached = true;
        this.interaction.showText(
          `\n⚠️ Paused: Maximum consecutive loop iterations (${this.state.maxAttempts}) completed. Resume this session to continue; completed tool results and verification evidence were preserved.`,
        );
      }

      const sessions = this.sessionManager
        .getSessionStore()
        .getEvents(this.state.sessionId);
      const modifiedFiles = Array.from(
        new Set(
          sessions
            .filter((e) => e.type === "file_modified")
            .flatMap((e) =>
              typeof e.payload === "object" &&
              e.payload !== null &&
              "path" in e.payload &&
              typeof e.payload.path === "string"
                ? [e.payload.path]
                : [],
            ),
        ),
      );

      this.interaction.showText(`\n● Summary:`);
      this.interaction.showText(
        `  Modified files: ${modifiedFiles.length > 0 ? modifiedFiles.join(", ") : "None"}`,
      );
      const verificationSummary = this.verificationSummary();
      this.interaction.showText(
        `  Verification contract: ${verificationSummary}.`,
      );
      this.interaction.showText(`  Session Cost: ${this.formatSessionCost()}`);

      if (
        !this.terminalFailure &&
        !iterationLimitReached &&
        this.config.autoCommit &&
        modifiedFiles.length > 0
      ) {
        this.interaction.showText(`\n● Auto-committing changes...`);
        try {
          const preparedCommit = prepareIsolatedGitCommit(
            this.cwd,
            modifiedFiles,
            this.buildChildProcessEnvironment(),
          );
          try {
            const diff = preparedCommit.diff;
            if (diff) {
              this.interaction.showText(
                "● Generating commit message via LLM...",
              );
              const fastModel =
                this.config.models.fast || this.config.models.default;
              const stream = this.provider.chat({
                model: fastModel,
                messages: [
                  {
                    id: `msg_auto_commit_${Date.now()}`,
                    role: "user",
                    createdAt: new Date().toISOString(),
                    content: [
                      {
                        type: "text",
                        text: `Generate a concise, high-quality conventional git commit message (e.g. feat(cli): add autocomplete) from the following change summary. Output ONLY the commit message, no formatting, no markdown, no quotes, just the text:\n\n${buildCommitContextForModel(diff)}`,
                      },
                    ],
                  },
                ],
                tools: [],
              });

              let generatedMessage = "";
              for await (const event of stream) {
                if (event.type === "text_delta") {
                  generatedMessage += event.text;
                }
              }
              const finalMsg =
                generatedMessage.trim().replace(/^["']|["']$/g, "") ||
                "chore: auto-commit";

              this.interaction.showText(
                `● Committing: "${picocolors.green(finalMsg)}"`,
              );
              preparedCommit.commit(finalMsg);
              this.interaction.showText(
                `${picocolors.green("✔")} Auto-commit created successfully without consuming user-staged changes.`,
              );
            } else {
              this.interaction.showText(
                "● No Orbit-owned changes to commit. Skipping auto-commit.",
              );
            }
          } finally {
            preparedCommit.dispose();
          }
        } catch (commitError: unknown) {
          this.interaction.showText(
            picocolors.red(
              `✖ Auto-commit failed: ${safeAgentLoopErrorMessage(commitError)}`,
            ),
          );
        }
      }
      this.sessionManager.saveHistory(this.state.history);
    } finally {
      process.removeListener("SIGINT", sigintListener);
      process.removeListener("exit", exitListener);
    }

    if (this.terminalFailure) {
      return this.createFailedOutcome(
        this.terminalFailure.code,
        this.terminalFailure.message,
      );
    }

    if (iterationLimitReached) {
      return this.createAbortedOutcome(
        "iteration_limit",
        `Paused after ${this.state.maxAttempts} consecutive loop iterations. Resume the session to continue.`,
      );
    }

    return {
      status: "completed",
      sessionId: this.state.sessionId,
      attempts: this.state.attemptCount,
      receipt: this.createRunReceipt(),
    };
  }

  private createFailedOutcome(
    code: AgentLoopFailureCode,
    message: string,
  ): AgentLoopRunOutcome {
    return {
      status: "failed",
      sessionId: this.state.sessionId,
      attempts: this.state.attemptCount,
      error: { code, message: safeAgentLoopErrorMessage(message) },
      receipt: this.createRunReceipt(),
    };
  }

  private finalizeOutcome(outcome: AgentLoopRunOutcome): void {
    try {
      const iterationPause =
        outcome.status === "aborted" && outcome.reason === "iteration_limit";
      this.sessionManager.setRunState(
        outcome.status,
        outcome.status === "completed"
          ? "finished"
          : iterationPause
            ? "paused"
            : "terminated",
        { attempt: this.state.attemptCount },
      );
      this.sessionManager.setStatus(
        outcome.status === "completed"
          ? "completed"
          : outcome.status === "aborted"
            ? "aborted"
            : "failed",
      );
    } catch (error: unknown) {
      this.interaction.showText(
        picocolors.yellow(
          `⚠️ Unable to persist final session status: ${safeAgentLoopErrorMessage(error)}`,
        ),
      );
    }

    eventBus.emitEvent("agent_completed", {
      taskId: this.state.sessionId,
      success: outcome.status === "completed",
      status: outcome.status,
      result: outcome,
      error:
        outcome.status === "failed"
          ? outcome.error.message
          : outcome.status === "aborted"
            ? outcome.message
            : undefined,
    });
  }

  private createAbortedOutcome(
    reason: AgentLoopAbortReason,
    message: string,
  ): AgentLoopRunOutcome {
    return {
      status: "aborted",
      sessionId: this.state.sessionId,
      attempts: this.state.attemptCount,
      reason,
      message,
      receipt: this.createRunReceipt(),
    };
  }

  private createRunReceipt(): AgentRunReceipt {
    const modifiedFiles = Array.from(
      new Set(
        this.sessionManager
          .getSessionStore()
          .getEvents(this.state.sessionId)
          .filter((event) => event.type === "file_modified")
          .flatMap((event) => {
            const payload = event.payload;
            return typeof payload === "object" &&
              payload !== null &&
              "path" in payload &&
              typeof payload.path === "string"
              ? [payload.path]
              : [];
          }),
      ),
    );
    const taskPlan = this.sessionManager.getTaskPlan();
    const plan = taskPlan
      ? {
          total: taskPlan.items.length,
          completed: taskPlan.items.filter(
            (item) => item.status === "completed",
          ).length,
          inProgress: taskPlan.items.filter(
            (item) => item.status === "in_progress",
          ).length,
          pending: taskPlan.items.filter((item) => item.status === "pending")
            .length,
        }
      : undefined;
    const verification = this.verificationSummary();
    return {
      modifiedFiles,
      verification: verification === "not run" ? "not_run" : verification,
      usage: {
        inputTokens: this.totalInputTokens,
        outputTokens: this.totalOutputTokens,
        cacheReadTokens: this.totalCacheReadTokens,
      },
      cost: {
        known: this.sessionCostKnown,
        usd: this.sessionCostKnown ? Number(this.sessionCost.toFixed(6)) : null,
      },
      ...(plan ? { plan } : {}),
    };
  }

  private isImmediateAbortRequested(): boolean {
    return this.interruptMode === "abort";
  }

  private persistAbortedAssistantMessage(
    model: string,
    responseText: string,
    thinkingText: string,
    thinkingSignature: string,
  ): void {
    if (!responseText && !thinkingText) return;

    const content: OrbitContentBlock[] = [];
    if (thinkingText) {
      content.push({
        type: "thinking",
        text: thinkingText,
        ...(thinkingSignature ? { signature: thinkingSignature } : {}),
      });
    }
    if (responseText) {
      content.push({ type: "text", text: responseText });
    }

    this.state.history.push({
      id: `msg_asst_aborted_${Date.now()}`,
      role: "assistant",
      createdAt: new Date().toISOString(),
      content,
      metadata: {
        model,
        aborted: true,
        incomplete: true,
      },
    });
    this.sessionManager.saveHistory(this.state.history);
  }

  private addRelevantFile(path: string, reason: string) {
    if (!this.state.relevantFiles.some((f) => f.path === path)) {
      this.state.relevantFiles.push({ path, reason });
    }
  }

  private async runHook(
    hookCommand: string,
    filePath: string,
  ): Promise<{ ok: boolean; output: string }> {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.cwd, filePath);
    const relativePath = path.relative(this.cwd, absolutePath);
    if (hookCommand.includes("{file}")) {
      return {
        ok: false,
        output:
          'Unsafe hook placeholder "{file}" is no longer supported. Read the ORBIT_FILE environment variable instead.',
      };
    }

    return this.runHookCommand(
      hookCommand,
      { ORBIT_FILE: relativePath },
      this.config.tools.bash.timeoutMs,
    );
  }

  private async runLifecycleHooks(
    event: LifecycleHookEvent,
    context: LifecycleHookContext,
  ): Promise<{ ok: boolean; output?: string }> {
    const hooks = this.options.profileHooks
      ? {
          ...this.config.hooks,
          lifecycle: mergeLifecycleHooks(
            this.options.profileHooks,
            this.config.hooks.lifecycle,
          ),
        }
      : this.config.hooks;
    return executeLifecycleHooks({
      hooks,
      event,
      context,
      execute: (hook, environment) =>
        hook.legacy
          ? this.runHook(hook.command, context.filePath || "")
          : this.runHookCommand(
              hook.command,
              environment,
              hook.timeoutMs,
              event !== "stop" && event !== "subagentStop",
              hook.extension,
            ),
      report: (message) => this.interaction.showText(message),
    });
  }

  private async runHookCommand(
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
    const decision = this.permissionEngine.evaluate(
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
      const approved = await this.interaction.askApproval(
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
              ORBIT_WORKSPACE_ROOT: this.cwd,
            },
          })
        : this.buildChildProcessEnvironment(environment, true);
      const shell = resolveCommandShellInvocation(hookCommand, {
        environment: childEnvironment,
      });
      const sandboxed = sandboxInvocation(shell, {
        cwd: extension?.root ?? this.cwd,
        mode: extension ? "required" : this.config.tools.bash.sandbox,
        network: extension ? "deny" : this.config.tools.bash.network,
        environment: childEnvironment,
        trustRoots: this.config.security.windowsSandboxTrustRoots,
        ...(extension
          ? {
              readOnlyRoots: [extension.root],
              writableRoots: [],
            }
          : {}),
      });
      const { stdout, stderr } = await execFilePromise(
        sandboxed.file,
        sandboxed.args,
        {
          ...HIDDEN_CHILD_PROCESS_OPTIONS,
          cwd: extension?.root ?? this.cwd,
          env: childEnvironment,
          timeout: Math.min(timeoutMs, this.config.tools.bash.timeoutMs),
          signal: abortable ? this.abortController?.signal : undefined,
          maxBuffer: 1024 * 1024,
        },
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
      return { ok: false, output };
    }
  }

  public getSessionId(): string {
    return this.state.sessionId;
  }

  public getGoal(): string | undefined {
    return this.sessionManager.getActiveSession()?.goal;
  }

  public setGoal(goal?: string): void {
    this.sessionManager.setGoal(goal);
    this.cachedContextPack = null;
  }

  public getProjectMemory(): ProjectMemory {
    return this.projectMemoryStore.read();
  }

  public addProjectMemory(text: string): ProjectMemoryEntry {
    const entry = this.projectMemoryStore.add(text);
    this.cachedContextPack = null;
    return entry;
  }

  public removeProjectMemory(id: string): boolean {
    const removed = this.projectMemoryStore.remove(id);
    if (removed) this.cachedContextPack = null;
    return removed;
  }

  public clearProjectMemory(): void {
    this.projectMemoryStore.clear();
    this.cachedContextPack = null;
  }

  public setProjectMemoryEnabled(enabled: boolean): ProjectMemory {
    const memory = this.projectMemoryStore.setEnabled(enabled);
    this.cachedContextPack = null;
    return memory;
  }

  public getTaskPlan(): TaskPlan | undefined {
    return this.sessionManager.getTaskPlan();
  }

  public addTaskPlanItem(text: string): TaskPlan | undefined {
    const now = new Date().toISOString();
    const plan = this.sessionManager.getTaskPlan();
    const item: TaskPlanItem = {
      id: `step_${randomUUID()}`,
      text: text.trim(),
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
    const saved = this.sessionManager.saveTaskPlan(
      [...(plan?.items || []), item],
      plan?.goal,
    );
    this.cachedContextPack = null;
    return saved;
  }

  public updateTaskPlanItem(
    id: string,
    status: TaskPlanItem["status"],
  ): TaskPlan | undefined {
    const plan = this.sessionManager.getTaskPlan();
    if (!plan || !plan.items.some((item) => item.id === id)) return undefined;
    const now = new Date().toISOString();
    const items = plan.items.map((item) => ({
      ...item,
      status:
        status === "in_progress" && item.id !== id
          ? item.status === "in_progress"
            ? ("pending" as const)
            : item.status
          : item.id === id
            ? status
            : item.status,
      updatedAt: item.id === id ? now : item.updatedAt,
    }));
    const saved = this.sessionManager.saveTaskPlan(items, plan.goal);
    this.cachedContextPack = null;
    return saved;
  }

  public removeTaskPlanItem(id: string): boolean {
    const plan = this.sessionManager.getTaskPlan();
    if (!plan || !plan.items.some((item) => item.id === id)) return false;
    this.sessionManager.saveTaskPlan(
      plan.items.filter((item) => item.id !== id),
      plan.goal,
    );
    this.cachedContextPack = null;
    return true;
  }

  public clearTaskPlan(): void {
    const plan = this.sessionManager.getTaskPlan();
    this.sessionManager.saveTaskPlan([], plan?.goal);
    this.cachedContextPack = null;
  }

  public getSessionMetrics(): SessionMetrics | undefined {
    return this.sessionManager.getMetrics();
  }

  /** Lightweight task lifecycle state for local user interfaces. */
  public getBackgroundTasks() {
    return this.backgroundTasks.listWorkspaceTaskSummaries();
  }

  /** Queue user intent in the active session so every UI observes one ordering. */
  public enqueueUserInput(
    text: string,
    options: {
      mode: QueuedAgentInput["mode"];
      source: QueuedAgentInput["source"];
      attachments?: Extract<OrbitContentBlock, { type: "image" }>[];
    },
  ): QueuedAgentInput {
    return this.inputQueue.enqueue(text, options);
  }

  /** Return the durable queue in server-authoritative execution order. */
  public getQueuedInputs(): QueuedAgentInput[] {
    return this.inputQueue.list();
  }

  public removeQueuedInput(id: string): boolean {
    return this.inputQueue.remove(id);
  }

  public updateQueuedInput(
    id: string,
    patch: { text?: string; mode?: QueuedAgentInput["mode"] },
  ): QueuedAgentInput | undefined {
    return this.inputQueue.update(id, patch);
  }

  public moveQueuedInput(id: string, direction: "up" | "down"): boolean {
    return this.inputQueue.move(id, direction);
  }

  public clearQueuedInputs(): number {
    return this.inputQueue.clear();
  }

  /** Take the next queued item for a new outer turn after the current run. */
  public takeNextQueuedInput(): QueuedAgentInput | undefined {
    return this.inputQueue.takeNext();
  }

  /** Prepare a dequeued item while retaining its queue provenance in history. */
  public prepareQueuedUserTurn(input: QueuedAgentInput): void {
    if (input.sessionId !== this.state.sessionId) {
      throw new Error("Queued input belongs to a different Orbit session.");
    }
    this.prepareUserTurn(input.text, input.attachments);
    const message = this.state.history.at(-1);
    if (message?.role === "user") {
      message.metadata = {
        ...message.metadata,
        kind: "queued_follow_up",
        queueId: input.id,
        queuedMode: input.mode,
        source: input.source,
      };
      this.sessionManager.saveHistory(this.state.history);
    }
  }

  public getToolTimeline() {
    return this.sessionManager.getToolCalls();
  }

  public getRecoveryReport() {
    return this.sessionManager.getRecoveryReport();
  }

  public setSessionTitle(title: string): void {
    this.sessionManager.setTitle(title);
  }

  public getHistory(): OrbitMessage[] {
    return this.state.history;
  }

  public getRelevantFiles(): Array<{ path: string; reason: string }> {
    return this.state.relevantFiles;
  }

  public prepareUserTurn(
    task: string,
    attachments: Extract<OrbitContentBlock, { type: "image" }>[] = [],
  ): void {
    this.state.task = task;
    this.state.done = false;
    this.state.attemptCount = 0;
    this.state.maxAttempts = resolveAgentMaxLoopAttempts(this.config);
    this.finalResponseOnlyReason = null;
    this.progressGuard.reset();
    this.state.history.push({
      id: `msg_user_${Date.now()}`,
      role: "user",
      createdAt: new Date().toISOString(),
      content: [{ type: "text", text: task }, ...attachments],
    });
    // Persist the accepted user turn before any provider or tool work starts.
    // A crash in the narrow gap before run() can then resume the exact prompt.
    this.sessionManager.saveHistory(this.state.history);
  }

  private pendingTerminalCompletionReason(): string | null {
    const lastMessage = this.state.history.at(-1);
    return lastMessage?.role === "user" &&
      lastMessage.metadata?.kind === "terminal_completion" &&
      lastMessage.metadata?.terminalSuccess === "cumcm-finalizer"
      ? "cumcm-finalizer"
      : null;
  }

  /** Apply all pending steering inputs at a provider-safe conversation boundary. */
  private applyPendingSteeringInputs(): boolean {
    const inputs = this.inputQueue.drainSteering();
    if (inputs.length === 0) return false;

    // A fresh user instruction outranks an earlier workflow terminal marker.
    // The Skill must re-finalize if the newly requested work changes artifacts.
    this.finalResponseOnlyReason = null;

    for (const input of inputs) {
      this.state.history.push({
        id: `msg_user_steer_${randomUUID().replace(/-/g, "")}`,
        role: "user",
        createdAt: new Date().toISOString(),
        content: [{ type: "text", text: input.text }, ...input.attachments],
        metadata: {
          kind: "mid_turn_interjection",
          queueId: input.id,
          source: input.source,
        },
      });
    }
    this.state.task = inputs.at(-1)?.text || this.state.task;
    this.state.done = false;
    this.cachedContextPack = null;
    this.sessionManager.saveHistory(this.state.history);
    this.interaction.showText(
      inputs.length === 1
        ? "● Steering instruction accepted; applying it at the next safe step."
        : `● ${inputs.length} steering instructions accepted; applying them in order at the next safe step.`,
    );
    return true;
  }

  public addRelevantFilePublic(path: string, reason: string) {
    this.addRelevantFile(path, reason);
  }

  public addReadOnlyFilePublic(path: string, reason: string) {
    if (!this.state.relevantFiles.some((f) => f.path === path)) {
      this.state.relevantFiles.push({ path, reason, readOnly: true });
    }
    this.cachedContextPack = null;
  }

  public removeRelevantFilePublic(path: string) {
    this.state.relevantFiles = this.state.relevantFiles.filter(
      (f) => f.path !== path,
    );
    this.cachedContextPack = null;
  }

  public clearRelevantFilesPublic() {
    this.state.relevantFiles = [];
    this.cachedContextPack = null;
  }

  public clearHistoryPublic() {
    this.state.history = [];
    this.sessionManager.saveHistory([]);
  }

  public resumeSession(sessionId: string): boolean {
    const session = this.sessionManager.resumeSession(sessionId);
    if (!session) return false;

    this.state = createInitialState(
      sessionId,
      "REPL Interactive Shell Started",
      resolveAgentMaxLoopAttempts(this.config),
    );
    const savedHistory = this.sessionManager.getHistory();
    if (savedHistory && savedHistory.length > 0) {
      this.state.history = savedHistory;
      const lastUser = [...savedHistory]
        .reverse()
        .find(
          (message) =>
            message.role === "user" &&
            message.metadata?.kind !== VOLATILE_CONTEXT_MESSAGE_KIND &&
            message.metadata?.kind !== "history_compaction_summary",
        );
      if (lastUser) {
        const userText = lastUser.content
          .map((content) => (content.type === "text" ? content.text : ""))
          .join("");
        this.state.task = userText;
      }
    }

    this.rebindSessionRuntime(sessionId);
    this.sessionCost = session.totalCostEstimate || 0;
    this.totalInputTokens = session.totalInputTokens || 0;
    this.totalCacheReadTokens = session.totalCacheReadTokens || 0;
    this.totalOutputTokens = session.totalOutputTokens || 0;
    this.sessionCostKnown = session.costEstimateKnown !== false;
    this.unknownPricingModels.clear();
    return true;
  }

  public startNewSession(providerId: string, model: string): string {
    const session = this.sessionManager.startNewSession(providerId, model);
    this.state = createInitialState(
      session.id,
      "REPL Interactive Shell Started",
      resolveAgentMaxLoopAttempts(this.config),
    );
    this.rebindSessionRuntime(session.id);
    this.sessionCost = 0;
    this.sessionCostKnown = true;
    this.unknownPricingModels.clear();
    this.totalInputTokens = 0;
    this.totalCacheReadTokens = 0;
    this.totalOutputTokens = 0;
    this.sessionManager.saveHistory(this.state.history);
    return session.id;
  }

  /** Atomically move every session-bound service to one durable session. */
  private rebindSessionRuntime(sessionId: string): void {
    this.checkpointManager = createSessionCheckpointManager(
      this.cwd,
      sessionId,
      this.config,
      this.options.checkpointKeyProvider,
    );
    this.stepRunner = new StepRunner(
      this.cwd,
      sessionId,
      this.config,
      this.toolRuntimeServices,
      this.toolRegistry,
    );
    this.verificationManager = new VerificationContractManager(
      this.cwd,
      sessionId,
      this.checkpointManager,
      this.config.security?.trustProjectExecutables ?? false,
      this.config.tools.bash.timeoutMs,
    );
    this.cachedContextPack = null;
    this.cachedRepoMapTextForRun = null;
    this.sessionReviewCache = undefined;
    this.reportedSkillActivations = "";
    this.reportedSkillErrors = "";
  }

  /** Reap every process owned by this workspace runtime. */
  public async dispose(): Promise<void> {
    await this.contextBuilder.settleBackgroundWork().catch(() => undefined);
    await this.backgroundTasks.dispose();
    await this.mcpInitialization?.catch(() => undefined);
    await this.mcpRuntimeManager.stop();
    this.mcpStartResult = null;
    this.mcpInitialization = null;
  }

  public getSessions(): Session[] {
    return this.sessionManager.getSessionStore().listSessions();
  }

  public deleteSession(sessionId: string): void {
    this.backgroundTasks.cancelSession(sessionId);
    this.sessionManager.getSessionStore().deleteSession(sessionId);
  }

  public setSessionArchived(sessionId: string, archived: boolean): boolean {
    const store = this.sessionManager.getSessionStore();
    const session = store.getSession(sessionId);
    if (!session) return false;
    store.updateSession({
      ...session,
      archivedAt: archived ? new Date().toISOString() : undefined,
    });
    return true;
  }

  public getSessionCost(): number {
    return this.sessionCost;
  }

  public isSessionCostKnown(): boolean {
    return this.sessionCostKnown;
  }

  public getTotalInputTokens(): number {
    return this.totalInputTokens;
  }

  public getTotalCacheReadTokens(): number {
    return this.totalCacheReadTokens;
  }

  public getTotalOutputTokens(): number {
    return this.totalOutputTokens;
  }

  public getConfig(): OrbitConfig {
    return this.config;
  }

  public getProvider(): ModelProvider {
    return this.provider;
  }

  /** Replace the provider used by subsequent turns while preserving history. */
  public setProvider(provider: ModelProvider): void {
    const violation = validateManagedRuntimeChange(this.config, {
      provider: provider.id,
    });
    if (violation) throw new Error(violation);
    this.provider = provider;
    this.activeModelForRun = null;
    this.fallbackModelForRun = null;
    this.cachedContextPack = null;
    this.sessionManager.setRuntime(
      provider.id,
      this.options?.modelOverride || this.config.models.default,
    );
  }

  public setModelOverride(model: string): void {
    const violation = validateManagedRuntimeChange(this.config, { model });
    if (violation) throw new Error(violation);
    if (!this.options) {
      this.options = {};
    }
    this.options.modelOverride = model;
    this.activeModelForRun = null;
    this.fallbackModelForRun = null;
    this.cachedContextPack = null;
    this.sessionManager.setRuntime(this.provider.id, model);
  }

  /**
   * Apply a validated Agent Profile to subsequent turns in this durable loop.
   * The command router serializes settings changes with active turns, so this
   * method deliberately refuses mutation while a model/tool step is running.
   */
  public async setAgentProfile(
    profile: AgentProfile | undefined,
  ): Promise<void> {
    if (this.abortController) {
      throw new Error("Agent Profile changes require an idle Agent loop.");
    }
    const nextOptions = { ...this.options };
    const previousMcpServers = this.options.mcpServers;
    if (profile?.model) nextOptions.modelOverride = profile.model;
    else delete nextOptions.modelOverride;
    if (profile?.effort) nextOptions.thinkingEffort = profile.effort;
    else delete nextOptions.thinkingEffort;
    if (profile?.allowedTools)
      nextOptions.allowedTools = [...profile.allowedTools];
    else delete nextOptions.allowedTools;
    nextOptions.disallowedTools = [...(profile?.disallowedTools ?? [])];
    nextOptions.forcedSkills = [...(profile?.skills ?? [])];
    nextOptions.memoryMode = profile?.memory ?? "project";
    nextOptions.profileHooks = profile?.hooks;
    nextOptions.mcpServers = profile?.mcpServers
      ? [...profile.mcpServers]
      : undefined;
    if (profile?.systemPrompt)
      nextOptions.systemPromptOverride = profile.systemPrompt;
    else delete nextOptions.systemPromptOverride;
    this.options = nextOptions;
    if (
      JSON.stringify(previousMcpServers ?? null) !==
      JSON.stringify(nextOptions.mcpServers ?? null)
    ) {
      await this.mcpInitialization?.catch(() => undefined);
      await this.mcpRuntimeManager.stop();
      this.mcpStartResult = null;
      this.mcpInitialization = null;
    }
    this.activeModelForRun = null;
    this.fallbackModelForRun = null;
    this.cachedContextPack = null;
    this.sessionManager.setRuntime(
      this.provider.id,
      this.options.modelOverride || this.config.models.default,
    );
  }

  /** Return the currently applied profile-shaped runtime controls. */
  public getAgentProfileRuntime(): Pick<
    AgentLoopOptions,
    | "modelOverride"
    | "thinkingEffort"
    | "allowedTools"
    | "disallowedTools"
    | "forcedSkills"
    | "memoryMode"
    | "systemPromptOverride"
  > {
    return {
      modelOverride: this.options.modelOverride,
      thinkingEffort: this.options.thinkingEffort,
      allowedTools: this.options.allowedTools,
      disallowedTools: this.options.disallowedTools,
      forcedSkills: this.options.forcedSkills,
      memoryMode: this.options.memoryMode,
      systemPromptOverride: this.options.systemPromptOverride,
    };
  }

  public getModelOverride(): string | undefined {
    return this.options?.modelOverride;
  }

  /** Return model selection to Orbit's explainable fast/quality routing. */
  public clearModelOverride(): void {
    if (this.options) delete this.options.modelOverride;
    this.activeModelForRun = null;
    this.fallbackModelForRun = null;
    this.cachedContextPack = null;
    this.sessionManager.setRuntime(
      this.provider.id,
      this.config.models.default,
    );
  }

  public async rollbackLastCheckpoint(): Promise<void> {
    const checkpoints = this.checkpointManager.getCheckpoints();
    if (checkpoints.length === 0) {
      this.interaction.showText("No file checkpoints found to rollback.");
      return;
    }
    const last = checkpoints[checkpoints.length - 1];
    this.interaction.showText(
      `Rolling back last changes for tool call ${last.toolCallId}...`,
    );
    const res = this.rollbackManager.rollback(last);
    if (res.success) {
      this.checkpointManager.removeCheckpoint(last.id);
      this.interaction.showText(
        `Successfully rolled back: ${res.restored.join(", ")}`,
      );
    } else {
      this.interaction.showText(`Rollback failed: ${res.error}`);
    }
  }

  public getCheckpoints(): Array<{
    id: string;
    timestamp: string;
    toolCallId: string;
    files: string[];
  }> {
    return this.checkpointManager.getCheckpoints().map((checkpoint) => ({
      id: checkpoint.id,
      timestamp: checkpoint.timestamp,
      toolCallId: checkpoint.toolCallId,
      files: checkpoint.backups.map((backup) => backup.path),
    }));
  }

  /** Return a browser-safe review snapshot backed by the persisted audit log. */
  public getSessionReview(): SessionReviewSnapshot {
    if (
      this.sessionReviewCache &&
      this.sessionReviewCache.expiresAt > Date.now()
    ) {
      return this.sessionReviewCache.value;
    }
    const trace = this.sessionManager
      .getSessionStore()
      .exportTrace(this.getSessionId());
    const value: SessionReviewSnapshot = {
      fileChanges: trace.fileChanges,
      toolCalls: trace.toolCalls,
      checkpoints: this.getCheckpoints(),
      verification: trace.events
        .filter((event) => event.type === "verification_ended")
        .slice(-20)
        .map((event) => {
          const payload =
            typeof event.payload === "object" && event.payload !== null
              ? (event.payload as Record<string, unknown>)
              : {};
          return {
            timestamp: event.createdAt,
            success:
              typeof payload.success === "boolean"
                ? payload.success
                : undefined,
            detail:
              typeof payload.summary === "string"
                ? payload.summary.slice(0, 2_000)
                : undefined,
          };
        }),
    };
    this.sessionReviewCache = { expiresAt: Date.now() + 2_000, value };
    return value;
  }

  /** Export the current session's stable, secret-redacted support trace. */
  public exportSessionTrace(includeHistory = true): SessionTraceBundle {
    return this.sessionManager
      .getSessionStore()
      .exportTrace(this.getSessionId(), { includeHistory });
  }

  public async rewindToCheckpoint(checkpointId: string): Promise<boolean> {
    this.sessionReviewCache = undefined;
    const checkpoints = this.checkpointManager.getCheckpoints();
    const targetIndex = checkpoints.findIndex(
      (checkpoint) => checkpoint.id === checkpointId,
    );
    if (targetIndex === -1) {
      this.interaction.showText(`Checkpoint not found: ${checkpointId}`);
      return false;
    }

    const checkpointsToRollback = checkpoints.slice(targetIndex).reverse();
    const restored = new Set<string>();
    const result = this.rollbackManager.rollbackMany(checkpointsToRollback);
    if (!result.success) {
      this.interaction.showText(
        `Rewind failed: ${result.error || "unknown error"}`,
      );
      return false;
    }
    for (const file of result.restored) restored.add(file);
    for (const checkpoint of checkpointsToRollback) {
      this.checkpointManager.removeCheckpoint(checkpoint.id);
    }
    this.interaction.showText(
      `Rewound ${checkpointsToRollback.length} checkpoint(s): ${Array.from(restored).join(", ")}`,
    );
    return true;
  }

  public rollbackFileToCheckpoint(filePath: string): boolean {
    const result = this.rollbackFilesToCheckpoints([filePath]);
    return result.success && result.restored.length === 1;
  }

  /** Restore the latest available backup for each path as one transaction. */
  public rollbackFilesToCheckpoints(filePaths: string[]): {
    success: boolean;
    restored: string[];
    unresolved: string[];
    error?: string;
  } {
    this.sessionReviewCache = undefined;
    const checkpoints = this.checkpointManager.getCheckpoints().reverse();
    const selected: Array<{
      requestedPath: string;
      checkpoint: (typeof checkpoints)[number];
      backup: (typeof checkpoints)[number]["backups"][number];
    }> = [];
    const unresolved: string[] = [];
    for (const requestedPath of [...new Set(filePaths)]) {
      let targetAbs: string;
      try {
        targetAbs = resolveSafePath(this.cwd, requestedPath);
      } catch {
        unresolved.push(requestedPath);
        continue;
      }
      let match: (typeof selected)[number] | undefined;
      for (const checkpoint of checkpoints) {
        const backup = checkpoint.backups.find((candidate) => {
          try {
            return resolveSafePath(this.cwd, candidate.path) === targetAbs;
          } catch {
            return false;
          }
        });
        if (backup) {
          match = { requestedPath, checkpoint, backup };
          break;
        }
      }
      if (match) selected.push(match);
      else unresolved.push(requestedPath);
    }

    const result = this.rollbackManager.rollbackMany(
      selected.map(({ checkpoint, backup }) => ({
        ...checkpoint,
        backups: [backup],
      })),
    );
    if (!result.success) {
      return {
        success: false,
        restored: [],
        unresolved,
        error: result.error,
      };
    }
    return {
      success: true,
      restored: selected.map(({ requestedPath }) => requestedPath),
      unresolved,
    };
  }

  private accumulateCost(model: string, usage: TokenUsage): void {
    const pricing = this.resolvePricing(model);
    const uncachedInputTokens = usage.cacheReadTokens
      ? Math.max(0, usage.inputTokens - usage.cacheReadTokens)
      : usage.inputTokens;

    const inputCost = pricing
      ? (uncachedInputTokens / 1000000) * pricing.inputCostPer1M
      : 0;
    const outputCost = pricing
      ? (usage.outputTokens / 1000000) * pricing.outputCostPer1M
      : 0;
    const cacheReadCost =
      usage.cacheReadTokens && pricing?.cacheReadCostPer1M
        ? (usage.cacheReadTokens / 1000000) * pricing.cacheReadCostPer1M
        : 0;

    this.totalInputTokens += usage.inputTokens || 0;
    this.totalOutputTokens += usage.outputTokens || 0;
    this.totalCacheReadTokens += usage.cacheReadTokens || 0;

    const turnCost = inputCost + outputCost + cacheReadCost;
    if (pricing) this.sessionCost += turnCost;
    else this.noteUnknownPricing(model);

    const session = this.sessionManager.getActiveSession();
    if (session) {
      session.totalInputTokens = this.totalInputTokens;
      session.totalOutputTokens = this.totalOutputTokens;
      session.totalCacheReadTokens = this.totalCacheReadTokens;
      session.totalCostEstimate = this.sessionCostKnown
        ? this.sessionCost
        : session.totalCostEstimate;
      session.costEstimateKnown = this.sessionCostKnown;
      this.sessionManager.getSessionStore().updateSession(session);
    }

    eventBus.emitEvent("cost_update", {
      turnCost,
      sessionCost: this.sessionCost,
      costKnown: this.sessionCostKnown,
      totalInputTokens: this.totalInputTokens,
      totalCacheReadTokens: this.totalCacheReadTokens,
      totalOutputTokens: this.totalOutputTokens,
    });
  }

  /**
   * Cache-aware two-phase history compaction.
   *
   * Phase 1 (cache-friendly, triggers near the model input budget):
   *   Truncates bulky tool_result and tool-role text content in older messages.
   *   Preserves the message structure so the DeepSeek prompt prefix cache stays valid.
   *
   * Phase 2 (aggressive, used near the context limit or by `/compact`):
   *   Drops the oldest messages entirely to prevent context window overflow.
   *   This breaks the prefix cache but is necessary as a safety valve.
   *   Only fires when Phase 1 alone isn't enough to keep history bounded.
   */
  private async compactHistory(
    mode: "manual" | "automatic",
    targetHistoryTokens?: number,
  ): Promise<HistoryCompactionResult> {
    const preCompactHooks = await this.runLifecycleHooks("preCompact", {
      sessionId: this.state.sessionId,
      attempt: this.state.attemptCount,
      mode,
    });
    if (!preCompactHooks.ok) {
      throw new Error(
        preCompactHooks.output || "A blocking pre-compaction hook failed.",
      );
    }
    const status = this.getContextWindowStatus();
    const { history, droppedHistory, summaryMessageId, ...result } =
      compactHistoryMessages(this.state.history, {
        mode,
        compactAtTokens: status.compactAtTokens,
        targetHistoryTokens,
      });
    if (result.changed) {
      // Upgrade the mechanical snippet summary to a fast-model semantic one
      // when turns were dropped; any failure keeps the mechanical fallback.
      if (droppedHistory?.length && summaryMessageId) {
        const semanticSummary = await buildSemanticCompactionSummary(
          droppedHistory,
          this.provider,
          this.config.models.fast,
          {
            abortSignal: this.abortController?.signal,
            onUsage: (usage) =>
              this.accumulateCost(this.config.models.fast, usage),
          },
        );
        const summaryBlock = semanticSummary
          ? history
              .find((message) => message.id === summaryMessageId)
              ?.content.find((block) => block.type === "text")
          : undefined;
        if (semanticSummary && summaryBlock?.type === "text") {
          summaryBlock.text = semanticSummary;
        }
      }
      this.state.history = history;
      this.sessionManager.saveHistory(this.state.history);
    }
    const finalResult = {
      ...this.getContextWindowStatus(),
      ...result,
    };
    const postCompactHooks = await this.runLifecycleHooks("postCompact", {
      sessionId: this.state.sessionId,
      attempt: this.state.attemptCount,
      mode,
      status: result.changed ? "changed" : "unchanged",
    });
    if (!postCompactHooks.ok) {
      throw new Error(
        postCompactHooks.output || "A blocking post-compaction hook failed.",
      );
    }
    return finalResult;
  }

  /** Compacts older dialogue on demand while preserving the active turn. */
  public async compactHistoryPublic(): Promise<HistoryCompactionResult> {
    return this.compactHistory("manual");
  }

  /** Reports the model-aware context budget used by automatic compaction. */
  public getContextWindowStatus(modelOverride?: string): ContextWindowStatus {
    const model =
      modelOverride ||
      this.activeModelForRun ||
      this.options?.modelOverride ||
      this.config.models.default;
    return resolveContextWindowStatus({
      model,
      config: this.config,
      provider: this.provider,
      history: this.state.history,
    });
  }

  private shouldCompactHistory(): boolean {
    const status = this.getContextWindowStatus();
    return status.estimatedHistoryTokens >= status.compactAtTokens;
  }

  private async compactOversizedRequest(
    model: string,
    system: string,
    messages: OrbitMessage[],
  ): Promise<HistoryCompactionResult | null> {
    const status = this.getContextWindowStatus(model);
    const systemTokens = estimateTokenCount(system);
    const requestTokens =
      systemTokens + estimateTokenCount(JSON.stringify(messages));
    if (requestTokens < status.compactAtTokens) return null;

    this.interaction.showText(
      `● Context usage reached ${requestTokens.toLocaleString()}/${status.maxContextTokens.toLocaleString()} estimated tokens for ${model}. Auto-compacting...`,
    );
    const historyTarget = Math.max(256, status.compactAtTokens - systemTokens);
    return this.compactHistory("automatic", historyTarget);
  }

  private showAutomaticCompactionResult(result: HistoryCompactionResult): void {
    if (!result.changed) return;
    this.interaction.showText(
      `✔ Context compacted for ${result.model}: ${result.beforeTokens.toLocaleString()} → ${result.afterTokens.toLocaleString()} estimated tokens; truncated ${result.truncatedToolResults} tool outputs and ${result.truncatedContextMessages} context blocks, summarized ${result.droppedMessages} older messages.`,
    );
  }

  private async promptSchemaGuided(
    registeredTool: OrbitTool,
    currentArgsStr: string,
  ): Promise<string | null> {
    if (this.options?.nonInteractive) return null;
    try {
      const schema = registeredTool.inputSchema;
      if (!(schema instanceof z.ZodObject)) {
        return null;
      }

      const currentArgs = toUnknownRecord(JSON.parse(currentArgsStr));
      const shape = schema.shape;
      const updatedArgs: Record<string, unknown> = {};

      for (const [key, fieldSchema] of Object.entries(shape)) {
        const val = currentArgs[key];
        const valStr =
          val !== undefined
            ? typeof val === "object"
              ? JSON.stringify(val)
              : String(val)
            : "";
        const typedFieldSchema = fieldSchema as z.ZodTypeAny;
        const description =
          typedFieldSchema.description || `Parameter "${key}"`;

        let result: unknown = null;
        let unwrapped: z.ZodTypeAny = typedFieldSchema;
        while (true) {
          if (
            unwrapped instanceof z.ZodOptional ||
            unwrapped instanceof z.ZodNullable
          ) {
            unwrapped = unwrapped.unwrap();
            continue;
          }
          if (unwrapped instanceof z.ZodEffects) {
            unwrapped = unwrapped.innerType();
            continue;
          }
          break;
        }

        if (unwrapped instanceof z.ZodBoolean) {
          const choice = await this.askSelect(`${description} (boolean):`, [
            { value: "true", label: "true" },
            { value: "false", label: "false" },
          ]);
          if (choice === null) return null;
          result = choice === "true";
        } else if (unwrapped instanceof z.ZodEnum) {
          const options = unwrapped.options.map((value: string) => ({
            value,
            label: value,
          }));
          const choice = await this.askSelect(
            `${description} (select):`,
            options,
          );
          if (choice === null) return null;
          result = choice;
        } else {
          const input = await this.askText(`${description} (${key}):`, valStr);
          if (input === null) return null;

          if (unwrapped instanceof z.ZodNumber) {
            const num = Number(input);
            result = isNaN(num) ? input : num;
          } else if (
            unwrapped instanceof z.ZodArray ||
            unwrapped instanceof z.ZodObject
          ) {
            try {
              result = JSON.parse(input);
            } catch {
              result = input;
            }
          } else {
            result = input;
          }
        }

        if (result !== undefined && result !== "") {
          updatedArgs[key] = result;
        }
      }

      return JSON.stringify(updatedArgs);
    } catch {
      return null;
    }
  }

  private async handleInterrupt(): Promise<
    "continue" | "abort" | "rollback_exit"
  > {
    this.interaction.progress?.stop();
    if (this.interruptMode === "abort") {
      this.interruptMode = "prompt";
      return "abort";
    }
    if (this.options?.nonInteractive) return "abort";
    this.interaction.showText(
      picocolors.yellow("\n● Execution interrupted by user."),
    );
    const choice = await this.askSelect("What would you like to do?", [
      { value: "continue", label: "Continue execution" },
      { value: "abort", label: "Abort execution and return to prompt" },
      { value: "rollback_exit", label: "Rollback changes and exit" },
    ]);
    return choice === "continue" ||
      choice === "abort" ||
      choice === "rollback_exit"
      ? choice
      : "abort";
  }

  private async isGitRepo(): Promise<boolean> {
    try {
      await execPromise("git rev-parse --is-inside-work-tree", {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        cwd: this.cwd,
        env: this.buildChildProcessEnvironment(),
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Keep every Agent-owned child process aligned with the active permission mode. */
  private buildChildProcessEnvironment(
    extra?: NodeJS.ProcessEnv,
    minimal = false,
  ): NodeJS.ProcessEnv {
    return isFullAccessEnabled(this.config)
      ? buildInheritedChildEnvironment({ extra })
      : buildSanitizedChildEnvironment({
          ...(minimal ? { mode: "minimal" as const } : {}),
          extra,
        });
  }

  private shouldShowDeepSeekCacheStatus(inputTokens = 0, hitRate = 1): boolean {
    const verbose = process.env[DEEPSEEK_VERBOSE_CACHE_ENV];
    if (verbose === "1" || verbose?.toLowerCase() === "true") {
      return true;
    }
    if (verbose === "0" || verbose?.toLowerCase() === "false") {
      return false;
    }
    return inputTokens >= 4096 && hitRate < 0.5;
  }

  private emitCacheTelemetry(
    slab: PromptCacheSlab,
    usage: {
      inputTokens?: number;
      cacheReadTokens?: number;
      cacheMissTokens?: number;
    },
  ): void {
    const inputTokens = usage.inputTokens || 0;
    const hitTokens = usage.cacheReadTokens || 0;
    const explicitMiss = usage.cacheMissTokens;
    const missTokens =
      explicitMiss !== undefined
        ? explicitMiss
        : Math.max(0, inputTokens - hitTokens);
    const hitRate = inputTokens > 0 ? hitTokens / inputTokens : 0;
    const degraded =
      PromptCacheSlabBuilder.hasTelemetry(slab) &&
      inputTokens >= Math.min(1024, Math.max(256, slab.tokenEstimate / 2)) &&
      hitRate < DEEPSEEK_CACHE_DEGRADED_HIT_RATE;

    eventBus.emitEvent("cache_update", {
      slabHash: slab.hash,
      slabTokenEstimate: slab.tokenEstimate,
      hitTokens,
      missTokens,
      inputTokens,
      hitRate,
      degraded,
    });

    PromptCacheSlabBuilder.recordTelemetry(slab, {
      inputTokens,
      hitTokens,
      missTokens,
      hitRate,
      degraded,
    });

    if (degraded) {
      if (this.shouldShowDeepSeekCacheStatus(inputTokens, hitRate)) {
        this.interaction.showText(
          picocolors.yellow(
            `⚠ Prompt cache hit degraded for slab ${slab.hash.slice(0, 8)}: ${(hitRate * 100).toFixed(0)}% hit (${hitTokens}/${inputTokens} tokens).`,
          ),
        );
      }
      // V4 persists natural request boundaries automatically. Avoid synthetic
      // repair calls here: they consume concurrency and compete with the next
      // visible agent turn, which is normally the best cache warmer itself.
    }
  }
}

/**
 * Build a commit-message context that contains file names and change counts,
 * not source lines. Commit-message generation is optional convenience work;
 * sending the full diff to a remote model can disclose secrets or proprietary
 * code even after best-effort token redaction.
 */
function buildCommitContextForModel(diff: string): string {
  const files = new Set<string>();
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/ b\/(.+)$/);
      if (match?.[1]) files.add(match[1]);
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      additions += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions += 1;
    }
  }
  const fileList = [...files].slice(0, 100);
  return redactSecrets(
    [
      `Files changed (${files.size}): ${fileList.join(", ") || "unknown"}`,
      `Line changes: +${additions} / -${deletions}.`,
      "Infer the scope from paths and counts only; do not invent implementation details.",
    ].join("\n"),
  ).slice(0, 8_000);
}

function toUnknownRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstStringValue(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncateInteractionText(value: string, maxChars: number): string {
  const clean = redactSecrets(String(value))
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .trim();
  return clean.length <= maxChars ? clean : `${clean.slice(0, maxChars - 1)}…`;
}

function boundedInteractionText(value: unknown, fallback: string): string {
  return truncateInteractionText(
    typeof value === "string" && value.trim() ? value : fallback,
    2_000,
  );
}

function enumOptions(definition: Record<string, unknown>): string[] {
  const values = Array.isArray(definition.enum)
    ? definition.enum
    : Array.isArray(definition.oneOf)
      ? definition.oneOf.flatMap((item) =>
          isRecord(item) && typeof item.const === "string" ? [item.const] : [],
        )
      : [];
  return values
    .filter((value): value is string => typeof value === "string")
    .slice(0, 50)
    .map((value) => truncateInteractionText(value, 200));
}

function primitiveDefault(value: unknown): string | undefined {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? String(value)
    : undefined;
}

function convertElicitationValue(
  value: string,
  type: unknown,
): string | number | boolean | undefined {
  if (type === "boolean") {
    if (/^(true|yes|y)$/i.test(value)) return true;
    if (/^(false|no|n)$/i.test(value)) return false;
    return undefined;
  }
  if (type === "number" || type === "integer") {
    const parsed = Number(value);
    if (
      !Number.isFinite(parsed) ||
      (type === "integer" && !Number.isInteger(parsed))
    )
      return undefined;
    return parsed;
  }
  return truncateInteractionText(value, 8_192);
}

export function selectProfileMcpServers(
  configured: OrbitConfig["mcpServers"],
  selected: string[] | undefined,
): OrbitConfig["mcpServers"] {
  if (!selected) return configured;
  const allowed = new Set(selected);
  return Object.fromEntries(
    Object.entries(configured).filter(([serverName]) =>
      allowed.has(serverName),
    ),
  );
}

export function mergeLifecycleHooks(
  profile: NonNullable<OrbitConfig["hooks"]["lifecycle"]>,
  global: OrbitConfig["hooks"]["lifecycle"],
): NonNullable<OrbitConfig["hooks"]["lifecycle"]> {
  const merged: NonNullable<OrbitConfig["hooks"]["lifecycle"]> = {};
  for (const event of ORBIT_LIFECYCLE_HOOK_EVENTS) {
    const profileHooks = profile[event] ?? [];
    const globalHooks = global?.[event] ?? [];
    if (profileHooks.length > 0 || globalHooks.length > 0) {
      merged[event] = [...profileHooks, ...globalHooks];
    }
  }
  return merged;
}

function parseMcpSamplingMessages(value: unknown): OrbitMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 32).flatMap((rawMessage, messageIndex) => {
    if (
      !isRecord(rawMessage) ||
      (rawMessage.role !== "user" && rawMessage.role !== "assistant")
    )
      return [];
    const rawContent = Array.isArray(rawMessage.content)
      ? rawMessage.content
      : [rawMessage.content];
    const content: OrbitContentBlock[] = rawContent
      .slice(0, 64)
      .flatMap<OrbitContentBlock>((rawBlock): OrbitContentBlock[] => {
        if (!isRecord(rawBlock)) return [];
        if (rawBlock.type === "text" && typeof rawBlock.text === "string") {
          return [
            {
              type: "text",
              text: truncateInteractionText(rawBlock.text, 64_000),
            },
          ];
        }
        if (
          rawBlock.type === "image" &&
          typeof rawBlock.data === "string" &&
          typeof rawBlock.mimeType === "string" &&
          /^image\/(png|jpeg|gif|webp)$/.test(rawBlock.mimeType)
        ) {
          return [
            {
              type: "image",
              mediaType: rawBlock.mimeType as
                | "image/png"
                | "image/jpeg"
                | "image/gif"
                | "image/webp",
              data: rawBlock.data.slice(0, 8 * 1024 * 1024),
            },
          ];
        }
        return [];
      });
    return content.length > 0
      ? [
          {
            id: randomUUID(),
            role: rawMessage.role,
            content,
            createdAt: new Date().toISOString(),
            metadata: { source: "mcp-sampling", messageIndex },
          },
        ]
      : [];
  });
}

export function extractFilePathFromLine(line: string): string {
  const winAbsMatch = line.match(/([a-zA-Z]:[\\/][^`*:"#\s]+)/);
  if (winAbsMatch) {
    return winAbsMatch[1];
  }

  const unixAbsMatch = line.match(/(?:^|\s)(\/[^`*:"#\s]+)/);
  if (unixAbsMatch) {
    return unixAbsMatch[1];
  }

  const pathMatch = line.match(/([.\w\-+]+[\\/][^`*:"#\s]+)/);
  if (pathMatch) {
    return pathMatch[1];
  }

  return line.replace(/[`*:*#\-+]/g, "").trim();
}
