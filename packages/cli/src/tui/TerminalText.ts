const TERMINAL_CONTROL_PATTERN =
  /(?:[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]|\u001b\]8;;[^\u0007]*(?:\u0007|\u001b\\))/g;

const HYPERLINK_CLOSE = "\u001b]8;;\u0007";
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});
const ZERO_WIDTH_FORMAT_CHARACTERS = new Set([
  "\u200c",
  "\u200d",
  "\ufe0e",
  "\ufe0f",
]);

interface GraphemeEntry {
  segment: string;
  index: number;
}

function graphemeEntries(value: string): GraphemeEntry[] {
  return [...GRAPHEME_SEGMENTER.segment(value)].map(({ segment, index }) => ({
    segment,
    index,
  }));
}

function graphemes(value: string): string[] {
  return graphemeEntries(value).map((entry) => entry.segment);
}

function graphemeWidth(grapheme: string): number {
  if (
    !grapheme ||
    [...grapheme].every(
      (character) =>
        /^\p{Mark}$/u.test(character) ||
        ZERO_WIDTH_FORMAT_CHARACTERS.has(character),
    )
  ) {
    return 0;
  }
  const codePoints = [...grapheme]
    .map((character) => character.codePointAt(0))
    .filter((codePoint): codePoint is number => codePoint !== undefined);
  return grapheme.includes("\u200d") ||
    codePoints.some((codePoint) => isFullWidth(codePoint))
    ? 2
    : 1;
}

export interface WrappedInputLine {
  text: string;
  start: number;
  end: number;
}

export function stripAnsiCodes(str: string): string {
  return str.replace(TERMINAL_CONTROL_PATTERN, "");
}

export function isFullWidth(codePoint: number): boolean {
  if (Number.isNaN(codePoint)) return false;
  if (
    codePoint === 0x25e2 ||
    codePoint === 0x25e3 ||
    codePoint === 0x25e4 ||
    codePoint === 0x25e5 ||
    codePoint === 0x2590 ||
    codePoint === 0x258c ||
    codePoint === 0x25cf
  ) {
    return true;
  }
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0x3247 && codePoint !== 0x303f) ||
    (codePoint >= 0x3250 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0xa4c6) ||
    (codePoint >= 0xa960 && codePoint <= 0xa97c) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6b) ||
    (codePoint >= 0xff01 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1b000 && codePoint <= 0x1b001) ||
    (codePoint >= 0x1f200 && codePoint <= 0x1f251) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1f9ff) ||
    (codePoint >= 0x1f600 && codePoint <= 0x1f64f) ||
    (codePoint >= 0x1f680 && codePoint <= 0x1f6ff)
  );
}

export function truncateToWidth(str: string, maxWidth: number): string {
  let width = 0;
  let result = "";
  for (const char of graphemes(str)) {
    const charWidth = graphemeWidth(char);
    if (width + charWidth > maxWidth) break;
    width += charWidth;
    result += char;
  }
  return result;
}

function truncateFromEndToWidth(str: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  let width = 0;
  const result: string[] = [];
  for (const char of graphemes(str).reverse()) {
    const charWidth = graphemeWidth(char);
    if (width + charWidth > maxWidth) break;
    width += charWidth;
    result.push(char);
  }
  return result.reverse().join("");
}

/** Preserve the most useful trailing path segments within a terminal column budget. */
export function truncatePathToWidth(path: string, maxWidth: number): string {
  const plain = stripAnsiCodes(path).replace(/\\/g, "/");
  if (maxWidth <= 0) return "";
  if (getStringWidth(plain) <= maxWidth) return plain;
  if (maxWidth <= 1) return truncateFromEndToWidth(plain, maxWidth);

  const parts = plain.split("/").filter(Boolean);
  const prefix = plain.startsWith("/") ? "/" : "";
  const ellipsis = "…";
  const pathMarker = `${ellipsis}/`;
  if (parts.length === 0) return truncateFromEndToWidth(plain, maxWidth);

  let result = parts.at(-1) ?? "";
  if (getStringWidth(result) + getStringWidth(pathMarker) > maxWidth) {
    return `${ellipsis}${truncateFromEndToWidth(result, maxWidth - 1)}`;
  }

  for (let index = parts.length - 2; index >= 0; index -= 1) {
    const candidate = `${parts[index]}/${result}`;
    const isComplete = index === 0;
    const display = isComplete
      ? `${prefix}${candidate}`
      : `${pathMarker}${candidate}`;
    if (getStringWidth(display) > maxWidth) return `${pathMarker}${result}`;
    result = candidate;
  }

  return `${prefix}${result}`;
}

export function getStringWidth(str: string): number {
  let width = 0;
  for (const char of graphemes(stripAnsiCodes(str))) {
    width += graphemeWidth(char);
  }
  return width;
}

/** Truncate plain terminal text and reserve space for an ellipsis. */
export function truncatePlainToWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  const plain = stripAnsiCodes(text);
  if (getStringWidth(plain) <= maxWidth) return plain;
  if (maxWidth <= 3) return truncateToWidth(plain, maxWidth);
  return `${truncateToWidth(plain, maxWidth - 3)}...`;
}

/** Wraps an ANSI-decorated line while preserving the active color. */
export function wrapAnsiLine(line: string, maxWidth: number): string[] {
  if (getStringWidth(line) <= maxWidth) return [line];

  const lines: string[] = [];
  let currentLine = "";
  let currentWidth = 0;
  let activeColor = "";
  let activeHyperlink = "";
  let index = 0;

  while (index < line.length) {
    TERMINAL_CONTROL_PATTERN.lastIndex = index;
    const match = TERMINAL_CONTROL_PATTERN.exec(line);
    if (match?.index === index) {
      const controlSequence = match[0];
      currentLine += controlSequence;
      if (controlSequence.startsWith("\u001b]8;;")) {
        activeHyperlink =
          controlSequence === HYPERLINK_CLOSE ? "" : controlSequence;
      } else if (
        controlSequence.includes("m") &&
        !controlSequence.includes("[0m")
      ) {
        activeColor = controlSequence;
      } else if (controlSequence.includes("[0m")) {
        activeColor = "";
      }
      index += controlSequence.length;
      continue;
    }

    const plainEnd = match?.index ?? line.length;
    const plainChunk = line.slice(index, plainEnd);
    for (const char of graphemes(plainChunk)) {
      const charWidth = graphemeWidth(char);
      if (currentWidth + charWidth > maxWidth) {
        if (activeColor) currentLine += "\x1b[0m";
        if (activeHyperlink) currentLine += HYPERLINK_CLOSE;
        lines.push(currentLine);
        currentLine = activeColor + activeHyperlink + char;
        currentWidth = charWidth;
      } else {
        currentLine += char;
        currentWidth += charWidth;
      }
    }
    index = plainEnd;
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

export function wrapInputText(
  str: string,
  maxWidth: number,
): WrappedInputLine[] {
  const lines: WrappedInputLine[] = [];
  let currentLine = "";
  let currentWidth = 0;
  let currentStart = 0;

  for (const entry of graphemeEntries(str)) {
    const index = entry.index;
    const char = entry.segment;
    if (char === "\n") {
      lines.push({ text: currentLine, start: currentStart, end: index });
      currentLine = "";
      currentWidth = 0;
      currentStart = index + char.length;
      continue;
    }
    const charWidth = graphemeWidth(char);
    if (currentLine && currentWidth + charWidth > maxWidth) {
      lines.push({ text: currentLine, start: currentStart, end: index });
      currentLine = "";
      currentWidth = 0;
      currentStart = index;
    }
    currentLine += char;
    currentWidth += charWidth;
  }

  lines.push({ text: currentLine, start: currentStart, end: str.length });
  return lines;
}

/** Locate the cursor within text that has already been wrapped for display. */
export function getCursorPositionInWrappedInput(
  wrappedInputLines: readonly WrappedInputLine[],
  cursorPosition: number,
): { lineIndex: number; xOffset: number } {
  for (let index = 0; index < wrappedInputLines.length; index++) {
    const line = wrappedInputLines[index];
    if (cursorPosition >= line.start && cursorPosition <= line.end) {
      const beforeCursor = line.text.substring(
        0,
        Math.max(0, cursorPosition - line.start),
      );
      return { lineIndex: index, xOffset: getStringWidth(beforeCursor) };
    }
  }

  const lineIndex = Math.max(0, wrappedInputLines.length - 1);
  const lastLine = wrappedInputLines[lineIndex] ?? {
    text: "",
    start: 0,
    end: 0,
  };
  return { lineIndex, xOffset: getStringWidth(lastLine.text) };
}

export function formatWrappedLines(
  wrappedLines: string[],
  inputLength: number,
): string[] {
  let charIndex = 0;
  return wrappedLines.map((line) => {
    let formattedLine = "";
    for (const char of graphemes(line)) {
      const color =
        charIndex < inputLength
          ? "\x1b[1;38;2;245;242;232m"
          : "\x1b[38;2;148;146;138m";
      formattedLine += `${color}${char}\x1b[0m`;
      charIndex += char.length;
    }
    return formattedLine;
  });
}
