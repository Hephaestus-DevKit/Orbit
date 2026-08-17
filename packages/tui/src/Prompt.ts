import {
  confirm,
  text,
  spinner,
  select,
  multiselect,
  password,
  isCancel,
} from "@clack/prompts";
import picocolors from "picocolors";
import readline from "readline";

export type PromptOption = {
  value: string;
  label: string;
  hint?: string;
  deleteDisabled?: boolean;
};

export type SelectWithDeleteResult =
  | { action: "select"; value: string }
  | { action: "delete"; value: string }
  | { action: "cancel" };

export type TuiPromptType =
  | "select"
  | "multiselect"
  | "text"
  | "confirm"
  | "password";

export interface TuiPromptConfig {
  type: TuiPromptType;
  message: string;
  options?: PromptOption[];
  initialValue?: string;
  initialSelectedValue?: string;
  deletable?: boolean;
  suppressCloseRenderOnDelete?: boolean;
  suppressCloseRenderOnSelect?: boolean;
  renderOnSelectValues?: string[];
}

export type TuiPromptResult =
  | string
  | string[]
  | boolean
  | SelectWithDeleteResult
  | null;

export type PromptAccessibilityMode = "standard" | "screen-reader";

export interface TuiPromptHost {
  isActive: boolean;
  showPrompt(config: TuiPromptConfig): Promise<TuiPromptResult>;
}

type ReadlineWithTtyWrite = readline.Interface & {
  _ttyWrite?: (char: string | undefined, key: readline.Key) => void;
};

function isSelectWithDeleteResult(
  value: TuiPromptResult,
): value is SelectWithDeleteResult {
  if (!value || typeof value !== "object" || !("action" in value)) {
    return false;
  }
  if (value.action === "cancel") return true;
  return (
    (value.action === "select" || value.action === "delete") &&
    typeof value.value === "string"
  );
}

/** Resolves a plain-text numeric or exact-value selection. */
export function resolvePlainSelection(
  input: string,
  options: readonly PromptOption[],
): string | null {
  const normalized = input.trim();
  const index = Number(normalized);
  if (Number.isInteger(index) && index >= 1 && index <= options.length) {
    return options[index - 1]?.value ?? null;
  }
  return options.find((option) => option.value === normalized)?.value ?? null;
}

/** Resolves comma-separated plain-text selections without duplicates. */
export function resolvePlainMultiSelection(
  input: string,
  options: readonly PromptOption[],
): string[] | null {
  const normalized = input.trim();
  if (!normalized) return [];
  const selected = normalized
    .split(",")
    .map((part) => resolvePlainSelection(part, options));
  if (selected.some((value) => value === null)) return null;
  return Array.from(new Set(selected as string[]));
}

export class Prompt {
  public static tuiInstance: TuiPromptHost | null = null;
  private static accessibilityMode: PromptAccessibilityMode = "standard";

  public static setTuiInstance(tui: TuiPromptHost | null): void {
    this.tuiInstance = tui;
  }

  public static setAccessibilityMode(mode: PromptAccessibilityMode): void {
    this.accessibilityMode = mode;
  }

  private static get screenReaderMode(): boolean {
    return this.accessibilityMode === "screen-reader";
  }

  private static askPlainLine(
    message: string,
    initialValue?: string,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
      });
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        rl.close();
        resolve(value);
      };
      process.stdout.write(
        `${message}${initialValue ? ` [${initialValue}]` : ""}: `,
      );
      rl.once("SIGINT", () => finish(null));
      rl.once("line", (line) => finish(line || initialValue || ""));
    });
  }

  private static askPlainPassword(message: string): Promise<string | null> {
    if (
      process.stdin.isTTY !== true ||
      typeof process.stdin.setRawMode !== "function"
    ) {
      process.stderr.write(
        `${message}: secure password input requires an interactive terminal.\n`,
      );
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      const wasRaw = !!process.stdin.isRaw;
      let value = "";
      let settled = false;
      const finish = (result: string | null) => {
        if (settled) return;
        settled = true;
        process.stdin.removeListener("data", onData);
        process.stdin.setRawMode?.(wasRaw);
        if (!wasRaw) process.stdin.pause();
        process.stdout.write("\n");
        resolve(result);
      };
      const onData = (chunk: Buffer | string) => {
        const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
        for (const char of text) {
          if (char === "\u0003") {
            finish(null);
            return;
          }
          if (char === "\r" || char === "\n") {
            finish(value);
            return;
          }
          if (char === "\u0008" || char === "\u007f") {
            value = value.slice(0, -1);
            continue;
          }
          if (!/[\u0000-\u001f\u007f]/.test(char)) value += char;
        }
      };
      process.stdout.write(`${message}: `);
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on("data", onData);
    });
  }

  private static printPlainOptions(options: readonly PromptOption[]): void {
    for (let index = 0; index < options.length; index += 1) {
      const option = options[index];
      if (!option) continue;
      process.stdout.write(
        `${index + 1}. ${option.label}${option.hint ? ` - ${option.hint}` : ""}\n`,
      );
    }
  }

  private static async wrapPrompt<T>(promptFn: () => Promise<T>): Promise<T> {
    const onKeypress = (_str: string, key: readline.Key) => {
      if (key && key.name === "escape") {
        process.stdin.emit("keypress", "\u0003", { ctrl: true, name: "c" });
      }
    };
    process.stdin.on("keypress", onKeypress);
    try {
      return await promptFn();
    } finally {
      process.stdin.removeListener("keypress", onKeypress);
    }
  }

  public static async askPassword(message: string): Promise<string | null> {
    if (this.screenReaderMode) return this.askPlainPassword(message);
    if (this.tuiInstance && this.tuiInstance.isActive) {
      const response = await this.tuiInstance.showPrompt({
        type: "password",
        message,
      });
      return typeof response === "string" ? response : null;
    }
    return this.wrapPrompt(async () => {
      const response = await password({
        message,
        mask: "*",
      });
      if (isCancel(response)) return null;
      return typeof response === "string" ? response : "";
    });
  }

  public static async askApproval(message: string): Promise<boolean> {
    if (this.screenReaderMode) {
      const response = await this.askPlainLine(`${message} Approve? [y/N]`);
      return /^(?:y|yes)$/i.test(response?.trim() ?? "");
    }
    if (this.tuiInstance && this.tuiInstance.isActive) {
      const response = await this.tuiInstance.showPrompt({
        type: "confirm",
        message,
      });
      return response === true;
    }
    return this.wrapPrompt(async () => {
      const response = await confirm({
        message: `${picocolors.yellow(message)} Approve?`,
      });
      if (isCancel(response)) return false;
      return !!response;
    });
  }

  public static async askText(
    message: string,
    initialValue?: string,
  ): Promise<string | null> {
    if (this.screenReaderMode) return this.askPlainLine(message, initialValue);
    if (this.tuiInstance && this.tuiInstance.isActive) {
      const response = await this.tuiInstance.showPrompt({
        type: "text",
        message,
        initialValue,
      });
      return typeof response === "string" ? response : null;
    }
    return this.wrapPrompt(async () => {
      const response = await text({
        message,
        placeholder: "Type your task or command...",
        initialValue,
      });
      if (isCancel(response)) return null;
      return typeof response === "string" ? response : "";
    });
  }

  public static async askTextWithAutocomplete(
    message: string,
    completerFn: (line: string) => [string[], string],
    promptPrefix?: string,
  ): Promise<string | null> {
    if (this.screenReaderMode) return this.askPlainLine(message);
    return new Promise((resolve) => {
      const promptStr =
        promptPrefix !== undefined
          ? promptPrefix
          : `${picocolors.cyan("?")} ${message} › `;

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        completer: completerFn,
        prompt: promptStr,
      });

      let currentSuggestion = "";
      let hasPrintedSuggestions = false;

      function clearSuggestions() {
        if (hasPrintedSuggestions) {
          process.stdout.write("\n\x1b[K");
          readline.moveCursor(process.stdout, 0, -1);
          const visiblePromptLen = promptStr.replace(
            /\x1b\[[0-9;]*[a-zA-Z]/g,
            "",
          ).length;
          readline.cursorTo(process.stdout, rl.cursor + visiblePromptLen);
          hasPrintedSuggestions = false;
        }
      }

      function printSuggestions(hits: string[]) {
        clearSuggestions();
        if (hits.length === 0) return;
        const suggestionText = ` Suggestions: ${hits.slice(0, 6).join(" | ")}${hits.length > 6 ? " ..." : ""}`;

        process.stdout.write("\n\x1b[K" + picocolors.gray(suggestionText));
        readline.moveCursor(process.stdout, 0, -1);
        const visiblePromptLen = promptStr.replace(
          /\x1b\[[0-9;]*[a-zA-Z]/g,
          "",
        ).length;
        readline.cursorTo(process.stdout, rl.cursor + visiblePromptLen);
        hasPrintedSuggestions = true;
      }

      function updateSuggestion() {
        const line = rl.line;
        const cursor = rl.cursor;
        currentSuggestion = "";

        if (cursor === line.length && line.trim().length > 0) {
          const [hits, lastWord] = completerFn(line);
          if (hits.length > 0) {
            const bestMatch = hits[0];
            if (line.startsWith("/")) {
              if (bestMatch.startsWith(line) && bestMatch !== line) {
                currentSuggestion = bestMatch.substring(line.length);
              }
            } else if (lastWord) {
              if (bestMatch.startsWith(lastWord) && bestMatch !== lastWord) {
                currentSuggestion = bestMatch.substring(lastWord.length);
              }
            }
          }
        }

        process.stdout.write("\x1b[K"); // clear forward
        if (currentSuggestion) {
          process.stdout.write(picocolors.dim(currentSuggestion));
          readline.moveCursor(process.stdout, -currentSuggestion.length, 0);
        }
      }

      const internalReadline = rl as ReadlineWithTtyWrite;
      const originalTtyWrite = internalReadline._ttyWrite;
      if (originalTtyWrite) {
        internalReadline._ttyWrite = (char, key) => {
          if (key && key.name === "escape") {
            clearSuggestions();
            rl.close();
            process.stdout.write("\n");
            resolve(null);
            return;
          }

          if (
            currentSuggestion &&
            key &&
            (key.name === "tab" || key.name === "right")
          ) {
            clearSuggestions();
            rl.write(currentSuggestion);
            currentSuggestion = "";
            process.stdout.write("\x1b[K");
            return;
          }

          if (key && key.name === "tab" && !currentSuggestion) {
            const line = rl.line;
            const [hits] = completerFn(line);
            if (hits.length > 0) {
              printSuggestions(hits);
              return;
            }
          }

          clearSuggestions();
          originalTtyWrite.call(rl, char, key);
          updateSuggestion();
        };
      }

      rl.prompt();

      rl.on("SIGINT", () => {
        clearSuggestions();
        rl.close();
        process.stdout.write("\n");
        resolve(null);
      });

      rl.on("line", (line) => {
        clearSuggestions();
        rl.close();
        resolve(line);
      });
    });
  }

  public static async askSelect(
    message: string,
    options: PromptOption[],
    config: {
      suppressCloseRenderOnSelect?: boolean;
      renderOnSelectValues?: string[];
    } = {},
  ): Promise<string | null> {
    if (this.screenReaderMode) {
      this.printPlainOptions(options);
      const response = await this.askPlainLine(
        `${message} [1-${options.length}]`,
      );
      return response === null
        ? null
        : resolvePlainSelection(response, options);
    }
    if (this.tuiInstance && this.tuiInstance.isActive) {
      const response = await this.tuiInstance.showPrompt({
        type: "select",
        message,
        options,
        suppressCloseRenderOnSelect:
          config.suppressCloseRenderOnSelect === true,
        renderOnSelectValues: config.renderOnSelectValues,
      });
      if (isSelectWithDeleteResult(response)) {
        return response.action === "select" ? response.value : null;
      }
      return typeof response === "string" ? response : null;
    }
    return this.wrapPrompt(async () => {
      const response = await select({
        message,
        options,
      });
      if (isCancel(response)) return null;
      return typeof response === "string" ? response : "";
    });
  }

  public static async askSelectWithDelete(
    message: string,
    options: PromptOption[],
    config: {
      initialSelectedValue?: string;
      suppressCloseRenderOnDelete?: boolean;
    } = {},
  ): Promise<SelectWithDeleteResult> {
    if (this.tuiInstance && this.tuiInstance.isActive) {
      const response = await this.tuiInstance.showPrompt({
        type: "select",
        message,
        options,
        deletable: true,
        initialSelectedValue: config.initialSelectedValue,
        suppressCloseRenderOnDelete: config.suppressCloseRenderOnDelete,
      });
      if (isSelectWithDeleteResult(response)) {
        return response;
      }
      if (typeof response === "string" && response.length > 0) {
        return { action: "select", value: response };
      }
      return { action: "cancel" };
    }

    const response = await this.askSelect(message, options);
    if (!response) {
      return { action: "cancel" };
    }
    return { action: "select", value: response };
  }

  public static async askMultiSelect(
    message: string,
    options: PromptOption[],
  ): Promise<string[] | null> {
    if (this.screenReaderMode) {
      this.printPlainOptions(options);
      const response = await this.askPlainLine(
        `${message} [comma-separated numbers]`,
      );
      return response === null
        ? null
        : resolvePlainMultiSelection(response, options);
    }
    if (this.tuiInstance && this.tuiInstance.isActive) {
      const response = await this.tuiInstance.showPrompt({
        type: "multiselect",
        message,
        options,
      });
      return Array.isArray(response) &&
        response.every((value) => typeof value === "string")
        ? response
        : null;
    }
    return this.wrapPrompt(async () => {
      const response = await multiselect({
        message,
        options,
        required: false,
      });
      if (isCancel(response)) return null;
      return Array.isArray(response) ? (response as string[]) : [];
    });
  }

  public static makeSpinner() {
    return spinner();
  }
}
