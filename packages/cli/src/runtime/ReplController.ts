import {
  AgentLoop,
  UserInteraction,
  Orchestrator,
  eventBus,
  AutocompleteEngine,
  type AgentLoopRunOutcome,
} from "@orbit-build/core";
import { Prompt, Renderer, DiffView } from "@orbit-build/tui";
import picocolors from "picocolors";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  watch,
  writeFileSync,
} from "fs";
import { dirname, resolve } from "path";
import { homedir } from "os";
import http from "http";
import { randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { z } from "zod";
import { SymbolIndexer } from "@orbit-build/context-engine";
import { FullscreenTui, pageText } from "../tui/FullscreenTui.js";
import { CommandRouter, getAutocompleteCandidates } from "./CommandRouter.js";
import { buildMcpPromptCommandCandidates } from "./McpPromptCommands.js";
import { stopOrbitWebUi } from "./webui/index.js";
import { resolveSafePath } from "@orbit-build/shared";
import { readCliVersion } from "./CliVersion.js";
import { ensureSessionTitle } from "./SessionTitles.js";
import { OrbitLanguageSchema, type OrbitLanguage } from "@orbit-build/config";

const AutocompleteRequestSchema = z.object({
  prefix: z.string().max(20000),
  suffix: z.string().max(20000),
  windowId: z.string().max(1000).optional(),
});
const AUTOCOMPLETE_BODY_LIMIT_BYTES = 100_000;
const AUTOCOMPLETE_MAX_CONCURRENCY = 4;

const LocalStateSchema = z.object({
  lastSessionId: z.string().optional(),
  lastModel: z.string().optional(),
  language: OrbitLanguageSchema.optional(),
});

const AutocompleteEndpointSchema = z.object({
  port: z.number().int().min(1).max(65535),
  token: z.string().min(32).max(256),
});

interface LocalState {
  lastSessionId?: string;
  lastModel?: string;
  language?: OrbitLanguage;
  skills?: {
    enabled?: boolean;
    activation?: "auto" | "explicit";
    maxActive?: number;
    disabled?: string[];
  };
}

function getRunOutcomeMessage(
  outcome: AgentLoopRunOutcome | undefined,
): string | undefined {
  if (!outcome || outcome.status === "completed") return undefined;
  return outcome.status === "failed" ? outcome.error.message : outcome.message;
}

export class ReplController {
  private currentTui: FullscreenTui | null = null;
  private watchTimeout: NodeJS.Timeout | null = null;
  private watcher: any = null;
  private candidates: any = null;
  private autocompleteServer: http.Server | null = null;

  constructor(
    private cwd: string,
    private config: any,
    private providerInstance: any,
    private interaction: UserInteraction,
    private multi?: boolean,
    private direct?: boolean,
    private webUiOnly?: {
      port?: number;
      /** @deprecated Orbit no longer opens a browser automatically. */
      open?: boolean;
    },
  ) {}

  private getLocalState(): LocalState {
    try {
      const statePath = resolveSafePath(this.cwd, ".orbit/state.json");
      if (!existsSync(statePath)) return {};
      const parsed = LocalStateSchema.safeParse(
        JSON.parse(readFileSync(statePath, "utf8")),
      );
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  }

  private saveLocalState(state: LocalState): void {
    try {
      const statePath = resolveSafePath(this.cwd, ".orbit/state.json");
      const dir = dirname(statePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const current = this.getLocalState();
      const updated = LocalStateSchema.parse({ ...current, ...state });
      const temporaryPath = `${statePath}.${process.pid}.tmp`;
      writeFileSync(temporaryPath, JSON.stringify(updated, null, 2), "utf8");
      renameSync(temporaryPath, statePath);
    } catch {}
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
      const dir = dirname(endpointPath);
      mkdirSync(dir, { recursive: true });
      const temporaryPath = `${endpointPath}.${process.pid}.tmp`;
      writeFileSync(
        temporaryPath,
        JSON.stringify({ port: currentPort, token }, null, 2),
        { encoding: "utf8", mode: 0o600 },
      );
      renameSync(temporaryPath, endpointPath);
      eventBus.emitEvent("info", {
        message: `Autocomplete bridge server running on http://127.0.0.1:${currentPort}`,
      });
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
        const current = AutocompleteEndpointSchema.parse(
          JSON.parse(readFileSync(endpointPath, "utf8")),
        );
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

    const isTTY =
      process.stdin.isTTY && typeof process.stdin.setRawMode === "function";
    const useFullscreenTui = isTTY && !this.direct && !this.webUiOnly;
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
          console.log(picocolors.gray(`Parameters: ${preview}`));
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

        await pageText(DiffView.render(filePath, before, after));

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
        disableStatusBar: useFullscreenTui,
        sessionId: resumeSessionId,
      },
    );

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
        picocolors.yellow(
          `⚠️ ${isZh ? "已恢复上次异常中断的会话" : "Recovered the previously interrupted session"}${repaired.length ? `：${repaired.join(isZh ? "；" : "; ")}` : "。"}`,
        ),
      );
    }

    this.saveLocalState({
      lastSessionId: loop.getSessionId(),
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

    // Load autocomplete candidates
    this.candidates = await getAutocompleteCandidates(
      this.cwd,
      this.config,
      buildMcpPromptCommandCandidates(loop.listMcpPrompts()),
    );
    tui.setCandidates(this.candidates);

    const onModelDelta = (payload: any) => {
      if (useFullscreenTui) {
        tui.handleModelDelta(payload.text);
      } else {
        process.stdout.write(payload.text);
      }
    };
    const onLoopStart = (payload: any) => {
      if (useFullscreenTui) {
        tui.startAttempt(payload.attempt);
      }
    };
    const onModelRequest = (payload: any) => {
      if (useFullscreenTui && payload?.model) {
        tui.setActiveModelName(payload.model);
      }
    };
    const onCostUpdate = (payload: any) => {
      if (useFullscreenTui) {
        tui.setCost(
          payload.sessionCost,
          payload.totalInputTokens,
          payload.totalCacheReadTokens,
          payload.totalOutputTokens,
        );
      }
    };
    const onCacheUpdate = (payload: any) => {
      if (useFullscreenTui) {
        tui.setCacheTelemetry(payload);
      }
    };
    const onThinkingDelta = (payload: any) => {
      if (useFullscreenTui) {
        tui.handleThinkingDelta(payload.text);
      } else {
        process.stdout.write(picocolors.gray(payload.text));
      }
    };

    eventBus.on("model_delta", onModelDelta);
    eventBus.on("loop_start", onLoopStart);
    eventBus.on("model_request", onModelRequest);
    eventBus.on("cost_update", onCostUpdate);
    eventBus.on("cache_update", onCacheUpdate);
    eventBus.on("thinking_delta", onThinkingDelta);

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
      (newProvider: any) => {
        this.providerInstance = newProvider;
      },
      loop,
      tui,
      useFullscreenTui,
      () => this.candidates,
      (c: any) => {
        this.candidates = c;
        tui.setCandidates(c);
      },
      this.getLocalState.bind(this),
      this.saveLocalState.bind(this),
      tuiInteraction,
      this.multi,
      undefined,
      handleProjectHandoff,
    );

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
            `${picocolors.bold(picocolors.magenta("orbit"))}${picocolors.gray(" ❯ ")}`,
          );
        }

        if (input === null) {
          if (useFullscreenTui) {
            tui.stop();
          } else {
            console.log(
              picocolors.yellow("Exiting Orbit Interactive Shell. Goodbye!"),
            );
          }
          break;
        }
        if (!input) continue;

        const trimmed = input.trim();
        if (!trimmed) continue;

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

          loop.prepareUserTurn(trimmed);
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
              trimmed,
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

          // If a guided correction was entered during execution, loop to append and rerun
          while (tui.pendingGuidedStatement) {
            const guidedTask = tui.pendingGuidedStatement;
            tui.pendingGuidedStatement = null;

            const isZh = this.config.language !== "en";
            tuiInteraction.showText(
              isZh
                ? `\n● 收到引导指令。正在重新规划思考...`
                : `\n● Guided instruction received. Replanning execution...`,
            );

            loop.prepareUserTurn(guidedTask);
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
      if (useFullscreenTui) {
        Prompt.setTuiInstance(null);
      }
      await stopOrbitWebUi();
      tui.dispose();
      this.autocompleteServer?.close();
    }
  }

  private makeCompleter() {
    return (line: string): [string[], string] => {
      const candidates = this.candidates;
      if (!candidates) return [[], ""];

      if (line.startsWith("/")) {
        const hits = candidates.commands.filter((c: string) =>
          c.startsWith(line),
        );
        return [hits.length ? hits : candidates.commands, line];
      }

      const words = line.split(/\s+/);
      const lastWord = words[words.length - 1] || "";

      if (!lastWord) {
        return [[], lastWord];
      }

      const fileHits = candidates.files.filter((f: string) =>
        f.startsWith(lastWord),
      );
      const symbolHits = candidates.symbols.filter((s: string) =>
        s.startsWith(lastWord),
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
