import { describe, it, expect, vi } from "vitest";
import { AgentLoop } from "./AgentLoop.js";
import { DEFAULT_CONFIG, type OrbitConfig } from "@orbit-build/config";
import { ModelProvider } from "@orbit-build/model-providers";

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

  const dummyProvider: ModelProvider = {
    id: "openai",
    chat: () => {
      throw new Error("Not implemented");
    },
  } as any;

  const dummyInteraction = {
    askApproval: async () => true,
    showText: () => {},
    showDiff: () => {},
  };

  it("should run preEdit and postEdit hooks successfully", async () => {
    const loop = AgentLoop.initialize(
      process.cwd(),
      dummyConfig,
      dummyProvider,
      "test task",
      dummyInteraction,
    );

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

      const normalLoop = AgentLoop.initialize(
        process.cwd(),
        {
          ...dummyConfig,
          permissions: {
            ...dummyConfig.permissions,
            mode: "normal",
            requireApprovalForBash: false,
          },
        },
        dummyProvider,
        "test task",
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
    const loop = AgentLoop.initialize(
      process.cwd(),
      dummyConfig,
      dummyProvider,
      "test task",
      dummyInteraction,
    );
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
    const loop = AgentLoop.initialize(
      process.cwd(),
      {
        ...dummyConfig,
        permissions: { ...dummyConfig.permissions, mode: "plan" },
      },
      dummyProvider,
      "test task",
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
});
