import {
  AgentLoop,
  UserInteraction,
  Orchestrator,
  eventBus,
  AutocompleteEngine,
  type AgentLoopRunOutcome,
  type OrbitEvent,
} from "@orbit-build/core";
import { Prompt, Renderer, DiffView, StatusBar } from "@orbit-build/tui";
import picocolors from "picocolors";
import { rmSync, watch, type FSWatcher } from "fs";
import { dirname, resolve } from "path";
import { homedir } from "os";
import http from "http";
import { randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { z } from "zod";
import { SymbolIndexer } from "@orbit-build/context-engine";
import {
  isFullAccessEnabled,
  type OrbitConfig,
  type RegisteredAgentProfile,
} from "@orbit-build/config";
import type { ModelProvider } from "@orbit-build/model-providers";
import { FullscreenTui, pageText } from "../tui/FullscreenTui.js";
import { CommandRouter, getAutocompleteCandidates } from "./CommandRouter.js";
import type { AutocompleteCandidates } from "./AutocompleteCandidates.js";
import { buildMcpPromptCommandCandidates } from "./McpPromptCommands.js";
import { stopOrbitWebUi } from "./webui/index.js";
import {
  redactSecrets,
  readBoundedRegularFile,
  replacePrivateFileAtomically,
  resolveSafePath,
} from "@orbit-build/shared";
import { readCliVersion } from "./CliVersion.js";
import { ensureSessionTitle } from "./SessionTitles.js";
import { handleInputQueueCommand } from "./commands/InputQueueCommandHandler.js";
import {
  readLocalRuntimeState,
  writeLocalRuntimeState,
  type LocalRuntimeState,
} from "./LocalRuntimeState.js";
import { loadTerminalImage } from "./TerminalAttachments.js";
import type { OrbitContentBlock } from "@orbit-build/model-providers";
import { ScreenReaderOutputGuard } from "./ScreenReaderOutputGuard.js";

const AutocompleteRequestSchema = z.object({
  prefix: z.string().max(20000),
  suffix: z.string().max(20000),
  windowId: z.string().max(1000).optional(),
});
const AUTOCOMPLETE_BODY_LIMIT_BYTES = 100_000;
const AUTOCOMPLETE_MAX_CONCURRENCY = 4;

const AutocompleteEndpointSchema = z.object({
  port: z.number().int().min(1).max(65535),
  token: z.string().min(32).max(256),
});

type LocalState = LocalRuntimeState;
type EventPayload<T extends OrbitEvent["type"]> = Extract<
  OrbitEvent,
  { type: T }
>["payload"];

function getRunOutcomeMessage(
  outcome: AgentLoopRunOutcome | undefined,
): string | undefined {
  if (!outcome || outcome.status === "completed") return undefined;
  return outcome.status === "failed" ? outcome.error.message : outcome.message;
}

export interface FullscreenTuiDecision {
  readonly stdinIsTty: boolean;
  readonly hasRawMode: boolean;
  readonly direct: boolean;
  readonly webUiOnly: boolean;
  readonly accessibility: "standard" | "screen-reader";
}

/** Selects full-screen rendering only when the terminal and user mode allow it. */
export function shouldUseFullscreenTui(
  decision: FullscreenTuiDecision,
): boolean {
  return (
    decision.stdinIsTty &&
    decision.hasRawMode &&
    !decision.direct &&
    !decision.webUiOnly &&
    decision.accessibility === "standard"
  );
}

/** Formats a stable, cursor-control-free header for assistive terminals. */
export function formatScreenReaderHeader(
  sessionId: string,
  model: string,
  cwd: string,
  version: string,
): string {
  return [
    `Orbit AI Coding Runtime (${version})`,
    `Model: ${model}`,
    `Session: ${sessionId.slice(0, 8)}`,
    `Path: ${cwd}`,
    "Type /help to view commands, or type a task to start.",
  ].join("\n");
}

export class ReplController {
  private currentTui: FullscreenTui | null = null;
  private watchTimeout: NodeJS.Timeout | null = null;
  private watcher: FSWatcher | null = null;
  private candidates: AutocompleteCandidates | null = null;
  private autocompleteServer: http.Server | null = null;
  private terminalAttachments: Extract<OrbitContentBlock, { type: "image" }>[] =
    [];

  constructor(
    private cwd: string,
    private config: OrbitConfig,
    private providerInstance: ModelProvider,
    private interaction: UserInteraction,
    private multi?: boolean,
    private direct?: boolean,
    private webUiOnly?: {
      port?: number;
      /** @deprecated Orbit no longer opens a browser automatically. */
      open?: boolean;
    },
    private agentProfile?: RegisteredAgentProfile,
  ) {}

  private handleTerminalAttachmentCommand(
    input: string,
    interaction: Pick<UserInteraction, "showText">,
  ): boolean {
    if (/^\/attachments(?:\s|$)/i.test(input)) {
      if (this.terminalAttachments.length === 0) {
        interaction.showText("● No TUI image attachments are staged.");
      } else {
        interaction.showText(
          `● Staged image(s): ${this.terminalAttachments
            .map(
              (attachment, index) =>
                `${index + 1}. ${attachment.name ?? attachment.mediaType}`,
            )
            .join(", ")}`,
        );
      }
      return true;
    }
    if (/^\/detach(?:\s|$)/i.test(input)) {
      const target = input
        .replace(/^\/detach\s*/i, "")
        .trim()
        .toLowerCase();
      if (!target || target === "all") {
        const removed = this.terminalAttachments.length;
        this.terminalAttachments = [];
        interaction.showText(`✔ Removed ${removed} staged image(s).`);
        return true;
      }
      const index = Number(target);
      if (
        Number.isInteger(index) &&
        index >= 1 &&
        index <= this.terminalAttachments.length
      ) {
        const [removed] = this.terminalAttachments.splice(index - 1, 1);
        interaction.showText(`✔ Removed ${removed?.name ?? "image"}.`);
        return true;
      }
      interaction.showText("✖ Use /detach all or /detach <number>.");
      return true;
    }
    if (!/^\/attach(?:\s|$)/i.test(input)) return false;
    const path = input.replace(/^\/attach\s*/i, "").trim();
    if (!path) {
      interaction.showText("⚠️ Usage: /attach <workspace-relative-image>");
      return true;
    }
    if (this.terminalAttachments.length >= 4) {
      interaction.showText("✖ TUI supports at most 4 staged images per turn.");
      return true;
    }
    try {
      const attachment = loadTerminalImage(path, {
        cwd: this.cwd,
        allowSymbolicLink: isFullAccessEnabled(this.config),
      });
      this.terminalAttachments.push(attachment);
      interaction.showText(`✔ Staged image ${attachment.name ?? "image"}.`);
    } catch (error: unknown) {
      interaction.showText(
        `✖ ${redactSecrets(error instanceof Error ? error.message : String(error))}`,
      );
    }
    return true;
  }

  private takeTerminalAttachments(): Extract<
    OrbitContentBlock,
    { type: "image" }
  >[] {
    const attachments = this.terminalAttachments;
    this.terminalAttachments = [];
    return attachments;
  }

  private getLocalState(): LocalState {
    return readLocalRuntimeState(this.cwd);
  }

  private saveLocalState(state: LocalState): void {
    try {
      writeLocalRuntimeState(this.cwd, state);
    } catch (error) {
      eventBus.emitEvent("warning", {
        message: redactSecrets(
          `Unable to persist Orbit local state: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      });
    }
  }

  private startAutocompleteServer() {
    const engine = new AutocompleteEngine();
    const token = randomBytes(32).toString("base64url");
    const endpointPath = resolveSafePath(this.cwd, ".orbit/autocomplete.json");
    let activeRequests = 0;
    const server = http.createServer(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      const host = req.headers.host || "";
      if (!/^127\.0\.0\.1:\d+$/.test(host)) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (req.headers.origin) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (!hasBearerToken(req, token)) {
        res.writeHead(401);
        res.end();
        return;
      }
      if (req.method !== "POST" || req.url !== "/autocomplete") {
        res.writeHead(404);
        res.end();
        return;
      }
      if (!req.headers["content-type"]?.startsWith("application/json")) {
        res.writeHead(415);
        res.end();
        return;
      }
      if (activeRequests >= AUTOCOMPLETE_MAX_CONCURRENCY) {
        res.writeHead(429);
        res.end();
        return;
      }

      activeRequests++;
      try {
        const body = await readLimitedBody(req, AUTOCOMPLETE_BODY_LIMIT_BYTES);
        const parsed = AutocompleteRequestSchema.parse(JSON.parse(body));
        const completion = await engine.autocomplete(
          parsed.prefix,
          parsed.suffix,
          this.config,
          parsed.windowId,
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ completion }));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        res.writeHead(message === "Request body too large." ? 413 : 400, {
          "Content-Type": "application/json",
        });
        res.end(JSON.stringify({ error: message }));
      } finally {
        activeRequests--;
      }
    });

    let currentPort = 6018;
    server.once("listening", () => {
      try {
        replacePrivateFileAtomically(
          endpointPath,
          `${JSON.stringify({ port: currentPort, token }, null, 2)}\n`,
        );
        eventBus.emitEvent("info", {
          message: `Autocomplete bridge server running on http://127.0.0.1:${currentPort}`,
        });
      } catch (error) {
        eventBus.emitEvent("error", {
          message: redactSecrets(
            `Autocomplete bridge discovery file failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        });
        server.close();
      }
    });
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && currentPort < 6037) {
        currentPort++;
        server.listen(currentPort, "127.0.0.1");
      } else {
        eventBus.emitEvent("error", {
          message: `Autocomplete bridge failed: ${err.message}`,
        });
      }
    });
    server.once("close", () => {
      try {
        const raw = readBoundedRegularFile(endpointPath, 1_024);
        if (raw === undefined) return;
        const current = AutocompleteEndpointSchema.parse(JSON.parse(raw));
        if (current.token === token) {
          rmSync(endpointPath, { force: true });
        }
      } catch {
        // The discovery file may already be gone.
      }
    });
    server.listen(currentPort, "127.0.0.1");
    return server;
  }

  public async start(): Promise<void> {
    const version = `v${readCliVersion()}`;
    const sigintHandler = () => {
      // Prevent process exit on Ctrl+C during agent execution or REPL waiting.
    };
    process.on("SIGINT", sigintHandler);

    const localState = this.getLocalState();
    if (localState.language) {
      this.config.language = localState.language;
    }
    if (localState.skills) {
      const saved = localState.skills;
      if (typeof saved.enabled === "boolean") {
        this.config.skills.enabled = saved.enabled;
      }
      if (saved.activation === "auto" || saved.activation === "explicit") {
        this.config.skills.activation = saved.activation;
      }
      if (
        typeof saved.maxActive === "number" &&
        Number.isInteger(saved.maxActive) &&
        saved.maxActive >= 0 &&
        saved.maxActive <= 8
      ) {
        this.config.skills.maxActive = saved.maxActive;
      }
      if (Array.isArray(saved.disabled)) {
        this.config.skills.disabled = saved.disabled.filter(
          (name): name is string => typeof name === "string",
        );
      }
    }

    const screenReaderMode = this.config.tui?.accessibility === "screen-reader";
    const terminalColors = screenReaderMode
      ? picocolors.createColors(false)
      : picocolors;
    const screenReaderOutputGuard = screenReaderMode
      ? new ScreenReaderOutputGuard()
      : null;
    Prompt.setAccessibilityMode(
      screenReaderMode ? "screen-reader" : "standard",
    );
    const useFullscreenTui = shouldUseFullscreenTui({
      stdinIsTty: process.stdin.isTTY === true,
      hasRawMode: typeof process.stdin.setRawMode === "function",
      direct: this.direct === true,
      webUiOnly: this.webUiOnly !== undefined,
      accessibility: this.config.tui?.accessibility ?? "standard",
    });
    this.autocompleteServer = this.config.autocomplete?.enabled
      ? this.startAutocompleteServer()
      : null;

    const tui = new FullscreenTui(
      this.cwd,
      this.config.models.default,
      version,
      this.config,
    );
    this.currentTui = tui;
    tui.setPermissionsMode(this.config.permissions.mode);
    if (useFullscreenTui) {
      Prompt.setTuiInstance(tui);
    }

    const tuiInteraction: UserInteraction = {
      prompt: Prompt,
      progress: new StatusBar(useFullscreenTui || screenReaderMode),
      formatThought: screenReaderMode
        ? (thought) =>
            thought.trim() ? `\nOrbit Agent Thinking:\n${thought.trim()}\n` : ""
        : Renderer.formatThought,
      formatMarkdown: screenReaderMode
        ? (text) => text
        : Renderer.formatMarkdown,
      askApproval: async (
        reason: string,
        preview?: string,
      ): Promise<boolean> => {
        if (useFullscreenTui && tui.isActive) {
          const message = preview
            ? `Risk Warning: ${reason}\nParameters: ${preview}\nConfirm action?`
            : `Risk Warning: ${reason}\nConfirm action?`;
          return await Prompt.askApproval(message);
        }

        const wasActive = useFullscreenTui && tui.isActive;
        if (wasActive) tui.stop();

        console.log(`\nRisk Warning: ${reason}`);
        if (preview) {
          console.log(terminalColors.gray(`Parameters: ${preview}`));
        }
        const approved = await Prompt.askApproval("Confirm action?");

        if (wasActive) tui.start(this.config.budgetLimit);
        return approved;
      },
      showText(text: string): void {
        if (useFullscreenTui && tui.isActive) {
          tui.addLog(text);
        } else {
          console.log(text);
        }
      },
      showDiff: async (
        filePath: string,
        before: string | null,
        after: string,
      ): Promise<void> => {
        // Broadcast so read-only observers (Web UI) see the same diff the
        // terminal reviewer is looking at.
        eventBus.emitEvent("file_diff", {
          filePath,
          diff: DiffView.renderPlain(filePath, before, after),
        });
        const wasActive = useFullscreenTui && tui.isActive;
        if (wasActive) tui.stop();

        await pageText(
          screenReaderMode
            ? DiffView.renderPlain(filePath, before, after)
            : DiffView.render(filePath, before, after),
        );

        if (wasActive) tui.start(this.config.budgetLimit);
      },
    };

    let resumeSessionId: string | undefined;
    if (localState.lastSessionId) {
      if (this.webUiOnly) {
        resumeSessionId = localState.lastSessionId;
      } else {
        const resume = await Prompt.askApproval(
          `Found previous session (${localState.lastSessionId}). Resume last session?`,
        );
        if (resume) {
          resumeSessionId = localState.lastSessionId;
        }
      }
    }

    const loop = AgentLoop.initialize(
      this.cwd,
      this.config,
      this.providerInstance,
      "REPL Interactive Shell Started",
      tuiInteraction,
      {
        disableStatusBar: useFullscreenTui || screenReaderMode,
        sessionId: resumeSessionId,
        // Full Access is an explicit request for uninterrupted autonomous work.
        // Budget, cancellation, progress, and the configured hard ceiling remain.
        autoContinueRunaway: isFullAccessEnabled(this.config),
        thinkingEffort: this.agentProfile?.effort,
        allowedTools: this.agentProfile?.allowedTools,
        disallowedTools: this.agentProfile?.disallowedTools,
        forcedSkills: this.agentProfile?.skills,
        memoryMode: this.agentProfile?.memory,
        systemPromptOverride: this.agentProfile?.systemPrompt,
        modelOverride: this.agentProfile?.model,
        profileHooks: this.agentProfile?.hooks,
        mcpServers: this.agentProfile?.mcpServers,
      },
    );

    tui.setActiveInputHandler((submitted) => {
      try {
        const trimmed = submitted.trim();
        if (this.handleTerminalAttachmentCommand(trimmed, tuiInteraction)) {
          return true;
        }
        if (/^\/queue(?:\s|$)/i.test(trimmed)) {
          const [command, ...argumentsParts] = trimmed.split(/\s+/);
          handleInputQueueCommand(
            command.toLowerCase(),
            argumentsParts.join(" "),
            {
              loop,
              language: this.config.language,
              canSteer: !this.multi && tui.hasActiveRunnable(),
              printOutput: (text) => tui.addSystemMessage(text),
            },
          );
          return true;
        }
        const mode = this.multi ? "follow_up" : "steer";
        loop.enqueueUserInput(submitted, {
          mode,
          source: "terminal",
          attachments: this.takeTerminalAttachments(),
        });
        tui.addLog(
          this.config.language !== "en"
            ? mode === "steer"
              ? "● 引导指令已接收，将在当前安全步骤结束后生效。"
              : "● 后续指令已加入队列。"
            : mode === "steer"
              ? "● Steering accepted; it will apply after the current safe step."
              : "● Follow-up added to the queue.",
        );
        return true;
      } catch (error) {
        tui.addLog(
          terminalColors.red(
            `✖ ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        return false;
      }
    });

    const recovery = loop.getRecoveryReport();
    if (recovery) {
      const isZh = this.config.language !== "en";
      const repaired = [
        recovery.repairedToolCalls > 0
          ? `${recovery.repairedToolCalls} ${isZh ? "个未完成工具调用已安全封口" : "unfinished tool call(s) safely sealed"}`
          : "",
        recovery.resetPlanItems > 0
          ? `${recovery.resetPlanItems} ${isZh ? "个进行中计划项已退回待办" : "in-progress plan item(s) returned to pending"}`
          : "",
      ].filter(Boolean);
      tuiInteraction.showText(
        terminalColors.yellow(
          `⚠️ ${isZh ? "已恢复上次异常中断的会话" : "Recovered the previously interrupted session"}${repaired.length ? `：${repaired.join(isZh ? "；" : "; ")}` : "。"}`,
        ),
      );
    }

    this.saveLocalState({
      lastSessionId: loop.getSessionId(),
      lastProvider:
        this.config.provider?.default || this.providerInstance?.id || undefined,
      lastModel: loop.getModelOverride() || this.config.models.default,
    });

    if (resumeSessionId && useFullscreenTui) {
      tui.loadHistory(loop.getHistory());
      tui.setCost(
        loop.getSessionCost(),
        loop.getTotalInputTokens(),
        loop.getTotalCacheReadTokens(),
        loop.getTotalOutputTokens(),
      );
    }

    tui.setModelNameGetter(
      () => loop.getModelOverride() || this.config.models.default,
    );

    // Discover long-lived MCP prompts before the first interactive input.
    await loop.initializeMcp();

    // Load autocomplete candidates
    this.candidates = await getAutocompleteCandidates(
      this.cwd,
      this.config,
      buildMcpPromptCommandCandidates(loop.listMcpPrompts()),
    );
    tui.setCandidates(this.candidates);

    const onModelDelta = (payload: EventPayload<"model_delta">) => {
      if (useFullscreenTui) {
        tui.handleModelDelta(payload.text);
      } else {
        process.stdout.write(payload.text);
      }
    };
    const onLoopStart = (payload: EventPayload<"loop_start">) => {
      if (useFullscreenTui) {
        tui.startAttempt(payload.attempt);
      }
    };
    const onModelRequest = (payload: EventPayload<"model_request">) => {
      if (useFullscreenTui && payload?.model) {
        tui.setActiveModelName(payload.model);
      }
    };
    const onCostUpdate = (payload: EventPayload<"cost_update">) => {
      if (useFullscreenTui) {
        tui.setCost(
          payload.sessionCost,
          payload.totalInputTokens,
          payload.totalCacheReadTokens,
          payload.totalOutputTokens,
          payload.costKnown,
        );
      }
    };
    const onCacheUpdate = (payload: EventPayload<"cache_update">) => {
      if (useFullscreenTui) {
        tui.setCacheTelemetry(payload);
      }
    };
    const onThinkingDelta = (payload: EventPayload<"thinking_delta">) => {
      if (useFullscreenTui) {
        tui.handleThinkingDelta(payload.text);
      } else {
        process.stdout.write(terminalColors.gray(payload.text));
      }
    };
    const onBackgroundTaskStarted = (
      payload: EventPayload<"background_task_started">,
    ) => {
      if (payload.sessionId !== loop.getSessionId()) return;
      tuiInteraction.showText(
        `${terminalColors.cyan("●")} Background task ${payload.taskId} started.`,
      );
    };
    const onBackgroundTaskCompleted = (
      payload: EventPayload<"background_task_completed">,
    ) => {
      if (payload.sessionId !== loop.getSessionId()) return;
      const success = payload.status === "completed";
      const symbol = success
        ? terminalColors.green("✔")
        : payload.status === "killed"
          ? terminalColors.yellow("⚠️")
          : terminalColors.red("✖");
      tuiInteraction.showText(
        `${symbol} Background task ${payload.taskId} ${payload.status}${payload.exitCode === null ? "" : ` (exit ${payload.exitCode})`}.`,
      );
    };

    eventBus.on("model_delta", onModelDelta);
    eventBus.on("loop_start", onLoopStart);
    eventBus.on("model_request", onModelRequest);
    eventBus.on("cost_update", onCostUpdate);
    eventBus.on("cache_update", onCacheUpdate);
    eventBus.on("thinking_delta", onThinkingDelta);
    eventBus.on("background_task_started", onBackgroundTaskStarted);
    eventBus.on("background_task_completed", onBackgroundTaskCompleted);

    // Start background file watcher (Dynamic Incremental Watcher with Config Ignores)
    const ignorePatterns = this.config.context?.ignore || [];
    const ignoreRegexes = ignorePatterns.map((pattern: string) => {
      const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "__DOUBLE_STAR__")
        .replace(/\*/g, "[^/]*")
        .replace(/__DOUBLE_STAR__\/?/g, "(?:|.*/)");
      const finalPattern = escaped.endsWith(".*")
        ? "^" + escaped + "$"
        : "(^" + escaped + "$|^" + escaped + "\/.*)";
      return new RegExp(finalPattern);
    });

    const normCwd = resolve(this.cwd).toLowerCase().replace(/\\/g, "/");
    const normHome = resolve(homedir()).toLowerCase().replace(/\\/g, "/");
    const isHomeOrRoot =
      normCwd === normHome ||
      normCwd === "/" ||
      /^[a-zA-Z]:\/$/.test(normCwd) ||
      dirname(normCwd) === normCwd;

    if (!isHomeOrRoot) {
      const indexer = new SymbolIndexer(this.cwd);
      this.watcher = watch(
        this.cwd,
        { recursive: true },
        (eventType, filename) => {
          if (
            filename &&
            /\.(ts|tsx|js|jsx)$/.test(filename) &&
            !filename.includes(".orbit")
          ) {
            const normalized = filename.replace(/\\/g, "/");
            const isIgnored = ignoreRegexes.some((rx: RegExp) =>
              rx.test(normalized),
            );
            if (isIgnored) return;

            if (this.watchTimeout) clearTimeout(this.watchTimeout);
            this.watchTimeout = setTimeout(() => {
              indexer.index().catch(() => {});
            }, 500); // debounce 500ms
          }
        },
      );
    }

    if (useFullscreenTui) {
      tui.start(this.config.budgetLimit);
    } else if (screenReaderMode) {
      console.log(
        formatScreenReaderHeader(
          loop.getSessionId(),
          this.config.models.default,
          this.cwd,
          version,
        ),
      );
    } else {
      Renderer.printHeader(
        loop.getSessionId(),
        this.config.models.default,
        this.cwd,
        version,
      );
    }

    let resolveProjectHandoff: (() => void) | undefined;
    const projectHandoff = new Promise<void>((resolveHandoff) => {
      resolveProjectHandoff = resolveHandoff;
    });
    const handleProjectHandoff = () => {
      const timer = setTimeout(() => {
        if (this.webUiOnly) {
          resolveProjectHandoff?.();
        } else {
          void stopOrbitWebUi();
        }
      }, 750);
      timer.unref();
    };
    const commandRouter = new CommandRouter(
      this.cwd,
      this.config,
      this.providerInstance,
      (newProvider: ModelProvider) => {
        this.providerInstance = newProvider;
      },
      loop,
      tui,
      useFullscreenTui,
      () => this.candidates,
      (c: AutocompleteCandidates) => {
        this.candidates = c;
        tui.setCandidates(c);
      },
      this.getLocalState.bind(this),
      this.saveLocalState.bind(this),
      tuiInteraction,
      this.multi,
      undefined,
      handleProjectHandoff,
      this.agentProfile,
    );

    screenReaderOutputGuard?.start();
    try {
      if (this.webUiOnly) {
        const command = [
          "/webui",
          this.webUiOnly.port !== undefined
            ? `--port ${this.webUiOnly.port}`
            : "",
        ]
          .filter(Boolean)
          .join(" ");
        const result = await commandRouter.route(command);
        if (!result.processed) {
          throw new Error("Orbit Web UI could not be started.");
        }
        let resolveSignal: (() => void) | undefined;
        const signal = new Promise<void>((resolveStop) => {
          resolveSignal = resolveStop;
          process.once("SIGINT", resolveStop);
          process.once("SIGTERM", resolveStop);
        });
        await Promise.race([signal, projectHandoff]);
        if (resolveSignal) {
          process.off("SIGINT", resolveSignal);
          process.off("SIGTERM", resolveSignal);
        }
        return;
      }

      while (true) {
        let input: string | null;
        if (useFullscreenTui) {
          input = await tui.askInput({
            echoSubmitted: (submitted) => {
              const trimmedSubmitted = submitted.trim();
              return (
                !trimmedSubmitted.startsWith("/") &&
                !trimmedSubmitted.startsWith("!")
              );
            },
          });
        } else {
          input = await Prompt.askTextWithAutocomplete(
            "Type your task or command...",
            this.makeCompleter(),
            `${terminalColors.bold(terminalColors.magenta("orbit"))}${terminalColors.gray(" ❯ ")}`,
          );
        }

        if (input === null) {
          if (useFullscreenTui) {
            tui.stop();
          } else {
            console.log(
              terminalColors.yellow(
                "Exiting Orbit Interactive Shell. Goodbye!",
              ),
            );
          }
          break;
        }
        if (!input) continue;

        const trimmed = input.trim();
        if (!trimmed) continue;

        if (this.handleTerminalAttachmentCommand(trimmed, tuiInteraction)) {
          continue;
        }

        const releaseTerminalRun = commandRouter.beginTerminalRun();
        if (!releaseTerminalRun) {
          tuiInteraction.showText(
            this.config.language !== "en"
              ? "⚠️ Web UI 正在处理任务，请等待完成或在浏览器中停止后再提交终端指令。"
              : "⚠️ The Web UI is processing a task. Wait for it to finish or stop it in the browser before submitting a terminal command.",
          );
          continue;
        }

        try {
          const routeResult = await commandRouter.route(trimmed);
          if (routeResult.shouldExit) {
            break;
          }
          if (routeResult.processed) {
            continue;
          }
          const routedInput = routeResult.input ?? trimmed;

          const attachments = this.takeTerminalAttachments();
          if (attachments.length > 0 && this.multi) {
            tuiInteraction.showText(
              "✖ Image attachments are currently supported by single-agent TUI turns only.",
            );
            this.terminalAttachments.unshift(...attachments);
            continue;
          }
          const activeModel =
            loop.getModelOverride() || this.config.models.default;
          const activeCapabilities =
            this.providerInstance.getModelCapabilities?.(activeModel);
          if (attachments.length > 0 && !activeCapabilities?.vision) {
            tuiInteraction.showText(
              `✖ The selected model (${activeModel}) does not support image input.`,
            );
            this.terminalAttachments.unshift(...attachments);
            continue;
          }
          loop.prepareUserTurn(routedInput, attachments);
          const terminalTurnId = randomUUID();
          eventBus.emitEvent("ui_turn_started", {
            turnId: terminalTurnId,
            source: "terminal",
            prompt: trimmed,
          });

          ensureSessionTitle(loop, trimmed);

          let orchestratorInstance: Orchestrator | null = null;
          if (this.multi) {
            orchestratorInstance = new Orchestrator(
              this.cwd,
              this.config,
              this.providerInstance,
              routedInput,
              tuiInteraction,
            );
            tui.setActiveRunnable(orchestratorInstance);
          } else {
            tui.setActiveRunnable(loop);
          }

          tui.startThinkingInput();

          let terminalOutcome: AgentLoopRunOutcome | undefined;
          try {
            if (orchestratorInstance) {
              terminalOutcome = await orchestratorInstance.run();
            } else {
              terminalOutcome = await loop.run();
            }
          } catch (error) {
            terminalOutcome = {
              status: "failed",
              sessionId: loop.getSessionId(),
              attempts: 0,
              error: {
                code: "execution_error",
                message: error instanceof Error ? error.message : String(error),
              },
            };
            // Fallback
          } finally {
            tui.stopThinkingInput();
            tui.setActiveRunnable(null);
            eventBus.emitEvent("ui_turn_completed", {
              turnId: terminalTurnId,
              source: "terminal",
              status: terminalOutcome?.status || "failed",
              message: getRunOutcomeMessage(terminalOutcome),
            });
          }

          // Inputs that could not be consumed as safe in-turn steering become
          // ordered outer turns. This also drains follow-ups queued by Web UI.
          for (;;) {
            const queuedInput = loop.takeNextQueuedInput();
            if (!queuedInput) break;
            const guidedTask = queuedInput.text;

            const isZh = this.config.language !== "en";
            tuiInteraction.showText(
              isZh
                ? `\n● 收到引导指令。正在重新规划思考...`
                : `\n● Guided instruction received. Replanning execution...`,
            );

            loop.prepareQueuedUserTurn(queuedInput);
            const guidedTurnId = randomUUID();
            eventBus.emitEvent("ui_turn_started", {
              turnId: guidedTurnId,
              source: "terminal",
              prompt: guidedTask,
            });

            tui.syncFromLoop(loop);

            let subOrchestrator: Orchestrator | null = null;
            if (this.multi) {
              subOrchestrator = new Orchestrator(
                this.cwd,
                this.config,
                this.providerInstance,
                guidedTask,
                tuiInteraction,
              );
              tui.setActiveRunnable(subOrchestrator);
            } else {
              tui.setActiveRunnable(loop);
            }

            tui.startThinkingInput();

            let guidedOutcome: AgentLoopRunOutcome | undefined;
            try {
              if (subOrchestrator) {
                guidedOutcome = await subOrchestrator.run();
              } else {
                guidedOutcome = await loop.run();
              }
            } catch (error) {
              guidedOutcome = {
                status: "failed",
                sessionId: loop.getSessionId(),
                attempts: 0,
                error: {
                  code: "execution_error",
                  message:
                    error instanceof Error ? error.message : String(error),
                },
              };
              // Fallback
            } finally {
              tui.stopThinkingInput();
              tui.setActiveRunnable(null);
              eventBus.emitEvent("ui_turn_completed", {
                turnId: guidedTurnId,
                source: "terminal",
                status: guidedOutcome?.status || "failed",
                message: getRunOutcomeMessage(guidedOutcome),
              });
            }
          }
          tui.syncFromLoop(loop);
          tui.finishAttempt();

          // Refresh candidates in the background asynchronously
          getAutocompleteCandidates(
            this.cwd,
            this.config,
            buildMcpPromptCommandCandidates(loop.listMcpPrompts()),
          )
            .then((c) => {
              this.candidates = c;
              tui.setCandidates(c);
            })
            .catch(() => {});
        } finally {
          releaseTerminalRun();
        }
      }
    } finally {
      process.off("SIGINT", sigintHandler);
      this.watcher?.close();
      if (this.watchTimeout) clearTimeout(this.watchTimeout);
      eventBus.off("model_delta", onModelDelta);
      eventBus.off("loop_start", onLoopStart);
      eventBus.off("model_request", onModelRequest);
      eventBus.off("cost_update", onCostUpdate);
      eventBus.off("cache_update", onCacheUpdate);
      eventBus.off("thinking_delta", onThinkingDelta);
      eventBus.off("background_task_started", onBackgroundTaskStarted);
      eventBus.off("background_task_completed", onBackgroundTaskCompleted);
      if (useFullscreenTui) {
        Prompt.setTuiInstance(null);
      }
      Prompt.setAccessibilityMode("standard");
      try {
        await stopOrbitWebUi();
        await loop.dispose();
        tui.dispose();
        this.autocompleteServer?.close();
      } finally {
        screenReaderOutputGuard?.stop();
      }
    }
  }

  private makeCompleter() {
    return (line: string): [string[], string] => {
      const candidates = this.candidates;
      if (!candidates) return [[], ""];

      if (line.startsWith("/")) {
        const hits = candidates.commands.filter((command) =>
          command.startsWith(line),
        );
        return [hits.length ? hits : candidates.commands, line];
      }

      const words = line.split(/\s+/);
      const lastWord = words[words.length - 1] || "";

      if (!lastWord) {
        return [[], lastWord];
      }

      const fileHits = candidates.files.filter((file) =>
        file.startsWith(lastWord),
      );
      const symbolHits = candidates.symbols.filter((symbol) =>
        symbol.startsWith(lastWord),
      );
      const allHits = [...fileHits, ...symbolHits];

      return [allHits, lastWord];
    };
  }
}

function hasBearerToken(req: http.IncomingMessage, expected: string): boolean {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(authorization.slice(7));
  const expectedBuffer = Buffer.from(expected);
  return (
    provided.length === expectedBuffer.length &&
    timingSafeEqual(provided, expectedBuffer)
  );
}

async function readLimitedBody(
  req: http.IncomingMessage,
  limitBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limitBytes) {
      throw new Error("Request body too large.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
