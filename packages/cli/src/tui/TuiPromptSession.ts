import type {
  PromptOption,
  TuiPromptConfig,
  TuiPromptResult,
  TuiPromptType,
} from "@orbit-build/tui";
import {
  filterPromptOptionIndices,
  nextCodePointIndex,
  nextWordIndex,
  previousCodePointIndex,
  previousWordIndex,
} from "./TuiInputHelpers.js";

export type { TuiPromptConfig, TuiPromptResult } from "@orbit-build/tui";

export interface TuiPromptState {
  type: TuiPromptType;
  message: string;
  options: PromptOption[];
  deletable: boolean;
  suppressCloseRenderOnDelete: boolean;
  suppressCloseRenderOnSelect: boolean;
  renderOnSelectValues: Set<string>;
  pendingDeleteValue: string | null;
  filterQuery: string;
  filterActive: boolean;
  selectedIndex: number;
  selectedValues: Set<string>;
  inputValue: string;
  cursorPosition: number;
}

export type TuiPromptActionResult =
  | { action: "select"; value: string }
  | { action: "delete"; value: string }
  | { action: "cancel" };

export interface TuiKeypress {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
}

export type PromptKeypressEffect =
  | { kind: "none" }
  | { kind: "render" }
  | { kind: "complete"; value: TuiPromptResult };

const NONE: PromptKeypressEffect = { kind: "none" };
const RENDER: PromptKeypressEffect = { kind: "render" };

/** Creates the complete mutable state owned by one prompt session. */
export function createPromptState(config: TuiPromptConfig): TuiPromptState {
  const initialValue = config.initialValue ?? "";
  const options =
    config.type === "confirm"
      ? [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ]
      : [...(config.options ?? [])];
  const initialIndex =
    config.initialSelectedValue &&
    (config.type === "select" || config.type === "multiselect")
      ? options.findIndex(
          (option) => option.value === config.initialSelectedValue,
        )
      : -1;

  return {
    type: config.type,
    message: config.message,
    options,
    deletable: config.deletable === true,
    suppressCloseRenderOnDelete: config.suppressCloseRenderOnDelete === true,
    suppressCloseRenderOnSelect: config.suppressCloseRenderOnSelect === true,
    renderOnSelectValues: new Set(config.renderOnSelectValues ?? []),
    pendingDeleteValue: null,
    filterQuery: "",
    filterActive: false,
    selectedIndex: initialIndex >= 0 ? initialIndex : 0,
    selectedValues: new Set<string>(),
    inputValue: initialValue,
    cursorPosition: initialValue.length,
  };
}

/** Returns indices visible through the prompt's current text filter. */
export function getPromptOptionIndices(state: TuiPromptState): number[] {
  return state.type === "confirm"
    ? state.options.map((_, index) => index)
    : filterPromptOptionIndices(state.options, state.filterQuery);
}

function ensureSelectionVisible(state: TuiPromptState): number[] {
  const indices = getPromptOptionIndices(state);
  if (indices.length > 0 && !indices.includes(state.selectedIndex)) {
    state.selectedIndex = indices[0];
  }
  return indices;
}

function clearPendingDelete(state: TuiPromptState): void {
  state.pendingDeleteValue = null;
}

function moveSelection(state: TuiPromptState, delta: number): void {
  clearPendingDelete(state);
  const indices = ensureSelectionVisible(state);
  if (indices.length === 0) return;
  const currentPosition = Math.max(0, indices.indexOf(state.selectedIndex));
  const nextPosition =
    (currentPosition + delta + indices.length * 1000) % indices.length;
  state.selectedIndex = indices[nextPosition];
}

function moveSelectionToEdge(
  state: TuiPromptState,
  edge: "first" | "last",
): void {
  clearPendingDelete(state);
  const indices = ensureSelectionVisible(state);
  if (indices.length === 0) return;
  state.selectedIndex =
    edge === "first" ? indices[0] : indices[indices.length - 1];
}

function cancelResult(state: TuiPromptState): TuiPromptResult {
  if (state.type === "confirm") return false;
  if (state.deletable && state.type === "select") {
    return { action: "cancel" };
  }
  return null;
}

function isPrintableInput(str: string, key: TuiKeypress): boolean {
  return (
    str.length > 0 &&
    !key.ctrl &&
    !key.meta &&
    !/[\u0000-\u001f\u007f]/.test(str)
  );
}

function reduceFilterKeypress(
  state: TuiPromptState,
  str: string,
  key: TuiKeypress,
): PromptKeypressEffect | null {
  if (key.name === "escape") {
    clearPendingDelete(state);
    if (state.filterQuery.length > 0) {
      state.filterQuery = "";
      ensureSelectionVisible(state);
    } else {
      state.filterActive = false;
    }
    return RENDER;
  }
  if (key.ctrl && key.name === "u") {
    clearPendingDelete(state);
    state.filterQuery = "";
    ensureSelectionVisible(state);
    return RENDER;
  }
  if (key.name === "backspace") {
    clearPendingDelete(state);
    const previousIndex = previousCodePointIndex(
      state.filterQuery,
      state.filterQuery.length,
    );
    state.filterQuery = state.filterQuery.slice(0, previousIndex);
    ensureSelectionVisible(state);
    return RENDER;
  }
  if (isPrintableInput(str, key)) {
    clearPendingDelete(state);
    state.filterQuery += str;
    ensureSelectionVisible(state);
    return RENDER;
  }
  return null;
}

function reduceListKeypress(
  state: TuiPromptState,
  str: string,
  key: TuiKeypress,
): PromptKeypressEffect {
  const indices = ensureSelectionVisible(state);
  if (indices.length === 0) return NONE;

  if (state.type === "select" && state.deletable && key.name === "delete") {
    const option = state.options[state.selectedIndex];
    if (
      !option ||
      option.deleteDisabled ||
      !indices.includes(state.selectedIndex)
    ) {
      clearPendingDelete(state);
      return RENDER;
    }
    if (state.pendingDeleteValue === option.value) {
      return {
        kind: "complete",
        value: { action: "delete", value: option.value },
      };
    }
    state.pendingDeleteValue = option.value;
    return RENDER;
  }
  if (key.name === "up" || str === "k") {
    moveSelection(state, -1);
    return RENDER;
  }
  if (key.name === "down" || str === "j") {
    moveSelection(state, 1);
    return RENDER;
  }
  if (key.name === "home") {
    moveSelectionToEdge(state, "first");
    return RENDER;
  }
  if (key.name === "end") {
    moveSelectionToEdge(state, "last");
    return RENDER;
  }
  if (key.name === "pageup") {
    moveSelection(state, -8);
    return RENDER;
  }
  if (key.name === "pagedown") {
    moveSelection(state, 8);
    return RENDER;
  }
  if (state.type === "multiselect" && (key.name === "space" || str === " ")) {
    const value = state.options[state.selectedIndex]?.value;
    if (value) {
      if (state.selectedValues.has(value)) {
        state.selectedValues.delete(value);
      } else {
        state.selectedValues.add(value);
      }
    }
    return RENDER;
  }
  return NONE;
}

function reduceTextKeypress(
  state: TuiPromptState,
  str: string,
  key: TuiKeypress,
): PromptKeypressEffect {
  if (key.name === "home" || (key.ctrl && key.name === "a")) {
    state.cursorPosition = 0;
    return RENDER;
  }
  if (key.name === "end" || (key.ctrl && key.name === "e")) {
    state.cursorPosition = state.inputValue.length;
    return RENDER;
  }
  if ((key.ctrl || key.meta) && key.name === "left") {
    state.cursorPosition = previousWordIndex(
      state.inputValue,
      state.cursorPosition,
    );
    return RENDER;
  }
  if ((key.ctrl || key.meta) && key.name === "right") {
    state.cursorPosition = nextWordIndex(
      state.inputValue,
      state.cursorPosition,
    );
    return RENDER;
  }
  if (key.ctrl && (key.name === "backspace" || key.name === "w")) {
    if (state.cursorPosition > 0) {
      const target = previousWordIndex(state.inputValue, state.cursorPosition);
      state.inputValue =
        state.inputValue.slice(0, target) +
        state.inputValue.slice(state.cursorPosition);
      state.cursorPosition = target;
      return RENDER;
    }
    return NONE;
  }
  if (key.ctrl && key.name === "u") {
    state.inputValue = state.inputValue.slice(state.cursorPosition);
    state.cursorPosition = 0;
    return RENDER;
  }
  if (key.name === "backspace") {
    if (state.cursorPosition === 0) return NONE;
    const previousIndex = previousCodePointIndex(
      state.inputValue,
      state.cursorPosition,
    );
    state.inputValue =
      state.inputValue.slice(0, previousIndex) +
      state.inputValue.slice(state.cursorPosition);
    state.cursorPosition = previousIndex;
    return RENDER;
  }
  if (key.name === "delete") {
    if (state.cursorPosition >= state.inputValue.length) return NONE;
    const nextIndex = nextCodePointIndex(
      state.inputValue,
      state.cursorPosition,
    );
    state.inputValue =
      state.inputValue.slice(0, state.cursorPosition) +
      state.inputValue.slice(nextIndex);
    return RENDER;
  }
  if (key.name === "left") {
    if (state.cursorPosition === 0) return NONE;
    state.cursorPosition = previousCodePointIndex(
      state.inputValue,
      state.cursorPosition,
    );
    return RENDER;
  }
  if (key.name === "right") {
    if (state.cursorPosition >= state.inputValue.length) return NONE;
    state.cursorPosition = nextCodePointIndex(
      state.inputValue,
      state.cursorPosition,
    );
    return RENDER;
  }
  if (isPrintableInput(str, key)) {
    state.inputValue =
      state.inputValue.slice(0, state.cursorPosition) +
      str +
      state.inputValue.slice(state.cursorPosition);
    state.cursorPosition += str.length;
    return RENDER;
  }
  return NONE;
}

/** Applies one keypress to prompt state and reports the required session effect. */
export function reducePromptKeypress(
  state: TuiPromptState,
  str: string,
  key: TuiKeypress = {},
): PromptKeypressEffect {
  if (key.ctrl && key.name === "c") {
    return { kind: "complete", value: cancelResult(state) };
  }

  const isList = state.type === "select" || state.type === "multiselect";
  if (isList && key.name === "/" && !state.filterActive) {
    clearPendingDelete(state);
    state.filterActive = true;
    return RENDER;
  }
  if (isList && state.filterActive) {
    const filterEffect = reduceFilterKeypress(state, str, key);
    if (filterEffect) return filterEffect;
  }

  if (key.name === "escape") {
    return { kind: "complete", value: cancelResult(state) };
  }

  if (key.name === "return" || key.name === "enter") {
    if (state.type === "select") {
      const indices = ensureSelectionVisible(state);
      if (indices.length === 0) return RENDER;
      const value = state.options[state.selectedIndex]?.value ?? null;
      return {
        kind: "complete",
        value: state.deletable && value ? { action: "select", value } : value,
      };
    }
    if (state.type === "confirm") {
      return {
        kind: "complete",
        value: state.options[state.selectedIndex]?.value === "yes",
      };
    }
    if (state.type === "multiselect") {
      return {
        kind: "complete",
        value: Array.from(state.selectedValues),
      };
    }
    return { kind: "complete", value: state.inputValue };
  }

  if (
    state.type === "select" ||
    state.type === "confirm" ||
    state.type === "multiselect"
  ) {
    return reduceListKeypress(state, str, key);
  }
  return reduceTextKeypress(state, str, key);
}

interface ActivePrompt {
  readonly resolve: (value: TuiPromptResult) => void;
  readonly wasRaw: boolean;
  readonly listener: (str: string, key: TuiKeypress) => void;
}

/** Owns one interactive prompt's state, key listener, and raw-mode lifecycle. */
export class TuiPromptSession {
  private promptState: TuiPromptState | null = null;
  private active: ActivePrompt | null = null;

  public constructor(
    private readonly requestRender: () => void,
    private readonly stdin: NodeJS.ReadStream = process.stdin,
  ) {}

  public get state(): TuiPromptState | null {
    return this.promptState;
  }

  public show(config: TuiPromptConfig): Promise<TuiPromptResult> {
    this.cancelActive(false);
    this.promptState = createPromptState(config);
    this.requestRender();

    const wasRaw = !!this.stdin.isRaw;
    if (this.stdin.setRawMode) this.stdin.setRawMode(true);

    return new Promise<TuiPromptResult>((resolve) => {
      const listener = (str: string, key: TuiKeypress = {}) => {
        const state = this.promptState;
        if (!state) {
          this.cleanupActive();
          return;
        }
        try {
          const effect = reducePromptKeypress(state, str, key);
          if (effect.kind === "render") {
            this.requestRender();
          } else if (effect.kind === "complete") {
            this.complete(effect.value);
          }
        } catch {
          this.requestRender();
        }
      };
      this.active = { resolve, wasRaw, listener };
      this.stdin.on("keypress", listener);
      // The main input prompt pauses stdin when it submits a command. Arm the
      // replacement listener before resuming so readline never observes a
      // flowing stream without a keypress consumer during prompt hand-off.
      this.stdin.resume();
    });
  }

  /** Removes listeners and resolves an unfinished prompt during TUI disposal. */
  public dispose(): void {
    this.cancelActive(false);
  }

  private complete(value: TuiPromptResult): void {
    const state = this.promptState;
    const active = this.active;
    if (!state || !active) return;
    const actionValue =
      typeof value === "object" && value !== null && "action" in value
        ? value
        : null;
    const skipRender =
      (state.suppressCloseRenderOnDelete && actionValue?.action === "delete") ||
      (state.suppressCloseRenderOnSelect &&
        (typeof value === "string" || actionValue?.action === "select") &&
        !state.renderOnSelectValues.has(
          typeof value === "string"
            ? value
            : actionValue?.action === "select"
              ? actionValue.value
              : "",
        ));
    this.cleanupActive();
    this.promptState = null;
    if (!skipRender) this.requestRender();
    active.resolve(value);
  }

  private cancelActive(render: boolean): void {
    const active = this.active;
    if (!active) {
      this.promptState = null;
      return;
    }
    this.cleanupActive();
    this.promptState = null;
    if (render) this.requestRender();
    active.resolve(null);
  }

  private cleanupActive(): void {
    const active = this.active;
    if (!active) return;
    this.stdin.removeListener("keypress", active.listener);
    if (this.stdin.setRawMode) this.stdin.setRawMode(active.wasRaw);
    // Match the main input lifecycle: commands explicitly resume stdin when
    // they open the next prompt, so no flowing terminal handle is left behind.
    this.stdin.pause();
    this.active = null;
  }
}
