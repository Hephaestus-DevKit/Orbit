import type { OrbitConfig } from "@orbit-build/config";
import {
  DynamicMCPTool,
  MCPClient,
  McpResourceTool,
  StreamableHttpMCPClient,
  createMcpToolName,
  createMcpTokenStore,
  type MCPPrompt,
  type McpCatalogKind,
  type MCPToolClient,
  type MCPToolDefinition,
} from "@orbit-build/mcp";
import type { OrbitTool, ToolRegistry } from "@orbit-build/tools";
import { redactSecrets } from "@orbit-build/shared";

type McpServers = OrbitConfig["mcpServers"];

export interface McpRuntimeClient extends MCPToolClient {
  start(): Promise<MCPToolDefinition[]>;
  stop(): ReturnType<MCPClient["stop"]>;
}

export type McpRuntimeClientFactory = (
  serverName: string,
  serverConfig: McpServers[string],
) => McpRuntimeClient;

export interface McpRuntimeStartResult {
  startedServers: number;
  registeredTools: number;
  failures: Array<{ serverName: string; message: string }>;
}

export interface McpPromptDescriptor {
  serverName: string;
  prompt: MCPPrompt;
}

export interface McpServerHealth {
  serverName: string;
  status: "healthy" | "refreshing" | "degraded" | "failed";
  connected: boolean;
  registeredTools: number;
  recoveryCount: number;
  protocol?: string;
  lastRefreshAt?: string;
  lastError?: string;
}

interface McpServerRuntime {
  serverName: string;
  config: McpServers[string];
  client: McpRuntimeClient;
  report: (message: string) => void;
  toolNames: Set<string>;
  unsubscribeCatalog?: () => void;
}

/** Owns MCP server processes and their temporary dynamic tool registrations. */
export class McpRuntimeManager {
  private readonly clients: McpRuntimeClient[] = [];
  private readonly registeredTools = new Map<
    string,
    OrbitTool<unknown, unknown>
  >();
  private readonly promptsByServer = new Map<
    string,
    { client: McpRuntimeClient; prompts: MCPPrompt[] }
  >();
  private readonly runtimes = new Map<string, McpServerRuntime>();
  private readonly healthByServer = new Map<string, McpServerHealth>();
  private readonly pendingRefreshKinds = new Map<string, Set<McpCatalogKind>>();
  private readonly refreshTimers = new Map<string, NodeJS.Timeout>();

  public constructor(
    private readonly registry: ToolRegistry,
    private readonly createClient: McpRuntimeClientFactory = (
      serverName,
      serverConfig,
    ) => {
      if (serverConfig.transport === "streamable-http") {
        if (!serverConfig.url) {
          throw new Error(
            `MCP server "${serverName}" requires a URL for streamable-http transport.`,
          );
        }
        return new StreamableHttpMCPClient(serverName, serverConfig.url, {
          headers: serverConfig.headers,
          bearerTokenEnv: serverConfig.bearerTokenEnv,
          oauth: serverConfig.oauth,
          tokenStore:
            serverConfig.oauth?.mode === "authorization_code"
              ? createMcpTokenStore(serverName)
              : undefined,
          requestTimeoutMs: serverConfig.requestTimeoutMs,
        });
      }
      if (!serverConfig.command) {
        throw new Error(
          `MCP server "${serverName}" requires a command for stdio transport.`,
        );
      }
      return new MCPClient(
        serverName,
        serverConfig.command,
        serverConfig.args ?? [],
        serverConfig.env ?? {},
        serverConfig.inheritEnv ?? [],
        undefined,
        serverConfig.requestTimeoutMs,
      );
    },
  ) {}

  public async start(
    servers: McpServers,
    report: (message: string) => void,
  ): Promise<McpRuntimeStartResult> {
    await this.stop();
    const result: McpRuntimeStartResult = {
      startedServers: 0,
      registeredTools: 0,
      failures: [],
    };

    for (const [serverName, serverConfig] of Object.entries(servers)) {
      let client: McpRuntimeClient | undefined;
      const registeredForClient: string[] = [];
      try {
        client = this.createClient(serverName, serverConfig);
        const tools = await client.start();
        const protocol = client.getNegotiatedProtocol?.();
        if (protocol) {
          report(
            `  ● MCP server "${serverName}" negotiated ${protocol.version} (${protocol.era})`,
          );
        }
        for (const warning of client.getProtocolWarnings?.() ?? []) {
          report(`  ⚠️ ${warning}`);
        }

        for (const toolDefinition of tools) {
          const risk =
            serverConfig.tools?.[toolDefinition.name]?.risk ?? "execute";
          const dynamicTool = new DynamicMCPTool(
            serverName,
            toolDefinition,
            risk,
            client,
          );
          if (this.registry.get(dynamicTool.name)) {
            throw new Error(
              `MCP tool name collision after normalization: "${dynamicTool.name}". Rename the server or remote tool.`,
            );
          }
          this.registry.register(dynamicTool);
          this.registeredTools.set(dynamicTool.name, dynamicTool);
          registeredForClient.push(dynamicTool.name);
          result.registeredTools += 1;
          report(`  ✔ Registered MCP tool: ${dynamicTool.name} (${risk})`);
        }
        await this.registerResourceTool(
          serverName,
          serverConfig,
          client,
          registeredForClient,
          result,
          report,
        );
        await this.captureServerPrompts(
          serverName,
          serverConfig,
          client,
          report,
        );
        this.clients.push(client);
        const runtime: McpServerRuntime = {
          serverName,
          config: serverConfig,
          client,
          report,
          toolNames: new Set(registeredForClient),
        };
        runtime.unsubscribeCatalog = client.onCatalogChanged?.((kinds) => {
          this.scheduleCatalogRefresh(serverName, kinds);
        });
        this.runtimes.set(serverName, runtime);
        const runtimeHealth = client.getRuntimeHealth?.();
        this.healthByServer.set(serverName, {
          serverName,
          status: "healthy",
          connected: runtimeHealth?.connected ?? true,
          registeredTools: runtime.toolNames.size,
          recoveryCount: runtimeHealth?.recoveryCount ?? 0,
          ...(protocol ? { protocol: protocol.version } : {}),
          lastRefreshAt: new Date().toISOString(),
        });
        result.startedServers += 1;
      } catch (error: unknown) {
        for (const toolName of registeredForClient) {
          this.registry.unregister(
            toolName,
            this.registeredTools.get(toolName),
          );
          this.registeredTools.delete(toolName);
          result.registeredTools -= 1;
        }
        this.promptsByServer.delete(serverName);
        await client?.stop().catch(() => undefined);
        const message = safeMcpRuntimeMessage(error);
        this.healthByServer.set(serverName, {
          serverName,
          status: "failed",
          connected: false,
          registeredTools: 0,
          recoveryCount: 0,
          lastError: message,
        });
        result.failures.push({ serverName, message });
        report(`  ✖ Failed to start MCP server "${serverName}": ${message}`);
      }
    }

    return result;
  }

  /** All prompts discovered on started servers, for slash-command surfaces. */
  public listPrompts(): McpPromptDescriptor[] {
    const descriptors: McpPromptDescriptor[] = [];
    for (const [serverName, entry] of this.promptsByServer) {
      for (const prompt of entry.prompts) {
        descriptors.push({ serverName, prompt });
      }
    }
    return descriptors;
  }

  /** Return a stable, credential-redacted snapshot for doctor and UI surfaces. */
  public listHealth(): McpServerHealth[] {
    return [...this.healthByServer.values()]
      .map((health) => {
        const runtimeHealth = this.runtimes
          .get(health.serverName)
          ?.client.getRuntimeHealth?.();
        return {
          ...health,
          status:
            runtimeHealth && !runtimeHealth.connected
              ? "degraded"
              : health.status,
          connected: runtimeHealth?.connected ?? health.connected,
          recoveryCount: runtimeHealth?.recoveryCount ?? health.recoveryCount,
          ...(runtimeHealth?.lastError
            ? { lastError: safeMcpRuntimeMessage(runtimeHealth.lastError) }
            : {}),
        };
      })
      .sort((left, right) => left.serverName.localeCompare(right.serverName));
  }

  /** Refresh live catalogs without restarting healthy MCP processes. */
  public async refreshCatalogs(
    serverName?: string,
  ): Promise<McpServerHealth[]> {
    const runtimes = serverName
      ? [this.runtimes.get(serverName)].filter(
          (runtime): runtime is McpServerRuntime => Boolean(runtime),
        )
      : [...this.runtimes.values()];
    await Promise.all(
      runtimes.map((runtime) =>
        this.refreshServerCatalog(runtime, ["tools", "resources", "prompts"]),
      ),
    );
    return this.listHealth();
  }

  /** Resolve one discovered prompt into expanded prompt text. */
  public async expandPrompt(
    serverName: string,
    promptName: string,
    args?: Record<string, string>,
  ): Promise<string> {
    const entry = this.promptsByServer.get(serverName);
    const prompt = entry?.prompts.find((item) => item.name === promptName);
    if (!entry || !prompt || !entry.client.getPrompt) {
      throw new Error(
        `Unknown MCP prompt "${promptName}" on server "${serverName}".`,
      );
    }
    return entry.client.getPrompt(prompt.name, args);
  }

  public async stop(): Promise<void> {
    for (const timer of this.refreshTimers.values()) clearTimeout(timer);
    this.refreshTimers.clear();
    this.pendingRefreshKinds.clear();
    for (const runtime of this.runtimes.values()) {
      runtime.unsubscribeCatalog?.();
    }
    this.runtimes.clear();
    for (const [toolName, tool] of this.registeredTools) {
      this.registry.unregister(toolName, tool);
    }
    this.registeredTools.clear();
    this.promptsByServer.clear();
    this.healthByServer.clear();

    const clients = this.clients.splice(0);
    await Promise.allSettled(clients.map((client) => client.stop()));
  }

  private async registerResourceTool(
    serverName: string,
    serverConfig: McpServers[string],
    client: McpRuntimeClient,
    registeredForClient: string[],
    result: McpRuntimeStartResult,
    report: (message: string) => void,
  ): Promise<void> {
    if (serverConfig.resources?.enabled === false) return;
    if (!client.getServerCapabilities?.().resources || !client.listResources) {
      return;
    }
    const [resources, resourceTemplates] = await Promise.all([
      client.listResources(),
      client.listResourceTemplates?.() ?? Promise.resolve([]),
    ]);
    const resourceTool = new McpResourceTool(
      serverName,
      resources,
      client,
      resourceTemplates,
    );
    if (this.registry.get(resourceTool.name)) {
      throw new Error(
        `MCP tool name collision after normalization: "${resourceTool.name}". Rename the server or remote tool.`,
      );
    }
    this.registry.register(resourceTool);
    this.registeredTools.set(resourceTool.name, resourceTool);
    registeredForClient.push(resourceTool.name);
    result.registeredTools += 1;
    report(
      `  ✔ Registered MCP resource reader: ${resourceTool.name} (${resources.length} resources, ${resourceTemplates.length} templates)`,
    );
  }

  private async captureServerPrompts(
    serverName: string,
    serverConfig: McpServers[string],
    client: McpRuntimeClient,
    report: (message: string) => void,
  ): Promise<void> {
    if (serverConfig.prompts?.enabled === false) return;
    if (!client.getServerCapabilities?.().prompts || !client.listPrompts) {
      return;
    }
    const prompts = await client.listPrompts();
    this.promptsByServer.delete(serverName);
    if (!prompts.length) return;
    this.promptsByServer.set(serverName, { client, prompts });
    report(
      `  ✔ Discovered ${prompts.length} MCP prompt${prompts.length === 1 ? "" : "s"} on "${serverName}"`,
    );
  }

  private scheduleCatalogRefresh(
    serverName: string,
    kinds: McpCatalogKind[],
  ): void {
    const runtime = this.runtimes.get(serverName);
    if (!runtime) return;
    const pending = this.pendingRefreshKinds.get(serverName) ?? new Set();
    for (const kind of kinds) pending.add(kind);
    this.pendingRefreshKinds.set(serverName, pending);
    if (this.refreshTimers.has(serverName)) return;
    const timer = setTimeout(() => {
      this.refreshTimers.delete(serverName);
      const nextKinds = [
        ...(this.pendingRefreshKinds.get(serverName) ?? new Set()),
      ];
      this.pendingRefreshKinds.delete(serverName);
      void this.refreshServerCatalog(runtime, nextKinds);
    }, 100);
    timer.unref?.();
    this.refreshTimers.set(serverName, timer);
  }

  private async refreshServerCatalog(
    runtime: McpServerRuntime,
    kinds: McpCatalogKind[],
  ): Promise<void> {
    const current = this.healthByServer.get(runtime.serverName);
    this.healthByServer.set(runtime.serverName, {
      ...(current ?? {
        serverName: runtime.serverName,
        connected: true,
        registeredTools: runtime.toolNames.size,
        recoveryCount: 0,
      }),
      status: "refreshing",
    });
    try {
      if (kinds.includes("tools") && runtime.client.listTools) {
        await this.refreshTools(runtime, await runtime.client.listTools());
      }
      if (kinds.includes("resources")) {
        await this.refreshResourceTool(runtime);
      }
      if (kinds.includes("prompts")) {
        await this.captureServerPrompts(
          runtime.serverName,
          runtime.config,
          runtime.client,
          runtime.report,
        );
      }
      const runtimeHealth = runtime.client.getRuntimeHealth?.();
      this.healthByServer.set(runtime.serverName, {
        serverName: runtime.serverName,
        status: "healthy",
        connected: runtimeHealth?.connected ?? true,
        registeredTools: runtime.toolNames.size,
        recoveryCount: runtimeHealth?.recoveryCount ?? 0,
        ...(runtime.client.getNegotiatedProtocol?.()?.version
          ? { protocol: runtime.client.getNegotiatedProtocol?.()?.version }
          : {}),
        lastRefreshAt: new Date().toISOString(),
      });
      runtime.report(
        `  ✔ Refreshed MCP catalog for "${runtime.serverName}" (${kinds.join(", ")})`,
      );
    } catch (error: unknown) {
      const message = safeMcpRuntimeMessage(error);
      const runtimeHealth = runtime.client.getRuntimeHealth?.();
      this.healthByServer.set(runtime.serverName, {
        serverName: runtime.serverName,
        status: "degraded",
        connected: runtimeHealth?.connected ?? true,
        registeredTools: runtime.toolNames.size,
        recoveryCount: runtimeHealth?.recoveryCount ?? 0,
        ...(current?.protocol ? { protocol: current.protocol } : {}),
        lastRefreshAt: new Date().toISOString(),
        lastError: message,
      });
      runtime.report(
        `  ⚠️ MCP catalog refresh failed for "${runtime.serverName}": ${message}`,
      );
    }
  }

  private async refreshTools(
    runtime: McpServerRuntime,
    definitions: MCPToolDefinition[],
  ): Promise<void> {
    const resourceToolName = createMcpToolName(
      runtime.serverName,
      "read_resource",
    );
    const oldNames = [...runtime.toolNames].filter(
      (name) => name !== resourceToolName,
    );
    const oldTools = new Map(
      oldNames.flatMap((name) => {
        const tool = this.registeredTools.get(name);
        return tool ? [[name, tool] as const] : [];
      }),
    );
    const replacements = definitions.map((definition) => {
      const risk = runtime.config.tools?.[definition.name]?.risk ?? "execute";
      return new DynamicMCPTool(
        runtime.serverName,
        definition,
        risk,
        runtime.client,
      );
    });
    const replacementNames = new Set<string>();
    for (const tool of replacements) {
      if (replacementNames.has(tool.name)) {
        throw new Error(`MCP refresh produced duplicate tool ${tool.name}.`);
      }
      replacementNames.add(tool.name);
      const collision = this.registry.get(tool.name);
      if (collision && !oldTools.has(tool.name)) {
        throw new Error(`MCP refresh collided with tool ${tool.name}.`);
      }
    }

    for (const [name, tool] of oldTools) {
      this.registry.unregister(name, tool);
      this.registeredTools.delete(name);
      runtime.toolNames.delete(name);
    }
    const registered: Array<OrbitTool<unknown, unknown>> = [];
    try {
      for (const tool of replacements) {
        this.registry.register(tool);
        this.registeredTools.set(tool.name, tool);
        runtime.toolNames.add(tool.name);
        registered.push(tool);
      }
    } catch (error) {
      for (const tool of registered) {
        this.registry.unregister(tool.name, tool);
        this.registeredTools.delete(tool.name);
        runtime.toolNames.delete(tool.name);
      }
      for (const [name, tool] of oldTools) {
        this.registry.register(tool);
        this.registeredTools.set(name, tool);
        runtime.toolNames.add(name);
      }
      throw error;
    }
  }

  private async refreshResourceTool(runtime: McpServerRuntime): Promise<void> {
    const resourceName = createMcpToolName(runtime.serverName, "read_resource");
    const oldTool = this.registeredTools.get(resourceName);
    if (oldTool) {
      this.registry.unregister(resourceName, oldTool);
      this.registeredTools.delete(resourceName);
      runtime.toolNames.delete(resourceName);
    }
    const result: McpRuntimeStartResult = {
      startedServers: 1,
      registeredTools: runtime.toolNames.size,
      failures: [],
    };
    const registered: string[] = [];
    try {
      await this.registerResourceTool(
        runtime.serverName,
        runtime.config,
        runtime.client,
        registered,
        result,
        runtime.report,
      );
      for (const name of registered) runtime.toolNames.add(name);
    } catch (error) {
      if (oldTool) {
        this.registry.register(oldTool);
        this.registeredTools.set(resourceName, oldTool);
        runtime.toolNames.add(resourceName);
      }
      throw error;
    }
  }
}

function safeMcpRuntimeMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return (
    redactSecrets(raw)
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2_000) || "Unknown MCP startup failure."
  );
}
