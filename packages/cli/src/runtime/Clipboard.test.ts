import { describe, expect, it, vi } from "vitest";
import { copyTextToClipboard, type ClipboardRuntime } from "./Clipboard.js";

describe("copyTextToClipboard", () => {
  it.each([
    ["win32", "clip", []],
    ["darwin", "pbcopy", []],
  ] as const)("uses the native %s adapter", (platform, executable, args) => {
    const execute = vi.fn<ClipboardRuntime["execute"]>(() => undefined);

    expect(copyTextToClipboard("hello", { platform, execute })).toBe(true);
    expect(execute).toHaveBeenCalledWith(executable, args, "hello");
  });

  it("falls back to Wayland without interpreting clipboard text as a command", () => {
    const text = "$(touch should-not-run); `still text` & echo no";
    const execute = vi.fn<ClipboardRuntime["execute"]>((executable) => {
      if (executable !== "wl-copy") throw new Error("not installed");
    });

    expect(copyTextToClipboard(text, { platform: "linux", execute })).toBe(
      true,
    );
    expect(execute.mock.calls).toEqual([
      ["xclip", ["-selection", "clipboard"], text],
      ["xsel", ["-ib"], text],
      ["wl-copy", [], text],
    ]);
  });

  it("returns false when no clipboard adapter is available", () => {
    const execute = vi.fn<ClipboardRuntime["execute"]>(() => {
      throw new Error("missing");
    });

    expect(copyTextToClipboard("hello", { platform: "linux", execute })).toBe(
      false,
    );
    expect(execute).toHaveBeenCalledTimes(3);
  });
});
