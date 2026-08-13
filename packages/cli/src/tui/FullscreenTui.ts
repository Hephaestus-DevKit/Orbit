import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import { exec } from "child_process";
import {
  HIDDEN_CHILD_PROCESS_OPTIONS,
  readBoundedRegularFile,
  redactSecrets,
  replacePrivateFileAtomically,
} from "@orbit-build/shared";
import { localizeOrbit, type OrbitConfig } from "@orbit-build/config";
import type { OrbitMessage } from "@orbit-build/model-providers";
import readline from "readline";
import { Prompt, Renderer } from "@orbit-build/tui";
import {
  BUILTIN_SLASH_COMMANDS,
  SLASH_COMMAND_DEFINITIONS,
  localizeSlashText,
  type SlashCommandDetail,
} from "../runtime/SlashCommandCatalog.js";
import { getProviderModelCandidates } from "../runtime/ModelCatalog.js";
import {
  findPreviousHistoryEntry,
  getSlashSuggestionFooterText,
  nextCodePointIndex,
  nextWordIndex,
  parseMouseWheelDirection,
  previousCodePointIndex,
  previousWordIndex,
  rankSlashCandidates,
  selectActiveSlashSuggestion,
} from "./TuiInputHelpers.js";
import {
  formatWrappedLines,
  getCursorPositionInWrappedInput,
  getStringWidth,
  stripAnsiCodes,
  truncatePathToWidth,
  truncatePlainToWidth,
  truncateToWidth,
  wrapAnsiLine,
  wrapInputText,
  type WrappedInputLine,
} from "./TerminalText.js";
import { InputHistoryStore } from "./InputHistoryStore.js";
import { MORANDI } from "./TuiTheme.js";
import {
  TuiPromptSession,
  type TuiPromptConfig,
  type TuiPromptResult,
} from "./TuiPromptSession.js";
import { renderPromptScreen } from "./TuiPromptView.js";
import { UpdateManager } from "../runtime/UpdateManager.js";
import {
  buildTuiConversationViewModel,
  type TuiActionLink,
  type TuiHistoryEntry,
} from "./TuiConversationViewModel.js";
import {
  TuiEnvironmentStatus,
  type TuiCacheTelemetry,
} from "./TuiEnvironmentStatus.js";

export {
  filterPromptOptionIndices,
  findPreviousHistoryEntry,
  getSlashSuggestionFooterText,
  nextCodePointIndex,
  nextWordIndex,
  parseMouseWheelDirection,
  previousCodePointIndex,
  previousWordIndex,
  rankSlashCandidates,
  selectActiveSlashSuggestion,
} from "./TuiInputHelpers.js";
export { pageText } from "./TextPager.js";
export { stripAnsiCodes } from "./TerminalText.js";

const TUI_ERROR_LOG_MAX_BYTES = 1_048_576;

function appendTuiErrorLog(context: string, error: unknown): void {
  try {
    const logPath = join(homedir(), ".orbit", "tui_error.log");
    let previous = "";
    try {
      previous = readBoundedRegularFile(logPath, TUI_ERROR_LOG_MAX_BYTES) ?? "";
    } catch {
      // An oversized prior log is replaced; unsafe paths remain rejected below.
    }
    const detail = redactSecrets(
      error instanceof Error ? error.stack || error.message : String(error),
    )
      .replace(/\u0000/g, "")
      .slice(0, 8_000);
    const entry = `[${new Date().toISOString()}] ${context}: ${detail}\n`;
    let combined = `${previous}${entry}`;
    while (
      Buffer.byteLength(combined, "utf8") > TUI_ERROR_LOG_MAX_BYTES &&
      combined.length > entry.length
    ) {
      combined = combined.slice(Math.min(combined.length - entry.length, 8192));
    }
    replacePrivateFileAtomically(logPath, combined);
  } catch {
    // Terminal recovery must not fail because diagnostic persistence is unsafe.
  }
}

export type SubmittedInputEcho = boolean | ((submitted: string) => boolean);

export interface AskInputOptions {
  echoSubmitted?: SubmittedInputEcho;
}

export interface FullscreenTuiDependencies {
  checkOrbitUpdate?: (currentVersion: string) => Promise<boolean>;
}

interface LoopViewSource {
  getRelevantFiles(): Array<{
    path: string;
    reason: string;
    readOnly?: boolean;
  }>;
  getHistory(): OrbitMessage[];
}

interface CachedTuiHistoryEntry extends TuiHistoryEntry {
  _lastMarkdownRenderTime?: number;
  _formattedCached?: string[];
  _textCached?: string;
}

type StdinEmit = (event: string | symbol, ...args: unknown[]) => boolean;

// Width of the fixed input-box left prefix "  │ orbit > " (constant, pre-calculated)
const INPUT_PREFIX_WIDTH = 12; // "  │ orbit > " visual width

function terminalHyperlink(label: string, url: string): string {
  return `\u001b]8;;${url}\u0007${label}\u001b]8;;\u0007`;
}

export class FullscreenTui {
  private history: TuiHistoryEntry[] = [];

  private inputBuffer = "";
  private cursorPosition = 0;
  public isActive = false;
  private readonly environmentStatus = new TuiEnvironmentStatus();

  // Command history
  private inputHistory: string[] = [];
  private historyIndex = -1;
  private historySearchQuery: string | null = null;
  private tempBuffer = "";
  private activeCommandIndex = 0;
  private ctrlCPressedOnce = false;
  private ctrlCTimeout: NodeJS.Timeout | null = null;
  private cachedStaticLinesCount = 0;
  private cachedStaticContent = "";
  private lastRenderedBottomHeight = 0;

  // DeepSeek real-time thinking
  private currentThinking = "";

  // Timers and metrics
  private attemptStartTime = 0;
  private firstDeltaTime = 0;
  private thoughtTimer: NodeJS.Timeout | null = null;
  private thoughtElapsed = 0;
  private readonly promptSession = new TuiPromptSession(() => this.render());

  private isThinking = false;

  private hasCheckedOrbitUpdate = false;
  private isCheckingOrbitUpdate = false;
  private orbitUpdateAvailable = false;
  private orbitRestartRequired = false;
  private budgetLimit = 0;

  private resolveInput: ((val: string | null) => void) | null = null;
  private activeRunnable: {
    abort: (mode?: "prompt" | "immediate") => void;
  } | null = null;
  private thinkingKeypressListener:
    | ((str: string, key: readline.Key) => void)
    | null = null;
  private activeInputHandler: ((submitted: string) => boolean) | null = null;

  // Throttled rendering to prevent terminal flickering during model output
  private lastRenderTime = 0;
  private renderPending = false;
  private renderTimeout: NodeJS.Timeout | null = null;
  private hasRenderedAttemptDelta = false;

  private originalWrite: typeof process.stdout.write | null = null;
  private hasWrittenStdoutSinceStop = false;
  private originalStdinEmit: StdinEmit | null = null;

  private candidates: {
    commands: string[];
    commandDetails: SlashCommandDetail[];
    files: string[];
    symbols: string[];
    sessions: string[];
  } | null = null;
  private modelNameGetter: () => string = () => this.modelName;
  private hideAutocomplete = false;
  /** Cached logo-line widths — static strings, computed once. */
  private _cachedLogoWidths: {
    w0: number;
    w1: number;
    w2: number;
    w3: number;
    maxW: number;
  } | null = null;

  private cachedPlanLines: string[] = [];
  private lastPlanReadTime = 0;
  private activeContextFiles: Array<{
    path: string;
    reason: string;
    readOnly?: boolean;
  }> = [];
  private cachedGitSummary: {
    branch: string;
    added: number;
    modified: number;
    deleted: number;
  } | null = null;
  private lastGitSummaryReadTime = 0;
  private isRefreshingGit = false;
  private historyScrollOffset = 0;
  private maxHistoryScrollOffset = 0;
  private lastHistoryLineCount = 0;
  private hasNewOutputWhileScrolled = false;
  private readonly inputHistoryStore = new InputHistoryStore();
  private terminalInitialized = false;
  private readonly checkOrbitUpdate: (
    currentVersion: string,
  ) => Promise<boolean>;

  private getPlanLines(): string[] {
    const now = Date.now();
    if (now - this.lastPlanReadTime < 2000) {
      return this.cachedPlanLines;
    }
    this.lastPlanReadTime = now;
    const planPath2 = join(this.cwd, ".orbit", "task.md");
    const planPath1 = join(this.cwd, "task.md");
    let planPath = "";
    if (existsSync(planPath2)) {
      planPath = planPath2;
    } else if (existsSync(planPath1)) {
      planPath = planPath1;
    }
    if (!planPath) {
      this.cachedPlanLines = [];
      return [];
    }
    try {
      const content = readBoundedRegularFile(planPath, 1024 * 1024);
      if (content === undefined) {
        this.cachedPlanLines = [];
        return [];
      }
      const lines = content.split("\n");
      const planItems: string[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (
          trimmed.startsWith("- [ ") ||
          trimmed.startsWith("- [x") ||
          trimmed.startsWith("- [/")
        ) {
          planItems.push(trimmed);
        }
      }
      this.cachedPlanLines = planItems;
    } catch {
      this.cachedPlanLines = [];
    }
    return this.cachedPlanLines;
  }

  public setPermissionsMode(mode: string) {
    this.environmentStatus.setPermissionsMode(mode);
  }

  public setModelNameGetter(getter: () => string) {
    this.modelNameGetter = getter;
  }

  public setActiveModelName(model: string) {
    const cleanModel = model.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
    this.environmentStatus.setActiveModelName(cleanModel);
    const lastAsst = [...this.history]
      .reverse()
      .find((m) => m.role === "assistant" && (!m.text || !m.model));
    if (lastAsst) {
      lastAsst.model = cleanModel;
    }
    this.render();
  }

  public setActiveRunnable(
    runnable: {
      abort: (mode?: "prompt" | "immediate") => void;
    } | null,
  ) {
    this.activeRunnable = runnable;
  }

  public hasActiveRunnable(): boolean {
    return this.activeRunnable !== null;
  }

  public abortActiveRunnable(mode: "prompt" | "immediate" = "prompt"): boolean {
    if (!this.activeRunnable) return false;
    this.activeRunnable.abort(mode);
    return true;
  }

  /** Route text entered during a run into the shared agent input queue. */
  public setActiveInputHandler(
    handler: ((submitted: string) => boolean) | null,
  ): void {
    this.activeInputHandler = handler;
  }

  public constructor(
    private cwd: string,
    private modelName: string,
    private version: string,
    private config?: OrbitConfig,
    dependencies: FullscreenTuiDependencies = {},
  ) {
    this.checkOrbitUpdate =
      dependencies.checkOrbitUpdate ??
      (async (currentVersion) =>
        (await new UpdateManager().checkAsync(currentVersion)).updateAvailable);
  }

  /**
   * Installs process-level terminal hooks and loads persisted input history.
   * This method is explicit and idempotent so construction remains side-effect free.
   */
  public initialize(): void {
    if (this.terminalInitialized) return;

    readline.emitKeypressEvents(process.stdin);
    this.originalWrite = process.stdout.write;
    const originalWrite = this.originalWrite;
    process.stdout.write = ((
      chunk: string | Uint8Array,
      ...args: unknown[]
    ) => {
      if (!this.isActive) {
        const text =
          typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
        if (text.trim().length > 0) {
          this.hasWrittenStdoutSinceStop = true;
        }
      }
      return Reflect.apply(originalWrite, process.stdout, [
        chunk,
        ...args,
      ]) as boolean;
    }) as typeof process.stdout.write;
    this.inputHistory = this.inputHistoryStore.load();
    this.terminalInitialized = true;
  }

  private formatSystemStatusLine(
    rawLine: string,
    prefixUnknown: boolean,
    actionLink?: TuiActionLink,
  ): string {
    const morandi = MORANDI;
    const plain = stripAnsiCodes(rawLine.trim()).trim();
    if (!plain) return "";
    if (/^(?:✓|✔)\s*Success/i.test(plain) || /^✖\s*Failed/i.test(plain)) {
      return "";
    }
    if (plain.startsWith("✔")) {
      const renderedLink = actionLink
        ? ` ${terminalHyperlink(
            morandi.accent(actionLink.label),
            actionLink.url,
          )} ${morandi.dim("·")}`
        : "";
      return (
        morandi.completed("completed") +
        renderedLink +
        morandi.gray(plain.substring(1))
      );
    }
    if (plain.startsWith("✖")) {
      return morandi.failed("failed") + morandi.gray(plain.substring(1));
    }
    if (plain.startsWith("●")) {
      return morandi.cyan("●") + morandi.gray(plain.substring(1));
    }
    if (plain.startsWith("✦")) {
      return morandi.cyan("✦") + morandi.gray(plain.substring(1));
    }
    if (plain.startsWith("⚠")) {
      return morandi.warn("⚠") + morandi.gray(plain.substring(1));
    }
    if (prefixUnknown) {
      return morandi.cyan("✦") + " " + morandi.gray(plain);
    }
    return morandi.gray(plain);
  }

  private formatSystemLinesForDisplay(
    system: TuiHistoryEntry[],
    options: { prefixUnknown: boolean; preserveBlank: boolean },
  ): string[] {
    const morandi = MORANDI;
    const lines: string[] = [];
    let liveLookupCount = 0;
    let liveLookupTool = "";
    let liveLookupResults = 0;
    let liveLookupOpenMeteo = false;
    let lastLiveLookupQuery = "";

    const flushLiveLookupSummary = () => {
      if (liveLookupCount === 0) return;
      const resultsText =
        liveLookupResults > 0 ? ` · ${liveLookupResults} results` : "";
      const sourceText = liveLookupOpenMeteo ? " · Open-Meteo" : "";
      const queryText = lastLiveLookupQuery
        ? truncatePlainToWidth(lastLiveLookupQuery, 42)
        : "";
      const label =
        liveLookupTool && liveLookupTool !== "mixed"
          ? liveLookupTool
          : "live_lookup";
      const summary =
        liveLookupCount === 1
          ? `${label}${queryText ? ` ${queryText}` : ""}${resultsText}${sourceText}`
          : label === "web_search"
            ? `web_search ${liveLookupCount} searches${resultsText}${
                queryText ? ` · latest: ${queryText}` : ""
              }`
            : `${label} ${liveLookupCount} lookups${resultsText}${sourceText}${
                queryText ? ` · latest: ${queryText}` : ""
              }`;
      lines.push(morandi.cyan("✦") + " " + morandi.gray(summary));
      liveLookupCount = 0;
      liveLookupTool = "";
      liveLookupResults = 0;
      liveLookupOpenMeteo = false;
      lastLiveLookupQuery = "";
    };

    for (const sys of system) {
      let pendingActionLink = sys.actionLink;
      const rawLines = sys.text.split("\n");
      for (const rawLine of rawLines) {
        const plain = stripAnsiCodes(rawLine.trim()).trim();
        if (!plain) {
          flushLiveLookupSummary();
          if (options.preserveBlank) lines.push("");
          continue;
        }

        const liveLookupMatch = plain.match(
          /^✦\s*(?:✨\s*)?(web_search)\b\s*(.*)$/i,
        );
        if (liveLookupMatch) {
          liveLookupCount += 1;
          const toolName = liveLookupMatch[1] || "";
          liveLookupTool =
            !liveLookupTool || liveLookupTool === toolName ? toolName : "mixed";
          const query = liveLookupMatch[2]?.trim();
          if (query) lastLiveLookupQuery = query;
          continue;
        }

        const webSearchSuccess = plain.match(
          /^(?:✓|✔)\s*Success:\s*Web search returned\s+(\d+)\s+results?/i,
        );
        if (webSearchSuccess) {
          liveLookupResults += Number(webSearchSuccess[1] || 0);
          continue;
        }

        if (
          /^(?:✓|✔)\s*Success:\s*Weather data returned\b.*\bOpen-Meteo\b/i.test(
            plain,
          )
        ) {
          liveLookupOpenMeteo = true;
          continue;
        }

        if (/^⚠.*(?:DeepSeek|Prompt) cache hit degraded/i.test(plain)) {
          continue;
        }

        flushLiveLookupSummary();
        const formatted = this.formatSystemStatusLine(
          rawLine,
          options.prefixUnknown,
          pendingActionLink,
        );
        if (formatted) {
          lines.push(formatted);
          pendingActionLink = undefined;
        }
      }
    }
    flushLiveLookupSummary();
    return lines;
  }

  public setCandidates(candidates: unknown) {
    if (!candidates || typeof candidates !== "object") {
      this.candidates = null;
      return;
    }
    const candidateRecord = candidates as Record<string, unknown>;
    const strings = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
    const details = Array.isArray(candidateRecord.commandDetails)
      ? candidateRecord.commandDetails.filter(
          (item): item is SlashCommandDetail =>
            Boolean(
              item &&
              typeof item === "object" &&
              typeof (item as SlashCommandDetail).command === "string" &&
              typeof (item as SlashCommandDetail).description === "string" &&
              [
                "context",
                "session",
                "settings",
                "git",
                "system",
                "workflow",
              ].includes((item as SlashCommandDetail).category) &&
              ["builtin", "user", "project", "mcp"].includes(
                (item as SlashCommandDetail).source,
              ) &&
              ((item as SlashCommandDetail).argumentHint === undefined ||
                typeof (item as SlashCommandDetail).argumentHint === "string"),
            ),
        )
      : [];
    this.candidates = {
      commands: strings(candidateRecord.commands),
      commandDetails: details,
      files: strings(candidateRecord.files),
      symbols: strings(candidateRecord.symbols),
      sessions: strings(candidateRecord.sessions),
    };
  }

  private saveInputHistory() {
    this.inputHistoryStore.save(this.inputHistory);
  }

  public addSystemMessage(
    text: string,
    _raw = false,
    actionLink?: TuiActionLink,
  ) {
    if (!text) return;
    this.history.push({
      role: "system",
      text: text,
      actionLink,
    });
    this.render();
  }

  /** Mirror a prompt submitted by another local UI into this conversation. */
  public addUserMessage(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.history.push({
      role: "user",
      text: trimmed,
    });
    this.render();
  }

  private onResize = () => {
    if (this.isActive) {
      this.render(true);
    }
  };

  public start(budgetLimit: number) {
    this.initialize();
    this.budgetLimit = budgetLimit;
    this.isActive = true;
    this.hasWrittenStdoutSinceStop = false;

    if (this.originalStdinEmit) {
      process.stdin.emit = this.originalStdinEmit;
      this.originalStdinEmit = null;
    }

    const mouseMode =
      this.config?.tui?.mouse !== false ? "\x1b[?1000h\x1b[?1006h" : "";
    // Save the main-buffer cursor before entering the alternate screen. Some
    // Windows/ConPTY combinations accept alternate-screen drawing but do not
    // restore its contents reliably. The saved cursor gives stop() a precise
    // fallback boundary that preserves the command used to launch Orbit.
    process.stdout.write(`\x1b7\x1b[?1049h${mouseMode}\x1b[?25l`);
    process.stdout.on("resize", this.onResize);

    if (this.config?.tui?.mouse !== false) {
      this.originalStdinEmit = process.stdin.emit.bind(process.stdin);
      process.stdin.emit = ((
        event: string | symbol,
        ...args: unknown[]
      ): boolean => {
        if (
          event === "data" &&
          (typeof args[0] === "string" || Buffer.isBuffer(args[0]))
        ) {
          const chunk = args[0];
          const isBuffer = Buffer.isBuffer(chunk);
          let str = isBuffer ? chunk.toString("utf8") : chunk;

          const sgrRegex = /\x1b\[<(\d+);(\d+);(\d+)([mM])/g;
          let match;
          let hasMouse = false;
          while ((match = sgrRegex.exec(str)) !== null) {
            hasMouse = true;
            const button = Number(match[1]);
            if ((button & 64) !== 0) {
              const direction = (button & 1) === 0 ? "up" : "down";
              const lines = this.getWheelScrollLines();
              this.scrollHistory(direction === "up" ? lines : -lines);
            }
          }

          if (hasMouse) {
            str = str.replace(sgrRegex, "");
          }

          const normalRegex = /\x1b\[M([\s\S]{3})/g;
          if (normalRegex.test(str)) {
            str = str.replace(normalRegex, "");
            hasMouse = true;
          }

          if (hasMouse) {
            if (str.length === 0) {
              return true;
            }
            args[0] = isBuffer ? Buffer.from(str, "utf8") : str;
          }
        }
        return this.originalStdinEmit?.(event, ...args) ?? false;
      }) as typeof process.stdin.emit;
    }

    this.render();
  }

  public stop() {
    if (!this.isActive) return;
    this.isActive = false;
    process.stdout.off("resize", this.onResize);
    // Leave the alternate screen, restore the launch cursor, and erase only
    // content written after it. This keeps the user's earlier terminal history
    // and `orbit` invocation even when alternate-buffer restoration is broken.
    process.stdout.write(
      "\x1b[?1006l\x1b[?1000l\x1b[?1049l\x1b8\x1b[0J\x1b[?25h",
    );
    this.hasWrittenStdoutSinceStop = false;
    if (this.renderTimeout) {
      clearTimeout(this.renderTimeout);
      this.renderTimeout = null;
    }
    this.renderPending = false;

    if (this.originalStdinEmit) {
      process.stdin.emit = this.originalStdinEmit;
      this.originalStdinEmit = null;
    }
  }

  public dispose() {
    this.promptSession.dispose();
    this.stopThinkingInput();
    this.stop();
    if (this.thoughtTimer) {
      clearInterval(this.thoughtTimer);
      this.thoughtTimer = null;
    }
    if (this.ctrlCTimeout) {
      clearTimeout(this.ctrlCTimeout);
      this.ctrlCTimeout = null;
    }
    if (process.stdin.setRawMode && process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    if (this.originalWrite) {
      process.stdout.write = this.originalWrite as typeof process.stdout.write;
      this.originalWrite = null;
    }
    this.terminalInitialized = false;
  }

  private getOrbitUpdateAvailable(): boolean {
    if (!this.hasCheckedOrbitUpdate && !this.isCheckingOrbitUpdate) {
      void this.refreshOrbitUpdateStatus();
    }
    return this.orbitUpdateAvailable;
  }

  public setOrbitUpdateAvailable(updateAvailable: boolean): void {
    this.hasCheckedOrbitUpdate = true;
    this.orbitUpdateAvailable = this.orbitRestartRequired
      ? false
      : updateAvailable;
    if (this.isActive) this.render();
  }

  /** Mark that npm has updated the package while this process remains on the old runtime. */
  public setOrbitRestartRequired(restartRequired: boolean): void {
    this.orbitRestartRequired = restartRequired;
    if (restartRequired) this.orbitUpdateAvailable = false;
    if (this.isActive) this.render();
  }

  private async refreshOrbitUpdateStatus(): Promise<void> {
    if (this.hasCheckedOrbitUpdate || this.isCheckingOrbitUpdate) return;
    this.isCheckingOrbitUpdate = true;
    this.hasCheckedOrbitUpdate = true;
    try {
      this.orbitUpdateAvailable = await this.checkOrbitUpdate(
        this.version.replace(/^v/i, ""),
      );
    } catch {
      this.orbitUpdateAvailable = false;
    } finally {
      this.isCheckingOrbitUpdate = false;
      if (this.isActive) this.render();
    }
  }

  private getGitSummary() {
    const now = Date.now();
    if (!this.cachedGitSummary) {
      this.cachedGitSummary = {
        branch: "no-git",
        added: 0,
        modified: 0,
        deleted: 0,
      };
      this.refreshGitSummaryAsync().catch(() => {});
    } else if (now - this.lastGitSummaryReadTime > 8000) {
      this.refreshGitSummaryAsync().catch(() => {});
    }
    return this.cachedGitSummary;
  }

  private async refreshGitSummaryAsync() {
    if (this.isRefreshingGit) return;
    this.isRefreshingGit = true;
    this.lastGitSummaryReadTime = Date.now();

    try {
      const summary = {
        branch: "no-git",
        added: 0,
        modified: 0,
        deleted: 0,
      };

      const branchPromise = new Promise<string>((resolve) => {
        exec(
          "git rev-parse --abbrev-ref HEAD",
          { ...HIDDEN_CHILD_PROCESS_OPTIONS, cwd: this.cwd },
          (err, stdout) => {
            if (err) resolve("no-git");
            else resolve(stdout.trim());
          },
        );
      });

      const statusPromise = new Promise<string>((resolve) => {
        exec(
          "git status --porcelain",
          { ...HIDDEN_CHILD_PROCESS_OPTIONS, cwd: this.cwd },
          (err, stdout) => {
            if (err) resolve("");
            else resolve(stdout);
          },
        );
      });

      const [branch, statusOutput] = await Promise.all([
        branchPromise,
        statusPromise,
      ]);
      summary.branch = branch;

      for (const line of statusOutput.split("\n")) {
        if (!line) continue;
        const code = line.substring(0, 2);
        if (code.includes("A") || code.includes("?")) {
          summary.added++;
        } else if (code.includes("M") || code.includes("R")) {
          summary.modified++;
        } else if (code.includes("D")) {
          summary.deleted++;
        }
      }

      this.cachedGitSummary = summary;
      this.render();
    } catch {
      // Ignored
    } finally {
      this.isRefreshingGit = false;
    }
  }

  private getWheelScrollLines(): number {
    const configured = Number(this.config?.tui?.scrollSpeed ?? 50);
    return Math.max(1, Math.min(20, Math.ceil(configured / 5)));
  }

  private scrollHistory(delta: number): void {
    this.historyScrollOffset = Math.max(
      0,
      Math.min(this.maxHistoryScrollOffset, this.historyScrollOffset + delta),
    );
    if (this.historyScrollOffset === 0) {
      this.hasNewOutputWhileScrolled = false;
    }
    this.render();
  }

  private handleScrollInput(str: string, key: readline.Key): boolean {
    const wheelDirection = parseMouseWheelDirection(str);
    if (wheelDirection) {
      const lines = this.getWheelScrollLines();
      this.scrollHistory(wheelDirection === "up" ? lines : -lines);
      return true;
    }

    const pageSize = Math.max(3, Math.floor((process.stdout.rows || 24) * 0.6));
    if (key?.name === "pageup") {
      this.scrollHistory(pageSize);
      return true;
    }
    if (key?.name === "pagedown") {
      this.scrollHistory(-pageSize);
      return true;
    }
    if (key?.name === "home" && key?.ctrl) {
      this.scrollHistory(this.maxHistoryScrollOffset);
      return true;
    }
    if (key?.name === "end" && this.historyScrollOffset > 0) {
      this.historyScrollOffset = 0;
      this.hasNewOutputWhileScrolled = false;
      this.render();
      return true;
    }
    return false;
  }

  public startThinkingInput() {
    if (!this.isActive) return;
    this.stopThinkingInput();

    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    this.thinkingKeypressListener = (str: string, key: readline.Key) => {
      try {
        if (!this.isActive) {
          this.stopThinkingInput();
          return;
        }

        if (this.handleScrollInput(str, key)) {
          return;
        }

        if (key && key.ctrl && key.name === "c") {
          if (this.inputBuffer.length > 0) {
            this.inputBuffer = "";
            this.cursorPosition = 0;
            this.render();
          } else {
            if (this.activeRunnable) {
              this.activeRunnable.abort();
            }
          }
          return;
        }

        if (key && (key.name === "return" || key.name === "enter")) {
          const submitted = this.inputBuffer;
          if (submitted.trim()) {
            const accepted = this.activeInputHandler?.(submitted) ?? false;
            if (!accepted) return;
          }
          this.inputBuffer = "";
          this.cursorPosition = 0;
          this.render();
          return;
        }

        if (key && key.ctrl && key.name === "j") {
          this.inputBuffer =
            this.inputBuffer.slice(0, this.cursorPosition) +
            "\n" +
            this.inputBuffer.slice(this.cursorPosition);
          this.cursorPosition += 1;
          this.render();
          return;
        }

        if (key && (key.name === "home" || (key.ctrl && key.name === "a"))) {
          this.cursorPosition = 0;
          this.render();
          return;
        }

        if (key && (key.name === "end" || (key.ctrl && key.name === "e"))) {
          this.cursorPosition = this.inputBuffer.length;
          this.render();
          return;
        }

        if (key && (key.ctrl || key.meta) && key.name === "left") {
          this.cursorPosition = previousWordIndex(
            this.inputBuffer,
            this.cursorPosition,
          );
          this.render();
          return;
        }

        if (key && (key.ctrl || key.meta) && key.name === "right") {
          this.cursorPosition = nextWordIndex(
            this.inputBuffer,
            this.cursorPosition,
          );
          this.render();
          return;
        }

        if (key && key.ctrl && (key.name === "backspace" || key.name === "w")) {
          if (this.cursorPosition > 0) {
            const targetPos = previousWordIndex(
              this.inputBuffer,
              this.cursorPosition,
            );
            this.inputBuffer =
              this.inputBuffer.slice(0, targetPos) +
              this.inputBuffer.slice(this.cursorPosition);
            this.cursorPosition = targetPos;
            this.render();
          }
          return;
        }

        if (key && key.ctrl && key.name === "delete") {
          if (this.cursorPosition < this.inputBuffer.length) {
            const targetPos = nextWordIndex(
              this.inputBuffer,
              this.cursorPosition,
            );
            this.inputBuffer =
              this.inputBuffer.slice(0, this.cursorPosition) +
              this.inputBuffer.slice(targetPos);
            this.render();
          }
          return;
        }

        if (key && key.ctrl && key.name === "u") {
          this.inputBuffer = "";
          this.cursorPosition = 0;
          this.render();
          return;
        }

        if (key && key.ctrl) {
          return;
        }

        if (key && key.name === "backspace") {
          if (this.cursorPosition > 0) {
            const previousIndex = previousCodePointIndex(
              this.inputBuffer,
              this.cursorPosition,
            );
            this.inputBuffer =
              this.inputBuffer.slice(0, previousIndex) +
              this.inputBuffer.slice(this.cursorPosition);
            this.cursorPosition = previousIndex;
            this.render();
          }
          return;
        }

        if (key && key.name === "delete") {
          if (this.cursorPosition < this.inputBuffer.length) {
            const nextIndex = nextCodePointIndex(
              this.inputBuffer,
              this.cursorPosition,
            );
            this.inputBuffer =
              this.inputBuffer.slice(0, this.cursorPosition) +
              this.inputBuffer.slice(nextIndex);
            this.render();
          }
          return;
        }

        if (key && key.name === "left") {
          if (this.cursorPosition > 0) {
            this.cursorPosition = previousCodePointIndex(
              this.inputBuffer,
              this.cursorPosition,
            );
            this.render();
          }
          return;
        }

        if (key && key.name === "right") {
          if (this.cursorPosition < this.inputBuffer.length) {
            this.cursorPosition = nextCodePointIndex(
              this.inputBuffer,
              this.cursorPosition,
            );
            this.render();
          }
          return;
        }

        if (str && !/[\u0000-\u001f\u007f]/.test(str)) {
          this.inputBuffer =
            this.inputBuffer.slice(0, this.cursorPosition) +
            str +
            this.inputBuffer.slice(this.cursorPosition);
          this.cursorPosition += str.length;
          this.render();
        }
      } catch (error) {
        appendTuiErrorLog("Error in thinkingKeypressListener", error);
        try {
          this.render();
        } catch {}
      }
    };

    process.stdin.on("keypress", this.thinkingKeypressListener);
  }

  public stopThinkingInput() {
    if (this.thinkingKeypressListener) {
      process.stdin.removeListener("keypress", this.thinkingKeypressListener);
      this.thinkingKeypressListener = null;
    }
  }

  private getActiveMatches(): string[] {
    if (!this.inputBuffer.startsWith("/")) return [];
    if (this.hideAutocomplete) return [];

    const line = this.inputBuffer;
    const parts = line.split(/\s+/);

    if (parts[0] === "/add" && line.includes(" ")) {
      let query = line.slice(5).trim();
      let prefix = "/add ";
      if (query.startsWith("-r ")) {
        prefix = "/add -r ";
        query = query.slice(3).trim();
      } else if (query.startsWith("--read-only ")) {
        prefix = "/add --read-only ";
        query = query.slice(12).trim();
      } else if (query.startsWith("--readonly ")) {
        prefix = "/add --readonly ";
        query = query.slice(11).trim();
      } else if (
        query === "-r" ||
        query === "--read-only" ||
        query === "--readonly"
      ) {
        query = "";
        prefix = `/add ${parts[1]} `;
      }
      const hits = rankSlashCandidates(
        (this.candidates?.files || []).map((f) => `${prefix}${f}`),
        line,
      );
      if (hits.length > 0) return hits;
    }

    if (parts[0] === "/drop" && line.includes(" ")) {
      const hits = rankSlashCandidates(
        (this.candidates?.files || []).map((f) => `/drop ${f}`),
        line,
      );
      if (hits.length > 0) return hits;
    }

    if (parts[0] === "/model" && line.includes(" ")) {
      const models = getProviderModelCandidates(this.config);

      const hits = rankSlashCandidates(
        models.map((m) => `/model ${m}`),
        line,
      );
      if (hits.length > 0) return hits;
    }

    if (parts[0] === "/chat" && line.includes(" ")) {
      // 1. If it's just "/chat " completing the subcommand
      if (parts.length <= 2) {
        const subcommands = ["list", "ls", "new", "delete", "rm", "switch"];
        const hits = rankSlashCandidates(
          subcommands.map((sub) => `/chat ${sub}`),
          line,
        );
        if (hits.length > 0) return hits;
      }

      // 2. If it's "/chat delete <query>", "/chat switch <query>", "/chat rm <query>"
      if (parts.length >= 3 && ["delete", "rm", "switch"].includes(parts[1])) {
        const cmd = parts[0];
        const sub = parts[1];
        const prefix = `${cmd} ${sub} `;
        const hits = rankSlashCandidates(
          (this.candidates?.sessions || []).map((s) => `${prefix}${s}`),
          line,
        );
        if (hits.length > 0) return hits;
      }
    }

    if (line.includes(" ")) {
      const definition = SLASH_COMMAND_DEFINITIONS.find(
        ({ command }) => command === parts[0],
      );
      if (definition?.suggestions?.length) {
        const hits = rankSlashCandidates(
          definition.suggestions.map(
            ({ value }) => `${definition.command} ${value}`,
          ),
          line,
        );
        if (hits.length > 0) return hits;
      }
    }

    const cmds =
      this.candidates &&
      Array.isArray(this.candidates.commands) &&
      this.candidates.commands.length > 0
        ? this.candidates.commands
        : BUILTIN_SLASH_COMMANDS;
    return rankSlashCandidates(cmds, line);
  }

  private getSlashMatchHint(match: string): string {
    const language = this.config?.language ?? "en";
    const command = match.split(/\s+/, 1)[0];
    const definition = SLASH_COMMAND_DEFINITIONS.find(
      (candidate) => candidate.command === command,
    );
    if (definition) {
      const invocation = match.slice(command.length).trim();
      const suggestion = definition.suggestions?.find(
        ({ value }) => value.trim() === invocation,
      );
      if (suggestion) {
        return localizeSlashText(suggestion.description, language);
      }
    }
    const detail = this.candidates?.commandDetails.find(
      (candidate) => candidate.command === command,
    );
    if (detail) return detail.description;
    if (match.startsWith("/chat delete ") || match.startsWith("/chat rm ")) {
      return localizeOrbit(
        language,
        "Delete this chat",
        "删除该聊天",
        "刪除該聊天",
      );
    }
    if (match.startsWith("/chat switch ")) {
      return localizeOrbit(
        language,
        "Switch to this chat",
        "切换到该聊天",
        "切換到該聊天",
      );
    }
    if (definition) {
      return localizeSlashText(definition.description, language);
    }
    return "";
  }

  private getSuggestion(): string {
    const line = this.inputBuffer;
    const matches = this.getActiveMatches();
    if (matches.length > 0) {
      const idx = Math.min(this.activeCommandIndex, matches.length - 1);
      const match = matches[idx];
      if (match && match !== line && match.startsWith(line)) {
        return match.substring(line.length);
      }
    }
    return "";
  }

  private acceptActiveSlashSuggestion(): string | null {
    const matches = this.getActiveMatches();
    const selected = selectActiveSlashSuggestion(
      this.inputBuffer,
      matches,
      this.activeCommandIndex,
    );
    if (selected === this.inputBuffer) return null;
    this.inputBuffer = selected;
    this.cursorPosition = selected.length;
    this.activeCommandIndex = 0;
    return selected;
  }

  private getHits(): { hits: string[]; lastWord: string } {
    const hits = this.getActiveMatches();
    return { hits, lastWord: this.inputBuffer };
  }

  public setCost(
    cost: number,
    inputTokens = 0,
    cacheReadTokens = 0,
    outputTokens = 0,
    costKnown = true,
  ) {
    this.environmentStatus.setUsage(
      cost,
      inputTokens,
      cacheReadTokens,
      outputTokens,
      costKnown,
    );
    this.render();
  }

  public setCacheTelemetry(payload: TuiCacheTelemetry) {
    this.environmentStatus.setCacheTelemetry(payload);
    this.render();
  }

  public handleThinkingDelta(text: string) {
    this.currentThinking += text;
    this.throttleRender();
  }

  public addLog(text: string) {
    if (!text || !text.trim()) return;
    const trimmed = text.trim();
    if (
      trimmed.includes("Summary:") ||
      trimmed.includes("Modified files:") ||
      trimmed.includes("Verification:") ||
      trimmed.includes("Session Cost:")
    ) {
      return;
    }
    if (text.includes("Orbit:")) {
      const cleanText = text.replace(/Orbit:\s*/i, "").trim();
      const last = this.history[this.history.length - 1];
      if (last && last.role === "assistant") {
        if (!last.text.includes(cleanText)) {
          last.text = cleanText;
        }
        this.render();
      }
      return;
    }
    if (text.includes("Thought")) {
      return;
    }

    this.history.push({
      role: "system",
      text: trimmed,
    });
    this.render();
  }

  public clearHistoryView(options: { silent?: boolean } = {}) {
    this.history = [];
    this.historyScrollOffset = 0;
    this.maxHistoryScrollOffset = 0;
    this.lastHistoryLineCount = 0;
    this.hasNewOutputWhileScrolled = false;
    this.historySearchQuery = null;
    if (!options.silent) {
      this.render();
    }
  }

  public syncFromLoop(loop: LoopViewSource) {
    this.activeContextFiles = loop.getRelevantFiles() || [];
    const loopHistory = loop.getHistory();
    if (loopHistory.length === 0) {
      this.render();
      return;
    }

    const localAsstIdx = this.history
      .map((m, i) => (m.role === "assistant" ? i : -1))
      .filter((i) => i !== -1);
    const loopAsst = loopHistory.filter(
      (message) => message.role === "assistant",
    );

    for (let i = 0; i < loopAsst.length; i++) {
      const loopMsg = loopAsst[i];
      const textBlock = loopMsg.content.find((block) => block.type === "text");
      if (textBlock && textBlock.text) {
        const localIdx = localAsstIdx[i];
        if (localIdx !== undefined) {
          this.history[localIdx].text = textBlock.text;
          this.history[localIdx].model = loopMsg.metadata?.model;
        } else {
          this.history.push({
            role: "assistant",
            text: textBlock.text,
            attempt: i + 1,
            model: loopMsg.metadata?.model,
          });
        }
      }
    }
    this.render();
  }

  public loadHistory(
    loopHistory: readonly OrbitMessage[],
    options: { silent?: boolean } = {},
  ) {
    this.clearHistoryView({ silent: true });
    let attempt = 0;
    for (const msg of loopHistory) {
      if (msg.role === "user") {
        const text = msg.content
          .map((content) => (content.type === "text" ? content.text : ""))
          .join("");
        if (text === "REPL Interactive Shell Started") {
          continue;
        }
        this.history.push({
          role: "user",
          text,
        });
      } else if (msg.role === "assistant") {
        attempt++;
        const textBlock = msg.content.find((block) => block.type === "text");
        this.history.push({
          role: "assistant",
          text: textBlock?.text || "",
          attempt,
          model: msg.metadata?.model,
        });
      } else if (msg.role === "system") {
        const text = msg.content
          .map((content) => (content.type === "text" ? content.text : ""))
          .join("");
        this.history.push({
          role: "system",
          text,
        });
      }
    }
    if (!options.silent) {
      this.render();
    }
  }

  /** Opens a typed full-screen prompt managed by an isolated session. */
  public showPrompt(config: TuiPromptConfig): Promise<TuiPromptResult> {
    return this.promptSession.show(config);
  }
  public async askInput(options: AskInputOptions = {}): Promise<string | null> {
    if (!this.isActive) {
      if (this.hasWrittenStdoutSinceStop) {
        const wasRaw = !!process.stdin.isRaw;
        if (process.stdin.setRawMode) {
          process.stdin.setRawMode(false);
        }
        await Prompt.askText("Press Enter to return to Orbit...");
        if (process.stdin.setRawMode) {
          process.stdin.setRawMode(wasRaw);
        }
        this.hasWrittenStdoutSinceStop = false;
      }
      this.start(this.budgetLimit);
    }
    process.stdout.write("\x1b[?25h");

    return new Promise((resolve) => {
      this.resolveInput = resolve;
      this.inputBuffer = "";
      this.cursorPosition = 0;
      this.hideAutocomplete = false;
      this.historySearchQuery = null;
      this.render();

      const wasRaw = !!process.stdin.isRaw;
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();

      const onKeypress = (str: string, key: readline.Key) => {
        try {
          if (!this.isActive) {
            cleanup();
            return;
          }

          if (this.handleScrollInput(str, key)) {
            return;
          }

          if (key && key.ctrl && key.name === "c") {
            this.activeCommandIndex = 0;
            this.historySearchQuery = null;
            if (this.inputBuffer.length > 0) {
              this.inputBuffer = "";
              this.cursorPosition = 0;
              this.render();
            } else {
              if (this.ctrlCPressedOnce) {
                if (this.ctrlCTimeout) clearTimeout(this.ctrlCTimeout);
                this.ctrlCTimeout = null;
                this.ctrlCPressedOnce = false;
                cleanup();
                process.stdout.write("\x1b[?25l");
                this.resolveInput = null;
                resolve(null);
              } else {
                this.ctrlCPressedOnce = true;
                if (this.ctrlCTimeout) clearTimeout(this.ctrlCTimeout);
                this.ctrlCTimeout = setTimeout(() => {
                  this.ctrlCPressedOnce = false;
                  this.render();
                }, 2000);
                this.render();
              }
            }
            return;
          }

          if (key && key.ctrl && key.name === "r") {
            const query = this.historySearchQuery ?? this.inputBuffer;
            const startIndex =
              this.historyIndex >= 0
                ? this.historyIndex
                : this.inputHistory.length;
            const match = findPreviousHistoryEntry(
              this.inputHistory,
              query,
              startIndex,
            );
            if (match) {
              this.historySearchQuery = query;
              this.historyIndex = match.index;
              this.inputBuffer = match.entry;
              this.cursorPosition = this.inputBuffer.length;
              this.activeCommandIndex = 0;
              this.hideAutocomplete = true;
              this.render();
            }
            return;
          }

          if (key && (key.name === "return" || key.name === "enter")) {
            cleanup();
            process.stdout.write("\x1b[?25l");
            const submitted =
              this.acceptActiveSlashSuggestion() || this.inputBuffer;
            this.historySearchQuery = null;
            this.resolveInput = null;
            this.historyScrollOffset = 0;
            this.hasNewOutputWhileScrolled = false;

            if (submitted.trim()) {
              const echoSubmitted =
                typeof options.echoSubmitted === "function"
                  ? options.echoSubmitted(submitted)
                  : options.echoSubmitted !== false;
              if (echoSubmitted) {
                this.history.push({ role: "user", text: submitted });
              }
              if (
                this.inputHistory[this.inputHistory.length - 1] !== submitted
              ) {
                this.inputHistory.push(submitted);
                this.saveInputHistory();
              }
            }
            this.historyIndex = -1;
            this.inputBuffer = "";
            this.cursorPosition = 0;
            this.render();
            resolve(submitted);
            return;
          }

          if (key && key.ctrl && key.name === "j") {
            this.activeCommandIndex = 0;
            this.historySearchQuery = null;
            this.hideAutocomplete = true;
            this.inputBuffer =
              this.inputBuffer.slice(0, this.cursorPosition) +
              "\n" +
              this.inputBuffer.slice(this.cursorPosition);
            this.cursorPosition += 1;
            this.render();
            return;
          }

          if (key && (key.name === "home" || (key.ctrl && key.name === "a"))) {
            this.activeCommandIndex = 0;
            this.historySearchQuery = null;
            this.cursorPosition = 0;
            this.render();
            return;
          }

          if (key && (key.name === "end" || (key.ctrl && key.name === "e"))) {
            this.activeCommandIndex = 0;
            this.historySearchQuery = null;
            this.cursorPosition = this.inputBuffer.length;
            this.render();
            return;
          }

          if (key && (key.ctrl || key.meta) && key.name === "left") {
            this.activeCommandIndex = 0;
            this.historySearchQuery = null;
            this.cursorPosition = previousWordIndex(
              this.inputBuffer,
              this.cursorPosition,
            );
            this.render();
            return;
          }

          if (key && (key.ctrl || key.meta) && key.name === "right") {
            this.activeCommandIndex = 0;
            this.historySearchQuery = null;
            this.cursorPosition = nextWordIndex(
              this.inputBuffer,
              this.cursorPosition,
            );
            this.render();
            return;
          }

          if (
            key &&
            key.ctrl &&
            (key.name === "backspace" || key.name === "w")
          ) {
            this.activeCommandIndex = 0;
            this.hideAutocomplete = false;
            this.historySearchQuery = null;
            if (this.cursorPosition > 0) {
              const targetPos = previousWordIndex(
                this.inputBuffer,
                this.cursorPosition,
              );
              this.inputBuffer =
                this.inputBuffer.slice(0, targetPos) +
                this.inputBuffer.slice(this.cursorPosition);
              this.cursorPosition = targetPos;
              this.render();
            }
            return;
          }

          if (key && key.ctrl && key.name === "delete") {
            this.activeCommandIndex = 0;
            this.hideAutocomplete = false;
            this.historySearchQuery = null;
            if (this.cursorPosition < this.inputBuffer.length) {
              const targetPos = nextWordIndex(
                this.inputBuffer,
                this.cursorPosition,
              );
              this.inputBuffer =
                this.inputBuffer.slice(0, this.cursorPosition) +
                this.inputBuffer.slice(targetPos);
              this.render();
            }
            return;
          }

          if (key && key.ctrl && key.name === "u") {
            this.activeCommandIndex = 0;
            this.hideAutocomplete = false;
            this.historySearchQuery = null;
            this.inputBuffer = "";
            this.cursorPosition = 0;
            this.render();
            return;
          }

          if (key && key.name === "up") {
            this.historySearchQuery = null;
            if (this.inputBuffer.startsWith("/")) {
              const matches = this.getActiveMatches();
              if (matches.length > 0) {
                this.activeCommandIndex =
                  (this.activeCommandIndex - 1 + matches.length) %
                  matches.length;
                this.render();
                return;
              }
            }
            if (this.inputHistory.length > 0) {
              if (this.historyIndex === -1) {
                this.tempBuffer = this.inputBuffer;
                this.historyIndex = this.inputHistory.length - 1;
              } else if (this.historyIndex > 0) {
                this.historyIndex--;
              }
              this.inputBuffer = this.inputHistory[this.historyIndex];
              this.hideAutocomplete = false;
              this.cursorPosition = this.inputBuffer.length;
              this.render();
            }
            return;
          }

          if (key && key.name === "down") {
            this.historySearchQuery = null;
            if (this.inputBuffer.startsWith("/")) {
              const matches = this.getActiveMatches();
              if (matches.length > 0) {
                this.activeCommandIndex =
                  (this.activeCommandIndex + 1) % matches.length;
                this.render();
                return;
              }
            }
            if (this.historyIndex !== -1) {
              if (this.historyIndex < this.inputHistory.length - 1) {
                this.historyIndex++;
                this.inputBuffer = this.inputHistory[this.historyIndex];
              } else {
                this.historyIndex = -1;
                this.inputBuffer = this.tempBuffer || "";
              }
              this.hideAutocomplete = false;
              this.cursorPosition = this.inputBuffer.length;
              this.render();
            }
            return;
          }

          if (key && key.name === "left") {
            this.historySearchQuery = null;
            if (this.cursorPosition > 0) {
              this.cursorPosition = previousCodePointIndex(
                this.inputBuffer,
                this.cursorPosition,
              );
              this.render();
            }
            return;
          }

          if (key && key.name === "right") {
            this.historySearchQuery = null;
            if (this.cursorPosition < this.inputBuffer.length) {
              this.cursorPosition = nextCodePointIndex(
                this.inputBuffer,
                this.cursorPosition,
              );
              this.render();
            } else {
              const accepted = this.acceptActiveSlashSuggestion();
              if (accepted) {
                this.cursorPosition = this.inputBuffer.length;
                this.render();
              }
            }
            return;
          }

          if (key && key.name === "tab") {
            this.historySearchQuery = null;
            if (this.inputBuffer.startsWith("/")) {
              const accepted = this.acceptActiveSlashSuggestion();
              if (accepted) {
                this.render();
                return;
              }
            }
            const sug = this.getSuggestion();
            if (sug) {
              this.inputBuffer += sug;
              this.cursorPosition = this.inputBuffer.length;
              this.render();
            }
            return;
          }

          if (key && key.ctrl && key.name === "l") {
            this.clearHistoryView();
            return;
          }

          if (key && key.ctrl && key.name === "p") {
            this.activeCommandIndex = 0;
            this.hideAutocomplete = false;
            this.historySearchQuery = null;
            if (!this.inputBuffer.startsWith("/")) {
              this.inputBuffer = "/" + this.inputBuffer;
              this.cursorPosition = this.inputBuffer.length;
            }
            this.render();
            return;
          }

          if (key && key.name === "delete") {
            this.activeCommandIndex = 0;
            this.hideAutocomplete = false;
            this.historySearchQuery = null;
            if (this.cursorPosition < this.inputBuffer.length) {
              const nextIndex = nextCodePointIndex(
                this.inputBuffer,
                this.cursorPosition,
              );
              this.inputBuffer =
                this.inputBuffer.substring(0, this.cursorPosition) +
                this.inputBuffer.substring(nextIndex);
              this.render();
            }
            return;
          }

          if (key && key.name === "backspace") {
            this.activeCommandIndex = 0;
            this.hideAutocomplete = false;
            this.historySearchQuery = null;
            if (this.cursorPosition > 0) {
              const previousIndex = previousCodePointIndex(
                this.inputBuffer,
                this.cursorPosition,
              );
              this.inputBuffer =
                this.inputBuffer.substring(0, previousIndex) +
                this.inputBuffer.substring(this.cursorPosition);
              this.cursorPosition = previousIndex;
            }
          } else if (key && key.name === "escape") {
            this.activeCommandIndex = 0;
            this.historySearchQuery = null;
            if (!this.hideAutocomplete) {
              this.hideAutocomplete = true;
            }
            this.render();
          } else if (
            str &&
            !/[\u0000-\u001f\u007f]/.test(str) &&
            (!key || (!key.ctrl && !key.meta && key.name !== "tab"))
          ) {
            this.activeCommandIndex = 0;
            this.hideAutocomplete = false;
            this.historySearchQuery = null;
            this.inputBuffer =
              this.inputBuffer.substring(0, this.cursorPosition) +
              str +
              this.inputBuffer.substring(this.cursorPosition);
            this.cursorPosition += str.length;
          }

          this.render();
        } catch (error) {
          appendTuiErrorLog("Error in onKeypress", error);
          try {
            this.render();
          } catch {}
        }
      };

      const cleanup = () => {
        process.stdin.removeListener("keypress", onKeypress);
        if (process.stdin.setRawMode) {
          process.stdin.setRawMode(wasRaw);
        }
        process.stdin.pause();
      };

      process.stdin.on("keypress", onKeypress);
    });
  }

  public startAttempt(attempt: number) {
    this.environmentStatus.setAttempt(attempt);
    this.attemptStartTime = Date.now();
    this.firstDeltaTime = 0;
    this.isThinking = true;
    this.thoughtElapsed = 0;
    this.currentThinking = "";
    this.hasRenderedAttemptDelta = false;
    this.lastRenderTime = 0;
    if (this.renderTimeout) {
      clearTimeout(this.renderTimeout);
      this.renderTimeout = null;
    }
    this.renderPending = false;

    this.history.push({
      role: "assistant",
      text: "",
      attempt: attempt,
      model:
        this.environmentStatus.snapshot().activeModelName ||
        this.modelNameGetter(),
    });

    if (this.thoughtTimer) clearInterval(this.thoughtTimer);
    this.thoughtTimer = setInterval(() => {
      if (this.isThinking) {
        this.thoughtElapsed += 250;
        this.render();
      }
    }, 250);

    this.render();
  }

  public handleModelDelta(text: string) {
    const lastAsst = [...this.history]
      .reverse()
      .find((m) => m.role === "assistant");
    if (lastAsst) {
      if (this.isThinking && text.trim().length > 0) {
        this.isThinking = false;
        if (this.thoughtTimer) {
          clearInterval(this.thoughtTimer);
          this.thoughtTimer = null;
        }
        if (this.attemptStartTime > 0) {
          lastAsst.thoughtTime = Date.now() - this.attemptStartTime;
        }
      }
      lastAsst.text += text;
      this.throttleRender();
    }
  }

  private throttleRender() {
    const now = Date.now();
    const minInterval = this.getStreamRenderIntervalMs();
    if (!this.hasRenderedAttemptDelta) {
      this.hasRenderedAttemptDelta = true;
      if (this.renderTimeout) {
        clearTimeout(this.renderTimeout);
        this.renderTimeout = null;
      }
      this.renderPending = false;
      this.lastRenderTime = now;
      this.render();
      return;
    }

    if (now - this.lastRenderTime >= minInterval) {
      if (this.renderTimeout) {
        clearTimeout(this.renderTimeout);
        this.renderTimeout = null;
      }
      this.renderPending = false;
      this.lastRenderTime = now;
      this.render();
    } else if (!this.renderPending) {
      this.renderPending = true;
      this.renderTimeout = setTimeout(
        () => {
          this.renderPending = false;
          this.lastRenderTime = Date.now();
          this.render();
        },
        minInterval - (now - this.lastRenderTime),
      );
    }
  }

  private getStreamRenderIntervalMs(): number {
    const lastAsst = [...this.history]
      .reverse()
      .find((m) => m.role === "assistant");
    const streamedChars =
      (lastAsst?.text.length || 0) + this.currentThinking.length;
    if (streamedChars < 1200) return 16;
    if (streamedChars < 6000) return 32;
    return 60;
  }

  public finishAttempt() {
    const lastAsst = [...this.history]
      .reverse()
      .find((m) => m.role === "assistant");
    if (lastAsst) {
      this.isThinking = false;
      if (this.thoughtTimer) {
        clearInterval(this.thoughtTimer);
        this.thoughtTimer = null;
      }
      if (this.attemptStartTime > 0) {
        lastAsst.totalTime = Date.now() - this.attemptStartTime;
        if (lastAsst.thoughtTime === undefined) {
          lastAsst.thoughtTime = lastAsst.totalTime;
        }
      }
      this.attemptStartTime = 0;
      this.render();
    }
  }

  public render(forceFull = false) {
    const columns = Math.max(40, process.stdout.columns || 80);
    const rows = Math.max(10, process.stdout.rows || 24);

    // Use the shared MORANDI constant (class-level) instead of recreating per frame
    const morandi = MORANDI;
    const languageIsZh = this.config?.language !== "en";

    const promptState = this.promptSession.state;
    if (promptState) {
      const output = renderPromptScreen(promptState, {
        columns,
        rows,
        isZh: this.config?.language !== "en",
      });
      if (this.originalWrite) {
        Reflect.apply(this.originalWrite, process.stdout, [output]);
      } else {
        process.stdout.write(output);
      }
      return;
    }
    const isWaitingInput = this.resolveInput !== null;
    const isInputActive =
      isWaitingInput || this.thinkingKeypressListener !== null;
    const hasInput = isInputActive && this.inputBuffer.length > 0;
    const placeholder = isWaitingInput
      ? languageIsZh
        ? "输入任务或命令…"
        : "Ask Orbit anything…"
      : "";

    // A.1 构建底部的圆角输入框与状态行以及指令匹配浮窗
    const boxWidth = columns - 4;
    const wrapWidth = Math.max(8, boxWidth - 14);
    const fullText = hasInput ? this.inputBuffer : placeholder;

    const wrappedInputLines = this.wrapInputText(fullText, wrapWidth);
    const wrappedLines = wrappedInputLines.map((line) => line.text);
    const formattedLines = hasInput
      ? this.formatWrappedLines(wrappedLines, this.inputBuffer.length)
      : wrappedLines.map((line) => morandi.dim(line));

    const boxContentLines: string[] = [];
    const topBorder = morandi.gray("  ╭" + "─".repeat(boxWidth - 4) + "╮");
    const bottomBorder = morandi.gray("  ╰" + "─".repeat(boxWidth - 4) + "╯");

    boxContentLines.push(topBorder);
    for (let i = 0; i < formattedLines.length; i++) {
      const prefix = i === 0 ? "orbit > " : "        ";
      const rawLine = wrappedLines[i];
      const visualWidth = this.getStringWidth(rawLine);
      const remainingSpaces = wrapWidth - visualWidth;
      const padding = " ".repeat(Math.max(0, remainingSpaces));

      const lineContent =
        morandi.gray("  │ ") +
        morandi.userBold(prefix) +
        formattedLines[i] +
        padding +
        morandi.gray(" │");
      boxContentLines.push(lineContent);
    }
    boxContentLines.push(bottomBorder);

    const bottomLines: string[] = [];

    // A.2 只有以 / 开头且正在等待输入时，渲染指令下拉浮窗
    if (isWaitingInput) {
      const matches = this.getActiveMatches();

      if (matches.length > 0) {
        const isZh = this.config?.language !== "en";

        const maxVisible = 5;
        this.activeCommandIndex = Math.min(
          Math.max(0, this.activeCommandIndex),
          matches.length - 1,
        );

        let startIdx = 0;
        if (this.activeCommandIndex >= maxVisible) {
          startIdx = this.activeCommandIndex - maxVisible + 1;
        }
        const visibleMatches = matches.slice(startIdx, startIdx + maxVisible);

        const maxPopupWidth = Math.min(92, Math.max(34, columns - 8));
        const visibleCommands = visibleMatches.map((cmd) => {
          const selectedPrefix = " ❯ ";
          const idlePrefix = "   ";
          return {
            cmd,
            width: Math.max(
              this.getStringWidth(`${selectedPrefix}${cmd}`),
              this.getStringWidth(`${idlePrefix}${cmd}`),
            ),
          };
        });
        const widestCommand = visibleCommands.reduce(
          (max, item) => Math.max(max, item.width),
          0,
        );
        const commandColumnWidth = Math.min(
          Math.max(18, widestCommand + 2),
          Math.max(18, Math.floor(maxPopupWidth * 0.45)),
        );
        const formattedMatches = visibleMatches.map((cmd) => {
          const isSelected =
            visibleMatches.indexOf(cmd) + startIdx === this.activeCommandIndex;
          const prefix = isSelected ? " ❯ " : "   ";

          const hint = this.getSlashMatchHint(cmd);

          let leftPart = `${prefix}${cmd}`;
          let leftW = this.getStringWidth(leftPart);
          if (leftW > commandColumnWidth) {
            leftPart =
              this.truncateToWidth(leftPart, commandColumnWidth - 3) + "...";
            leftW = this.getStringWidth(leftPart);
          }

          let rightPart = "";
          let rightW = 0;
          if (hint) {
            const availableRightW = maxPopupWidth - commandColumnWidth - 2 - 2;
            if (availableRightW >= 5) {
              const rawRightW = this.getStringWidth(hint);
              if (rawRightW <= availableRightW) {
                rightPart = hint;
                rightW = rawRightW;
              } else {
                rightPart =
                  this.truncateToWidth(hint, availableRightW - 3) + "...";
                rightW = this.getStringWidth(rightPart);
              }
            }
          }

          return { cmd, isSelected, leftPart, leftW, rightPart, rightW };
        });

        const popupWidth = maxPopupWidth;

        bottomLines.push(morandi.gray("  ╭" + "─".repeat(popupWidth) + "╮"));
        for (const fm of formattedMatches) {
          const columnSpacing = Math.max(1, commandColumnWidth - fm.leftW);
          const bodyWidth = fm.leftW + columnSpacing + fm.rightW;
          const tailPadding = " ".repeat(Math.max(0, popupWidth - bodyWidth));

          const formattedLine = fm.isSelected
            ? morandi.accent(fm.leftPart) +
              " ".repeat(columnSpacing) +
              morandi.gray(fm.rightPart) +
              tailPadding
            : morandi.gray(fm.leftPart) +
              " ".repeat(columnSpacing) +
              morandi.dim(fm.rightPart) +
              tailPadding;

          bottomLines.push(
            morandi.gray("  │") + formattedLine + morandi.gray("│"),
          );
        }
        const footerText = getSlashSuggestionFooterText(isZh, matches.length);
        const footerW = this.getStringWidth(footerText);
        const footerPadding = " ".repeat(Math.max(0, popupWidth - footerW - 1));
        bottomLines.push(
          morandi.gray("  │ ") +
            morandi.dim(footerText + footerPadding) +
            morandi.gray("│"),
        );
        bottomLines.push(morandi.gray("  ╰" + "─".repeat(popupWidth) + "╯"));
      } else if (
        this.inputBuffer.startsWith("/") &&
        !this.hideAutocomplete &&
        this.inputBuffer.trim().length > 1
      ) {
        const isZh = this.config?.language !== "en";
        const popupWidth = Math.min(72, Math.max(30, columns - 8));
        const message = isZh
          ? "没有匹配的命令或候选项"
          : "No matching command or candidate";
        const hint = isZh
          ? "Esc 关闭建议 · Ctrl+P 重新打开命令面板"
          : "Esc closes suggestions · Ctrl+P reopens command palette";
        const messageText = truncatePlainToWidth(
          message,
          Math.max(8, popupWidth - 2),
        );
        const hintText = truncatePlainToWidth(
          hint,
          Math.max(8, popupWidth - 2),
        );
        bottomLines.push(morandi.gray("  ╭" + "─".repeat(popupWidth) + "╮"));
        bottomLines.push(
          morandi.gray("  │ ") +
            morandi.warn(messageText) +
            " ".repeat(
              Math.max(0, popupWidth - this.getStringWidth(messageText) - 1),
            ) +
            morandi.gray("│"),
        );
        bottomLines.push(
          morandi.gray("  │ ") +
            morandi.dim(hintText) +
            " ".repeat(
              Math.max(0, popupWidth - this.getStringWidth(hintText) - 1),
            ) +
            morandi.gray("│"),
        );
        bottomLines.push(morandi.gray("  ╰" + "─".repeat(popupWidth) + "╯"));
      }
    }

    // A.3 压入输入框
    bottomLines.push(...boxContentLines);

    // A.4 构建底部状态行
    const environment = this.environmentStatus.snapshot();
    const mode = environment.permissionsMode.toUpperCase();

    let statusText = "";
    if (this.historyScrollOffset > 0) {
      const newOutput = this.hasNewOutputWhileScrolled
        ? languageIsZh
          ? " · 有新输出"
          : " · new output"
        : "";
      statusText =
        morandi.accent(
          languageIsZh
            ? `↑ 历史 ${this.historyScrollOffset} 行`
            : `↑ history ${this.historyScrollOffset} lines`,
        ) + morandi.warn(newOutput);
    } else if (this.ctrlCPressedOnce) {
      statusText = morandi.warn(
        languageIsZh ? "再次按 Ctrl+C 退出" : "Press Ctrl+C again to exit",
      );
    } else if (this.historySearchQuery !== null) {
      const query = this.historySearchQuery || "*";
      statusText =
        morandi.accent("Ctrl+R") +
        morandi.gray("  ·  ") +
        morandi.white(
          languageIsZh
            ? `历史搜索: ${truncatePlainToWidth(query, 28)}`
            : `history search: ${truncatePlainToWidth(query, 28)}`,
        );
    } else {
      const displayedModel =
        environment.activeModelName || this.modelNameGetter();
      const cleanModel = displayedModel.split("/").pop() || displayedModel;
      const costStr = environment.costKnown
        ? `$${environment.sessionCost.toFixed(4)}`
        : "cost ?";
      statusText =
        morandi.completed("●") +
        " " +
        morandi.white(languageIsZh ? `${mode} 模式` : `${mode} MODE`) +
        morandi.gray("  ·  ") +
        morandi.accent(cleanModel) +
        morandi.gray("  ·  ") +
        morandi.accent(costStr) +
        morandi.gray("  ·  ") +
        morandi.dim(
          `${languageIsZh ? "尝试" : "attempt"}: ${environment.currentAttempt || 1}`,
        );
    }

    let keybindings =
      this.historyScrollOffset > 0
        ? morandi.gray("[End]") +
          morandi.dim(languageIsZh ? " 返回底部" : " Bottom")
        : columns >= 88
          ? [
              ...(this.isThinking
                ? [
                    morandi.gray("[Enter]") +
                      morandi.dim(languageIsZh ? " 引导" : " Steer"),
                  ]
                : []),
              morandi.gray("[^C]") +
                morandi.dim(languageIsZh ? " 取消" : " Cancel"),
              morandi.gray("[^J]") +
                morandi.dim(languageIsZh ? " 换行" : " Newline"),
              morandi.gray("[^R]") +
                morandi.dim(languageIsZh ? " 历史" : " History"),
              morandi.gray("[^L]") +
                morandi.dim(languageIsZh ? " 清屏" : " Clear"),
              morandi.gray("[^P]") +
                morandi.dim(languageIsZh ? " 命令" : " Cmds"),
            ].join("  ")
          : columns >= 62
            ? [
                ...(this.isThinking
                  ? [
                      morandi.gray("[↵]") +
                        morandi.dim(languageIsZh ? " 引导" : " Steer"),
                    ]
                  : []),
                morandi.gray("[^C]") +
                  morandi.dim(languageIsZh ? " 取消" : " Cancel"),
                morandi.gray("[^P]") +
                  morandi.dim(languageIsZh ? " 命令" : " Cmds"),
              ].join("  ")
            : morandi.gray("[^C]") +
              morandi.dim(languageIsZh ? " 退出" : " Exit");

    let statusTextLength = this.getStringWidth(statusText);
    let keybindingsLength = this.getStringWidth(keybindings);
    if (statusTextLength + keybindingsLength > columns - 8) {
      keybindings = [
        morandi.gray("[^C]") + morandi.dim(languageIsZh ? " 取消" : " Cancel"),
        morandi.gray("[^P]") + morandi.dim(languageIsZh ? " 命令" : " Cmds"),
      ].join("  ");
      keybindingsLength = this.getStringWidth(keybindings);
    }
    if (statusTextLength + keybindingsLength > columns - 8) {
      const compactMode = `${mode.slice(0, 6)} · ${environment.currentAttempt || 1}`;
      statusText = morandi.completed("●") + " " + morandi.white(compactMode);
      statusTextLength = this.getStringWidth(statusText);
    }
    if (statusTextLength + keybindingsLength > columns - 8) {
      keybindings = morandi.gray("[^C]");
      keybindingsLength = this.getStringWidth(keybindings);
    }
    const spacing = Math.max(
      1,
      columns - 6 - statusTextLength - keybindingsLength,
    );

    bottomLines.push("  " + statusText + " ".repeat(spacing) + keybindings);

    const bottomHeight = bottomLines.length;

    // 全屏渲染逻辑（当无法增量时）
    // Strip all ANSI escape sequences (e.g. \x1b[1m bold) from the model name
    const displayedModel =
      environment.activeModelName || this.modelNameGetter();
    const cleanModel = displayedModel.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");

    // 1. 获取 Git 当前分支与状态（短时缓存，避免流式输出期间阻塞重绘）
    const gitSummary = this.getGitSummary();
    const gitBranch = gitSummary.branch;

    // 2. 渲染左上角像素小猫 Logo 及其右侧信息
    const updateAvailable = this.getOrbitUpdateAvailable();
    const heartColor = this.orbitRestartRequired
      ? `\x1b[5m\x1b[38;2;120;190;150m`
      : updateAvailable
        ? `\x1b[5m\x1b[38;2;230;190;80m`
        : `\x1b[38;2;230;110;110m`;

    const logoLines = [
      `\x1b[38;2;158;184;196m  /\\___/\\  \x1b[0m`,
      `\x1b[38;2;158;184;196m (  o.o  ) \x1b[0m`,
      `\x1b[38;2;158;184;196m  / >${heartColor}♥\x1b[25m\x1b[38;2;158;184;196m< \\  \x1b[0m`,
      `\x1b[38;2;158;184;196m (__/ \\__) \x1b[0m`,
    ];

    // Logo widths are static — cache them to avoid re-computation every render frame
    if (!this._cachedLogoWidths) {
      const w0 = this.getStringWidth(logoLines[0]);
      const w1 = this.getStringWidth(logoLines[1]);
      const w2 = this.getStringWidth(logoLines[2]);
      const w3 = this.getStringWidth(logoLines[3]);
      this._cachedLogoWidths = {
        w0,
        w1,
        w2,
        w3,
        maxW: Math.max(w0, w1, w2, w3),
      };
    }
    const { w0, w1, w2, w3, maxW: maxLogoW } = this._cachedLogoWidths;
    const pad0 = " ".repeat(maxLogoW - w0);
    const pad1 = " ".repeat(maxLogoW - w1);
    const pad2 = " ".repeat(maxLogoW - w2);
    const pad3 = " ".repeat(maxLogoW - w3);

    const shortCwd = this.cwd.replace(/\\/g, "/");

    // Safety check to prevent left/right overflow of the header
    const availableWidth = Math.max(10, columns - 2 - maxLogoW - 2 - 20 - 2);

    let branchText = "";
    if (gitBranch !== "no-git") {
      const stats: string[] = [];
      if (gitSummary.added > 0) stats.push(`+${gitSummary.added}`);
      if (gitSummary.modified > 0) stats.push(`~${gitSummary.modified}`);
      if (gitSummary.deleted > 0) stats.push(`-${gitSummary.deleted}`);
      const gitStatusStats = stats.length > 0 ? ` (${stats.join(" ")})` : "";
      const maxBranchLen = 12;
      const displayBranch =
        gitBranch.length > maxBranchLen
          ? gitBranch.substring(0, maxBranchLen - 3) + "..."
          : gitBranch;
      branchText = `  ${morandi.dim("·")}  ${morandi.dim("⎇")} ${morandi.asst(displayBranch)}${gitStatusStats ? " " + morandi.accent(gitStatusStats) : ""}`;
    }

    const hitRate = environment.cacheTelemetry
      ? environment.cacheTelemetry.hitRate * 100
      : environment.totalInputTokens > 0
        ? (environment.totalCacheReadTokens / environment.totalInputTokens) *
          100
        : 0;
    const cacheRead = environment.cacheTelemetry
      ? environment.cacheTelemetry.hitTokens
      : environment.totalCacheReadTokens;
    const cacheInput = environment.cacheTelemetry
      ? environment.cacheTelemetry.inputTokens || environment.totalInputTokens
      : environment.totalInputTokens;
    const cacheMiss =
      environment.cacheTelemetry?.missTokens ||
      Math.max(0, cacheInput - cacheRead);
    const slabLabel = environment.cacheTelemetry
      ? ` slab:${environment.cacheTelemetry.slabHash.slice(0, 8)}`
      : "";
    const cachePrefix = environment.cacheTelemetry?.degraded
      ? languageIsZh
        ? "[缓存!]"
        : "[cache!]"
      : languageIsZh
        ? "[缓存]"
        : "[cache]";
    let cacheText =
      cacheInput <= 0
        ? `${cachePrefix} ${languageIsZh ? "等待遥测" : "awaiting telemetry"}${slabLabel}`
        : `${cachePrefix} ${languageIsZh ? "命中" : "hit"}: ${hitRate.toFixed(0)}% (${(cacheRead / 1000).toFixed(0)}k ${languageIsZh ? "命中" : "hit"}/${(cacheMiss / 1000).toFixed(0)}k ${languageIsZh ? "未命中" : "miss"})${slabLabel}`;
    if (this.getStringWidth(cacheText) > availableWidth) {
      cacheText = `${cachePrefix} ${hitRate.toFixed(0)}% (${(cacheRead / 1000).toFixed(0)}k/${(cacheInput / 1000).toFixed(0)}k)${slabLabel}`;
    }
    if (this.getStringWidth(cacheText) > availableWidth) {
      cacheText = `${cachePrefix} ${hitRate.toFixed(0)}%`;
    }

    let headerLines: string[];
    if (columns < 76) {
      const compactPrefix = `  workspace: `;
      const compactPath = truncatePathToWidth(
        shortCwd,
        Math.max(1, columns - this.getStringWidth(compactPrefix)),
      );
      const compactBranch =
        gitBranch === "no-git"
          ? ""
          : ` · ${gitBranch.length > 12 ? gitBranch.slice(0, 9) + "..." : gitBranch}`;
      headerLines = [
        `  ${morandi.whiteBold("O R B I T")}`,
        `  ${morandi.dim("workspace:")} ${morandi.gray(compactPath)}`,
        `  ${morandi.dim(cacheText)}${morandi.dim(compactBranch)}`,
      ];
    } else {
      const headerLine1 = `  ${logoLines[0]}${pad0}`;
      const headerLine2Prefix = `  ${logoLines[1]}${pad1}  ${morandi.whiteBold("O R B I T")}      ${morandi.dim("workspace:")} `;
      const maxPathWidth = Math.max(
        1,
        columns -
          this.getStringWidth(headerLine2Prefix) -
          this.getStringWidth(branchText),
      );
      const displayPath = truncatePathToWidth(shortCwd, maxPathWidth);
      const headerLine2 = `  ${logoLines[1]}${pad1}  ${morandi.whiteBold("O R B I T")}      ${morandi.dim("workspace:")} ${morandi.gray(displayPath)}${branchText}`;
      const headerLine3 = `  ${logoLines[2]}${pad2}                 ${morandi.dim(cacheText)}`;
      const headerLine4 = `  ${logoLines[3]}${pad3}`;
      headerLines = [headerLine1, headerLine2, headerLine3, headerLine4];
    }

    // 3. 构建历史对话内容
    const renderedLines: string[] = [];

    // Durable history remains complete, while rendering is bounded so long
    // sessions do not reflow every prior turn for each streaming delta.
    const renderHistory =
      this.history.length > 800 ? this.history.slice(-800) : this.history;
    const conversation = buildTuiConversationViewModel(renderHistory);
    const turns = conversation.turns;
    const lastAsst = conversation.lastAssistant;
    const uBorder = "    ";
    const aBorder = "    ";

    for (const turn of turns) {
      if (turn.user) {
        // Render User Turn
        renderedLines.push("    " + morandi.userBold("👤 User"));
        renderedLines.push(uBorder);

        const userLines = turn.user.text.split("\n");
        const wrappedUserLines: string[] = [];
        for (const line of userLines) {
          wrappedUserLines.push(...this.wrapLine(line, columns - 10));
        }
        for (const line of wrappedUserLines) {
          renderedLines.push(uBorder + morandi.user(line));
        }
        renderedLines.push(uBorder);
        renderedLines.push(""); // spacing
      }

      // Render Assistant Turn
      if (turn.assistant) {
        const asstLines: string[] = [];
        const systemLines = this.formatSystemLinesForDisplay(turn.system, {
          prefixUnknown: true,
          preserveBlank: false,
        });

        const isThinkingNow = turn.assistant === lastAsst && this.isThinking;
        const thoughtTimeVal = isThinkingNow
          ? this.thoughtElapsed
          : turn.assistant.thoughtTime;

        if (thoughtTimeVal !== undefined) {
          const timeStr =
            thoughtTimeVal >= 1000
              ? `${(thoughtTimeVal / 1000).toFixed(1)}s`
              : `${thoughtTimeVal}ms`;

          const breatheDots = [
            "\x1b[38;2;158;184;196m·\x1b[0m",
            "\x1b[38;2;164;178;150m•\x1b[0m",
            "\x1b[38;2;224;188;124m●\x1b[0m",
            "\x1b[38;2;152;188;146m•\x1b[0m",
          ];
          const spinIdx = Math.floor(Date.now() / 250) % 4;
          const dotChar = isThinkingNow
            ? breatheDots[spinIdx]
            : morandi.gray("•");

          if (isThinkingNow) {
            asstLines.push(
              `${dotChar} ` + morandi.accent(`Thinking... ${timeStr}`),
            );
            if (this.currentThinking) {
              const lines = this.currentThinking.split("\n").filter(Boolean);
              const lastLines = lines.slice(-4);
              const maxL = columns - 14;
              for (const line of lastLines) {
                const trimmed = line.trim();
                let displayText = trimmed;
                const displayW = this.getStringWidth(displayText);
                if (displayW > maxL) {
                  displayText =
                    this.truncateToWidth(displayText, maxL - 3) + "...";
                }
                asstLines.push(
                  "    " + morandi.gray("· ") + morandi.dim(displayText),
                );
              }
            }
          } else {
            asstLines.push(
              morandi.gray("🧠 ") + morandi.dim(`Thought for ${timeStr}`),
            );
          }
        }

        if (systemLines.length > 0) {
          asstLines.push(...systemLines);
        }

        if (turn.assistant.text) {
          if (asstLines.length > 0) {
            asstLines.push("");
          }

          const asstObj = turn.assistant as CachedTuiHistoryEntry;
          const isStreaming = this.resolveInput === null;
          const nowTime = Date.now();
          const timeSinceLastRender =
            nowTime - (asstObj._lastMarkdownRenderTime || 0);

          if (
            !asstObj._formattedCached ||
            asstObj._textCached !== turn.assistant.text
          ) {
            if (
              !isStreaming ||
              timeSinceLastRender >= 150 ||
              !asstObj._formattedCached
            ) {
              asstObj._formattedCached = Renderer.formatMarkdown(
                turn.assistant.text,
              ).split("\n");
              asstObj._textCached = turn.assistant.text;
              asstObj._lastMarkdownRenderTime = nowTime;
            }
          }
          asstLines.push(...asstObj._formattedCached);
        }

        const turnModel = turn.assistant?.model || cleanModel;
        const cleanTurnModel = turnModel.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
        let footerStatusLine = "";
        const lastSys = turn.system[turn.system.length - 1];
        if (lastSys && lastSys.text.includes("Failed")) {
          footerStatusLine = `${morandi.failed("failed")}  ·  ${morandi.dim(cleanTurnModel)}`;
        } else if (turn.assistant.totalTime !== undefined) {
          const sec = (turn.assistant.totalTime / 1000).toFixed(1);
          footerStatusLine = `${morandi.completed("completed")}  ·  ${morandi.dim(cleanTurnModel)}  ·  ${morandi.dim(sec + "s")}`;
        }

        if (footerStatusLine) {
          asstLines.push("");
          asstLines.push(footerStatusLine);
        }

        const actionLines = this.formatSystemLinesForDisplay(turn.actions, {
          prefixUnknown: true,
          preserveBlank: false,
        });
        if (actionLines.length > 0) {
          asstLines.push("");
          asstLines.push(...actionLines);
        }

        const wrappedAsstLines: string[] = [];
        for (const line of asstLines) {
          wrappedAsstLines.push(...this.wrapLine(line, columns - 10));
        }

        renderedLines.push(
          "    " + morandi.asstBold(`🤖 Orbit (${cleanTurnModel})`),
        );
        renderedLines.push(aBorder);
        for (const line of wrappedAsstLines) {
          renderedLines.push(aBorder + line);
        }
        renderedLines.push(aBorder);
        renderedLines.push("");
      } else if (turn.system.length > 0 || turn.actions.length > 0) {
        // Render System Lines (Command Outputs/Status/Help) directly!
        const systemLines = this.formatSystemLinesForDisplay(
          [...turn.system, ...turn.actions],
          {
            prefixUnknown: false,
            preserveBlank: true,
          },
        );

        const wrappedSysLines: string[] = [];
        for (const line of systemLines) {
          wrappedSysLines.push(...this.wrapLine(line, columns - 10));
        }
        for (const line of wrappedSysLines) {
          renderedLines.push("    " + line);
        }
        renderedLines.push("");
      }
    }

    // A.6 Read Plan Items
    let planText = "";
    const planItems = this.getPlanLines();
    if (planItems.length > 0) {
      const planContent: string[] = [];
      let activeIndex = planItems.findIndex((item) => item.startsWith("- [/]"));
      if (activeIndex === -1) {
        activeIndex = planItems.findIndex((item) => item.startsWith("- [ ]"));
      }
      if (activeIndex === -1) {
        activeIndex = planItems.length - 1;
      }

      planContent.push("  " + morandi.accent("📋 Active Plan:"));

      const startPlanIdx = Math.max(0, activeIndex - 1);
      const endPlanIdx = Math.min(planItems.length - 1, activeIndex + 1);

      if (startPlanIdx > 0) {
        planContent.push(
          "    " +
            morandi.dim(
              languageIsZh
                ? `… 已完成 ${startPlanIdx} 步`
                : `… ${startPlanIdx} step(s) completed`,
            ),
        );
      }

      for (let i = startPlanIdx; i <= endPlanIdx; i++) {
        const item = planItems[i];
        const text = item.substring(5).trim();
        const isCurrentRunning =
          item.startsWith("- [/]") || item.startsWith("- [/");
        const isCompleted = item.startsWith("- [x]") || item.startsWith("- [x");

        let prefixSymbol = "";
        if (isCurrentRunning) {
          prefixSymbol = morandi.accent("●");
        } else if (isCompleted) {
          prefixSymbol = morandi.completed("✔");
        } else {
          prefixSymbol = morandi.gray("○");
        }

        let displayText = text;
        const maxTextLen = columns - 12;
        const displayW = this.getStringWidth(displayText);
        if (displayW > maxTextLen) {
          displayText =
            this.truncateToWidth(displayText, maxTextLen - 3) + "...";
        }

        const coloredText = isCurrentRunning
          ? morandi.whiteBold(displayText)
          : isCompleted
            ? morandi.dim(displayText)
            : morandi.gray(displayText);

        planContent.push("    " + prefixSymbol + " " + coloredText);
      }

      if (endPlanIdx < planItems.length - 1) {
        const remaining = planItems.length - 1 - endPlanIdx;
        planContent.push(
          "    " +
            morandi.dim(
              languageIsZh
                ? `… 还有 ${remaining} 步待处理`
                : `… ${remaining} step(s) pending`,
            ),
        );
      }
      planText = planContent.join("\n") + "\n\n";
    }

    // A.5 Context files panel
    let contextText = "";
    if (this.activeContextFiles && this.activeContextFiles.length > 0) {
      const contextLines: string[] = [];
      contextLines.push("  " + morandi.accent("📎 Context Files:"));

      const filesStr = this.activeContextFiles
        .map((f) => `[${f.path}${f.readOnly ? " 🔒" : ""}]`)
        .join("  ");
      const maxW = columns - 10;
      const wrappedFiles = this.wrapLine(filesStr, maxW);
      for (const line of wrappedFiles) {
        contextLines.push("    " + morandi.white(line));
      }
      contextText = contextLines.join("\n") + "\n\n";
    }

    const headerText = `${headerLines.join("\n")}\n\n` + planText + contextText;
    const headerHeight = headerText.split("\n").length;

    // 6. 排版与渲染到终端 (带垂直裁剪逻辑，自底向上排布)
    // 留出 1 行用于历史记录与输入框之间的空行间隔
    const maxContentRows = Math.max(1, rows - bottomHeight - headerHeight - 1);

    const flatLines: string[] = [];
    for (const item of renderedLines) {
      flatLines.push(...item.split("\n"));
    }

    if (
      this.historyScrollOffset > 0 &&
      flatLines.length > this.lastHistoryLineCount
    ) {
      this.historyScrollOffset += flatLines.length - this.lastHistoryLineCount;
      this.hasNewOutputWhileScrolled = true;
    }
    this.lastHistoryLineCount = flatLines.length;
    this.maxHistoryScrollOffset = Math.max(
      0,
      flatLines.length - maxContentRows,
    );
    this.historyScrollOffset = Math.min(
      this.historyScrollOffset,
      this.maxHistoryScrollOffset,
    );

    const finalLines: string[] = [];
    let totalLinesCount = 0;

    const visibleEnd = Math.max(0, flatLines.length - this.historyScrollOffset);
    for (let i = visibleEnd - 1; i >= 0; i--) {
      const line = flatLines[i];
      const visibleLen = this.getStringWidth(line);
      const lineRows = Math.max(
        1,
        Math.ceil(visibleLen / Math.max(1, columns - 4)),
      );
      if (totalLinesCount + lineRows > maxContentRows) {
        break;
      }
      totalLinesCount += lineRows;
      finalLines.unshift(line);
    }

    // Trim trailing empty lines from finalLines to prevent extra blank space at the bottom
    while (
      finalLines.length > 0 &&
      finalLines[finalLines.length - 1]
        .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
        .trim() === ""
    ) {
      finalLines.pop();
    }

    const gapHeight = finalLines.length > 0 ? 1 : 0;
    const totalHeight =
      headerHeight + finalLines.length + gapHeight + bottomHeight;
    const extraPad = Math.max(0, rows - totalHeight);

    const allLines: string[] = [];
    allLines.push(...headerText.split("\n"));

    if (extraPad > 0) {
      for (let i = 0; i < extraPad; i++) {
        allLines.push("");
      }
    }

    if (finalLines.length > 0) {
      allLines.push(...finalLines);
      // 聊天记录的下限和输入框的长方形边框隔开一行空行
      allLines.push("");
    }

    allLines.push(...bottomLines);
    const rawLines = allLines;

    const staticText = rawLines
      .slice(0, rawLines.length - bottomHeight)
      .join("\n");
    const canIncremental =
      !forceFull &&
      isInputActive &&
      this.cachedStaticLinesCount > 0 &&
      bottomHeight === this.lastRenderedBottomHeight &&
      staticText === this.cachedStaticContent;

    if (canIncremental) {
      // 局部增量重绘
      let cursorSequence = "";
      const { lineIndex: cursorLineIndex, xOffset } =
        getCursorPositionInWrappedInput(wrappedInputLines, this.cursorPosition);
      // Use pre-calculated constant for the input prefix width instead of recomputing
      const lineStartX = cursorLineIndex === 0 ? INPUT_PREFIX_WIDTH : 12;
      const targetX = lineStartX + xOffset;
      const linesUp = formattedLines.length - cursorLineIndex + 1; // 距离状态行向上数 linesUp 行
      cursorSequence = `\x1b[${linesUp}A\x1b[${targetX + 1}G\x1b[?25h`;

      const bottomOutput =
        "\x1b[?25l" + // 隐藏光标
        `\x1b[${this.cachedStaticLinesCount + 1};1H` + // 移至底部的首行
        bottomLines.map((line) => line + "\x1b[K").join("\n") +
        "\x1b[J" + // 擦拭并重写 bottomLines
        cursorSequence;

      process.stdout.write(bottomOutput);
      return;
    }

    // 缓存静态渲染信息
    this.cachedStaticLinesCount = rawLines.length - bottomHeight;
    this.cachedStaticContent = staticText;
    this.lastRenderedBottomHeight = bottomHeight;

    let finalOutput =
      "\x1b[?25l\x1b[H" +
      rawLines.map((line) => line + "\x1b[K").join("\n") +
      "\x1b[J";

    // 7. 相对光标精确定位与原子打包输出
    let cursorSequence = "";
    if (this.resolveInput || this.thinkingKeypressListener !== null) {
      const { lineIndex: cursorLineIndex, xOffset } =
        getCursorPositionInWrappedInput(wrappedInputLines, this.cursorPosition);
      const lineStartX = cursorLineIndex === 0 ? INPUT_PREFIX_WIDTH : 12;
      const targetX = lineStartX + xOffset;
      const linesUp = formattedLines.length - cursorLineIndex + 1; // 距离状态行向上数 linesUp 行
      cursorSequence = `\x1b[${linesUp}A\x1b[${targetX + 1}G\x1b[?25h`;
    } else {
      cursorSequence = "\x1b[?25l";
    }

    finalOutput += cursorSequence;
    process.stdout.write(finalOutput);
  }

  private truncateToWidth(str: string, maxW: number): string {
    return truncateToWidth(str, maxW);
  }

  private wrapLine(line: string, maxWidth: number): string[] {
    return wrapAnsiLine(line, maxWidth);
  }

  private getStringWidth(str: string): number {
    return getStringWidth(str);
  }

  private wrapInputText(str: string, maxWidth: number): WrappedInputLine[] {
    return wrapInputText(str, maxWidth);
  }

  private formatWrappedLines(
    wrappedLines: string[],
    inputLength: number,
  ): string[] {
    return formatWrappedLines(wrappedLines, inputLength);
  }
}
