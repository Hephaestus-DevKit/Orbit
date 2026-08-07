import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, type OrbitConfig } from "@orbit-build/config";
import type {
  ModelChatInput,
  ModelProvider,
} from "@orbit-build/model-providers";
import { AgentLoop, type UserInteraction } from "./AgentLoop.js";

/**
 * Offline weak-model regression suite.
 *
 * Local and non-frontier models fail in characteristic ways: they emit tool
 * calls as plain text, repeat identical calls without progress, and hit
 * provider overload. These tests drive the real AgentLoop with a scripted
 * provider that reproduces each behavior and assert the harness carries the
 * task to completion anyway — no API key required.
 */

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
    name: "agent-loop-weak-model-test",
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
      default: "deepseek-v4-pro",
      coder: "deepseek-v4-pro",
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
      autoRepair: false,
      maxFilesToIndex: 10,
    },
    agent: { ...DEFAULT_CONFIG.agent },
    autoCommit: false,
  };
}

function textOf(input: ModelChatInput): string {
  return JSON.stringify(input.messages);
}

describe("AgentLoop weak-model harness regressions", () => {
  let cwd: string;
  let output: string[];
  let interaction: UserInteraction;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-weak-model-"));
    output = [];
    interaction = {
      askApproval: async () => true,
      askToolApproval: async () => true,
      reviewFileChange: async () => true,
      showText: (text) => output.push(text),
      showDiff: () => undefined,
    };
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("recovers a Hermes-style text tool call and actually executes it", async () => {
    writeFileSync(join(cwd, "verification.js"), "export {};\n", "utf8");
    const chat = vi.fn<ModelProvider["chat"]>(async function* (input) {
      if (chat.mock.calls.length === 1) {
        yield {
          type: "text_delta",
          text:
            "I will create the file now.\n<tool_call>\n" +
            '{"name": "write_file", "arguments": {"path": "notes.txt", "content": "harness works"}}\n' +
            "</tool_call>",
        };
        yield { type: "done" };
        return;
      }
      if (chat.mock.calls.length === 2) {
        // The recovered call must have really executed before this turn.
        expect(textOf(input)).toContain("notes.txt");
        yield { type: "text_delta", text: "The file was created." };
        yield { type: "done" };
        return;
      }
      if (chat.mock.calls.length === 3) {
        expect(textOf(input)).toContain("Orbit completion gate");
        const executable = process.execPath.replace(/"/g, '\\"');
        yield {
          type: "tool_call",
          toolCall: {
            id: "call_verify_notes",
            name: "run_tests",
            arguments: JSON.stringify({
              command: `"${executable}" --check verification.js`,
            }),
          },
        };
        yield { type: "done" };
        return;
      }
      yield { type: "text_delta", text: "The file was created." };
      yield { type: "done" };
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
      "create a notes file",
      interaction,
      { disableStatusBar: true },
    );

    const outcome = await loop.run();

    expect(outcome.status).toBe("completed");
    expect(chat).toHaveBeenCalledTimes(4);
    const notesPath = join(cwd, "notes.txt");
    expect(existsSync(notesPath)).toBe(true);
    expect(readFileSync(notesPath, "utf8")).toContain("harness works");
  });

  it("injects a loop-guard nudge after repeated identical failing calls", async () => {
    let sawNudge = false;
    const chat = vi.fn<ModelProvider["chat"]>(async function* (input) {
      const call = chat.mock.calls.length;
      if (call <= 2) {
        yield {
          type: "tool_call",
          toolCall: {
            id: `tc_read_${call}`,
            name: "read_file",
            arguments: JSON.stringify({ path: "missing-file.txt" }),
          },
        };
        yield { type: "done" };
        return;
      }
      sawNudge = textOf(input).includes("[Loop guard]");
      yield { type: "text_delta", text: "I am blocked: the file is absent." };
      yield { type: "done" };
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
      "inspect the missing file",
      interaction,
      { disableStatusBar: true },
    );

    const outcome = await loop.run();

    expect(outcome.status).toBe("completed");
    expect(chat).toHaveBeenCalledTimes(3);
    expect(sawNudge).toBe(true);
    expect(output.join("\n")).toContain("Loop guard");
  });

  it("falls back to the fast lane on overload and recovers to the primary lane", async () => {
    writeFileSync(join(cwd, "data.txt"), "alpha", "utf8");
    writeFileSync(join(cwd, "data2.txt"), "beta", "utf8");
    const modelsSeen: string[] = [];
    const chat = vi.fn<ModelProvider["chat"]>(async function* (input) {
      modelsSeen.push(input.model);
      const call = chat.mock.calls.length;
      if (call === 1) {
        throw new Error("HTTP 503 upstream temporarily unavailable");
      }
      if (call === 2 || call === 3) {
        yield {
          type: "tool_call",
          toolCall: {
            id: `tc_data_${call}`,
            name: "read_file",
            arguments: JSON.stringify({
              path: call === 2 ? "data.txt" : "data2.txt",
            }),
          },
        };
        yield { type: "done" };
        return;
      }
      yield { type: "text_delta", text: "Diagnosis complete." };
      yield { type: "done" };
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
      // "diagnose" routes the request onto the quality lane so the recovery
      // back from the fast lane is observable.
      "diagnose the data files",
      interaction,
      { disableStatusBar: true },
    );

    const outcome = await loop.run();

    expect(outcome.status).toBe("completed");
    expect(modelsSeen).toEqual([
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "deepseek-v4-flash",
      "deepseek-v4-pro",
    ]);
  });
});
