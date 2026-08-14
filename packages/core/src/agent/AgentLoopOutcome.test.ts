import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyPermissionModePreset,
  DEFAULT_CONFIG,
  type OrbitConfig,
} from "@orbit-build/config";
import type { ModelProvider } from "@orbit-build/model-providers";
import { AgentLoop, type UserInteraction } from "./AgentLoop.js";
import { Prompt } from "@orbit-build/tui";
import {
  createDefaultToolRegistry,
  type OrbitTool,
  type ToolContext,
} from "@orbit-build/tools";
import { z } from "zod";

const capabilities = {
  streaming: true,
  toolCalls: true,
  jsonMode: true,
  thinking: true,
  vision: false,
  promptCaching: true,
};

function createConfig(): OrbitConfig {
  return {
    ...DEFAULT_CONFIG,
    name: "agent-loop-outcome-test",
    provider: { default: "test-provider" },
    providers: {
      ...DEFAULT_CONFIG.providers,
      "test-provider": {
        type: "openai-compatible",
        apiKey: "test-only-key",
        baseUrl: "https://example.invalid",
      },
    },
    models: {
      ...DEFAULT_CONFIG.models,
      default: "deepseek-v4-flash",
      fast: "deepseek-v4-flash",
    },
    tools: {
      ...DEFAULT_CONFIG.tools,
      bash: { ...DEFAULT_CONFIG.tools.bash, enabled: false },
      webSearch: { ...DEFAULT_CONFIG.tools.webSearch, enabled: false },
      mcp: { ...DEFAULT_CONFIG.tools.mcp, enabled: false },
    },
    context: {
      ...DEFAULT_CONFIG.context,
      autoCompact: false,
      maxFilesToIndex: 10,
    },
    agent: { ...DEFAULT_CONFIG.agent },
    permissions: { ...DEFAULT_CONFIG.permissions },
    autoCommit: false,
  };
}

describe("AgentLoop run outcome", () => {
  let cwd: string;
  let output: string[];
  let interaction: UserInteraction;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-agent-loop-outcome-"));
    output = [];
    interaction = {
      askApproval: async () => true,
      showText: (text) => output.push(text),
      showDiff: () => undefined,
    };
  });

  afterEach(() => {
    rmSync(cwd, {
      recursive: true,
      force: true,
      maxRetries: process.platform === "win32" ? 5 : 0,
      retryDelay: 100,
    });
  });

  it("returns failed for a provider stream error and redacts its message", async () => {
    const chat = vi.fn<ModelProvider["chat"]>(async function* () {
      yield {
        type: "error",
        error: new Error("HTTP 401 Authorization: Bearer secret-token-value"),
      };
    });
    const provider: ModelProvider = {
      id: "test-provider",
      type: "openai-compatible",
      capabilities,
      chat,
    };
    const loop = AgentLoop.initialize(
      cwd,
      createConfig(),
      provider,
      "answer briefly",
      interaction,
      { disableStatusBar: true },
    );

    const outcome = await loop.run();

    expect(outcome).toMatchObject({
      status: "failed",
      error: {
        code: "provider_error",
        message: expect.stringContaining("HTTP 401"),
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("secret-token-value");
    expect(output.join("\n")).not.toContain("secret-token-value");
  });

  it("recovers from an output-token limit with a bounded continuation", async () => {
    const requests: Parameters<ModelProvider["chat"]>[0][] = [];
    let callCount = 0;
    const chat = vi.fn<ModelProvider["chat"]>(async function* (request) {
      requests.push(request);
      callCount += 1;
      if (callCount === 1) {
        yield {
          type: "error",
          error: new Error(
            "Model output was truncated at the configured token limit.",
          ),
        };
        return;
      }
      yield { type: "text_delta", text: "Completed in a bounded batch." };
    });
    const provider: ModelProvider = {
      id: "test-provider",
      type: "openai-compatible",
      capabilities,
      chat,
    };
    const loop = AgentLoop.initialize(
      cwd,
      createConfig(),
      provider,
      "complete a large task",
      interaction,
      { disableStatusBar: true },
    );

    const outcome = await loop.run();

    expect(outcome).toMatchObject({ status: "completed", attempts: 2 });
    expect(requests[1]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          metadata: { kind: "output_limit_recovery" },
          content: [
            expect.objectContaining({
              type: "text",
              text: expect.stringContaining("at most four tool calls"),
            }),
          ],
        }),
      ]),
    );
    expect(output.join("\n")).toContain("exceeded its output limit");
  });

  it("returns aborted immediately without calling the provider", async () => {
    const chat = vi.fn<ModelProvider["chat"]>();
    const provider: ModelProvider = {
      id: "test-provider",
      type: "openai-compatible",
      capabilities,
      chat,
    };
    const loop = AgentLoop.initialize(
      cwd,
      createConfig(),
      provider,
      "answer briefly",
      interaction,
      { disableStatusBar: true },
    );
    loop.abort("immediate");

    const outcome = await loop.run();

    expect(outcome).toMatchObject({
      status: "aborted",
      reason: "immediate",
      attempts: 0,
    });
    expect(chat).not.toHaveBeenCalled();
  });

  it("persists partial thinking and answer content when a stream is aborted", async () => {
    const loopRef: { current: AgentLoop | null } = { current: null };
    const chat = vi.fn<ModelProvider["chat"]>(async function* () {
      yield {
        type: "thinking_delta",
        text: "partial thought",
        signature: "partial-signature",
      };
      yield { type: "text_delta", text: "partial answer" };
      if (!loopRef.current) throw new Error("Agent loop was not initialized.");
      loopRef.current.abort("immediate");
    });
    const provider: ModelProvider = {
      id: "test-provider",
      type: "openai-compatible",
      capabilities,
      chat,
    };
    const loop = AgentLoop.initialize(
      cwd,
      createConfig(),
      provider,
      "answer briefly",
      interaction,
      { disableStatusBar: true },
    );
    loopRef.current = loop;

    const outcome = await loop.run();
    const assistantMessages = loop
      .getHistory()
      .filter((message) => message.role === "assistant");

    expect(outcome.status).toBe("aborted");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]).toMatchObject({
      metadata: {
        model: "deepseek-v4-flash",
        aborted: true,
        incomplete: true,
      },
      content: [
        {
          type: "thinking",
          text: "partial thought",
          signature: "partial-signature",
        },
        { type: "text", text: "partial answer" },
      ],
    });
  });

  it("pauses without reporting a false failure at the iteration limit", async () => {
    const chat = vi.fn<ModelProvider["chat"]>(async function* () {
      yield {
        type: "tool_call",
        toolCall: {
          id: "call_list",
          name: "list_files",
          arguments: JSON.stringify({ path: "." }),
        },
      };
    });
    const provider: ModelProvider = {
      id: "test-provider",
      type: "openai-compatible",
      capabilities,
      chat,
    };
    const config = createConfig();
    config.agent.maxIterations = 1;
    const loop = AgentLoop.initialize(
      cwd,
      config,
      provider,
      "inspect the workspace",
      interaction,
      { disableStatusBar: true },
    );

    const outcome = await loop.run();

    expect(outcome).toMatchObject({
      status: "aborted",
      attempts: 1,
      reason: "iteration_limit",
    });
    expect(
      loop.sessionManager.getSessionStore().getSession(loop.getSessionId())
        ?.status,
    ).toBe("aborted");
    expect(
      loop.sessionManager.getSessionStore().getRunJournal(loop.getSessionId())
        ?.phase,
    ).toBe("paused");
  });

  it("continues bounded automation through runaway checkpoints without approving tools", async () => {
    let callCount = 0;
    const chat = vi.fn<ModelProvider["chat"]>(async function* () {
      callCount += 1;
      if (callCount <= 6) {
        yield {
          type: "tool_call",
          toolCall: {
            id: `call_list_${callCount}`,
            name: "list_files",
            arguments: JSON.stringify({ path: "." }),
          },
        };
        return;
      }
      yield { type: "text_delta", text: "completed after checkpoint" };
    });
    const provider: ModelProvider = {
      id: "test-provider",
      type: "openai-compatible",
      capabilities,
      chat,
    };
    const config = createConfig();
    config.agent.maxIterations = 8;
    const askApproval = vi.fn(async () => false);
    const loop = AgentLoop.initialize(
      cwd,
      config,
      provider,
      "inspect repeatedly, then finish",
      { ...interaction, askApproval },
      {
        disableStatusBar: true,
        nonInteractive: true,
        autoContinueRunaway: true,
      },
    );

    const outcome = await loop.run();

    expect(outcome).toMatchObject({ status: "completed", attempts: 7 });
    expect(askApproval).not.toHaveBeenCalled();
    expect(output.join("\n")).toContain("Automated evaluation checkpoint");
  });

  it("applies a mid-turn steering instruction at the next safe model boundary", async () => {
    const loopRef: { current: AgentLoop | null } = { current: null };
    let callCount = 0;
    const chat = vi.fn<ModelProvider["chat"]>(async function* () {
      callCount += 1;
      if (callCount === 1) {
        yield { type: "text_delta", text: "I will change the API." };
        loopRef.current?.enqueueUserInput("Keep the public API unchanged.", {
          mode: "steer",
          source: "terminal",
        });
        return;
      }
      yield { type: "text_delta", text: "Understood. No API changes." };
    });
    const provider: ModelProvider = {
      id: "test-provider",
      type: "openai-compatible",
      capabilities,
      chat,
    };
    const loop = AgentLoop.initialize(
      cwd,
      createConfig(),
      provider,
      "improve the implementation",
      interaction,
      { disableStatusBar: true },
    );
    loopRef.current = loop;

    const outcome = await loop.run();

    expect(outcome.status).toBe("completed");
    expect(chat).toHaveBeenCalledTimes(2);
    expect(loop.getQueuedInputs()).toEqual([]);
    expect(loop.getHistory()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          metadata: expect.objectContaining({
            kind: "mid_turn_interjection",
            source: "terminal",
          }),
          content: [{ type: "text", text: "Keep the public API unchanged." }],
        }),
      ]),
    );
  });

  it("retains follow-ups for the outer UI turn driver", () => {
    const provider: ModelProvider = {
      id: "test-provider",
      type: "openai-compatible",
      capabilities,
      chat: vi.fn<ModelProvider["chat"]>(),
    };
    const loop = AgentLoop.initialize(
      cwd,
      createConfig(),
      provider,
      "initial task",
      interaction,
      { disableStatusBar: true },
    );
    const queued = loop.enqueueUserInput("verify everything", {
      mode: "follow_up",
      source: "web",
    });
    const second = loop.enqueueUserInput("document the result", {
      mode: "follow_up",
      source: "terminal",
    });

    expect(
      loop.updateQueuedInput(second.id, {
        text: "document the verified result",
      }),
    ).toMatchObject({ text: "document the verified result" });
    expect(loop.moveQueuedInput(second.id, "up")).toBe(true);
    expect(loop.getQueuedInputs().map((input) => input.id)).toEqual([
      second.id,
      queued.id,
    ]);
    expect(loop.removeQueuedInput(second.id)).toBe(true);
    const next = loop.takeNextQueuedInput();
    expect(next?.id).toBe(queued.id);
    if (!next) throw new Error("Expected queued input.");
    loop.prepareQueuedUserTurn(next);
    expect(loop.getHistory().at(-1)).toMatchObject({
      role: "user",
      metadata: {
        kind: "queued_follow_up",
        queueId: queued.id,
        queuedMode: "follow_up",
        source: "web",
      },
    });
  });

  it("accounts for background completion before declaring the turn complete", async () => {
    const requests: Parameters<ModelProvider["chat"]>[0][] = [];
    let callCount = 0;
    const encoded = Buffer.from(
      "setTimeout(() => console.log('background-ready'), 100)",
      "utf8",
    ).toString("base64");
    const executable = process.execPath.replace(/"/g, '\\"');
    const command = `"${executable}" -e "eval(Buffer.from('${encoded}','base64').toString())"`;
    const chat = vi.fn<ModelProvider["chat"]>(async function* (request) {
      requests.push(request);
      callCount += 1;
      if (callCount === 1) {
        yield {
          type: "tool_call",
          toolCall: {
            id: "call_background",
            name: "bash",
            arguments: JSON.stringify({ command, background: true }),
          },
        };
        return;
      }
      yield { type: "text_delta", text: "Background work is accounted for." };
    });
    const provider: ModelProvider = {
      id: "test-provider",
      type: "openai-compatible",
      capabilities,
      chat,
    };
    const config = createConfig();
    config.tools.bash.enabled = true;
    config.permissions = {
      ...config.permissions,
      mode: "auto",
      requireApprovalForBash: false,
    };
    const loop = AgentLoop.initialize(
      cwd,
      config,
      provider,
      "run a background check",
      interaction,
      { disableStatusBar: true, nonInteractive: true },
    );

    try {
      const outcome = await loop.run();

      expect(outcome.status).toBe("completed");
      expect(callCount).toBeGreaterThanOrEqual(2);
      expect(
        requests.some((request) =>
          request.messages.some((message) =>
            message.content.some(
              (block) =>
                block.type === "text" &&
                block.text.includes("Background task runtime notification"),
            ),
          ),
        ),
      ).toBe(true);
    } finally {
      await loop.dispose();
    }
  });

  it("never opens terminal prompts in non-interactive mode", async () => {
    const target = join(cwd, "generated.txt");
    const verificationTarget = join(cwd, "verification.js");
    writeFileSync(verificationTarget, "export {};\n", "utf8");
    let callCount = 0;
    const chat = vi.fn<ModelProvider["chat"]>(async function* () {
      callCount += 1;
      if (callCount === 1) {
        yield {
          type: "tool_call",
          toolCall: {
            id: "call_write",
            name: "write_file",
            arguments: JSON.stringify({ path: target, content: "ready\n" }),
          },
        };
        return;
      }
      if (callCount === 2) {
        yield { type: "text_delta", text: "Done." };
        return;
      }
      if (callCount === 3) {
        yield {
          type: "tool_call",
          toolCall: {
            id: "call_verify",
            name: "run_tests",
            arguments: JSON.stringify({
              command: `node --check "${verificationTarget}"`,
            }),
          },
        };
        return;
      }
      yield { type: "text_delta", text: "Done." };
    });
    const provider: ModelProvider = {
      id: "test-provider",
      type: "openai-compatible",
      capabilities,
      chat,
    };
    const config = createConfig();
    config.context.autoRepair = false;
    config.permissions = {
      ...config.permissions,
      mode: "auto",
      requireApprovalForWrite: false,
      requireApprovalForBash: false,
    };
    const askSelect = vi
      .spyOn(Prompt, "askSelect")
      .mockRejectedValue(new Error("Terminal prompt must not be opened."));
    const askApproval = vi
      .spyOn(Prompt, "askApproval")
      .mockRejectedValue(new Error("Terminal prompt must not be opened."));
    const loop = AgentLoop.initialize(
      cwd,
      config,
      provider,
      "write a file",
      interaction,
      { disableStatusBar: true, nonInteractive: true },
    );

    const outcome = await loop.run();

    expect(outcome.status).toBe("completed");
    expect(outcome.receipt).toMatchObject({
      modifiedFiles: ["generated.txt"],
      verification: "passed",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
      },
      cost: { known: true, usd: 0 },
    });
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("ready\n");
    expect(callCount).toBe(4);
    expect(output.join("\n")).toContain("Completion gate");
    expect(askSelect).not.toHaveBeenCalled();
    expect(askApproval).not.toHaveBeenCalled();
  });

  it("executes outside-workspace writes without checkpoint or review prompts in Full Access", async () => {
    const hostDirectory = mkdtempSync(
      join(tmpdir(), "orbit-full-access-host-"),
    );
    const target = join(hostDirectory, "outside.txt");
    let callCount = 0;
    const chat = vi.fn<ModelProvider["chat"]>(async function* () {
      callCount += 1;
      if (callCount === 1) {
        yield {
          type: "tool_call",
          toolCall: {
            id: "call_outside_write",
            name: "write_file",
            arguments: JSON.stringify({ path: target, content: "host data\n" }),
          },
        };
        return;
      }
      yield { type: "text_delta", text: "Outside write completed." };
    });
    const provider: ModelProvider = {
      id: "test-provider",
      type: "openai-compatible",
      capabilities,
      chat,
    };
    const config = createConfig();
    config.context.autoRepair = false;
    expect(applyPermissionModePreset(config, "auto")).toEqual({ ok: true });
    const reviewFileChange = vi.fn(async () => false);
    const askApproval = vi.fn(async () => {
      throw new Error("Full Access must not request tool approval.");
    });
    const loop = AgentLoop.initialize(
      cwd,
      config,
      provider,
      "write outside the workspace",
      {
        ...interaction,
        askApproval,
        reviewFileChange,
      },
      { disableStatusBar: true },
    );

    try {
      const outcome = await loop.run();

      expect(outcome).toMatchObject({ status: "completed", attempts: 2 });
      expect(readFileSync(target, "utf8")).toBe("host data\n");
      expect(reviewFileChange).not.toHaveBeenCalled();
      expect(askApproval).not.toHaveBeenCalled();
      expect(loop.getRelevantFiles()).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ path: target })]),
      );
    } finally {
      await loop.dispose();
      rmSync(hostDirectory, { recursive: true, force: true });
    }
  });

  it("does not let an unavailable checkpoint block a Full Access write", async () => {
    const target = join(cwd, "oversized-before.js");
    writeFileSync(target, "");
    truncateSync(target, 16 * 1024 * 1024 + 1);
    let callCount = 0;
    const chat = vi.fn<ModelProvider["chat"]>(async function* () {
      callCount += 1;
      if (callCount === 1) {
        yield {
          type: "tool_call",
          toolCall: {
            id: "call_checkpointless_write",
            name: "write_file",
            arguments: JSON.stringify({
              path: target,
              content: "export {};\n",
            }),
          },
        };
        return;
      }
      if (callCount === 2) {
        yield {
          type: "tool_call",
          toolCall: {
            id: "call_checkpointless_verify",
            name: "run_tests",
            arguments: JSON.stringify({
              command: `node --check "${target}"`,
            }),
          },
        };
        return;
      }
      yield { type: "text_delta", text: "Completed without a checkpoint." };
    });
    const provider: ModelProvider = {
      id: "test-provider",
      type: "openai-compatible",
      capabilities,
      chat,
    };
    const config = createConfig();
    config.context.autoRepair = false;
    expect(applyPermissionModePreset(config, "auto")).toEqual({ ok: true });
    const loop = AgentLoop.initialize(
      cwd,
      config,
      provider,
      "replace a large file",
      interaction,
      { disableStatusBar: true },
    );

    try {
      const outcome = await loop.run();

      expect(outcome).toMatchObject({ status: "completed", attempts: 3 });
      expect(readFileSync(target, "utf8")).toBe("export {};\n");
      expect(output.join("\n")).toContain("checkpoint unavailable");
    } finally {
      await loop.dispose();
    }
  });

  it("preserves Full Access configuration for internal verification tool calls", async () => {
    const target = join(cwd, "verified.txt");
    let callCount = 0;
    const chat = vi.fn<ModelProvider["chat"]>(async function* () {
      callCount += 1;
      if (callCount === 1) {
        yield {
          type: "tool_call",
          toolCall: {
            id: "call_verified_write",
            name: "write_file",
            arguments: JSON.stringify({ path: target, content: "ready\n" }),
          },
        };
        return;
      }
      yield { type: "text_delta", text: "Verified." };
    });
    const provider: ModelProvider = {
      id: "test-provider",
      type: "openai-compatible",
      capabilities,
      chat,
    };
    const config = createConfig();
    config.context.autoRepair = true;
    expect(applyPermissionModePreset(config, "auto")).toEqual({ ok: true });
    const verificationContexts: ToolContext[] = [];
    const verificationTool: OrbitTool<unknown, unknown> = {
      name: "run_tests",
      description: "Capture internal verification context.",
      inputSchema: z.unknown(),
      risk: "execute",
      execute: async (_input, context) => {
        verificationContexts.push(context);
        return {
          ok: true,
          data: { exitCode: 0 },
          metadata: { verificationEvidence: true },
        };
      },
    };
    const registry = createDefaultToolRegistry();
    registry.register(verificationTool, { replace: true });
    const loop = AgentLoop.initialize(
      cwd,
      config,
      provider,
      "write and verify",
      interaction,
      { disableStatusBar: true, toolRegistry: registry },
    );

    try {
      const outcome = await loop.run();

      expect(outcome).toMatchObject({ status: "completed", attempts: 2 });
      expect(verificationContexts).toHaveLength(1);
      expect(verificationContexts[0]).toMatchObject({
        cwd,
        config: {
          permissions: {
            mode: "auto",
            blockDangerousCommands: false,
            protectSecrets: false,
          },
        },
      });
      expect(verificationContexts[0].services).toBeDefined();
    } finally {
      await loop.dispose();
    }
  });

  it("fails closed when edited files remain unverified after the completion nudge", async () => {
    const target = join(cwd, "unverified.txt");
    let callCount = 0;
    const chat = vi.fn<ModelProvider["chat"]>(async function* () {
      callCount += 1;
      if (callCount === 1) {
        yield {
          type: "tool_call",
          toolCall: {
            id: "call_unverified_write",
            name: "write_file",
            arguments: JSON.stringify({ path: target, content: "draft\n" }),
          },
        };
        return;
      }
      yield { type: "text_delta", text: "Done without verification." };
    });
    const provider: ModelProvider = {
      id: "test-provider",
      type: "openai-compatible",
      capabilities,
      chat,
    };
    const config = createConfig();
    config.context.autoRepair = false;
    config.permissions = {
      ...config.permissions,
      mode: "auto",
      requireApprovalForWrite: false,
      requireApprovalForBash: false,
    };
    const loop = AgentLoop.initialize(
      cwd,
      config,
      provider,
      "write without checking",
      interaction,
      { disableStatusBar: true, nonInteractive: true },
    );

    const outcome = await loop.run();

    expect(outcome).toMatchObject({
      status: "failed",
      error: { code: "verification_failed" },
    });
    expect(callCount).toBe(3);
    expect(output.join("\n")).toContain("Completion gate");
  });

  it("invalidates successful verification after a later file mutation", async () => {
    const firstTarget = join(cwd, "first.txt");
    const secondTarget = join(cwd, "second.txt");
    const verificationTarget = join(cwd, "verification.js");
    writeFileSync(verificationTarget, "export {};\n", "utf8");
    let callCount = 0;
    const chat = vi.fn<ModelProvider["chat"]>(async function* () {
      callCount += 1;
      if (callCount === 1) {
        yield {
          type: "tool_call",
          toolCall: {
            id: "call_first_write",
            name: "write_file",
            arguments: JSON.stringify({
              path: firstTarget,
              content: "export const first = 1;\n",
            }),
          },
        };
        return;
      }
      if (callCount === 2) {
        yield {
          type: "tool_call",
          toolCall: {
            id: "call_first_verify",
            name: "run_tests",
            arguments: JSON.stringify({
              command: `node --check "${verificationTarget}"`,
            }),
          },
        };
        return;
      }
      if (callCount === 3) {
        yield {
          type: "tool_call",
          toolCall: {
            id: "call_second_write",
            name: "write_file",
            arguments: JSON.stringify({
              path: secondTarget,
              content: "export const second = 2;\n",
            }),
          },
        };
        return;
      }
      yield { type: "text_delta", text: "Done without re-verifying." };
    });
    const provider: ModelProvider = {
      id: "test-provider",
      type: "openai-compatible",
      capabilities,
      chat,
    };
    const config = createConfig();
    config.context.autoRepair = false;
    config.permissions = {
      ...config.permissions,
      mode: "auto",
      requireApprovalForWrite: false,
      requireApprovalForBash: false,
    };
    const loop = AgentLoop.initialize(
      cwd,
      config,
      provider,
      "write two files",
      interaction,
      { disableStatusBar: true, nonInteractive: true },
    );

    const outcome = await loop.run();

    expect(outcome).toMatchObject({
      status: "failed",
      error: { code: "verification_failed" },
    });
    expect(output.join("\n")).toContain("Completion gate");
  });

  it("does not require verification when a proposed edit was rejected", async () => {
    const target = join(cwd, "rejected.txt");
    let callCount = 0;
    const chat = vi.fn<ModelProvider["chat"]>(async function* () {
      callCount += 1;
      if (callCount === 1) {
        yield {
          type: "tool_call",
          toolCall: {
            id: "call_rejected_write",
            name: "write_file",
            arguments: JSON.stringify({ path: target, content: "draft\n" }),
          },
        };
        return;
      }
      yield { type: "text_delta", text: "The requested edit was not applied." };
    });
    const provider: ModelProvider = {
      id: "test-provider",
      type: "openai-compatible",
      capabilities,
      chat,
    };
    const loop = AgentLoop.initialize(
      cwd,
      createConfig(),
      provider,
      "try one edit",
      { ...interaction, askApproval: async () => false },
      { disableStatusBar: true, nonInteractive: true },
    );

    const outcome = await loop.run();

    expect(outcome).toMatchObject({ status: "completed", attempts: 2 });
    expect(callCount).toBe(2);
    expect(existsSync(target)).toBe(false);
    expect(output.join("\n")).not.toContain("Completion gate");
  });
});
