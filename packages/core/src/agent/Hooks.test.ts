import { afterEach, describe, it, expect, vi } from "vitest";
import { AgentLoop } from "./AgentLoop.js";
import { DEFAULT_CONFIG, type OrbitConfig } from "@orbit-build/config";
import { ModelProvider } from "@orbit-build/model-providers";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const loops: AgentLoop[] = [];
const workspaces: string[] = [];
const processTestRoot = join(process.cwd(), "rag-test-temp");
const dummyProvider: ModelProvider = {
  id: "openai",
  chat: () => {
    throw new Error("Not implemented");
  },
} as ModelProvider;
const dummyInteraction = {
  askApproval: async () => true,
  showText: () => {},
  showDiff: () => {},
};

afterEach(async () => {
  delete process.env.FAIL;
  await Promise.allSettled(loops.splice(0).map((loop) => loop.dispose()));
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, {
      recursive: true,
      force: true,
      maxRetries: process.platform === "win32" ? 10 : 0,
      retryDelay: 100,
    });
  }
});

describe("AgentLoop Hooks System", () => {
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
        // Windows process startup can exceed one second when the full suite is
        // compiling and running workers in parallel.
        timeoutMs: 5000,
      },
      webSearch: { ...DEFAULT_CONFIG.tools.webSearch, enabled: false },
      mcp: { ...DEFAULT_CONFIG.tools.mcp, enabled: false },
    },
    mcpServers: {},
    hooks: {
      preEdit:
        "node -e \"if (process.env.FAIL === 'true') process.exit(1); console.log('pre-ok')\"",
      postEdit:
        "node -e \"if (process.env.FAIL_POST === 'true') process.exit(1); console.log('post-ok')\"",
    },
    session: { store: "jsonl", path: ".orbit/test-sessions" },
  };

  it("should run preEdit and postEdit hooks successfully", async () => {
    const loop = createLoop(dummyConfig, dummyInteraction);

    // Test runHook helper directly
    const resPre = await (loop as any).runHook(
      dummyConfig.hooks.preEdit!,
      "dummy.txt",
    );
    expect(resPre.ok).toBe(true);
    expect(resPre.output).toBe("pre-ok");

    // Full Access hooks inherit the parent process environment consistently
    // with shell tools and Agent-owned verification commands.
    process.env.FAIL = "true";
    try {
      const inherited = await (loop as any).runHook(
        "node -e \"if (process.env.FAIL) process.exit(9); console.log('isolated')\"",
        "dummy.txt",
      );
      expect(inherited.ok).toBe(false);

      const normalLoop = createLoop(
        {
          ...dummyConfig,
          permissions: {
            ...dummyConfig.permissions,
            mode: "normal",
            requireApprovalForBash: false,
          },
        },
        dummyInteraction,
      );
      const isolated = await (normalLoop as any).runHook(
        "node -e \"if (process.env.FAIL) process.exit(9); console.log('isolated')\"",
        "dummy.txt",
      );
      expect(isolated.ok).toBe(true);
      expect(isolated.output).toBe("isolated");
    } finally {
      delete process.env.FAIL;
    }
  });

  it("should expose the target path through ORBIT_FILE", async () => {
    const loop = createLoop(dummyConfig, dummyInteraction);
    const hookWithFile = 'node -e "console.log(process.env.ORBIT_FILE)"';
    const res = await (loop as any).runHook(
      hookWithFile,
      "dummy-test-file.txt",
    );
    expect(res.ok).toBe(true);
    expect(res.output).toContain("dummy-test-file.txt");
  });

  it("routes hook execution through the shared permission policy", async () => {
    const interaction = {
      ...dummyInteraction,
      askApproval: vi.fn(async () => true),
    };
    const loop = createLoop(
      {
        ...dummyConfig,
        permissions: { ...dummyConfig.permissions, mode: "plan" },
      },
      interaction,
    );

    const result = await (loop as any).runHook(
      "node -e \"console.log('must-not-run')\"",
      "dummy.txt",
    );

    expect(result.ok).toBe(false);
    expect(result.output).toContain("blocked under plan mode");
    expect(interaction.askApproval).not.toHaveBeenCalled();
  });

  it("runs typed lifecycle hooks with metadata and failure policy", async () => {
    const output: string[] = [];
    const loop = createLoop(
      {
        ...dummyConfig,
        hooks: {
          lifecycle: {
            preToolUse: [
              {
                command:
                  "node -e \"console.log(process.env.ORBIT_HOOK_EVENT + ':' + process.env.ORBIT_TOOL_NAME)\"",
                matcher: "write_*",
                timeoutMs: 5_000,
                onFailure: "block",
              },
            ],
            postToolFailure: [
              {
                command: 'node -e "process.exit(7)"',
                timeoutMs: 5_000,
                onFailure: "warn",
              },
            ],
          },
        },
      },
      { ...dummyInteraction, showText: (text: string) => output.push(text) },
    );

    await expect(
      (loop as any).runLifecycleHooks("preToolUse", {
        sessionId: loop.getSessionId(),
        toolName: "write_file",
        filePath: "src/index.ts",
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      (loop as any).runLifecycleHooks("postToolFailure", {
        sessionId: loop.getSessionId(),
        toolName: "bash",
        status: "failure",
      }),
    ).resolves.toEqual({ ok: true });
    expect(output.join("\n")).toContain("preToolUse hook passed");
    expect(output.join("\n")).toContain("postToolFailure hook warning");
  });

  it("allows bounded stop cleanup after the active turn was cancelled", async () => {
    const output: string[] = [];
    const loop = createLoop(
      {
        ...dummyConfig,
        hooks: {
          lifecycle: {
            stop: [
              {
                command: "node -e \"console.log('cleanup-complete')\"",
                timeoutMs: 5_000,
                onFailure: "block",
              },
            ],
          },
        },
      },
      { ...dummyInteraction, showText: (text: string) => output.push(text) },
    );
    const controller = new AbortController();
    controller.abort();
    (loop as any).abortController = controller;

    await expect(
      (loop as any).runLifecycleHooks("stop", {
        sessionId: loop.getSessionId(),
        status: "aborted",
      }),
    ).resolves.toEqual({ ok: true });
    expect(output.join("\n")).toContain("stop hook passed");
  });

  it.runIf(process.platform === "win32")(
    "fails closed for extension hooks when Windows has no native sandbox",
    async () => {
      const extensionRoot = mkdtempSync(
        join(tmpdir(), "orbit-hook-extension-"),
      );
      try {
        const loop = createLoop(dummyConfig, dummyInteraction);
        const result = await (loop as any).runHookCommand(
          "node -e \"console.log('must-not-run')\"",
          { ORBIT_HOOK_EVENT: "sessionStart" },
          5_000,
          true,
          { id: "com.example.review", root: extensionRoot },
        );
        expect(result.ok).toBe(false);
        expect(result.output).toContain(
          "Required process sandbox is unavailable",
        );
        expect(result.output).not.toContain("must-not-run");
      } finally {
        rmSync(extensionRoot, { recursive: true, force: true });
      }
    },
  );
});

function createLoop(
  config: OrbitConfig,
  interaction: typeof dummyInteraction,
): AgentLoop {
  mkdirSync(processTestRoot, { recursive: true });
  const workspace = mkdtempSync(join(processTestRoot, "hooks-workspace-"));
  workspaces.push(workspace);
  const loop = AgentLoop.initialize(
    workspace,
    config,
    dummyProvider,
    "test task",
    interaction,
  );
  loops.push(loop);
  return loop;
}
