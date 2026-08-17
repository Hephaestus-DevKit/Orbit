import { describe, expect, it, vi } from "vitest";
import type { OrbitConfig } from "@orbit-build/config";
import { ToolRegistry } from "@orbit-build/tools";
import {
  McpRuntimeManager,
  type McpRuntimeClient,
} from "./McpRuntimeManager.js";
import type { MCPInteractionHandlers } from "@orbit-build/mcp";

function serverConfig(): OrbitConfig["mcpServers"][string] {
  return {
    transport: "stdio",
    command: "example-mcp",
    args: [],
    env: {},
    inheritEnv: [],
    tools: { lookup: { risk: "read" } },
    recovery: {
      enabled: true,
      maxAttempts: 3,
      windowMs: 10_000,
      initialBackoffMs: 25,
      maxBackoffMs: 50,
    },
  };
}

function mockClient(options?: {
  startError?: Error;
  duplicateTools?: boolean;
  state?: { connected: boolean; recoveryCount: number };
}): McpRuntimeClient {
  const state = options?.state ?? { connected: true, recoveryCount: 0 };
  const tools = [
    {
      name: "lookup",
      description: "Look up a value",
      inputSchema: {},
    },
  ];
  return {
    start: vi.fn(async () => {
      if (options?.startError) throw options.startError;
      state.connected = true;
      return options?.duplicateTools ? [...tools, ...tools] : tools;
    }),
    callTool: vi.fn(async () => ({ content: [], isError: false })),
    stop: vi.fn(async () => undefined),
    reconnect: vi.fn(async () => {
      state.connected = true;
      state.recoveryCount += 1;
      return tools;
    }),
    getRuntimeHealth: () => ({
      connected: state.connected,
      recoveryCount: state.recoveryCount,
    }),
  };
}

describe("McpRuntimeManager", () => {
  it("owns dynamic registrations for exactly one runtime", async () => {
    const registry = new ToolRegistry();
    const client = mockClient();
    const report = vi.fn();
    const manager = new McpRuntimeManager(registry, () => client);

    const result = await manager.start({ docs: serverConfig() }, report);

    expect(result).toEqual({
      startedServers: 1,
      registeredTools: 1,
      failures: [],
    });
    expect(registry.get("mcp__docs__lookup")?.risk).toBe("read");
    expect(
      registry
        .getDefinitions()
        .find((tool) => tool.name === "mcp__docs__lookup")?.inputJsonSchema,
    ).toEqual({});
    expect(report).toHaveBeenCalledWith(
      "  ✔ Registered MCP tool: mcp__docs__lookup (read)",
    );

    await manager.stop();

    expect(registry.get("mcp__docs__lookup")).toBeUndefined();
    expect(client.stop).toHaveBeenCalledOnce();
  });

  it("recovers a disconnected stdio server before the next tool call", async () => {
    const registry = new ToolRegistry();
    const state = { connected: true, recoveryCount: 0 };
    const client = mockClient({ state });
    const report = vi.fn();
    const manager = new McpRuntimeManager(registry, () => client);

    await manager.start({ docs: serverConfig() }, report);
    state.connected = false;
    const tool = registry.get("mcp__docs__lookup");
    expect(tool).toBeDefined();

    await expect(
      tool!.execute({}, { cwd: process.cwd(), sessionId: "session-recovery" }),
    ).resolves.toMatchObject({ ok: true });
    expect(client.reconnect).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith('  ✔ Recovered MCP server "docs".');
    await manager.stop();
  });

  it("passes server-attributed interaction handlers to every transport", async () => {
    const registry = new ToolRegistry();
    const client = mockClient();
    let received: MCPInteractionHandlers | undefined;
    const onRootsList = vi.fn(async () => ({ roots: [] }));
    const manager = new McpRuntimeManager(
      registry,
      (_serverName, _config, interactions) => {
        received = interactions;
        return client;
      },
      { interactions: { onRootsList } },
    );

    await manager.start({ docs: serverConfig() }, () => undefined);
    expect(received?.onRootsList).toBeTypeOf("function");
    await received?.onRootsList?.(
      { method: "roots/list", params: {} },
      new AbortController().signal,
    );
    expect(onRootsList).toHaveBeenCalledWith(
      expect.objectContaining({ method: "roots/list", serverName: "docs" }),
      expect.any(AbortSignal),
    );
    await manager.stop();
  });

  it("applies per-server interaction policy before advertising handlers", async () => {
    const registry = new ToolRegistry();
    const client = mockClient();
    let received: MCPInteractionHandlers | undefined;
    const manager = new McpRuntimeManager(
      registry,
      (_serverName, _config, interactions) => {
        received = interactions;
        return client;
      },
      {
        interactions: {
          onElicitation: vi.fn(async () => ({ action: "accept" })),
          onSampling: vi.fn(async () => ({ role: "assistant" })),
          onRootsList: vi.fn(async () => ({ roots: [] })),
        },
      },
    );

    await manager.start(
      {
        docs: {
          ...serverConfig(),
          interactions: { elicitation: false, sampling: true, roots: false },
        },
      },
      () => undefined,
    );
    expect(received?.onElicitation).toBeUndefined();
    expect(received?.onSampling).toBeTypeOf("function");
    expect(received?.onRootsList).toBeUndefined();
    await manager.stop();
  });

  it("isolates failed servers and reports a dense failure", async () => {
    const registry = new ToolRegistry();
    const failedClient = mockClient({ startError: new Error("not installed") });
    const report = vi.fn();
    const manager = new McpRuntimeManager(registry, () => failedClient);

    const result = await manager.start({ broken: serverConfig() }, report);

    expect(result.failures).toEqual([
      { serverName: "broken", message: "not installed" },
    ]);
    expect(result.startedServers).toBe(0);
    expect(failedClient.stop).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith(
      '  ✖ Failed to start MCP server "broken": not installed',
    );
  });

  it("keeps starting other servers when client construction fails", async () => {
    const registry = new ToolRegistry();
    const healthy = mockClient();
    const manager = new McpRuntimeManager(registry, (serverName) => {
      if (serverName === "broken") throw new Error("invalid transport config");
      return healthy;
    });

    const result = await manager.start(
      { broken: serverConfig(), healthy: serverConfig() },
      () => undefined,
    );

    expect(result.startedServers).toBe(1);
    expect(result.failures).toEqual([
      { serverName: "broken", message: "invalid transport config" },
    ]);
    expect(registry.get("mcp__healthy__lookup")).toBeDefined();
    await manager.stop();
  });

  it("redacts credentials from startup failures", async () => {
    const registry = new ToolRegistry();
    const failedClient = mockClient({
      startError: new Error("Authorization: Bearer private-mcp-token"),
    });
    const report = vi.fn();
    const manager = new McpRuntimeManager(registry, () => failedClient);

    const result = await manager.start({ broken: serverConfig() }, report);

    expect(JSON.stringify(result)).not.toContain("private-mcp-token");
    expect(JSON.stringify(report.mock.calls)).not.toContain(
      "private-mcp-token",
    );
  });

  it("restarting removes stale tools and stops previous clients", async () => {
    const registry = new ToolRegistry();
    const first = mockClient();
    const second = mockClient();
    const clients = [first, second];
    const manager = new McpRuntimeManager(registry, () => clients.shift()!);

    await manager.start({ first: serverConfig() }, () => undefined);
    await manager.start({ second: serverConfig() }, () => undefined);

    expect(first.stop).toHaveBeenCalledOnce();
    expect(registry.get("mcp__first__lookup")).toBeUndefined();
    expect(registry.get("mcp__second__lookup")).toBeDefined();
  });

  it("refreshes a live tool catalog transactionally and reports health", async () => {
    const registry = new ToolRegistry();
    const base = mockClient();
    const client: McpRuntimeClient = {
      ...base,
      listTools: vi.fn(async () => [
        {
          name: "search",
          description: "Search current content",
          inputSchema: {},
        },
      ]),
      getRuntimeHealth: () => ({ connected: true, recoveryCount: 2 }),
      getNegotiatedProtocol: () => ({ era: "modern", version: "2026-07-28" }),
    };
    const manager = new McpRuntimeManager(registry, () => client);

    await manager.start({ docs: serverConfig() }, () => undefined);
    const health = await manager.refreshCatalogs("docs");

    expect(registry.get("mcp__docs__lookup")).toBeUndefined();
    expect(registry.get("mcp__docs__search")).toBeDefined();
    expect(health).toEqual([
      expect.objectContaining({
        serverName: "docs",
        status: "healthy",
        connected: true,
        registeredTools: 1,
        recoveryCount: 2,
        protocol: "2026-07-28",
      }),
    ]);
    await manager.stop();
  });

  it("reports a disconnected client as degraded immediately", async () => {
    const registry = new ToolRegistry();
    let connected = true;
    const client: McpRuntimeClient = {
      ...mockClient(),
      getRuntimeHealth: () => ({
        connected,
        recoveryCount: 0,
        ...(connected ? {} : { lastError: "server exited" }),
      }),
    };
    const manager = new McpRuntimeManager(registry, () => client);
    await manager.start({ docs: serverConfig() }, () => undefined);

    connected = false;

    expect(manager.listHealth()).toEqual([
      expect.objectContaining({
        serverName: "docs",
        status: "degraded",
        connected: false,
        lastError: "server exited",
      }),
    ]);
    await manager.stop();
  });

  it("coalesces server notifications into one live catalog refresh", async () => {
    vi.useFakeTimers();
    try {
      const registry = new ToolRegistry();
      let notify:
        | ((kinds: Array<"tools" | "resources" | "prompts">) => void)
        | undefined;
      const listTools = vi.fn(async () => [
        { name: "current", description: "Current tool", inputSchema: {} },
      ]);
      const client: McpRuntimeClient = {
        ...mockClient(),
        listTools,
        onCatalogChanged: (listener) => {
          notify = listener;
          return () => {
            notify = undefined;
          };
        },
      };
      const manager = new McpRuntimeManager(registry, () => client);
      await manager.start({ docs: serverConfig() }, () => undefined);

      notify?.(["tools"]);
      notify?.(["tools"]);
      await vi.advanceTimersByTimeAsync(101);

      expect(listTools).toHaveBeenCalledOnce();
      expect(registry.get("mcp__docs__lookup")).toBeUndefined();
      expect(registry.get("mcp__docs__current")).toBeDefined();
      await manager.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("registers a resource reader and captures prompts when advertised", async () => {
    const registry = new ToolRegistry();
    const base = mockClient();
    const client: McpRuntimeClient = {
      ...base,
      getServerCapabilities: () => ({
        tools: true,
        resources: true,
        prompts: true,
      }),
      listResources: vi.fn(async () => [
        { uri: "docs://readme", name: "README", description: "Intro" },
      ]),
      listResourceTemplates: vi.fn(async () => [
        {
          uriTemplate: "docs://topic/{name}",
          name: "Topic",
          description: "",
        },
      ]),
      readResource: vi.fn(async () => "resource body"),
      listPrompts: vi.fn(async () => [
        {
          name: "summarize",
          description: "Summarize a document",
          arguments: [{ name: "topic", description: "", required: true }],
        },
      ]),
      getPrompt: vi.fn(async (_name, args) => `Summarize ${args?.topic ?? ""}`),
    };
    const report = vi.fn();
    const manager = new McpRuntimeManager(registry, () => client);

    const result = await manager.start({ docs: serverConfig() }, report);

    expect(result.startedServers).toBe(1);
    expect(result.registeredTools).toBe(2);
    expect(registry.get("mcp__docs__read_resource")?.risk).toBe("read");
    expect(registry.get("mcp__docs__read_resource")?.description).toContain(
      "docs://topic/{name}",
    );

    const prompts = manager.listPrompts();
    expect(prompts).toEqual([
      expect.objectContaining({
        serverName: "docs",
        prompt: expect.objectContaining({ name: "summarize" }),
      }),
    ]);
    await expect(
      manager.expandPrompt("docs", "summarize", { topic: "auth" }),
    ).resolves.toBe("Summarize auth");
    await expect(manager.expandPrompt("docs", "missing")).rejects.toThrow(
      /Unknown MCP prompt/,
    );

    await manager.stop();
    expect(registry.get("mcp__docs__read_resource")).toBeUndefined();
    expect(manager.listPrompts()).toEqual([]);
  });

  it("skips resource and prompt discovery when disabled in config", async () => {
    const registry = new ToolRegistry();
    const base = mockClient();
    const listResources = vi.fn(async () => []);
    const listPrompts = vi.fn(async () => []);
    const client: McpRuntimeClient = {
      ...base,
      getServerCapabilities: () => ({
        tools: true,
        resources: true,
        prompts: true,
      }),
      listResources,
      listPrompts,
    };
    const manager = new McpRuntimeManager(registry, () => client);

    const config = {
      ...serverConfig(),
      resources: { enabled: false },
      prompts: { enabled: false },
    };
    await manager.start({ docs: config }, () => undefined);

    expect(listResources).not.toHaveBeenCalled();
    expect(listPrompts).not.toHaveBeenCalled();
    await manager.stop();
  });

  it("rolls back a server when normalized tool names collide", async () => {
    const registry = new ToolRegistry();
    const client = mockClient({ duplicateTools: true });
    const manager = new McpRuntimeManager(registry, () => client);

    const result = await manager.start(
      { docs: serverConfig() },
      () => undefined,
    );

    expect(result.startedServers).toBe(0);
    expect(result.registeredTools).toBe(0);
    expect(result.failures[0]?.message).toContain("tool name collision");
    expect(registry.get("mcp__docs__lookup")).toBeUndefined();
    expect(client.stop).toHaveBeenCalledOnce();
  });
});
