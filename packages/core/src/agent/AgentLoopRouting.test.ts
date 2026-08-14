import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentLoop } from "./AgentLoop.js";
import { buildCompactionSummary } from "./ContextWindowManager.js";
import { DEFAULT_CONFIG, type OrbitConfig } from "@orbit-build/config";
import { ModelProvider } from "@orbit-build/model-providers";
import { createDefaultToolRegistry } from "@orbit-build/tools";
import { Prompt } from "@orbit-build/tui";
import { z } from "zod";
import fs from "fs";
import path from "path";

describe("AgentLoop Fin Heuristic Routing", () => {
  const testDir = path.resolve(process.cwd(), "routing-test-temp");

  const dummyConfig: OrbitConfig = {
    ...DEFAULT_CONFIG,
    name: "test",
    provider: { default: "openai" },
    models: {
      default: "deepseek-v4-pro",
      fast: "deepseek-v4-flash",
      planner: "deepseek-v4-pro",
      coder: "deepseek-v4-pro",
      reviewer: "deepseek-v4-pro",
      summarizer: "deepseek-v4-flash",
      embedding: "text-embedding-3-small",
    },
    providers: { openai: { type: "openai", apiKey: "test" } },
    permissions: {
      ...DEFAULT_CONFIG.permissions,
      mode: "auto",
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

  const dummyInteraction = {
    askApproval: async () => true,
    showText: () => {},
    showDiff: () => {},
  };

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, {
        recursive: true,
        force: true,
        maxRetries: process.platform === "win32" ? 5 : 0,
        retryDelay: 100,
      });
    }
  });

  it("should route to default reasoning model and set high thinking budget on complex keywords", async () => {
    const chatMock = vi.fn().mockImplementation(async function* () {
      yield {
        type: "text_delta",
        text: "Response",
      };
    });

    const mockProvider: ModelProvider = {
      id: "openai",
      chat: chatMock,
      capabilities: capableProviderDefaults(),
    } as any;

    const loop = AgentLoop.initialize(
      testDir,
      dummyConfig,
      mockProvider,
      "please debug the compilation error in parser.ts",
      dummyInteraction,
      { disableStatusBar: true },
    );

    await loop.run();

    expect(chatMock).toHaveBeenCalled();
    const callArgs = chatMock.mock.calls[0][0];
    expect(callArgs.model).toBe("deepseek-v4-pro");
    expect(callArgs.thinking).toEqual({
      enabled: true,
      budgetTokens: 4096,
      effort: "high",
    });
  });

  it("should route to fast model on simple query", async () => {
    const chatMock = vi.fn().mockImplementation(async function* () {
      yield {
        type: "text_delta",
        text: "Response",
      };
    });

    const mockProvider: ModelProvider = {
      id: "openai",
      chat: chatMock,
      capabilities: capableProviderDefaults(),
    } as any;

    const loop = AgentLoop.initialize(
      testDir,
      dummyConfig,
      mockProvider,
      "what is this project?",
      dummyInteraction,
      { disableStatusBar: true },
    );

    await loop.run();

    expect(chatMock).toHaveBeenCalled();
    const callArgs = chatMock.mock.calls[0][0];
    expect(callArgs.model).toBe("deepseek-v4-flash");
    expect(callArgs.thinking).toEqual({
      enabled: true,
      budgetTokens: 2048,
      effort: "low",
    });
    expect(callArgs.maxTokens).toBe(32000);
    expect(callArgs.userId).toMatch(/^[a-f0-9]{64}$/);
  });

  it("routes complex direct-mode work to the coder lane even when default equals fast", async () => {
    const chatMock = vi.fn().mockImplementation(async function* () {
      yield { type: "text_delta", text: "Response" };
    });
    const mockProvider: ModelProvider = {
      id: "deepseek-openai",
      chat: chatMock,
      capabilities: capableProviderDefaults(),
    } as any;
    const loop = AgentLoop.initialize(
      testDir,
      {
        ...dummyConfig,
        models: {
          ...dummyConfig.models,
          default: "deepseek-v4-flash",
          fast: "deepseek-v4-flash",
          coder: "deepseek-v4-pro",
        },
      },
      mockProvider,
      "refactor the architecture and debug the race condition",
      dummyInteraction,
      { disableStatusBar: true },
    );

    await loop.run();

    expect(chatMock.mock.calls[0][0].model).toBe("deepseek-v4-pro");
    expect(chatMock.mock.calls[0][0].thinking.enabled).toBe(true);
  });

  it("routes each new user turn independently instead of inheriting old complexity", async () => {
    const chatMock = vi.fn().mockImplementation(async function* () {
      yield { type: "text_delta", text: "Response" };
    });
    const mockProvider: ModelProvider = {
      id: "deepseek-openai",
      chat: chatMock,
      capabilities: capableProviderDefaults(),
    } as any;
    const loop = AgentLoop.initialize(
      testDir,
      dummyConfig,
      mockProvider,
      "debug the architecture race condition",
      dummyInteraction,
      { disableStatusBar: true },
    );

    await loop.run();
    loop.prepareUserTurn("list files");
    expect(loop.sessionManager.getHistory().at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "list files" }],
    });
    await loop.run();

    expect(chatMock.mock.calls[0][0].model).toBe("deepseek-v4-pro");
    expect(chatMock.mock.calls[1][0].model).toBe("deepseek-v4-flash");
    expect(chatMock.mock.calls[1][0].thinking).toMatchObject({
      enabled: true,
      effort: "low",
    });
  });

  it("preserves legacy deepseek-chat non-thinking semantics on complex overrides", async () => {
    const chatMock = vi.fn().mockImplementation(async function* () {
      yield { type: "text_delta", text: "Response" };
    });
    const mockProvider: ModelProvider = {
      id: "deepseek-openai",
      chat: chatMock,
      getModelCapabilities: () => ({
        streaming: true,
        toolCalls: true,
        jsonMode: true,
        thinking: true,
        vision: false,
        promptCaching: true,
      }),
    } as any;
    const loop = AgentLoop.initialize(
      testDir,
      dummyConfig,
      mockProvider,
      "debug the architecture",
      dummyInteraction,
      { disableStatusBar: true, modelOverride: "deepseek-chat" },
    );

    await loop.run();

    expect(chatMock.mock.calls[0][0].thinking).toEqual({
      enabled: false,
      budgetTokens: 0,
      effort: "high",
    });
  });

  it("should apply configured agent loop iteration limit", () => {
    const mockProvider: ModelProvider = {
      id: "openai",
      chat: vi.fn(),
    } as any;

    const loop = AgentLoop.initialize(
      testDir,
      {
        ...dummyConfig,
        agent: { maxIterations: 12 },
      } as any,
      mockProvider,
      "search current weather",
      dummyInteraction,
      { disableStatusBar: true },
    );

    expect((loop as any).state.maxAttempts).toBe(12);
  });

  it("supports long workflows beyond the legacy two-hundred-iteration clamp", () => {
    const mockProvider: ModelProvider = {
      id: "openai",
      chat: vi.fn(),
    } as any;

    const loop = AgentLoop.initialize(
      testDir,
      {
        ...dummyConfig,
        agent: { maxIterations: 512 },
      } as any,
      mockProvider,
      "complete a long document workflow",
      dummyInteraction,
      { disableStatusBar: true },
    );

    expect((loop as any).state.maxAttempts).toBe(512);
  });

  it("refreshes the configured iteration ceiling before each new user turn", () => {
    const config = {
      ...dummyConfig,
      agent: { maxIterations: 200 },
    } as any;
    const loop = AgentLoop.initialize(
      testDir,
      config,
      { id: "openai", chat: vi.fn() } as any,
      "first task",
      dummyInteraction,
      { disableStatusBar: true },
    );

    config.agent.maxIterations = 500;
    loop.prepareUserTurn("second task");

    expect((loop as any).state.maxAttempts).toBe(500);
  });

  it("summarizes aggressively compacted history instead of replaying old turns", () => {
    const summary = buildCompactionSummary([
      {
        id: "old-user",
        role: "user",
        createdAt: "2026-07-01T00:00:00.000Z",
        content: [{ type: "text", text: "请全面优化 TUI 删除体验" }],
      },
      {
        id: "old-assistant",
        role: "assistant",
        createdAt: "2026-07-01T00:00:01.000Z",
        content: [
          {
            type: "tool_call",
            toolCall: {
              id: "edit-1",
              name: "edit_file",
              arguments: "{}",
            },
          },
        ],
      },
      {
        id: "old-tool",
        role: "tool",
        createdAt: "2026-07-01T00:00:02.000Z",
        content: [
          {
            type: "tool_result",
            toolResult: {
              id: "edit-1",
              name: "edit_file",
              content: "ok",
              isError: false,
            },
          },
        ],
      },
    ]);

    expect(summary).toContain("[Conversation Summary]");
    expect(summary).toContain("tool_call:edit_file");
    expect(summary).toContain("tool_result:edit_file:ok");
    expect(summary.length).toBeLessThan(700);
  });

  it("should ask only once for repeated web search approval in one run", async () => {
    const isolatedTools = createDefaultToolRegistry();
    const executeWebSearch = vi.fn(async (input: any) => ({
      ok: true,
      data: `result for ${input.query}`,
      display: `mock search for ${input.query}`,
    }));
    isolatedTools.register(
      {
        name: "web_search",
        description: "mock web search",
        inputSchema: z.object({ query: z.string() }),
        risk: "network",
        execute: executeWebSearch,
      },
      { replace: true },
    );
    const askApproval = vi.fn(async () => true);
    const askSelect = vi.spyOn(Prompt, "askSelect");

    let callCount = 0;
    const chatMock = vi.fn().mockImplementation(async function* () {
      callCount++;
      if (callCount === 1) {
        yield {
          type: "tool_call",
          toolCall: {
            id: "search-1",
            name: "web_search",
            arguments: JSON.stringify({ query: "杭州 2026-06-29 天气" }),
          },
        };
        return;
      }
      if (callCount === 2) {
        yield {
          type: "tool_call",
          toolCall: {
            id: "search-2",
            name: "web_search",
            arguments: JSON.stringify({ query: "杭州 2026-06-29 气温" }),
          },
        };
        return;
      }
      yield { type: "text_delta", text: "done" };
    });

    const mockProvider: ModelProvider = {
      id: "openai",
      chat: chatMock,
      capabilities: capableProviderDefaults(),
      getModelCapabilities: () => ({
        streaming: true,
        toolCalls: true,
        jsonMode: true,
        thinking: false,
        vision: false,
        promptCaching: true,
      }),
    } as any;

    const loop = AgentLoop.initialize(
      testDir,
      {
        ...dummyConfig,
        permissions: { ...dummyConfig.permissions, mode: "normal" },
        tools: {
          ...dummyConfig.tools,
          webSearch: { enabled: true },
        },
        agent: { maxIterations: 8 },
      } as any,
      mockProvider,
      "查杭州 2026-06-29 天气",
      { ...dummyInteraction, askApproval },
      { disableStatusBar: true, toolRegistry: isolatedTools },
    );

    await loop.run();

    expect(executeWebSearch).toHaveBeenCalledTimes(2);
    expect(askApproval).toHaveBeenCalledTimes(1);
    expect(askSelect).not.toHaveBeenCalledWith(
      expect.stringContaining('Confirm execution of tool "web_search"'),
      expect.anything(),
    );
    askSelect.mockRestore();
  });

  it("returns malformed tool arguments to the model instead of crashing", async () => {
    let callCount = 0;
    let replayedMessages: any[] = [];
    const chatMock = vi.fn().mockImplementation(async function* (input: any) {
      callCount += 1;
      if (callCount === 1) {
        yield {
          type: "tool_call",
          toolCall: {
            id: "malformed-call",
            name: "read_file",
            arguments: '{"path":',
          },
        };
        return;
      }
      replayedMessages = input.messages;
      yield { type: "text_delta", text: "recovered" };
    });
    const mockProvider: ModelProvider = {
      id: "openai",
      chat: chatMock,
      capabilities: capableProviderDefaults(),
    } as any;

    const loop = AgentLoop.initialize(
      testDir,
      dummyConfig,
      mockProvider,
      "read a file",
      dummyInteraction,
      { disableStatusBar: true, allowedTools: ["read_file"] },
    );

    await loop.run();
    const toolMessage = replayedMessages.find(
      (message) => message.role === "tool",
    );
    expect(callCount).toBeGreaterThanOrEqual(2);
    expect(toolMessage.content[0].toolResult).toMatchObject({
      toolCallId: "malformed-call",
      isError: true,
    });
    expect(toolMessage.content[0].toolResult.content).toContain(
      "Tool input JSON parse failed",
    );
  });

  it("lets the model persist a task plan through the update_plan tool", async () => {
    let callCount = 0;
    const chatMock = vi.fn().mockImplementation(async function* () {
      callCount += 1;
      if (callCount === 1) {
        yield {
          type: "tool_call",
          toolCall: {
            id: "plan-call",
            name: "update_plan",
            arguments: JSON.stringify({
              explanation: "Repository inspected",
              plan: [
                { step: "Inspect repository", status: "completed" },
                { step: "Implement fix", status: "in_progress" },
              ],
            }),
          },
        };
        return;
      }
      yield { type: "text_delta", text: "working" };
    });
    const mockProvider: ModelProvider = {
      id: "openai",
      chat: chatMock,
      capabilities: capableProviderDefaults(),
    } as any;

    const loop = AgentLoop.initialize(
      testDir,
      dummyConfig,
      mockProvider,
      "inspect and fix this project",
      dummyInteraction,
      { disableStatusBar: true, allowedTools: ["update_plan"] },
    );

    await loop.run();

    expect(loop.getTaskPlan()?.items).toMatchObject([
      { text: "Inspect repository", status: "completed" },
      { text: "Implement fix", status: "in_progress" },
    ]);
  });

  it("compacts live lookup tool results before replaying them to the model", async () => {
    const isolatedTools = createDefaultToolRegistry();
    const longSummary = "杭州天气实时资料 ".repeat(80);
    const rawResults = Array.from({ length: 15 }, (_, index) =>
      [
        `[${index + 1}] Title: Weather Result ${index + 1}`,
        `    Link: https://example.com/weather/${index + 1}`,
        `    Summary: ${longSummary}${index + 1}`,
      ].join("\n"),
    ).join("\n\n");

    isolatedTools.register(
      {
        name: "web_search",
        description: "mock web search",
        inputSchema: z.object({ query: z.string() }),
        risk: "network",
        execute: vi.fn(async () => ({
          ok: true,
          data: rawResults,
          display: "Web search returned 15 results via Mock.",
        })),
      },
      { replace: true },
    );

    let callCount = 0;
    let replayedMessages: any[] = [];
    const chatMock = vi.fn().mockImplementation(async function* (input: any) {
      callCount++;
      if (callCount === 1) {
        yield {
          type: "tool_call",
          toolCall: {
            id: "search-compact",
            name: "web_search",
            arguments: JSON.stringify({ query: "杭州天气" }),
          },
        };
        return;
      }

      replayedMessages = input.messages;
      yield { type: "text_delta", text: "done" };
    });

    const mockProvider: ModelProvider = {
      id: "openai",
      chat: chatMock,
    } as any;

    const loop = AgentLoop.initialize(
      testDir,
      {
        ...dummyConfig,
        permissions: { ...dummyConfig.permissions, mode: "normal" },
        tools: {
          ...dummyConfig.tools,
          webSearch: { enabled: true },
        },
      } as any,
      mockProvider,
      "查杭州天气",
      dummyInteraction,
      { disableStatusBar: true, toolRegistry: isolatedTools },
    );

    await loop.run();

    const toolMessage = replayedMessages.find((msg) => msg.role === "tool");
    const toolResult = toolMessage?.content?.[0]?.toolResult;
    expect(toolResult?.content).toContain("Results kept for reasoning: 10/15");
    expect(toolResult?.content).toContain("Weather Result 10");
    expect(toolResult?.content).not.toContain("Weather Result 15");
    expect(toolResult?.content.length).toBeLessThan(rawResults.length);
  });

  it("uses a compact native-tool prompt when function calling is available", async () => {
    const isolatedTools = createDefaultToolRegistry();
    isolatedTools.register(
      {
        name: "web_search",
        description: "mock live lookup",
        inputSchema: z.object({
          query: z.string().describe("Search query with runtime dates."),
          maxResults: z
            .number()
            .describe("Maximum number of search results.")
            .optional(),
        }),
        risk: "network",
        execute: vi.fn(),
      },
      { replace: true },
    );

    const chatMock = vi.fn().mockImplementation(async function* () {
      yield { type: "text_delta", text: "done" };
    });

    const mockProvider: ModelProvider = {
      id: "openai",
      chat: chatMock,
      capabilities: capableProviderDefaults(),
    } as any;

    const loop = AgentLoop.initialize(
      testDir,
      {
        ...dummyConfig,
        tools: {
          ...dummyConfig.tools,
          webSearch: { enabled: true },
        },
      } as any,
      mockProvider,
      "search current docs",
      dummyInteraction,
      {
        disableStatusBar: true,
        allowedTools: ["web_search"],
        toolRegistry: isolatedTools,
      },
    );

    await loop.run();

    const system = chatMock.mock.calls[0][0].system;
    expect(system).toContain("### Native Tool Use");
    expect(system).toContain("Available tools: web_search");
    expect(system).not.toContain('<tool_call name="tool_name">');
  });

  it("uses natural request-boundary caching without synthetic primer calls", async () => {
    const chatMock = vi.fn().mockImplementation(async function* () {
      yield { type: "text_delta", text: "Response" };
      yield {
        type: "usage",
        usage: {
          inputTokens: 120,
          outputTokens: 5,
          totalTokens: 125,
          cacheReadTokens: 0,
          cacheMissTokens: 120,
        },
      };
    });

    const mockProvider: ModelProvider = {
      id: "deepseek-openai",
      type: "openai-compatible",
      chat: chatMock,
      getModelCapabilities: () => ({
        streaming: true,
        toolCalls: true,
        jsonMode: true,
        thinking: true,
        vision: false,
        promptCaching: true,
      }),
    } as any;

    const loop = AgentLoop.initialize(
      testDir,
      {
        ...dummyConfig,
        provider: { default: "deepseek-openai" },
      },
      mockProvider,
      "what is this project?",
      dummyInteraction,
      { disableStatusBar: true },
    );

    await loop.run();

    expect(chatMock).toHaveBeenCalledTimes(1);
    const request = chatMock.mock.calls[0][0];
    expect(request.maxTokens).toBe(32000);
    expect(request.userId).toMatch(/^[a-f0-9]{64}$/);
    expect(request.system).not.toContain("<!-- VOLATILE_CONTEXT -->");
    expect(request.messages.at(-2)?.metadata).toMatchObject({
      kind: "orbit_volatile_context",
    });
    expect(request.messages.at(-1)?.content[0].text).toBe(
      "what is this project?",
    );
  });

  it("reports unknown cost instead of inventing pricing for custom models", async () => {
    const messages: string[] = [];
    const chatMock = vi.fn().mockImplementation(async function* () {
      yield { type: "text_delta", text: "Response" };
      yield {
        type: "usage",
        usage: {
          inputTokens: 120,
          outputTokens: 5,
          totalTokens: 125,
        },
      };
    });
    const mockProvider: ModelProvider = {
      id: "custom",
      chat: chatMock,
      capabilities: capableProviderDefaults(),
    } as any;
    const loop = AgentLoop.initialize(
      testDir,
      dummyConfig,
      mockProvider,
      "what is this project?",
      {
        ...dummyInteraction,
        showText: (message: string) => messages.push(message),
      },
      { disableStatusBar: true, modelOverride: "vendor/future-model" },
    );

    await loop.run();

    expect(loop.isSessionCostKnown()).toBe(false);
    expect(loop.getSessionCost()).toBe(0);
    expect(messages.join("\n")).toContain("Pricing is not configured");
  });

  it("keeps system bytes stable across tool sub-turns for boundary cache hits", async () => {
    const target = path.join(testDir, "cache-boundary.txt");
    fs.writeFileSync(target, "stable", "utf8");
    let requestCount = 0;
    const chatMock = vi.fn().mockImplementation(async function* () {
      requestCount++;
      if (requestCount === 1) {
        yield {
          type: "tool_call",
          toolCall: {
            id: "read-cache-boundary",
            name: "read_file",
            arguments: JSON.stringify({ path: target }),
          },
        };
        return;
      }
      yield { type: "text_delta", text: "done" };
    });

    const mockProvider: ModelProvider = {
      id: "deepseek-openai",
      type: "openai-compatible",
      chat: chatMock,
      getModelCapabilities: () => ({
        streaming: true,
        toolCalls: true,
        jsonMode: true,
        thinking: true,
        vision: false,
        promptCaching: true,
      }),
    } as any;

    const loop = AgentLoop.initialize(
      testDir,
      {
        ...dummyConfig,
        provider: { default: "deepseek-openai" },
      },
      mockProvider,
      "show current project file",
      dummyInteraction,
      { disableStatusBar: true },
    );

    await loop.run();

    expect(chatMock).toHaveBeenCalledTimes(2);
    const first = chatMock.mock.calls[0][0];
    const second = chatMock.mock.calls[1][0];
    expect(second.system).toBe(first.system);
    expect(second.messages.length).toBeGreaterThan(first.messages.length);
    expect(second.messages.slice(0, first.messages.length)).toEqual(
      first.messages,
    );
    expect(second.userId).toBe(first.userId);
  });

  it("concatenates split thinking signatures before replaying a tool turn", async () => {
    const target = path.join(testDir, "signature-boundary.txt");
    fs.writeFileSync(target, "stable", "utf8");
    let requestCount = 0;
    const chatMock = vi.fn().mockImplementation(async function* () {
      requestCount++;
      if (requestCount === 1) {
        yield { type: "thinking_delta", text: "reason", signature: "sig-" };
        yield { type: "thinking_delta", text: "", signature: "part" };
        yield {
          type: "tool_call",
          toolCall: {
            id: "read-signature-boundary",
            name: "read_file",
            arguments: JSON.stringify({ path: target }),
          },
        };
        return;
      }
      yield { type: "text_delta", text: "done" };
    });
    const mockProvider: ModelProvider = {
      id: "anthropic-compatible",
      type: "anthropic-compatible",
      chat: chatMock,
      getModelCapabilities: () => ({
        streaming: true,
        toolCalls: true,
        jsonMode: true,
        thinking: true,
        vision: false,
        promptCaching: true,
      }),
    } as any;
    const loop = AgentLoop.initialize(
      testDir,
      dummyConfig,
      mockProvider,
      "debug signature replay",
      dummyInteraction,
      { disableStatusBar: true },
    );

    await loop.run();

    const secondRequest = chatMock.mock.calls[1][0];
    const assistant = secondRequest.messages.find(
      (message: any) => message.role === "assistant",
    );
    expect(assistant.content).toContainEqual({
      type: "thinking",
      text: "reason",
      signature: "sig-part",
    });
  });
});

function capableProviderDefaults() {
  return {
    streaming: true,
    toolCalls: true,
    jsonMode: true,
    thinking: true,
    vision: false,
    promptCaching: true,
  };
}
