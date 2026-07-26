import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import {
  FullscreenTui,
  getSlashSuggestionFooterText,
  stripAnsiCodes,
} from "./FullscreenTui.js";

type Key = {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
};

describe("FullscreenTui prompt interactions", () => {
  let originalWrite: typeof process.stdout.write;
  let originalRows: number | undefined;
  let originalColumns: number | undefined;
  let originalIsRaw: boolean;
  let setRawMode: Mock<[enabled: boolean], typeof process.stdin>;

  const press = (str: string, key: Key) => {
    process.stdin.emit("keypress", str, key);
  };
  const typeText = (value: string) => {
    for (const char of value) {
      press(char, { name: char });
    }
  };
  const createTui = (config: any = {}) => {
    const tui = new FullscreenTui(process.cwd(), "deepseek-v4-flash", "test", {
      language: "en",
      ...config,
    });
    tui.isActive = true;
    (tui as any).render = vi.fn();
    (tui as any).saveInputHistory = vi.fn();
    return tui;
  };

  beforeEach(() => {
    originalWrite = process.stdout.write;
    originalRows = process.stdout.rows;
    originalColumns = process.stdout.columns;
    originalIsRaw = process.stdin.isRaw;
    Object.defineProperty(process.stdout, "rows", {
      configurable: true,
      value: 30,
    });
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 100,
    });
    process.stdout.write = vi.fn() as any;
    setRawMode = vi.fn((enabled: boolean) => {
      process.stdin.isRaw = enabled;
      return process.stdin;
    });
    process.stdin.setRawMode = setRawMode as any;
    process.stdin.isRaw = false;
    vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);
    vi.spyOn(process.stdin, "pause").mockImplementation(() => process.stdin);
  });

  afterEach(() => {
    vi.useRealTimers();
    process.stdout.write = originalWrite;
    Object.defineProperty(process.stdout, "rows", {
      configurable: true,
      value: originalRows,
    });
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: originalColumns,
    });
    process.stdin.removeAllListeners("keypress");
    process.stdin.isRaw = originalIsRaw;
    vi.restoreAllMocks();
  });

  it("filters select options and resolves the visible selection on enter", async () => {
    const tui = createTui();

    const result = tui.showPrompt({
      type: "select",
      message: "Choose model",
      options: [
        { value: "flash", label: "DeepSeek Flash" },
        { value: "pro", label: "DeepSeek Pro" },
        { value: "codewhale", label: "CodeWhale" },
      ],
    });

    press("/", { name: "/" });
    press("p", { name: "p" });
    press("r", { name: "r" });
    press("o", { name: "o" });
    press("", { name: "return" });

    await expect(result).resolves.toBe("pro");
    expect(setRawMode).toHaveBeenCalledWith(true);
    expect(setRawMode).toHaveBeenLastCalledWith(false);
  });

  it("arms the prompt keypress listener before resuming paused stdin", async () => {
    const tui = createTui();
    const resume = vi.mocked(process.stdin.resume);
    resume.mockImplementationOnce(() => {
      expect(process.stdin.listenerCount("keypress")).toBeGreaterThan(0);
      return process.stdin;
    });

    const result = tui.showPrompt({
      type: "select",
      message: "Choose model",
      options: [{ value: "flash", label: "DeepSeek Flash" }],
    });
    press("", { name: "return" });

    await expect(result).resolves.toBe("flash");
    expect(resume).toHaveBeenCalledOnce();
    expect(process.stdin.pause).toHaveBeenCalledOnce();
  });

  it("requires two delete keypresses on the same option before resolving delete", async () => {
    const tui = createTui();

    const result = tui.showPrompt({
      type: "select",
      message: "Choose session",
      deletable: true,
      options: [
        { value: "new", label: "New", deleteDisabled: true },
        { value: "session-1", label: "Session 1" },
      ],
    });

    press("", { name: "delete" });
    press("", { name: "down" });
    press("", { name: "delete" });

    const raceAfterFirstDelete = await Promise.race([
      result.then(() => "resolved"),
      new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 0)),
    ]);
    expect(raceAfterFirstDelete).toBe("pending");

    press("", { name: "delete" });

    await expect(result).resolves.toEqual({
      action: "delete",
      value: "session-1",
    });
  });

  it("starts deletable prompts on the requested option and skips close render on delete", async () => {
    const tui = createTui();
    const render = (tui as any).render as ReturnType<typeof vi.fn>;

    const result = tui.showPrompt({
      type: "select",
      message: "Choose session",
      deletable: true,
      initialSelectedValue: "session-2",
      suppressCloseRenderOnDelete: true,
      options: [
        { value: "new", label: "New", deleteDisabled: true },
        { value: "session-1", label: "Session 1" },
        { value: "session-2", label: "Session 2" },
      ],
    });

    render.mockClear();
    press("", { name: "delete" });
    const renderCountAfterMark = render.mock.calls.length;
    press("", { name: "delete" });

    await expect(result).resolves.toEqual({
      action: "delete",
      value: "session-2",
    });
    expect(render.mock.calls.length).toBe(renderCountAfterMark);
  });

  it("can reload history silently while a delete picker stays open", () => {
    const tui = createTui();
    const render = (tui as any).render as ReturnType<typeof vi.fn>;
    const loopHistory = [
      {
        role: "user",
        content: [{ type: "text", text: "first question" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "first answer" }],
        metadata: { model: "deepseek-v4-flash" },
      },
    ];

    render.mockClear();
    tui.loadHistory(loopHistory, { silent: true });
    expect(render).not.toHaveBeenCalled();

    tui.loadHistory(loopHistory);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("clears history and scroll state through one TUI path", () => {
    const tui = createTui();
    const render = (tui as any).render as ReturnType<typeof vi.fn>;
    (tui as any).history = [{ role: "system", text: "old output" }];
    (tui as any).historyScrollOffset = 12;
    (tui as any).maxHistoryScrollOffset = 40;
    (tui as any).lastHistoryLineCount = 80;
    (tui as any).hasNewOutputWhileScrolled = true;
    (tui as any).historySearchQuery = "old";

    tui.clearHistoryView();

    expect((tui as any).history).toEqual([]);
    expect((tui as any).historyScrollOffset).toBe(0);
    expect((tui as any).maxHistoryScrollOffset).toBe(0);
    expect((tui as any).lastHistoryLineCount).toBe(0);
    expect((tui as any).hasNewOutputWhileScrolled).toBe(false);
    expect((tui as any).historySearchQuery).toBeNull();
    expect(render).toHaveBeenCalled();
  });

  it("submits the ranked slash command candidate on enter", async () => {
    const tui = createTui({
      provider: { default: "deepseek" },
      providers: {
        deepseek: { type: "openai-compatible" },
      },
    });

    const result = tui.askInput();

    typeText("/model deep pro");
    press("", { name: "return" });

    await expect(result).resolves.toBe("/model deepseek-v4-pro");
  });

  it("can submit control commands without echoing them into chat history", async () => {
    const tui = createTui();

    const result = tui.askInput({
      echoSubmitted: (submitted) => !submitted.trim().startsWith("/"),
    });

    typeText("/mod");
    press("", { name: "return" });

    await expect(result).resolves.toBe("/model");
    expect((tui as any).history).toEqual([]);
    expect((tui as any).inputHistory.at(-1)).toBe("/model");
    expect((tui as any).saveInputHistory).toHaveBeenCalledOnce();
  });

  it("makes slash command enter behavior explicit in the footer", () => {
    expect(getSlashSuggestionFooterText(false, 16)).toContain(
      "Enter run selected",
    );
    expect(getSlashSuggestionFooterText(true, 16)).toContain("Enter 运行所选");
  });

  it("discovers built-in command arguments and their canonical descriptions", () => {
    const tui = createTui();
    (tui as any).inputBuffer = "/language ";

    expect((tui as any).getActiveMatches()).toEqual([
      "/language en",
      "/language zh",
      "/language zh-TW",
    ]);
    expect((tui as any).getSlashMatchHint("/language zh-TW")).toBe(
      "Use Traditional Chinese",
    );
    expect((tui as any).getSlashMatchHint("/timeline")).toBe(
      "List persisted file checkpoints for this chat",
    );

    const traditionalTui = createTui({ language: "zh-TW" });
    expect(
      (traditionalTui as any).getSlashMatchHint("/chat delete session-1"),
    ).toBe("刪除該聊天");
  });

  it("uses custom command details without a second hard-coded hint catalog", () => {
    const tui = createTui();
    tui.setCandidates({
      commands: ["/release-review"],
      commandDetails: [
        {
          command: "/release-review",
          description: "Review this release",
          argumentHint: "<scope>",
          category: "workflow",
          source: "project",
        },
      ],
      files: [],
      symbols: [],
      sessions: [],
    });

    expect((tui as any).getSlashMatchHint("/release-review")).toBe(
      "Review this release",
    );
  });

  it("supports Ctrl+J multiline input before submit", async () => {
    const tui = createTui();

    const result = tui.askInput();

    typeText("line one");
    press("", { name: "j", ctrl: true });
    typeText("line two");
    press("", { name: "return" });

    await expect(result).resolves.toBe("line one\nline two");
  });

  it("returns an orderly exit request after Ctrl+C is confirmed", async () => {
    const tui = createTui();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit must not be called by the TUI input loop");
    }) as typeof process.exit);

    const result = tui.askInput();

    press("", { name: "c", ctrl: true });
    press("", { name: "c", ctrl: true });

    await expect(result).resolves.toBeNull();
    expect(exit).not.toHaveBeenCalled();
    expect(setRawMode).toHaveBeenLastCalledWith(false);
    expect(process.stdin.pause).toHaveBeenCalled();
    expect((tui as any).isActive).toBe(true);
  });

  it("supports Ctrl+R reverse history search from the active query", async () => {
    const tui = createTui();
    (tui as any).inputHistory = [
      "explain cache slabs",
      "/model deepseek-v4-flash",
      "optimize tui prompt",
    ];

    const result = tui.askInput();

    typeText("deepseek");
    press("", { name: "r", ctrl: true });
    press("", { name: "return" });

    await expect(result).resolves.toBe("/model deepseek-v4-flash");
  });

  it("reopens slash suggestions with Ctrl+P after Esc hides them", async () => {
    const tui = createTui();

    const result = tui.askInput();

    typeText("/mod");
    press("", { name: "escape" });
    expect((tui as any).hideAutocomplete).toBe(true);

    press("", { name: "p", ctrl: true });

    expect((tui as any).hideAutocomplete).toBe(false);
    press("", { name: "return" });
    await expect(result).resolves.toBe("/model");
  });

  it("compacts noisy web search system logs in history rendering", () => {
    const tui = createTui();

    const lines = (tui as any).formatSystemLinesForDisplay(
      [
        {
          role: "system",
          text: [
            "  ✦ web_search 杭州天气 2026-06-30",
            "  ✔ Success: Web search returned 5 results via Bing HTML.",
            "  ✦ web_search hangzhou weather today",
            "  ✔Success: Web search returned 3 results via Bing HTML.",
            "  ⚠Prompt cache hit degraded for slab abc: 28% hit (1536/5535 tokens).",
          ].join("\n"),
        },
      ],
      { prefixUnknown: true, preserveBlank: false },
    );

    const plain = lines.map((line: string) => stripAnsiCodes(line)).join("\n");
    expect(plain).toContain("web_search 2 searches · 8 results");
    expect(plain).toContain("latest: hangzhou weather today");
    expect(plain).not.toContain("Success:");
    expect(plain).not.toContain("Prompt cache hit degraded");
  });

  it("compacts Open-Meteo web search logs in history rendering", () => {
    const tui = createTui();

    const lines = (tui as any).formatSystemLinesForDisplay(
      [
        {
          role: "system",
          text: [
            "  ✦ web_search 杭州 2026-06-30 天气",
            "  ✔ Success: Weather data returned for 杭州, 浙江省, 中国 for 2026-06-30 via Open-Meteo.",
          ].join("\n"),
        },
      ],
      { prefixUnknown: true, preserveBlank: false },
    );

    const plain = lines.map((line: string) => stripAnsiCodes(line)).join("\n");
    expect(plain).toContain("web_search 杭州 2026-06-30 天气 · Open-Meteo");
    expect(plain).not.toContain("Success:");
  });

  it("renders the first model delta immediately and coalesces early bursts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const tui = createTui();
    const render = (tui as any).render;

    tui.startAttempt(1);
    render.mockClear();

    tui.handleModelDelta("h");
    expect(render).toHaveBeenCalledTimes(1);

    tui.handleModelDelta("i");
    expect(render).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15);
    expect(render).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(render).toHaveBeenCalledTimes(2);

    tui.finishAttempt();
  });
});
