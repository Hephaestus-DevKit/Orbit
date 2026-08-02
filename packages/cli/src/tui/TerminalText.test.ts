import { describe, expect, it } from "vitest";
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
} from "./TerminalText.js";

describe("TerminalText", () => {
  it("measures and truncates mixed-width text", () => {
    expect(getStringWidth("A界🙂")).toBe(5);
    expect(getStringWidth("\x1b[31mA界\x1b[0m")).toBe(3);
    expect(truncateToWidth("A界B", 3)).toBe("A界");
  });

  it("wraps colored lines without losing their visible content", () => {
    const wrapped = wrapAnsiLine("\x1b[31mAB界C\x1b[0m", 3);
    expect(wrapped.map(stripAnsiCodes)).toEqual(["AB", "界C"]);
  });

  it("measures and wraps terminal hyperlinks as visible text", () => {
    const open = "\x1b]8;;http://127.0.0.1/#token=secret\x07";
    const close = "\x1b]8;;\x07";
    const linked = `${open}abcdef${close}`;

    expect(stripAnsiCodes(linked)).toBe("abcdef");
    expect(getStringWidth(linked)).toBe(6);
    const wrapped = wrapAnsiLine(linked, 3);
    expect(wrapped.map(stripAnsiCodes)).toEqual(["abc", "def"]);
    expect(wrapped.every((line) => line.includes(open))).toBe(true);
    expect(wrapped.every((line) => line.endsWith(close))).toBe(true);
  });

  it("tracks UTF-16 offsets when wrapping input", () => {
    const wrapped = wrapInputText("A🙂界", 3);
    expect(wrapped).toEqual([
      { text: "A🙂", start: 0, end: 3 },
      { text: "界", start: 3, end: 4 },
    ]);
    expect(getCursorPositionInWrappedInput(wrapped, 3)).toEqual({
      lineIndex: 0,
      xOffset: 3,
    });
  });

  it("strips decoration before adding a bounded ellipsis", () => {
    expect(truncatePlainToWidth("\x1b[31mabcdef\x1b[0m", 5)).toBe("ab...");
  });

  it("keeps workspace paths on one line using terminal display width", () => {
    const path = "C:/Users/Jiehu Wang/Desktop/数模/暑期集训/reproduce/code";
    const truncated = truncatePathToWidth(path, 28);

    expect(truncated).toBe("…/暑期集训/reproduce/code");
    expect(getStringWidth(truncated)).toBeLessThanOrEqual(28);
    expect(truncatePathToWidth("C:/very-long-filename.ts", 10)).toBe(
      "…lename.ts",
    );
    expect(getStringWidth(truncatePathToWidth("a/123456789", 10))).toBe(10);
  });

  it("formats submitted and predicted input with separate colors", () => {
    const [line] = formatWrappedLines(["A🙂B"], 3);
    expect(stripAnsiCodes(line)).toBe("A🙂B");
    expect(line).toContain("\x1b[1;38;2;245;242;232m🙂");
    expect(line).toContain("\x1b[38;2;148;146;138mB");
  });
});
