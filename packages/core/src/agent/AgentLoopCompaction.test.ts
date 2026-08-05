import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DEFAULT_CONFIG, type OrbitConfig } from "@orbit-build/config";
import type {
  ModelCapabilities,
  ModelProvider,
  OrbitMessage,
} from "@orbit-build/model-providers";
import { AgentLoop } from "./AgentLoop.js";
import {
  isContextWindowError,
  isOutputTokenLimitError,
} from "./ContextWindowManager.js";
import { VOLATILE_CONTEXT_MESSAGE_KIND } from "./MessageBuilder.js";

describe("AgentLoop model-aware context compaction", () => {
  const workspaces: string[] = [];

  afterEach(() => {
    for (const workspace of workspaces.splice(0)) {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  function createLoop() {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-compaction-"));
    workspaces.push(cwd);
    const config: OrbitConfig = {
      ...DEFAULT_CONFIG,
      models: {
        ...DEFAULT_CONFIG.models,
        default: "small-model",
        fast: "fast-model",
      },
      context: {
        ...DEFAULT_CONFIG.context,
        autoCompact: true,
        compactThreshold: 0.75,
      },
      agent: {
        ...DEFAULT_CONFIG.agent,
        maxOutputTokens: 1024,
        fastMaxOutputTokens: 512,
      },
      tools: {
        ...DEFAULT_CONFIG.tools,
        bash: { ...DEFAULT_CONFIG.tools.bash, enabled: false },
        webSearch: { ...DEFAULT_CONFIG.tools.webSearch, enabled: false },
        mcp: { ...DEFAULT_CONFIG.tools.mcp, enabled: false },
      },
      mcpServers: {},
      hooks: {},
    };
    const capabilities = (model: string): ModelCapabilities => ({
      streaming: true,
      toolCalls: true,
      jsonMode: true,
      thinking: false,
      vision: false,
      promptCaching: true,
      maxContextTokens: model === "large-model" ? 32_000 : 4096,
      maxOutputTokens: model === "fast-model" ? 512 : 2048,
    });
    const provider: ModelProvider = {
      id: "test",
      type: "openai-compatible",
      capabilities: capabilities("small-model"),
      getModelCapabilities: capabilities,
      chat: vi.fn(),
    };
    const interaction = {
      askApproval: vi.fn(async () => true),
      showText: vi.fn(),
      showDiff: vi.fn(),
    };
    return {
      loop: AgentLoop.initialize(cwd, config, provider, "test", interaction, {
        disableStatusBar: true,
      }),
      interaction,
    };
  }

  function message(index: number): OrbitMessage {
    return {
      id: `message-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      createdAt: new Date(index * 1000).toISOString(),
      content: [
        {
          type: "text",
          text: `第 ${index} 轮需要保留的工程决策：${"上下文".repeat(80)}`,
        },
      ],
    };
  }

  it("recognizes common provider context-limit errors", () => {
    expect(
      isContextWindowError(
        new Error("This model's maximum context length is 4096 tokens"),
      ),
    ).toBe(true);
    expect(isContextWindowError("input tokens exceed the token limit")).toBe(
      true,
    );
    expect(isContextWindowError("HTTP 429 overloaded")).toBe(false);
    expect(
      isContextWindowError(
        "Model output was truncated at the configured token limit.",
      ),
    ).toBe(false);
    expect(
      isOutputTokenLimitError(
        "Model output was truncated at the configured token limit.",
      ),
    ).toBe(true);
  });

  it("derives thresholds and output headroom from the active model", () => {
    const { loop } = createLoop();

    expect(loop.getContextWindowStatus()).toMatchObject({
      model: "small-model",
      maxContextTokens: 4096,
      reservedOutputTokens: 1024,
      compactAtTokens: 3072,
    });

    loop.setModelOverride("large-model");
    expect(loop.getContextWindowStatus()).toMatchObject({
      model: "large-model",
      maxContextTokens: 32_000,
      reservedOutputTokens: 1024,
      compactAtTokens: 24_000,
    });
  });

  it("preserves conversation history while switching provider and context window", () => {
    const { loop } = createLoop();
    const state = (loop as unknown as { state: { history: OrbitMessage[] } })
      .state;
    state.history = [message(1), message(2)];
    const before = structuredClone(state.history);
    const largeProvider: ModelProvider = {
      id: "secondary-gateway",
      type: "openai-compatible",
      capabilities: {
        streaming: true,
        toolCalls: true,
        jsonMode: true,
        thinking: true,
        vision: true,
        promptCaching: true,
        maxContextTokens: 1_048_576,
      },
      getModelCapabilities: () => ({
        streaming: true,
        toolCalls: true,
        jsonMode: true,
        thinking: true,
        vision: true,
        promptCaching: true,
        maxContextTokens: 1_048_576,
        maxOutputTokens: 65_536,
      }),
      chat: vi.fn(),
    };

    loop.setProvider(largeProvider);
    loop.setModelOverride("secondary-large-model");

    expect(loop.getHistory()).toEqual(before);
    expect(loop.getContextWindowStatus()).toMatchObject({
      model: "secondary-large-model",
      maxContextTokens: 1_048_576,
      compactAtTokens: 786_432,
    });
  });

  it("synchronizes resumed session metadata with the current runtime", () => {
    const { loop } = createLoop();
    const sessionId = loop.getSessionId();
    loop.setModelOverride("large-model");
    const workspace = (loop as unknown as { cwd: string }).cwd;
    const config = loop.getConfig();
    const provider: ModelProvider = {
      id: "resumed-provider",
      type: "openai-compatible",
      capabilities: loop.getProvider().capabilities,
      getModelCapabilities: loop.getProvider().getModelCapabilities,
      chat: vi.fn(),
    };
    const resumed = AgentLoop.initialize(
      workspace,
      config,
      provider,
      "resume",
      {
        askApproval: vi.fn(async () => true),
        showText: vi.fn(),
        showDiff: vi.fn(),
      },
      {
        disableStatusBar: true,
        sessionId,
        modelOverride: "large-model",
      },
    );

    expect(resumed.getSessionId()).toBe(sessionId);
    expect(
      resumed.getSessions().find(({ id }) => id === sessionId),
    ).toMatchObject({
      provider: "resumed-provider",
      model: "large-model",
    });
  });

  it("supports manual compaction and persists a bounded recent tail", async () => {
    const { loop } = createLoop();
    const state = (loop as unknown as { state: { history: OrbitMessage[] } })
      .state;
    state.history = Array.from({ length: 16 }, (_, index) => message(index));

    const result = await loop.compactHistoryPublic();

    expect(result.changed).toBe(true);
    expect(result.droppedMessages).toBeGreaterThan(0);
    expect(result.afterTokens).toBeLessThan(result.beforeTokens);
    expect(loop.getHistory()[0].metadata?.kind).toBe(
      "history_compaction_summary",
    );
    expect(loop.getHistory().at(-1)?.id).toBe("message-15");
  });

  it("does not replace a short history with a larger summary", async () => {
    const { loop } = createLoop();
    const state = (loop as unknown as { state: { history: OrbitMessage[] } })
      .state;
    state.history = Array.from({ length: 5 }, (_, index) => ({
      ...message(index),
      content: [{ type: "text", text: `short ${index}` }],
    }));

    const result = await loop.compactHistoryPublic();

    expect(result.changed).toBe(false);
    expect(result.afterTokens).toBe(result.beforeTokens);
    expect(loop.getHistory()).toHaveLength(5);
  });

  it("includes system and volatile context when guarding a request", async () => {
    const { loop } = createLoop();
    const state = (loop as unknown as { state: { history: OrbitMessage[] } })
      .state;
    state.history = [
      ...Array.from({ length: 10 }, (_, index) => message(index)),
      {
        id: "volatile",
        role: "user",
        createdAt: new Date().toISOString(),
        content: [{ type: "text", text: "代码摘录".repeat(1200) }],
        metadata: { kind: VOLATILE_CONTEXT_MESSAGE_KIND },
      },
      {
        id: "current-user",
        role: "user",
        createdAt: new Date().toISOString(),
        content: [{ type: "text", text: "继续完成当前任务" }],
      },
    ];

    const result = await (
      loop as unknown as {
        compactOversizedRequest(
          model: string,
          system: string,
          messages: OrbitMessage[],
        ): Promise<{ changed: boolean; truncatedContextMessages: number }>;
      }
    ).compactOversizedRequest(
      "small-model",
      "system rules ".repeat(300),
      state.history,
    );

    expect(result?.changed).toBe(true);
    expect(result?.truncatedContextMessages).toBeGreaterThan(0);
    expect(JSON.stringify(loop.getHistory())).toContain(
      "volatile context compacted",
    );
    expect(loop.getHistory().at(-1)?.id).toBe("current-user");
  });
});
