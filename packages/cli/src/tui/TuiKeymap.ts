export type TuiKeymapMode = "standard" | "vim";
export type VimMode = "insert" | "normal";

export interface TuiKeypressLike {
  readonly name?: string;
  readonly ctrl?: boolean;
  readonly meta?: boolean;
}

export type VimNormalCommand =
  | "insert"
  | "append"
  | "start"
  | "end"
  | "backward-word"
  | "forward-word"
  | "left"
  | "right"
  | "delete-char"
  | "delete-operator"
  | "change-operator"
  | "delete-to-end"
  | "change-to-end"
  | "undo"
  | "insert-start"
  | "append-end"
  | "submit";

/** Maps one normal-mode keypress to a semantic command. */
export function resolveVimNormalCommand(
  str: string,
  key: TuiKeypressLike = {},
): VimNormalCommand | null {
  if (key.name === "return" || key.name === "enter") return "submit";
  if (key.name === "left" || str === "h") return "left";
  if (key.name === "right" || str === "l") return "right";
  if (str === "i") return "insert";
  if (str === "a") return "append";
  if (str === "I") return "insert-start";
  if (str === "A") return "append-end";
  if (str === "0" || str === "^") return "start";
  if (str === "$" || key.name === "end") return "end";
  if (str === "b") return "backward-word";
  if (str === "w") return "forward-word";
  if (str === "x" || key.name === "delete") return "delete-char";
  if (str === "d") return "delete-operator";
  if (str === "c") return "change-operator";
  if (str === "D") return "delete-to-end";
  if (str === "C") return "change-to-end";
  if (str === "u") return "undo";
  return null;
}

/** Returns the short status label shown alongside the TUI key hints. */
export function getVimModeLabel(mode: VimMode, isZh: boolean): string {
  if (mode === "normal") return isZh ? "普通模式" : "NORMAL";
  return isZh ? "插入模式" : "INSERT";
}
