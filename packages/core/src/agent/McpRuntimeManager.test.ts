import { describe, expect, it, vi } from "vitest";
import type { OrbitConfig } from "@orbit-build/config";
import { ToolRegistry } from "@orbit-build/tools";
import {
  McpRuntimeManager,
  type McpRuntimeClient,
} from "./McpRuntimeManager.js";

function serverConfig(): OrbitConfig["mcpServers"][string] {
  return {
    command: "example-mcp",
    args: [],
    env: {},
    inheritEnv: [],
    tools: { lookup: { risk: "read" } },
  };
}

function mockClient(options?: {
  startError?: Error;
  duplicateTools?: boolean;
}): McpRuntimeClient {
  return {
    start: vi.fn(async () => {
      if (options?.startError) throw options.startError;
      const tools = [
        {
          name: "lookup",
          description: "Look up a value",
          inputSchema: {},
        },
      ];
      return options?.duplicateTools ? [...tools, ...tools] : tools;
    }),
    callTool: vi.fn(async () => ({ content: [], isError: false })),
    stop: vi.fn(async () => undefined),
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

  it("registers a resource reader and captures prompts when advertised", async () => {
    const registry = new ToolRegistry();
    const base = mockClient();
    const client: McpRuntimeClient = {
      ...base,
      getServerCapabilities: () => ({ resources: true, prompts: true }),
      listResources: vi.fn(async () => [
        { uri: "docs://readme", name: "README", description: "Intro" },
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
      getServerCapabilities: () => ({ resources: true, prompts: true }),
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
