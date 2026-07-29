import {
  type OrbitConfig,
  validateManagedRuntimeChange,
} from "@orbit-build/config";
import {
  getDeepSeekV4ModelProfile,
  resolveModelCapabilities,
  ModelProvider,
  OrbitMessage,
  OrbitContentBlock,
  OrbitToolCall,
  TokenUsage,
} from "@orbit-build/model-providers";
import { PermissionEngine } from "@orbit-build/permissions";
import { CheckpointManager, RollbackManager } from "@orbit-build/sandbox";
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
} from "@orbit-build/session";
import {
  toolRegistry,
  type OrbitTool,
  type ToolResult,
} from "@orbit-build/tools";
import { StatusBar, Prompt, Renderer } from "@orbit-build/tui";
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
  resolveSafePath,
} from "@orbit-build/shared";
import { VerificationContractManager } from "../verification/VerificationContractManager.js";
import {
  buildSemanticCompactionSummary,
  compactHistoryMessages,
  isContextWindowError,
  resolveContextWindowStatus,
  type ContextWindowStatus,
  type HistoryCompactionStats,
} from "./ContextWindowManager.js";
import { buildAuditDiff, isFileMutationTool, sha256 } from "./AgentAudit.js";
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
import {
  initializeAgentSession,
  type AgentLoopOptions,
  type AgentSessionBootstrapResult,
} from "./AgentSessionBootstrap.js";

const DEEPSEEK_CACHE_DEGRADED_HIT_RATE = 0.85;
const DEEPSEEK_VERBOSE_CACHE_ENV = "ORBIT_DEEPSEEK_VERBOSE_CACHE";
const NETWORK_TOOL_RESULT_MAX_RESULTS = 10;
const NETWORK_TOOL_RESULT_SUMMARY_CHARS = 280;
const NETWORK_TOOL_RESULT_MAX_CHARS = 6000;
const TOOL_RESULT_MAX_CHARS = 24_000;
const TOOL_STATUS_MAX_CHARS = 2_000;
const AGENT_LOOP_ERROR_MESSAGE_MAX_CHARS = 2000;
const AGENT_EDIT_FILE_MAX_BYTES = 16 * 1024 * 1024;

export type AgentLoopFailureCode =
  | "provider_error"
  | "execution_error"
  | "verification_failed"
  | "iteration_limit"
  | "budget_exceeded";
export type AgentLoopAbortReason = "immediate" | "interrupted" | "rollback";

export type AgentLoopRunOutcome =
  | {
      status: "completed";
      sessionId: string;
      attempts: number;
    }
  | {
      status: "failed";
      sessionId: string;
      attempts: number;
      error: {
        code: AgentLoopFailureCode;
        message: string;
      };
    }
  | {
      status: "aborted";
      sessionId: string;
      attempts: number;
      reason: AgentLoopAbortReason;
      message: string;
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

export interface UserInteraction {
  askApproval(reason: string, preview?: string): Promise<boolean>;
  askToolApproval?(request: {
    toolCallId: string;
    toolName: string;
    reason: string;
    preview?: string;
  }): Promise<boolean>;
  reviewFileChange?(request: {
    filePath: string;
    before: string | null;
    after: string;
  }): Promise<boolean>;
  showText(text: string): void;
  showDiff(
    filePath: string,
    before: string | null,
    after: string,
  ): void | Promise<void>;
}

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
  private verificationManager: VerificationContractManager;
  private readonly mcpRuntimeManager = new McpRuntimeManager(toolRegistry);
  private reportedSkillActivations = "";
  private reportedSkillErrors = "";

  /**
   * Surface the turn's skill decisions: activation events for observers,
   * read roots so bundled skill resources are readable, and one warning per
   * unique set of discovery errors so a broken SKILL.md is not silent.
   */
  private reportSkillContext(contextPack: ContextPack): void {
    const active = contextPack.activeSkills ?? [];
    this.stepRunner.setReadRoots(active.map((skill) => skill.rootDir));

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

  private abortController: AbortController | null = null;
  private interruptMode: "prompt" | "abort" = "prompt";
  private sessionCost = 0;
  private totalInputTokens = 0;
  private totalCacheReadTokens = 0;
  private totalOutputTokens = 0;
  private statusBar: StatusBar;
  private cachedRepoMapText = "";
  private lastSymbolsMtime = 0;
  private cachedContextPack: ContextPack | null = null;
  private cachedRepoMapTextForRun: string | null = null;
  private readonly progressGuard = new LoopProgressGuard();
  private activeModelForRun: string | null = null;
  private fallbackModelForRun: string | null = null;
  private fallbackExpiresAfterAttempt = 0;
  private contextOverflowRetriesForRun = 0;
  private approvedToolScopes = new Set<string>();
  private terminalFailure: {
    code: AgentLoopFailureCode;
    message: string;
  } | null = null;
  private verificationStatus: "not_run" | "passed" | "failed" = "not_run";
  private sessionReviewCache:
    | { expiresAt: number; value: SessionReviewSnapshot }
    | undefined;
  private userId: string;
  private readonly projectMemoryStore: ProjectMemoryStore;

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
    this.verificationManager = bootstrap.verificationManager;
    this.projectMemoryStore = bootstrap.projectMemoryStore;
    this.statusBar = bootstrap.statusBar;
    this.userId = bootstrap.userId;
    this.sessionCost = bootstrap.sessionCost;
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

  private buildToolResultContent(
    toolName: string,
    result: ToolResult<unknown>,
  ): string {
    const content = result.ok
      ? this.serializeToolResultData(result.data, result.display)
      : result.error || "Unknown error";

    if (!result.ok || toolName !== "web_search") {
      return this.truncatePlain(
        redactSecrets(content),
        result.ok ? TOOL_RESULT_MAX_CHARS : TOOL_STATUS_MAX_CHARS,
      );
    }

    return this.compactNetworkToolResult(
      toolName,
      redactSecrets(content),
      redactSecrets(result.display || ""),
    );
  }

  private serializeToolResultData(data: unknown, display?: string): string {
    if (typeof data === "string") return data;
    if (data === undefined) return display?.trim() || "Done";

    try {
      return JSON.stringify(data) ?? String(data);
    } catch {
      return String(data);
    }
  }

  private compactNetworkToolResult(
    toolName: string,
    content: string,
    display: string,
  ): string {
    const normalized = content.replace(/\r\n/g, "\n").trim();
    const header = display
      ? `${toolName} result: ${display}`
      : `${toolName} result`;

    if (!normalized) {
      return header;
    }

    if (normalized.startsWith("Source: Open-Meteo weather API")) {
      return this.truncateToolResultText(`${header}\n${normalized}`);
    }

    const parsedResults = this.parseSearchResultBlocks(normalized);
    if (parsedResults.length === 0) {
      return this.truncateToolResultText(`${header}\n${normalized}`);
    }

    const keep = parsedResults.slice(0, NETWORK_TOOL_RESULT_MAX_RESULTS);
    const lines = [
      `${header}`,
      `Results kept for reasoning: ${keep.length}/${parsedResults.length}. Use another live lookup only if these results are insufficient or stale.`,
    ];

    for (const result of keep) {
      lines.push(
        `[${result.index}] ${result.title}`,
        `Link: ${result.link}`,
        `Summary: ${this.truncatePlain(result.summary, NETWORK_TOOL_RESULT_SUMMARY_CHARS)}`,
      );
    }

    return this.truncateToolResultText(lines.join("\n"));
  }

  private parseSearchResultBlocks(content: string): Array<{
    index: string;
    title: string;
    link: string;
    summary: string;
  }> {
    const results: Array<{
      index: string;
      title: string;
      link: string;
      summary: string;
    }> = [];
    const regex =
      /\[(\d+)\]\s+Title:\s*([\s\S]*?)\n\s*Link:\s*([^\n]+)\n\s*Summary:\s*([\s\S]*?)(?=\n\n\[\d+\]\s+Title:|\s*$)/g;

    let match;
    while ((match = regex.exec(content)) !== null) {
      results.push({
        index: match[1],
        title: this.truncatePlain(match[2], 180),
        link: match[3].trim(),
        summary: match[4].replace(/\s+/g, " ").trim(),
      });
    }

    return results;
  }

  private truncateToolResultText(text: string): string {
    return this.truncatePlain(text, NETWORK_TOOL_RESULT_MAX_CHARS);
  }

  private truncatePlain(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 32)).trimEnd()}\n... [truncated for context budget]`;
  }

  public async run(): Promise<AgentLoopRunOutcome> {
    let outcome: AgentLoopRunOutcome;
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

    this.finalizeOutcome(outcome);
    return outcome;
  }

  private async executeRun(): Promise<AgentLoopRunOutcome> {
    const runStartedAt = new Date();
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
    this.approvedToolScopes.clear();
    this.terminalFailure = null;
    this.verificationStatus = "not_run";
    this.sessionManager.setStatus("active");
    this.sessionManager.setRunState("running", "initializing", {
      attempt: this.state.attemptCount,
    });
    this.verificationManager.initialize();
    this.sessionManager.saveHistory(this.state.history);
    void this.provider.initialize?.().catch(() => {});

    // Start workspace symbol indexing in the background asynchronously
    const symbolIndexer = new SymbolIndexer(this.cwd);
    symbolIndexer.index().catch(() => {});

    // Initialize MCP Servers if enabled
    if (
      !this.options?.disableMcp &&
      this.config.tools.mcp.enabled &&
      this.config.mcpServers
    ) {
      eventBus.emitEvent("agent_status", {
        taskId: this.state.sessionId,
        status: "initializing_mcp",
        detail: `${Object.keys(this.config.mcpServers).length} configured server(s)`,
      });
      this.interaction.showText(`● Initializing MCP servers...`);
      const mcpResult = await this.mcpRuntimeManager.start(
        this.config.mcpServers,
        (message) => this.interaction.showText(message),
      );
      eventBus.emitEvent("agent_status", {
        taskId: this.state.sessionId,
        status: mcpResult.failures.length === 0 ? "mcp_ready" : "mcp_degraded",
        detail: `${mcpResult.startedServers} server(s), ${mcpResult.registeredTools} tool(s), ${mcpResult.failures.length} failure(s)`,
      });
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

        if (this.sessionCost > this.config.budgetLimit) {
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
          const continueExec = await this.interaction.askApproval(
            `Agent loop has run for ${this.state.attemptCount - 1} iterations. Continue executing to prevent runaway costs?`,
          );
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
        const hasWrittenFiles = this.state.history
          .slice(Math.max(0, currentTurnStartIndex))
          .some(
            (msg) =>
              msg.role === "assistant" &&
              msg.content.some(
                (b) =>
                  b.type === "tool_call" &&
                  (b.toolCall.name === "write_file" ||
                    b.toolCall.name === "edit_file"),
              ),
          );

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
        });
        const isComplexTask =
          classifyTaskComplexity({
            query: userQueryText,
            repairTurn: isRepairTurn,
            hasWrittenFiles,
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
            },
          );
          this.reportSkillContext(this.cachedContextPack);
        }
        let toolDefs = toolRegistry.getDefinitions();
        if (!this.config.tools.webSearch.enabled) {
          toolDefs = toolDefs.filter(
            (tool) => tool.name !== "web_search" && tool.name !== "web_fetch",
          );
        }
        if (!this.config.tools.bash.enabled) {
          toolDefs = toolDefs.filter(
            (tool) => tool.name !== "bash" && tool.name !== "run_tests",
          );
        }
        if (this.options?.allowedTools) {
          toolDefs = toolDefs.filter((t) =>
            this.options!.allowedTools!.includes(t.name),
          );
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
        const projectMemory = this.projectMemoryStore.read();
        const taskPlan = this.sessionManager.getTaskPlan();
        const baseSystemPrompt =
          this.options?.systemPromptOverride ||
          Planner.makeSystemPrompt(
            activeModel,
            this.config.language,
            this.provider.id,
            this.sessionManager.getActiveSession()?.goal,
            projectMemory.enabled
              ? projectMemory.entries.map((entry) => entry.text)
              : [],
            taskPlan?.items.map((item) => `[${item.status}] ${item.text}`),
            capabilities.thinking,
          );
        const toolsPrompt = capabilities.toolCalls
          ? generateNativeToolsPrompt(toolDefs)
          : generateXMLToolsPrompt(toolDefs);
        const contextPack = this.cachedContextPack;
        const cacheSlab = PromptCacheSlabBuilder.build({
          cwd: this.cwd,
          model: activeModel,
          baseSystemPrompt,
          toolsPrompt,
          repoMapText,
          contextPack,
        });
        let builtMessages = MessageBuilder.build(
          cacheSlab.text,
          this.state,
          contextPack,
          { now: runStartedAt, repoMapText },
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
              { now: runStartedAt, repoMapText },
            );
            this.state.history = builtMessages.messages;
            this.sessionManager.saveHistory(this.state.history);
          }
        }
        // Keep the provider request array immutable while history grows with the
        // assistant response and tool results.
        const messages = [...builtMessages.messages];
        const supportsThinking = capabilities.thinking;
        const deepSeekProfile = getDeepSeekV4ModelProfile(activeModel);
        const thinkingEnabled = supportsThinking
          ? deepSeekProfile?.legacyAlias
            ? deepSeekProfile.optimizedThinkingDefault
            : Boolean(
                deepSeekProfile?.optimizedThinkingDefault ||
                isRepairTurn ||
                isComplexTask,
              )
          : false;

        this.statusBar.start(
          `Calling ${activeModel}... | Cost: $${this.sessionCost.toFixed(4)}`,
        );

        this.abortController = new AbortController();
        if (this.interruptMode === "abort") {
          this.abortController.abort();
        }

        // 2. Dynamic thinking budget configuration based on complexity
        let thinkingBudget = 1024;
        if (isRepairTurn) {
          thinkingBudget = 8192; // Max thinking budget for repair
        } else if (isComplexTask || deepSeekProfile?.lane === "pro") {
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
          thinking: supportsThinking
            ? { enabled: thinkingEnabled, budgetTokens: thinkingBudget }
            : undefined,
        });

        let responseText = "";
        let thinkingText = "";
        let thinkingSignature = "";
        let finalUsage: TokenUsage | undefined;
        let resolvedModel: string | undefined;
        let providerRequestId: string | undefined;
        const toolCallsToExecute: OrbitToolCall[] = [];
        const toolCallProtocolErrors = new Map<string, string>();

        try {
          for await (const event of stream) {
            this.statusBar.stop();
            if (event.type === "response_metadata") {
              resolvedModel = event.resolvedModel;
              providerRequestId = event.providerRequestId;
              this.sessionManager.logEvent("provider_response_identity", {
                provider: this.provider.id,
                requestedModel: event.requestedModel,
                resolvedModel: event.resolvedModel || null,
                providerRequestId: event.providerRequestId || null,
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
            const contextWindowRejected =
              this.config.context.autoCompact &&
              this.contextOverflowRetriesForRun < 2 &&
              isContextWindowError(chatError);
            if (contextWindowRejected) {
              this.contextOverflowRetriesForRun++;
              const retryStatus = this.getContextWindowStatus(activeModel);
              const compacted = await this.compactHistory(
                "automatic",
                Math.max(256, Math.floor(retryStatus.compactAtTokens * 0.5)),
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
              /(?:insufficient_system_resource|resources were insufficient|overloaded|temporarily unavailable|HTTP 429|HTTP 500|HTTP 503|timed out)/i.test(
                chatErrorMessage,
              );
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
          this.statusBar.stop();
        }

        if (toolCallsToExecute.length === 0 && responseText) {
          const xmlToolCalls = parseXMLToolCalls(responseText);
          const textToolCalls =
            xmlToolCalls.length > 0
              ? []
              : parseTextToolCalls(
                  responseText,
                  (name) => toolRegistry.get(name) !== undefined,
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
          text: responseText || undefined,
          reasoning_content: thinkingText || undefined,
          usage: finalUsage
            ? {
                inputTokens: finalUsage.inputTokens,
                outputTokens: finalUsage.outputTokens,
                cacheReadTokens: finalUsage.cacheReadTokens,
                cacheWriteTokens: finalUsage.cacheWriteTokens,
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
          },
        };
        this.state.history.push(assistantMsg);
        this.sessionManager.saveHistory(this.state.history);

        if (responseText) {
          if (toolCallsToExecute.length > 0) {
            this.interaction.showText(Renderer.formatThought(responseText));
          } else {
            this.interaction.showText(
              `\nOrbit: ${Renderer.formatMarkdown(responseText)}`,
            );
          }
        }

        if (toolCallsToExecute.length === 0) {
          const hasEdits = this.state.history.some(
            (msg) =>
              msg.role === "assistant" &&
              msg.content.some(
                (b) =>
                  b.type === "tool_call" &&
                  (b.toolCall.name === "write_file" ||
                    b.toolCall.name === "edit_file" ||
                    b.toolCall.name === "replace_file_content" ||
                    b.toolCall.name === "multi_replace_file_content"),
              ),
          );

          if (hasEdits) {
            if (this.verificationManager.hasContract()) {
              this.sessionManager.setRunState("verifying", "verification", {
                attempt: this.state.attemptCount,
              });
              this.interaction.showText(
                "\n● Verification: Running contract verification checks...",
              );
              const verifyResult =
                await this.verificationManager.runVerification();
              this.verificationStatus = verifyResult.success
                ? "passed"
                : "failed";
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
              const testTool = toolRegistry.get("run_tests");
              if (testTool) {
                this.interaction.showText(
                  "\n● Auto-Repair: Running project tests to verify changes...",
                );
                const preferredCommand = this.config.context.testCommands?.[0];
                const result = await testTool.execute(
                  { command: preferredCommand },
                  {
                    cwd: this.cwd,
                    sessionId: this.state.sessionId,
                    abortSignal: this.abortController?.signal,
                  },
                );
                this.verificationStatus = result.ok ? "passed" : "failed";

                if (!result.ok) {
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
                  const rawLog = result.error || result.display || "";
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
        for (const tc of toolCallsToExecute) {
          const toolStartedAt = new Date().toISOString();
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

          const registeredTool = toolRegistry.get(tc.name);
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
              `Tool input validation failed: ${validation.error.message}`,
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
            if (targetPath) {
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
                const choice = await Prompt.askSelect(
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
                    const editChoice = await Prompt.askSelect(
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
                      edited = await Prompt.askText(
                        "Edit tool arguments (JSON string):",
                        currentArgs,
                      );
                    }
                  } else {
                    edited = await Prompt.askText(
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
          if (targetPath) {
            try {
              absoluteTargetPath = resolveSafePath(this.cwd, targetPath);
            } catch {
              absoluteTargetPath = undefined;
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
                });
                this.interaction.showText(`✔ Pre-commit checks passed.`);
              } catch (error: unknown) {
                const commandError = hookErrorOutput(error);
                this.interaction.showText(
                  picocolors.red(
                    `✖ Pre-commit checks failed. Verification tests failed.`,
                  ),
                );

                const choice = this.options?.nonInteractive
                  ? "no"
                  : await Prompt.askSelect(
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
                            text: `Generate a concise, high-quality conventional git commit message (e.g. feat(cli): add autocomplete) for the following git diff. Output ONLY the commit message, no formatting, no markdown, no quotes, just the text:\n\n${stdout.substring(0, 20000)}`,
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
            targetPath
          ) {
            const checkpoint = await this.checkpointManager.captureBeforeState(
              tc.id,
              targetPath,
            );
            beforeContent = checkpoint.backups[0].originalContent;

            eventBus.emitEvent("checkpoint_created", {
              checkpointId: checkpoint.id,
              timestamp: checkpoint.timestamp,
              message: `Before executing ${tc.name} on ${targetPath}`,
            });

            // Run pre-edit hook if configured
            if (this.config.hooks?.preEdit) {
              this.interaction.showText(`● Running pre-edit hook...`);
              const hookRes = await this.runHook(
                this.config.hooks.preEdit,
                targetPath,
              );
              if (!hookRes.ok) {
                this.interaction.showText(
                  `✖ Pre-edit hook failed: ${hookRes.output}`,
                );
                hookResult = {
                  ok: false,
                  error: `Pre-edit hook failed: ${hookRes.output}`,
                };
                skipToolExecution = true;
              } else {
                this.interaction.showText(`✔ Pre-edit hook passed.`);
              }
            }
          }

          this.statusBar.start(
            `Executing tool: ${tc.name}... | Cost: $${this.sessionCost.toFixed(4)}`,
          );
          const result = skipToolExecution
            ? (hookResult ?? {
                ok: false,
                error: "Pre-edit hook prevented tool execution.",
              })
            : await this.stepRunner.run(tc, this.abortController?.signal);
          this.statusBar.stop();

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
          // Run post-edit hook if tool succeeded and it's a file edit
          if (
            result.ok &&
            !skipToolExecution &&
            (tc.name === "write_file" || tc.name === "edit_file") &&
            targetPath
          ) {
            if (this.config.hooks?.postEdit) {
              this.interaction.showText(`● Running post-edit hook...`);
              const hookRes = await this.runHook(
                this.config.hooks.postEdit,
                targetPath,
              );
              if (!hookRes.ok) {
                this.interaction.showText(
                  `✖ Post-edit hook failed: ${hookRes.output}`,
                );
                finalResult = {
                  ok: false,
                  error: `Post-edit hook failed: ${hookRes.output}`,
                };
              } else {
                this.interaction.showText(`✔ Post-edit hook passed.`);
              }
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
                await executeLocalPackageBinary(this.cwd, "eslint", "eslint", [
                  "--fix",
                  absoluteTargetPath,
                ]);
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
                      const installPkg = await this.interaction.askApproval(
                        `Missing dependency "${pkg}" detected. Install it automatically?`,
                      );
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
                  const autoFix = await this.interaction.askApproval(
                    `Lint/Syntax verification failed. Let Agent auto-repair the file?`,
                  );
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
            const choice = this.options?.nonInteractive
              ? "yes"
              : this.interaction.reviewFileChange
                ? (await this.interaction.reviewFileChange({
                    filePath: targetPath,
                    before: beforeContent,
                    after: afterContent,
                  }))
                  ? "yes"
                  : "no"
                : await Prompt.askSelect(`Accept changes to ${targetPath}?`, [
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

                  const selectedHunkIndices = await Prompt.askMultiSelect(
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
            isFileMutationTool(tc.name)
          ) {
            try {
              const afterContent = readBoundedRegularFile(
                absoluteTargetPath,
                AGENT_EDIT_FILE_MAX_BYTES,
              );
              if (afterContent === undefined) {
                throw new Error("Edited file disappeared before audit.");
              }
              this.sessionManager.recordFileModification(
                path.relative(this.cwd, absoluteTargetPath).replace(/\\/g, "/"),
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

          if (finalResult.ok) {
            const statusText = this.truncatePlain(
              redactSecrets(finalResult.display || "Done"),
              TOOL_STATUS_MAX_CHARS,
            );
            this.interaction.showText(
              `  ${picocolors.green("✔")} Success: ${picocolors.gray(statusText)}`,
            );

            if (targetPath) {
              this.addRelevantFile(targetPath, `Modified by ${tc.name}`);
            }
            if (tc.name === "write_file" || tc.name === "edit_file") {
              new SymbolIndexer(this.cwd).index().catch(() => {});
            }
          } else {
            const statusError = this.truncatePlain(
              redactSecrets(finalResult.error || "Unknown error"),
              TOOL_STATUS_MAX_CHARS,
            );
            this.interaction.showText(
              `  ${picocolors.red("✖")} Failed: ${picocolors.red(statusError)}`,
            );
          }

          eventBus.emitEvent("tool_result", {
            toolCallId: tc.id,
            toolName: tc.name,
            result: finalResult.ok ? finalResult.data : undefined,
            display: finalResult.ok ? finalResult.display : undefined,
            error: finalResult.ok
              ? undefined
              : finalResult.error || "Unknown error",
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
                this.buildToolResultContent(tc.name, finalResult) +
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
        this.abortController = null;
        this.sessionManager.saveHistory(this.state.history);
      }

      if (
        this.state.attemptCount >= this.state.maxAttempts &&
        !this.state.done
      ) {
        this.terminalFailure = {
          code: "iteration_limit",
          message: `Maximum loop iterations (${this.state.maxAttempts}) reached before the task completed.`,
        };
        this.interaction.showText(
          `\n● Limit reached: Maximum consecutive loop iterations (${this.state.maxAttempts}) completed. Pausing loop.`,
        );
      }

      const sessions = this.sessionManager
        .getSessionStore()
        .getEvents(this.state.sessionId);
      const modifiedFiles = sessions
        .filter((e) => e.type === "file_modified")
        .flatMap((e) =>
          typeof e.payload === "object" &&
          e.payload !== null &&
          "path" in e.payload &&
          typeof e.payload.path === "string"
            ? [e.payload.path]
            : [],
        );

      this.interaction.showText(`\n● Summary:`);
      this.interaction.showText(
        `  Modified files: ${modifiedFiles.length > 0 ? Array.from(new Set(modifiedFiles)).join(", ") : "None"}`,
      );
      const verificationSummary =
        this.verificationStatus === "passed"
          ? "passed"
          : this.verificationStatus === "failed"
            ? "failed"
            : "not run";
      this.interaction.showText(
        `  Verification contract: ${verificationSummary}.`,
      );
      this.interaction.showText(
        `  Session Cost: $${this.sessionCost.toFixed(4)}`,
      );

      if (
        !this.terminalFailure &&
        this.config.autoCommit &&
        modifiedFiles.length > 0
      ) {
        this.interaction.showText(`\n● Auto-committing changes...`);
        try {
          const uniqueFiles = Array.from(new Set(modifiedFiles));
          const { execFileSync } = await import("child_process");

          for (const file of uniqueFiles) {
            execFileSync("git", ["add", file], {
              ...HIDDEN_CHILD_PROCESS_OPTIONS,
              cwd: this.cwd,
            });
          }

          const diff = execFileSync("git", ["diff", "--cached"], {
            ...HIDDEN_CHILD_PROCESS_OPTIONS,
            cwd: this.cwd,
          })
            .toString()
            .trim();
          if (diff) {
            this.interaction.showText("● Generating commit message via LLM...");
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
                      text: `Generate a concise, high-quality conventional git commit message (e.g. feat(cli): add autocomplete) for the following git diff. Output ONLY the commit message, no formatting, no markdown, no quotes, just the text:\n\n${diff.substring(0, 20000)}`,
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
            execFileSync("git", ["commit", "-m", finalMsg], {
              ...HIDDEN_CHILD_PROCESS_OPTIONS,
              cwd: this.cwd,
            });
            this.interaction.showText(
              `${picocolors.green("✔")} Auto-commit created successfully.`,
            );
          } else {
            this.interaction.showText(
              "● No changes staged or modified. Skipping auto-commit.",
            );
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
      await this.mcpRuntimeManager.stop();
    }

    if (this.terminalFailure) {
      return this.createFailedOutcome(
        this.terminalFailure.code,
        this.terminalFailure.message,
      );
    }

    return {
      status: "completed",
      sessionId: this.state.sessionId,
      attempts: this.state.attemptCount,
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
    };
  }

  private finalizeOutcome(outcome: AgentLoopRunOutcome): void {
    try {
      this.sessionManager.setRunState(
        outcome.status,
        outcome.status === "completed" ? "finished" : "terminated",
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

    const toolCallId = `hook_${randomUUID()}`;
    eventBus.emitEvent("tool_proposal", {
      toolCallId,
      toolName: "hook",
      arguments: { filePath: relativePath },
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
      const { stdout, stderr } = await execPromise(hookCommand, {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        cwd: this.cwd,
        env: { ...process.env, ORBIT_FILE: relativePath },
        timeout: this.config.tools.bash.timeoutMs,
        signal: this.abortController?.signal,
      });
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

    this.checkpointManager = new CheckpointManager(this.cwd, sessionId);
    this.stepRunner = new StepRunner(this.cwd, sessionId, this.config);
    this.sessionCost = session.totalCostEstimate || 0;
    this.totalInputTokens = session.totalInputTokens || 0;
    this.totalCacheReadTokens = session.totalCacheReadTokens || 0;
    this.totalOutputTokens = session.totalOutputTokens || 0;
    return true;
  }

  public startNewSession(providerId: string, model: string): string {
    const session = this.sessionManager.startNewSession(providerId, model);
    this.state = createInitialState(
      session.id,
      "REPL Interactive Shell Started",
    );
    this.checkpointManager = new CheckpointManager(this.cwd, session.id);
    this.stepRunner = new StepRunner(this.cwd, session.id, this.config);
    this.sessionCost = 0;
    this.totalInputTokens = 0;
    this.totalCacheReadTokens = 0;
    this.totalOutputTokens = 0;
    this.sessionManager.saveHistory(this.state.history);
    return session.id;
  }

  public getSessions(): Session[] {
    return this.sessionManager.getSessionStore().listSessions();
  }

  public deleteSession(sessionId: string): void {
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
    for (const checkpoint of checkpointsToRollback) {
      const result = this.rollbackManager.rollback(checkpoint);
      if (!result.success) {
        this.interaction.showText(
          `Rewind failed at checkpoint ${checkpoint.id}: ${result.error || "unknown error"}`,
        );
        return false;
      }
      for (const file of result.restored) restored.add(file);
      this.checkpointManager.removeCheckpoint(checkpoint.id);
    }
    this.interaction.showText(
      `Rewound ${checkpointsToRollback.length} checkpoint(s): ${Array.from(restored).join(", ")}`,
    );
    return true;
  }

  public rollbackFileToCheckpoint(filePath: string): boolean {
    this.sessionReviewCache = undefined;
    let targetAbs: string;
    try {
      targetAbs = resolveSafePath(this.cwd, filePath);
    } catch {
      return false;
    }
    const checkpoints = this.checkpointManager.getCheckpoints().reverse();
    for (const cp of checkpoints) {
      const backup = cp.backups.find((candidate) => {
        try {
          return resolveSafePath(this.cwd, candidate.path) === targetAbs;
        } catch {
          return false;
        }
      });
      if (backup) {
        const safePath = resolveSafePath(this.cwd, backup.path);
        try {
          if (backup.originalContent === null) {
            if (fs.existsSync(safePath)) {
              fs.unlinkSync(safePath);
            }
          } else {
            fs.writeFileSync(safePath, backup.originalContent, "utf8");
          }
          return true;
        } catch {
          return false;
        }
      }
    }
    return false;
  }

  private accumulateCost(model: string, usage: TokenUsage): void {
    const cleanModel = model.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
    const pricingModel =
      getDeepSeekV4ModelProfile(cleanModel)?.canonicalModel || cleanModel;
    let pricing = this.config.pricing?.[pricingModel];
    if (!pricing) {
      for (const key of Object.keys(this.config.pricing || {})) {
        if (key.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "") === pricingModel) {
          pricing = this.config.pricing[key];
          break;
        }
      }
    }
    if (!pricing) {
      pricing = {
        inputCostPer1M: 0.14,
        outputCostPer1M: 0.28,
        cacheReadCostPer1M: 0.07,
      };
    }

    const uncachedInputTokens = usage.cacheReadTokens
      ? Math.max(0, usage.inputTokens - usage.cacheReadTokens)
      : usage.inputTokens;

    const inputCost = (uncachedInputTokens / 1000000) * pricing.inputCostPer1M;
    const outputCost = (usage.outputTokens / 1000000) * pricing.outputCostPer1M;
    const cacheReadCost =
      usage.cacheReadTokens && pricing.cacheReadCostPer1M
        ? (usage.cacheReadTokens / 1000000) * pricing.cacheReadCostPer1M
        : 0;

    this.totalInputTokens += usage.inputTokens || 0;
    this.totalOutputTokens += usage.outputTokens || 0;
    this.totalCacheReadTokens += usage.cacheReadTokens || 0;

    const turnCost = inputCost + outputCost + cacheReadCost;
    this.sessionCost += turnCost;

    const session = this.sessionManager.getActiveSession();
    if (session) {
      session.totalInputTokens = this.totalInputTokens;
      session.totalOutputTokens = this.totalOutputTokens;
      session.totalCacheReadTokens = this.totalCacheReadTokens;
      session.totalCostEstimate = this.sessionCost;
      this.sessionManager.getSessionStore().updateSession(session);
    }

    eventBus.emitEvent("cost_update", {
      turnCost,
      sessionCost: this.sessionCost,
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
    return {
      ...this.getContextWindowStatus(),
      ...result,
    };
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
          const choice = await Prompt.askSelect(`${description} (boolean):`, [
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
          const choice = await Prompt.askSelect(
            `${description} (select):`,
            options,
          );
          if (choice === null) return null;
          result = choice;
        } else {
          const input = await Prompt.askText(
            `${description} (${key}):`,
            valStr,
          );
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
    this.statusBar.stop();
    if (this.interruptMode === "abort") {
      this.interruptMode = "prompt";
      return "abort";
    }
    if (this.options?.nonInteractive) return "abort";
    this.interaction.showText(
      picocolors.yellow("\n● Execution interrupted by user."),
    );
    const choice = await Prompt.askSelect("What would you like to do?", [
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
      });
      return true;
    } catch {
      return false;
    }
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

function toUnknownRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstStringValue(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string");
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
