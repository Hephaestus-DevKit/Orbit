import {
  getStringWidth,
  stripAnsiCodes,
  truncatePlainToWidth,
  wrapAnsiLine,
} from "./TerminalText.js";
import { getPromptOptionIndices, type TuiPromptState } from "./TuiPromptSession.js";
import { MORANDI, type TuiTheme } from "./TuiTheme.js";

export interface PromptViewport {
  columns: number;
  rows: number;
  isZh: boolean;
}

function getPromptTitle(state: TuiPromptState, isZh: boolean): string {
  if (state.type === "confirm") return isZh ? "确认" : "Confirmation";
  if (state.type === "select") return isZh ? "选择" : "Selection";
  if (state.type === "multiselect") return isZh ? "多选" : "Multi-Selection";
  return isZh ? "输入" : "Input";
}

function appendPromptMessage(
  lines: string[],
  state: TuiPromptState,
  columns: number,
  isZh: boolean,
  theme: TuiTheme,
): void {
  const messageLines = state.message
    .split("\n")
    .flatMap((line) => wrapAnsiLine(stripAnsiCodes(line), columns - 8));
  for (let index = 0; index < Math.min(messageLines.length, 5); index++) {
    const prefix = index === 0 ? "? " : "  ";
    lines.push(
      "  " + theme.cyan(prefix) + theme.white(messageLines[index] ?? ""),
    );
  }
  if (messageLines.length > 5) {
    lines.push(
      "  "
        + theme.dim(
          isZh
            ? `... 还有 ${messageLines.length - 5} 行`
            : `... ${messageLines.length - 5} more line(s)`,
        ),
    );
  }
  lines.push("");
}

function appendFilter(
  lines: string[],
  state: TuiPromptState,
  visibleCount: number,
  isZh: boolean,
  theme: TuiTheme,
): void {
  const searchable = state.type === "select" || state.type === "multiselect";
  if (!searchable || (!state.filterActive && !state.filterQuery)) return;
  const searchLabel = isZh ? "过滤" : "filter";
  const placeholder = isZh ? "输入关键字" : "type keywords";
  const query = state.filterQuery || theme.dim(placeholder);
  const cursor = state.filterActive ? theme.accent("▌") : "";
  lines.push(
    "  "
      + theme.dim(`${searchLabel}: `)
      + theme.white(stripAnsiCodes(query))
      + cursor
      + theme.dim(`  ${visibleCount}/${state.options.length}`),
  );
  lines.push("");
}

function appendListOptions(
  lines: string[],
  state: TuiPromptState,
  viewport: PromptViewport,
  theme: TuiTheme,
): void {
  const { columns, rows, isZh } = viewport;
  const filteredIndices = getPromptOptionIndices(state);
  appendFilter(lines, state, filteredIndices.length, isZh, theme);

  const maxVisible = Math.max(5, Math.min(12, rows - lines.length - 6));
  const selectedPosition = filteredIndices.indexOf(state.selectedIndex);
  let startIndex = selectedPosition >= maxVisible ? selectedPosition - maxVisible + 1 : 0;
  if (startIndex + maxVisible > filteredIndices.length) {
    startIndex = filteredIndices.length - maxVisible;
  }
  startIndex = Math.max(0, startIndex);
  const visibleIndices = filteredIndices.slice(
    startIndex,
    startIndex + maxVisible,
  );

  if (startIndex > 0) {
    lines.push(
      theme.gray(isZh ? "    ▲ 上方还有更多选项" : "    ▲ more options above"),
    );
  }
  if (visibleIndices.length === 0) {
    lines.push(
      "    "
        + theme.warn(
          isZh
            ? "没有匹配项，按 Esc 清空过滤"
            : "No matches. Press Esc to clear the filter.",
        ),
    );
  }

  for (const optionIndex of visibleIndices) {
    const option = state.options[optionIndex];
    if (!option) continue;
    const selected = optionIndex === state.selectedIndex;
    const checked = state.selectedValues.has(option.value);
    const deleteArmed = state.deletable && state.pendingDeleteValue === option.value;
    const checkbox = state.type === "multiselect" ? (checked ? "[x] " : "[ ] ") : "    ";
    let text = checkbox + stripAnsiCodes(option.label);
    if (option.hint) text += ` (${stripAnsiCodes(option.hint)})`;
    if (deleteArmed) {
      text += isZh ? "  再按 Del 删除" : "  Del again to delete";
    } else if (
      state.deletable
      && state.type === "select"
      && selected
      && !option.deleteDisabled
    ) {
      text += isZh ? "  Del 标记删除" : "  Del to delete";
    }

    const marker = selected ? (deleteArmed ? "  ! " : "  ❯ ") : "    ";
    const clipped = truncatePlainToWidth(
      text.trim(),
      Math.max(8, columns - getStringWidth(marker) - 6),
    );
    if (selected) {
      lines.push((deleteArmed ? theme.warn : theme.accent)(marker + clipped));
    } else {
      lines.push(marker + theme.gray(clipped));
    }
  }

  if (startIndex + maxVisible < filteredIndices.length) {
    lines.push(
      theme.gray(isZh ? "    ▼ 下方还有更多选项" : "    ▼ more options below"),
    );
  }
}

function getFooterHelp(state: TuiPromptState, isZh: boolean): string {
  if (
    (state.type === "select" || state.type === "multiselect")
    && state.filterActive
  ) {
    return isZh
      ? "输入过滤 · Backspace 删除 · Ctrl+U 清空 · ↑/↓ 选择 · Enter 确认 · Esc 退出过滤"
      : "type to filter · Backspace edit · Ctrl+U clear · ↑/↓ move · Enter confirm · Esc exit filter";
  }
  if (state.type === "multiselect") {
    return isZh
      ? "↑/↓/j/k 选择 · / 过滤 · Space 勾选 · Enter 确认 · Esc 取消"
      : "↑/↓/j/k move · / filter · Space toggle · Enter confirm · Esc cancel";
  }
  if (state.type === "select" && state.deletable) {
    return isZh
      ? "↑/↓/j/k 选择 · / 过滤 · Enter 打开 · Del 标记 · 再 Del 删除 · Esc 取消"
      : "↑/↓/j/k move · / filter · Enter open · Del mark · Del again delete · Esc cancel";
  }
  if (state.type === "select") {
    return isZh
      ? "↑/↓/j/k 选择 · / 过滤 · Enter 确认 · Esc 取消"
      : "↑/↓/j/k move · / filter · Enter select · Esc cancel";
  }
  if (state.type === "confirm") {
    return isZh
      ? "↑/↓/j/k 选择 · Enter 确认 · Esc 取消"
      : "↑/↓/j/k move · Enter select · Esc cancel";
  }
  return isZh
    ? "Ctrl+A/E 跳转 · Ctrl+W 删词 · Enter 确认 · Esc 取消"
    : "Ctrl+A/E jump · Ctrl+W delete word · Enter confirm · Esc cancel";
}

/** Purely renders a full-screen prompt from session state and viewport data. */
export function renderPromptScreen(
  state: TuiPromptState,
  viewport: PromptViewport,
  theme: TuiTheme = MORANDI,
): string {
  const { columns, rows, isZh } = viewport;
  const lines = [
    "",
    theme.userBold("  Orbit " + getPromptTitle(state, isZh)),
    theme.gray("  " + "─".repeat(columns - 4)),
    "",
  ];
  appendPromptMessage(lines, state, columns, isZh, theme);

  let inputLineRow = 0;
  let cursorColumn = 0;
  if (
    state.type === "select"
    || state.type === "confirm"
    || state.type === "multiselect"
  ) {
    appendListOptions(lines, state, viewport, theme);
  } else {
    inputLineRow = lines.length + 1;
    const displayValue = state.type === "password"
      ? "*".repeat(state.inputValue.length)
      : state.inputValue;
    const beforeCursor = state.type === "password"
      ? "*".repeat(state.cursorPosition)
      : state.inputValue.slice(0, state.cursorPosition);
    cursorColumn = 3 + getStringWidth(beforeCursor);
    lines.push("  " + displayValue);
    lines.push(
      "  " + theme.gray("─".repeat(Math.max(20, displayValue.length + 4))),
    );
  }

  for (let index = 0; index < rows - lines.length - 5; index++) {
    lines.push("");
  }
  const catLines = [theme.gray(" /\\ /\\ "), theme.gray("/ °_° \\")];
  for (const row of catLines) {
    lines.push(
      " ".repeat(Math.max(0, columns - getStringWidth(row) - 2)) + row,
    );
  }
  lines.push(theme.gray("  " + "─".repeat(columns - 4)));
  lines.push(
    "  "
      + theme.dim(
        truncatePlainToWidth(
          getFooterHelp(state, isZh),
          Math.max(12, columns - 4),
        ),
      ),
  );

  const cursorSequence = state.type === "text" || state.type === "password"
    ? `\x1b[${inputLineRow};${cursorColumn}H\x1b[?25h`
    : "\x1b[?25l";
  return (
    "\x1b[?25l\x1b[H"
    + lines.map((line) => line + "\x1b[K").join("\n")
    + "\x1b[J"
    + cursorSequence
  );
}
