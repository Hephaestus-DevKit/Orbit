import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentLoop, extractFilePathFromLine } from "./AgentLoop.js";
import { DEFAULT_CONFIG, type OrbitConfig } from "@orbit-build/config";
import { ModelProvider } from "@orbit-build/model-providers";
import { Prompt } from "@orbit-build/tui";
import fs from "fs";
import path from "path";

const HUNK_FLOW_TIMEOUT_MS =
  process.env.CI && process.platform === "win32" ? 60_000 : 20_000;
vi.setConfig({ testTimeout: HUNK_FLOW_TIMEOUT_MS });

describe("AgentLoop Hunk Acceptance Flow", () => {
  const testDir = path.resolve(process.cwd(), "hunk-test-temp");
  const testFile = path.join(testDir, "test.txt");

  const dummyConfig: OrbitConfig = {
    ...DEFAULT_CONFIG,
    name: "test",
    provider: { default: "openai" },
    models: {
      ...DEFAULT_CONFIG.models,
      default: "gpt-4",
      fast: "gpt-4",
    },
    providers: { openai: { type: "openai", apiKey: "test" } },
    permissions: {
      ...DEFAULT_CONFIG.permissions,
      // Hunk acceptance is a post-write review behavior and therefore belongs
      // to a non-Full-Access mode. Full Access accepts writes automatically.
      mode: "normal",
      allowRead: true,
      requireApprovalForWrite: false,
      requireApprovalForBash: false,
      blockDangerousCommands: false,
      protectSecrets: false,
      protectedPaths: [],
    },
    context: {
      ...DEFAULT_CONFIG.context,
      maxFilesToIndex: 10,
      maxFileSizeKb: 10,
      ignore: [],
      autoCompact: false,
      compactThreshold: 0.75,
    },
    tools: {
      ...DEFAULT_CONFIG.tools,
      bash: {
        ...DEFAULT_CONFIG.tools.bash,
        enabled: false,
        timeoutMs: 1000,
      },
      webSearch: { ...DEFAULT_CONFIG.tools.webSearch, enabled: false },
      mcp: { ...DEFAULT_CONFIG.tools.mcp, enabled: false },
    },
    mcpServers: {},
    hooks: {},
    session: { store: "jsonl", path: ".orbit/test-sessions" },
  };

  const createMockProvider = (): ModelProvider => {
    let callCount = 0;
    return {
      id: "openai",
      chat: async function* () {
        callCount++;
        if (callCount === 1) {
          yield {
            type: "tool_call",
            toolCall: {
              id: "call_1",
              name: "write_file",
              arguments: JSON.stringify({
                path: testFile,
                content: "line1\nlineX\nline3\nlineY\nline5",
              }),
            },
          };
        } else {
          yield {
            type: "text_delta",
            text: "I have finished writing the file.",
          };
        }
      },
    } as any;
  };

  const dummyInteraction = {
    askApproval: async () => true,
    // Keep permission approval separate so Prompt.askSelect assertions below
    // exercise only the post-write hunk review UI.
    askToolApproval: async () => true,
    showText: () => {},
    showDiff: () => {},
    prompt: {
      askSelect: (...args: Parameters<typeof Prompt.askSelect>) =>
        Prompt.askSelect(...args),
      askText: (...args: Parameters<typeof Prompt.askText>) =>
        Prompt.askText(...args),
      askMultiSelect: (...args: Parameters<typeof Prompt.askMultiSelect>) =>
        Prompt.askMultiSelect(...args),
    },
  };

  it("preserves absolute Unix paths from SEARCH/REPLACE file headers", () => {
    expect(extractFilePathFromLine("File: /tmp/orbit/test.txt")).toBe(
      "/tmp/orbit/test.txt",
    );
  });

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    fs.writeFileSync(testFile, "line1\nline2\nline3\nline4\nline5", "utf8");
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it("should accept all changes when user selects yes", async () => {
    const askSelectSpy = vi.spyOn(Prompt, "askSelect").mockResolvedValue("yes");

    const loop = AgentLoop.initialize(
      testDir,
      dummyConfig,
      createMockProvider(),
      "modify file",
      dummyInteraction,
    );
    await loop.run();

    expect(askSelectSpy).toHaveBeenCalled();
    const finalContent = fs.readFileSync(testFile, "utf8");
    expect(finalContent).toBe("line1\nlineX\nline3\nlineY\nline5");
  });

  it("should reject and rollback changes when user selects no", async () => {
    const askSelectSpy = vi.spyOn(Prompt, "askSelect").mockResolvedValue("no");

    const loop = AgentLoop.initialize(
      testDir,
      dummyConfig,
      createMockProvider(),
      "modify file",
      dummyInteraction,
    );
    await loop.run();

    expect(askSelectSpy).toHaveBeenCalled();
    const finalContent = fs.readFileSync(testFile, "utf8");
    // Content should remain original
    expect(finalContent).toBe("line1\nline2\nline3\nline4\nline5");
  });

  it("should apply selected hunks and reject other hunks", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const showText = vi.fn();
    const askSelectSpy = vi
      .spyOn(Prompt, "askSelect")
      .mockResolvedValue("hunks");
    // Mock multi-select to return indices of hunks to apply (only apply Hunk 1)
    const askMultiSelectSpy = vi
      .spyOn(Prompt, "askMultiSelect")
      .mockResolvedValue(["0"]);

    const loop = AgentLoop.initialize(
      testDir,
      dummyConfig,
      createMockProvider(),
      "modify file",
      { ...dummyInteraction, showText },
    );
    await loop.run();

    expect(askSelectSpy).toHaveBeenCalled();
    expect(askMultiSelectSpy).toHaveBeenCalled();
    expect(showText).toHaveBeenCalledWith(
      expect.stringContaining("Reviewing 2 hunks"),
    );
    expect(showText).toHaveBeenCalledWith(
      expect.stringContaining("--- Hunk #1/2 ---"),
    );
    expect(consoleLog).not.toHaveBeenCalled();

    const finalContent = fs.readFileSync(testFile, "utf8");
    // Hunk 1 accepted (lineX), Hunk 2 rejected (remains line4)
    expect(finalContent).toBe("line1\nlineX\nline3\nline4\nline5");
  });

  it("should parse XML tool call from text_delta and execute it successfully", async () => {
    const askSelectSpy = vi.spyOn(Prompt, "askSelect").mockResolvedValue("yes");

    let callCount = 0;
    const xmlMockProvider: ModelProvider = {
      id: "openai",
      chat: async function* () {
        callCount++;
        if (callCount === 1) {
          yield {
            type: "text_delta",
            text: `I will use the write_file tool to write to the file.\n\n<tool_call name="write_file">\n  <path>${testFile.replace(/\\/g, "/")}</path>\n  <content>xmlLine1\nxmlLine2</content>\n</tool_call>\n\nLet me know if this works.`,
          };
        } else {
          yield {
            type: "text_delta",
            text: "I have finished writing the file via XML.",
          };
        }
      },
    } as any;

    const loop = AgentLoop.initialize(
      testDir,
      dummyConfig,
      xmlMockProvider,
      "modify file",
      dummyInteraction,
    );
    await loop.run();

    expect(askSelectSpy).toHaveBeenCalled();
    const finalContent = fs.readFileSync(testFile, "utf8");
    expect(finalContent).toBe("xmlLine1\nxmlLine2");
  });

  it("should parse SEARCH/REPLACE block from text_delta and execute it successfully", async () => {
    const askSelectSpy = vi.spyOn(Prompt, "askSelect").mockResolvedValue("yes");

    let callCount = 0;
    const srMockProvider: ModelProvider = {
      id: "openai",
      chat: async function* () {
        callCount++;
        if (callCount === 1) {
          yield {
            type: "text_delta",
            text: `I will modify the test file now.\n\nFile: ${testFile.replace(/\\/g, "/")}\n<<<<<<< SEARCH\nline2\nline3\n=======\nlineX\nlineY\n>>>>>>>\n\nHope that looks correct!`,
          };
        } else {
          yield {
            type: "text_delta",
            text: "I have completed the SEARCH/REPLACE modifications.",
          };
        }
      },
    } as any;

    const loop = AgentLoop.initialize(
      testDir,
      dummyConfig,
      srMockProvider,
      "modify file",
      dummyInteraction,
    );
    await loop.run();

    expect(askSelectSpy).toHaveBeenCalled();
    const finalContent = fs.readFileSync(testFile, "utf8");
    expect(finalContent).toBe("line1\nlineX\nlineY\nline4\nline5");
  });
});
