import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { DEFAULT_CONFIG } from "@orbit-build/config";
import type {
  ModelProvider,
  ModelEvent,
  OrbitToolCall,
} from "@orbit-build/model-providers";
import { ToolRegistry } from "@orbit-build/tools";
import { SessionManager } from "@orbit-build/session";
import { AgentLoop } from "./AgentLoop.js";

const workspaces: string[] = [];
afterEach(() => {
  for (const cwd of workspaces.splice(0))
    rmSync(cwd, { recursive: true, force: true });
});

function fixture(
  calls: OrbitToolCall[],
  registry: ToolRegistry,
  budgetLimit = 10,
) {
  const cwd = mkdtempSync(join(tmpdir(), "orbit-durability-"));
  workspaces.push(cwd);
  const config = structuredClone(DEFAULT_CONFIG);
  config.tools.mcp.enabled = false;
  config.mcpServers = {};
  config.hooks = {};
  config.context.autoCompact = false;
  config.budgetLimit = budgetLimit;
  config.pricing = {};
  let requestCount = 0;
  const chat = vi.fn(async function* (): AsyncIterable<ModelEvent> {
    if (++requestCount > 1) {
      yield { type: "text_delta", text: "Finished inspection." };
      yield { type: "done" };
      return;
    }
    for (const toolCall of calls) yield { type: "tool_call", toolCall };
    yield { type: "done" };
  });
  const provider: ModelProvider = {
    id: "fixture",
    type: "openai-compatible",
    capabilities: {
      streaming: true,
      toolCalls: true,
      jsonMode: false,
      thinking: false,
      vision: false,
      promptCaching: false,
    },
    chat,
  };
  const interaction = {
    askApproval: vi.fn(async () => true),
    showText: vi.fn(),
    showDiff: vi.fn(),
  };
  const loop = AgentLoop.initialize(
    cwd,
    config,
    provider,
    "inspect the project",
    interaction,
    { toolRegistry: registry, disableMcp: true },
  );
  return { cwd, config, loop, chat, interaction };
}

describe("agent durable tool boundary", () => {
  it("applies session budget admission to approved MCP nested sampling", async () => {
    const { loop, config, chat } = fixture([], new ToolRegistry());
    config.budgetLimit = 0;
    const host = loop as unknown as {
      createMcpInteractionHandlers(): import("@orbit-build/mcp").MCPInteractionHandlers;
    };
    await expect(
      host.createMcpInteractionHandlers().onSampling!(
        {
          method: "sampling/createMessage",
          params: {
            messages: [
              { role: "user", content: { type: "text", text: "hello" } },
            ],
          },
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "budget_exceeded" });
    expect(chat).not.toHaveBeenCalled();
  });

  it("blocks stop hooks, session switches and rollback until an interrupted tool settles", async () => {
    const registry = new ToolRegistry();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const call = { id: "slow", name: "read_file", arguments: "{}" };
    const { loop, config, cwd } = fixture([call], registry);
    config.hooks = {
      lifecycle: {
        stop: [
          {
            command: `node -e "require('node:fs').writeFileSync('late-hook.txt','unsafe')"`,
            timeoutMs: 1000,
            onFailure: "block",
          },
        ],
      },
    };
    registry.register({
      name: "read_file",
      description: "uncooperative fixture",
      risk: "read",
      inputSchema: z.object({}),
      execute: async () => {
        loop.abort("immediate");
        await pending;
        return { ok: true };
      },
    });
    try {
      expect((await loop.run()).status).toBe("aborted");
      expect(existsSync(join(cwd, "late-hook.txt"))).toBe(false);
      expect(() => loop.startNewSession("fixture", "fixture")).toThrow(
        "still executing",
      );
      expect(() => loop.resumeSession(loop.getSessionId())).toThrow(
        "still executing",
      );
      await expect(loop.rollbackLastCheckpoint()).rejects.toThrow(
        "still executing",
      );
      await expect(loop.run()).rejects.toThrow("still executing");
      finish();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(() => loop.startNewSession("fixture", "fixture")).not.toThrow();
    } finally {
      finish();
      await loop.dispose();
    }
  });

  it("rejects an unaffordable priced request before calling the provider", async () => {
    const { loop, config, chat } = fixture([], new ToolRegistry(), 0.000001);
    for (const model of Object.values(config.models))
      config.pricing[model] = { inputCostPer1M: 100, outputCostPer1M: 100 };
    try {
      expect(await loop.run()).toMatchObject({
        status: "failed",
        error: { code: "budget_exceeded" },
      });
      expect(chat).not.toHaveBeenCalled();
    } finally {
      await loop.dispose();
    }
  });

  it.each([1, 2])(
    "rejects implementation replacement after model output for %s calls",
    async (count) => {
      const registry = new ToolRegistry();
      const execute = vi.fn(async () => ({ ok: true }));
      const original = {
        name: "read_file",
        description: "admitted fixture",
        risk: "read" as const,
        inputSchema: z.object({}),
        execution: {
          version: 2 as const,
          readOnly: true,
          idempotent: true,
          cancellation: "cooperative" as const,
          concurrency: "parallel" as const,
        },
        execute,
      };
      registry.register(original);
      const calls = Array.from({ length: count }, (_, i) => ({
        id: `replace-${i}`,
        name: "read_file",
        arguments: "{}",
      }));
      const { loop, chat, interaction } = fixture(calls, registry);
      const replacement = vi.fn(async () => ({ ok: true }));
      interaction.showText.mockImplementation((...args: unknown[]) => {
        if (String(args[0]).includes("replace-after-admission"))
          registry.register(
            { ...original, execute: replacement },
            { replace: true },
          );
      });
      let generation = 0;
      chat.mockImplementation(async function* (): AsyncIterable<ModelEvent> {
        if (++generation === 1) {
          yield { type: "text_delta", text: "replace-after-admission" };
          for (const toolCall of calls) yield { type: "tool_call", toolCall };
        } else yield { type: "text_delta", text: "Finished." };
        yield { type: "done" };
      });
      expect((await loop.run()).status).toBe("completed");
      expect(execute).not.toHaveBeenCalled();
      expect(replacement).not.toHaveBeenCalled();
      expect(JSON.stringify(loop.getHistory())).toContain(
        "changed after approval",
      );
      await loop.dispose();
    },
  );
  it.each([1, 2])(
    "rejects %s disabled tool calls before either execution path",
    async (count) => {
      const registry = new ToolRegistry();
      const execute = vi.fn(async () => ({
        ok: true,
        data: "must not execute",
      }));
      registry.register({
        name: "web_search",
        description: "disabled fixture",
        risk: "read",
        inputSchema: z.object({}),
        execution: {
          version: 2,
          readOnly: true,
          idempotent: true,
          cancellation: "cooperative",
          concurrency: "parallel",
        },
        execute,
      });
      const { loop } = fixture(
        Array.from({ length: count }, (_, index) => ({
          id: `denied-${index}`,
          name: "web_search",
          arguments: "{}",
        })),
        registry,
      );
      loop.getConfig().tools.webSearch.enabled = false;
      expect((await loop.run()).status).toBe("completed");
      expect(execute).not.toHaveBeenCalled();
      expect(JSON.stringify(loop.getHistory())).toContain(
        "not enabled for this request",
      );
      await loop.dispose();
    },
  );
  it.each([false, true])(
    "preserves completed results and closes cancelled calls (parallel=%s)",
    async (parallel) => {
      const registry = new ToolRegistry();
      let finishFirst!: () => void;
      const firstFinished = new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
      const calls = ["first", "second", "third"].map((id) => ({
        id,
        name: `read_${id}`,
        arguments: "{}",
      }));
      for (const call of calls)
        registry.register({
          name: call.name,
          description: "fixture read",
          risk: "read",
          inputSchema: z.object({}),
          ...(parallel
            ? {
                execution: {
                  version: 2 as const,
                  readOnly: true,
                  idempotent: true,
                  cancellation: "cooperative" as const,
                  concurrency: "parallel" as const,
                },
              }
            : {}),
          execute: async () => {
            if (call.id === "first") {
              finishFirst();
              return { ok: true, data: "completed before cancellation" };
            }
            await firstFinished;
            // Let the first boundary persist before the other call cancels the batch.
            await new Promise<void>((resolve) => setImmediate(resolve));
            if (call.id === "second") loop.abort("immediate");
            return { ok: true, data: "late success" };
          },
        });
      const setup = fixture(calls, registry);
      const loop = setup.loop;
      const outcome = await loop.run();
      expect(outcome.status).toBe("aborted");
      const saved = new SessionManager(setup.cwd, setup.config.session.path);
      saved.resumeSession(outcome.sessionId);
      const results = saved
        .getHistory()
        .flatMap((message) => message.content)
        .filter((block) => block.type === "tool_result");
      expect(results).toHaveLength(3);
      expect(results[0]).toMatchObject({
        toolResult: {
          toolCallId: "first",
          content: expect.stringContaining("completed before cancellation"),
          isError: false,
        },
      });
      expect(results[1]).toMatchObject({
        toolResult: { toolCallId: "second", isError: true },
      });
      expect(saved.getRecoveryReport()).toBeUndefined();
      await loop.dispose();
    },
  );

  it("keeps later known charges durable and enforces the budget after an unknown charge", async () => {
    const registry = new ToolRegistry();
    const calls = ["unknown", "known"].map((id) => ({
      id,
      name: "web_search",
      arguments: JSON.stringify({ query: id }),
    }));
    registry.register({
      name: "web_search",
      description: "fixture search",
      risk: "network",
      inputSchema: z.object({ query: z.string() }),
      execute: async (input) => ({
        ok: true,
        data: "search result",
        metadata:
          (input as { query: string }).query === "unknown"
            ? { externalUsageUnknown: true }
            : {
                externalUsage: {
                  provider: "deepseek",
                  operation: "search",
                  successfulRequests: 1,
                  estimatedCostUsd: 0.00075,
                  pricingAsOf: "2026-11-16",
                },
              },
      }),
    });
    const { loop, chat, interaction, cwd, config } = fixture(
      calls,
      registry,
      0.00075,
    );
    interaction.askApproval.mockImplementation(
      async (...args: unknown[]) => !String(args[0]).includes("budget limit"),
    );
    const outcome = await loop.run();
    expect(outcome).toMatchObject({
      status: "failed",
      error: { code: "budget_exceeded" },
    });
    expect(chat).toHaveBeenCalledTimes(1);
    const saved = new SessionManager(cwd, config.session.path);
    expect(saved.resumeSession(outcome.sessionId)).toMatchObject({
      totalCostEstimate: 0.00075,
      costEstimateKnown: false,
    });
    expect(loop.getSessionCost()).toBe(0.00075);
    await loop.dispose();
  });
});
