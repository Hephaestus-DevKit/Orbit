import type { PromptOption } from "@orbit-build/tui";
import { stripAnsiCodes } from "./TerminalText.js";

/** Returns the UTF-16 index immediately before the previous Unicode code point. */
export function previousCodePointIndex(text: string, index: number): number {
  const safeIndex = Math.max(0, Math.min(index, text.length));
  if (safeIndex === 0) return 0;
  const previous = text.charCodeAt(safeIndex - 1);
  if (previous >= 0xdc00 && previous <= 0xdfff && safeIndex >= 2) {
    const leading = text.charCodeAt(safeIndex - 2);
    if (leading >= 0xd800 && leading <= 0xdbff) return safeIndex - 2;
  }
  return safeIndex - 1;
}

/** Returns the UTF-16 index immediately after the next Unicode code point. */
export function nextCodePointIndex(text: string, index: number): number {
  const safeIndex = Math.max(0, Math.min(index, text.length));
  if (safeIndex >= text.length) return text.length;
  const leading = text.charCodeAt(safeIndex);
  if (leading >= 0xd800 && leading <= 0xdbff && safeIndex + 1 < text.length) {
    const trailing = text.charCodeAt(safeIndex + 1);
    if (trailing >= 0xdc00 && trailing <= 0xdfff) return safeIndex + 2;
  }
  return safeIndex + 1;
}

export function previousWordIndex(text: string, index: number): number {
  let pos = index;
  while (pos > 0 && /\s/.test(text.charAt(pos - 1))) pos--;
  while (pos > 0 && !/\s/.test(text.charAt(pos - 1))) pos--;
  return pos;
}

export function nextWordIndex(text: string, index: number): number {
  let pos = index;
  while (pos < text.length && /\s/.test(text.charAt(pos))) pos++;
  while (pos < text.length && !/\s/.test(text.charAt(pos))) pos++;
  return pos;
}

export function parseMouseWheelDirection(
  input: string | undefined | null,
): "up" | "down" | null {
  if (typeof input !== "string") return null;
  const match = input.match(/\x1b\[<(\d+);\d+;\d+[mM]/);
  if (!match) return null;
  const button = Number(match[1]);
  if ((button & 64) === 0) return null;
  return (button & 1) === 0 ? "up" : "down";
}

export function selectActiveSlashSuggestion(
  input: string,
  matches: string[],
  activeIndex: number,
): string {
  if (!input.startsWith("/") || matches.length === 0) return input;
  const idx = Math.min(Math.max(0, activeIndex), matches.length - 1);
  return matches[idx] || input;
}

export function getSlashSuggestionFooterText(
  isZh: boolean,
  matchCount: number,
): string {
  return isZh
    ? `↑/↓ 选择  Enter 运行所选  Tab 填入  Esc 关闭  ·  ${matchCount} 项`
    : `↑/↓ select  Enter run selected  Tab fill  Esc close  ·  ${matchCount} match(es)`;
}

export function filterPromptOptionIndices(
  options: PromptOption[],
  query: string,
): number[] {
  const terms = stripAnsiCodes(query)
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) return options.map((_, index) => index);

  return options
    .map((option, index) => ({ option, index }))
    .filter(({ option }) => {
      const haystack = stripAnsiCodes(
        [option.label, option.value, option.hint || ""].join(" "),
      ).toLocaleLowerCase();
      return terms.every((term) => haystack.includes(term));
    })
    .map(({ index }) => index);
}

function normalizeMatchText(text: string): string {
  return stripAnsiCodes(text)
    .toLocaleLowerCase()
    .replace(/[_/\\:-]+/g, " ");
}

function isOrderedSubsequence(needle: string, haystack: string): boolean {
  if (needle.length === 0) return true;
  let pos = 0;
  for (const char of haystack) {
    if (char === needle[pos]) {
      pos++;
      if (pos === needle.length) return true;
    }
  }
  return false;
}

export function rankSlashCandidates(
  candidates: readonly string[],
  input: string,
): string[] {
  const rawQuery = stripAnsiCodes(input).trim();
  if (!rawQuery || rawQuery === "/") return [...candidates];

  const normalizedQuery = normalizeMatchText(rawQuery);
  const queryNoSlash = normalizedQuery.replace(/^\s*\/\s*/, "").trim();
  const terms = queryNoSlash.split(/\s+/).filter(Boolean);

  return candidates
    .map((candidate, index) => {
      const normalizedCandidate = normalizeMatchText(candidate);
      const candidateNoSlash = normalizedCandidate
        .replace(/^\s*\/\s*/, "")
        .trim();

      let score = Number.POSITIVE_INFINITY;
      if (normalizedCandidate === normalizedQuery) {
        score = 0;
      } else if (normalizedCandidate.startsWith(normalizedQuery)) {
        score = 10;
      } else if (queryNoSlash && candidateNoSlash.startsWith(queryNoSlash)) {
        score = 20;
      } else if (
        terms.length > 0
        && terms.every((term) => normalizedCandidate.includes(term))
      ) {
        const positionScore = terms.reduce(
          (sum, term) => sum + Math.max(0, normalizedCandidate.indexOf(term)),
          0,
        );
        score = 50 + positionScore + normalizedCandidate.length / 1000;
      } else if (
        queryNoSlash.length >= 2
        && isOrderedSubsequence(queryNoSlash.replace(/\s+/g, ""), candidateNoSlash)
      ) {
        score = 100 + candidateNoSlash.length;
      }

      return { candidate, index, score };
    })
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.candidate);
}

export function findPreviousHistoryEntry(
  history: string[],
  query: string,
  startIndex = history.length,
): { entry: string; index: number } | null {
  if (history.length === 0) return null;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const cappedStart = Math.max(0, Math.min(startIndex, history.length));

  for (let offset = 0; offset < history.length; offset++) {
    const index = (cappedStart - 1 - offset + history.length) % history.length;
    const entry = history[index];
    if (
      !normalizedQuery
      || entry.toLocaleLowerCase().includes(normalizedQuery)
    ) {
      return { entry, index };
    }
  }
  return null;
}
