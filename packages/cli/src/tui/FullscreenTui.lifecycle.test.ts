import readline from "readline";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FullscreenTui } from "./FullscreenTui.js";
import { InputHistoryStore } from "./InputHistoryStore.js";
import { stripAnsiCodes } from "./TerminalText.js";

describe("FullscreenTui lifecycle", () => {
  const originalWrite = process.stdout.write;

  afterEach(() => {
    process.stdout.write = originalWrite;
    vi.restoreAllMocks();
  });

  it("keeps construction side-effect free and initializes explicitly", () => {
    const emitKeypressEvents = vi
      .spyOn(readline, "emitKeypressEvents")
      .mockImplementation(() => {});
    const loadHistory = vi
      .spyOn(InputHistoryStore.prototype, "load")
      .mockReturnValue([]);

    const tui = new FullscreenTui("C:/repo", "model", "test-version");
    expect(emitKeypressEvents).not.toHaveBeenCalled();
    expect(loadHistory).not.toHaveBeenCalled();
    expect(process.stdout.write).toBe(originalWrite);

    tui.initialize();
    tui.initialize();
    expect(emitKeypressEvents).toHaveBeenCalledTimes(1);
    expect(loadHistory).toHaveBeenCalledTimes(1);
    expect(process.stdout.write).not.toBe(originalWrite);

    tui.dispose();
    expect(process.stdout.write).toBe(originalWrite);
  });

  it("preserves the stdout receiver while rendering an embedded prompt", async () => {
    vi.spyOn(readline, "emitKeypressEvents").mockImplementation(() => {});
    vi.spyOn(InputHistoryStore.prototype, "load").mockReturnValue([]);
    vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);
    vi.spyOn(process.stdin, "pause").mockImplementation(() => process.stdin);

    const receivers: unknown[] = [];
    const receiverAwareWrite = function (this: typeof process.stdout): boolean {
      receivers.push(this);
      return true;
    } as typeof process.stdout.write;
    process.stdout.write = receiverAwareWrite;

    const tui = new FullscreenTui("C:/repo", "model", "test-version");
    tui.initialize();
    tui.isActive = true;

    const pending = tui.showPrompt({
      type: "select",
      message: "Choose model",
      options: [{ value: "flash", label: "DeepSeek Flash" }],
    });

    expect(receivers.length).toBeGreaterThan(0);
    expect(receivers.every((receiver) => receiver === process.stdout)).toBe(
      true,
    );
    tui.dispose();
    await expect(pending).resolves.toBeNull();
  });

  it("uses one alternate-screen lifecycle and restores raw input on exit", () => {
    vi.spyOn(readline, "emitKeypressEvents").mockImplementation(() => {});
    vi.spyOn(InputHistoryStore.prototype, "load").mockReturnValue([]);
    const output: string[] = [];
    process.stdout.write = vi.fn((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    const tui = new FullscreenTui("C:/repo", "model", "test-version");
    vi.spyOn(
      tui as unknown as { render: () => void },
      "render",
    ).mockImplementation(() => undefined);

    tui.start(1);
    tui.stop();

    const terminalWrites = output.join("");
    expect(terminalWrites).toContain("\x1b[?1049h");
    expect(terminalWrites).toContain("\x1b[?1049l\x1b[0m\x1b[?25h");
    expect(terminalWrites).not.toContain("\x1b7");
    expect(terminalWrites).not.toContain("\x1b8");
    tui.dispose();
  });

  it("ignores late render requests after the main screen is restored", () => {
    vi.spyOn(readline, "emitKeypressEvents").mockImplementation(() => {});
    vi.spyOn(InputHistoryStore.prototype, "load").mockReturnValue([]);
    const output: string[] = [];
    process.stdout.write = vi.fn((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    const tui = new FullscreenTui("C:/repo", "model", "test-version");

    tui.start(1);
    tui.stop();
    const outputAfterStop = output.join("");

    tui.render(true);
    tui.addLog("late async completion");

    expect(output.join("")).toBe(outputAfterStop);
    tui.dispose();
  });

  it("stores an action link beside its system completion message", () => {
    const tui = new FullscreenTui("C:/repo", "model", "test-version");
    const render = vi
      .spyOn(tui as unknown as { render: () => void }, "render")
      .mockImplementation(() => undefined);

    tui.isActive = true;
    tui.addSystemMessage("✔ Orbit Web UI started", false, {
      label: "http://127.0.0.1:6047/",
      url: "http://127.0.0.1:6047/#token=secret",
    });

    expect((tui as unknown as { history: unknown[] }).history).toEqual([
      {
        role: "system",
        text: "✔ Orbit Web UI started",
        actionLink: {
          label: "http://127.0.0.1:6047/",
          url: "http://127.0.0.1:6047/#token=secret",
        },
      },
    ]);
    const [line] = (
      tui as unknown as {
        formatSystemLinesForDisplay(
          system: Array<{
            role: "system";
            text: string;
            actionLink: { label: string; url: string };
          }>,
          options: { prefixUnknown: boolean; preserveBlank: boolean },
        ): string[];
      }
    ).formatSystemLinesForDisplay(
      [
        {
          role: "system",
          text: "✔ Orbit Web UI started",
          actionLink: {
            label: "http://127.0.0.1:6047/",
            url: "http://127.0.0.1:6047/#token=secret",
          },
        },
      ],
      { prefixUnknown: false, preserveBlank: true },
    );
    expect(stripAnsiCodes(line || "")).toBe(
      "completed http://127.0.0.1:6047/ · Orbit Web UI started",
    );
    expect(line).toContain("\x1b]8;;http://127.0.0.1:6047/#token=secret\x07");
    expect(render).toHaveBeenCalledOnce();
  });

  it("honors explicit no-color mode in conversation status rendering", () => {
    const tui = new FullscreenTui("C:/repo", "model", "test-version", {
      language: "en",
      tui: { color: "never" },
    });
    const lines = (
      tui as unknown as {
        formatSystemLinesForDisplay(
          system: Array<{ role: "system"; text: string }>,
          options: { prefixUnknown: boolean; preserveBlank: boolean },
        ): string[];
      }
    ).formatSystemLinesForDisplay([{ role: "system", text: "✔ Completed" }], {
      prefixUnknown: false,
      preserveBlank: false,
    });

    expect(lines[0]).toBe("completed Completed");
    expect(lines[0]).not.toMatch(/\x1b/);
  });

  it("mirrors prompts submitted by another local UI", () => {
    const tui = new FullscreenTui("C:/repo", "model", "test-version");
    vi.spyOn(
      tui as unknown as { render: () => void },
      "render",
    ).mockImplementation(() => undefined);

    tui.addUserMessage("  inspect the workspace  ");

    expect(
      (tui as unknown as { history: Array<{ role: string; text: string }> })
        .history,
    ).toEqual([{ role: "user", text: "inspect the workspace" }]);
  });

  it("queues text entered during a run without aborting the active runnable", () => {
    vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);
    vi.spyOn(process.stdin, "pause").mockImplementation(() => process.stdin);
    const tui = new FullscreenTui("C:/repo", "model", "test-version");
    const abort = vi.fn();
    const onInput = vi.fn(() => true);
    const internals = tui as unknown as {
      inputBuffer: string;
      cursorPosition: number;
      thinkingKeypressListener: (text: string, key: readline.Key) => void;
      render: () => void;
    };
    vi.spyOn(internals, "render").mockImplementation(() => undefined);
    tui.isActive = true;
    tui.setActiveRunnable({ abort });
    tui.setActiveInputHandler(onInput);
    internals.inputBuffer = "preserve the public API";
    internals.cursorPosition = internals.inputBuffer.length;

    tui.startThinkingInput();
    internals.thinkingKeypressListener("\r", { name: "return" });
    tui.stopThinkingInput();

    expect(onInput).toHaveBeenCalledWith("preserve the public API");
    expect(abort).not.toHaveBeenCalled();
    expect(internals.inputBuffer).toBe("");
  });

  it("does not render an epoch-sized duration when an attempt start event is absent", () => {
    const tui = new FullscreenTui("C:/repo", "model", "test-version");
    const internals = tui as unknown as {
      history: Array<{
        role: "assistant";
        text: string;
        totalTime?: number;
        thoughtTime?: number;
      }>;
      render: () => void;
    };
    internals.history = [{ role: "assistant", text: "done" }];
    vi.spyOn(internals, "render").mockImplementation(() => undefined);

    tui.finishAttempt();

    expect(internals.history[0]?.totalTime).toBeUndefined();
    expect(internals.history[0]?.thoughtTime).toBeUndefined();
  });

  it("preserves the Orbit cat mascot in the full-screen header", () => {
    const output: string[] = [];
    process.stdout.write = vi.fn((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    const tui = new FullscreenTui("C:/repo", "deepseek-v4-flash", "0.1.3");
    const internals = tui as unknown as {
      getGitSummary: () => {
        branch: string;
        added: number;
        modified: number;
        deleted: number;
      };
      getOrbitUpdateAvailable: () => boolean;
    };
    vi.spyOn(internals, "getGitSummary").mockReturnValue({
      branch: "main",
      added: 0,
      modified: 0,
      deleted: 0,
    });
    vi.spyOn(internals, "getOrbitUpdateAvailable").mockReturnValue(false);

    tui.isActive = true;
    tui.render(true);

    const plain = stripAnsiCodes(output.join(""));
    expect(plain).toContain("O R B I T");
    expect(plain).toContain("/\\___/\\");
    expect(plain).toContain("o.o");
    expect(plain).toContain("♥");
  });

  it("checks the Orbit release once and marks the heart for blinking", async () => {
    const checkOrbitUpdate = vi.fn().mockResolvedValue(true);
    const tui = new FullscreenTui(
      "C:/repo",
      "deepseek-v4-flash",
      "v0.1.6",
      undefined,
      { checkOrbitUpdate },
    );
    const internals = tui as unknown as {
      getOrbitUpdateAvailable: () => boolean;
    };

    expect(internals.getOrbitUpdateAvailable()).toBe(false);
    await vi.waitFor(() =>
      expect(internals.getOrbitUpdateAvailable()).toBe(true),
    );
    expect(checkOrbitUpdate).toHaveBeenCalledOnce();
    expect(checkOrbitUpdate).toHaveBeenCalledWith("0.1.6");
  });

  it("renders the update heart with the terminal blink attribute", () => {
    const output: string[] = [];
    process.stdout.write = vi.fn((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    const tui = new FullscreenTui("C:/repo", "model", "v0.1.6");
    const internals = tui as unknown as {
      getGitSummary: () => {
        branch: string;
        added: number;
        modified: number;
        deleted: number;
      };
      getOrbitUpdateAvailable: () => boolean;
    };
    vi.spyOn(internals, "getGitSummary").mockReturnValue({
      branch: "main",
      added: 0,
      modified: 0,
      deleted: 0,
    });
    vi.spyOn(internals, "getOrbitUpdateAvailable").mockReturnValue(true);

    tui.isActive = true;
    tui.render(true);

    expect(output.join("")).toContain("\u001b[5m");
    expect(stripAnsiCodes(output.join(""))).toContain("♥");
  });

  it("keeps a distinct blinking heart until an updated process is restarted", () => {
    const output: string[] = [];
    process.stdout.write = vi.fn((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    const tui = new FullscreenTui("C:/repo", "model", "v0.1.6");
    const internals = tui as unknown as {
      getGitSummary: () => {
        branch: string;
        added: number;
        modified: number;
        deleted: number;
      };
    };
    vi.spyOn(internals, "getGitSummary").mockReturnValue({
      branch: "main",
      added: 0,
      modified: 0,
      deleted: 0,
    });

    tui.setOrbitRestartRequired(true);
    tui.setOrbitUpdateAvailable(true);
    tui.isActive = true;
    tui.render(true);

    expect(output.join("")).toContain("\u001b[5m\u001b[38;2;120;190;150m");
    expect(stripAnsiCodes(output.join(""))).toContain("♥");
  });
});
