import type { OrbitConfig } from "@orbit-build/config";
import {
  DynamicMCPTool,
  MCPClient,
  McpResourceTool,
  StreamableHttpMCPClient,
  createMcpToolName,
  createMcpTokenStore,
  type MCPInteractionHandlers,
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
  interactions?: MCPInteractionHandlers,
) => McpRuntimeClient;

export interface McpRuntimeManagerOptions {
  interactions?: MCPInteractionHandlers;
}

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
  unsubscribeElicitationComplete?: () => void;
  unsubscribeRootsListChanged?: () => void;
  recoveryAttempts: number[];
  recoveryAbortController: AbortController;
  recoveryPromise?: Promise<void>;
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
  private readonly createClient: McpRuntimeClientFactory;

  public constructor(
    private readonly registry: ToolRegistry,
    createClient?: McpRuntimeClientFactory,
    private readonly options: McpRuntimeManagerOptions = {},
  ) {
    this.createClient =
      createClient ??
      ((serverName, serverConfig, interactions) => {
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
            interactions,
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
          interactions,
        );
      });
  }

  private interactionHandlersFor(
    serverName: string,
    serverConfig: McpServers[string],
  ): MCPInteractionHandlers | undefined {
    const handlers = this.options.interactions;
    if (!handlers) return undefined;
    const policy = serverConfig.interactions ?? {
      elicitation: true,
      sampling: true,
      roots: true,
    };
    return {
      ...(handlers.onElicitation && policy.elicitation
        ? {
            onElicitation: (request, signal) =>
              handlers.onElicitation!({ ...request, serverName }, signal),
          }
        : {}),
      ...(handlers.onSampling && policy.sampling
        ? {
            onSampling: (request, signal) =>
              handlers.onSampling!({ ...request, serverName }, signal),
          }
        : {}),
      ...(handlers.onRootsList && policy.roots
        ? {
            onRootsList: (request, signal) =>
              handlers.onRootsList!({ ...request, serverName }, signal),
          }
        : {}),
    };
  }

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
      let runtime: McpServerRuntime | undefined;
      const registeredForClient: string[] = [];
      try {
        client = this.createClient(
          serverName,
          serverConfig,
          this.interactionHandlersFor(serverName, serverConfig),
        );
        runtime = {
          serverName,
          config: serverConfig,
          client,
          report,
          toolNames: new Set(),
          recoveryAttempts: [],
          recoveryAbortController: new AbortController(),
        };
        const toolClient = this.createResilientClient(runtime);
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
            toolClient,
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
          toolClient,
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
        runtime.toolNames = new Set(registeredForClient);
        runtime.unsubscribeCatalog = client.onCatalogChanged?.((kinds) => {
          this.scheduleCatalogRefresh(serverName, kinds);
        });
        runtime.unsubscribeElicitationComplete = client.onElicitationComplete?.(
          (elicitationId) => {
            report(
              `  ● MCP server "${serverName}" completed URL elicitation "${elicitationId}"; retry the paused operation when ready.`,
            );
          },
        );
        runtime.unsubscribeRootsListChanged = client.onRootsListChanged?.(
          () => {
            report(
              `  ● MCP server "${serverName}" requested a roots refresh; Orbit will re-evaluate the permitted workspace root on the next interaction.`,
            );
          },
        );
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
        runtime?.recoveryAbortController.abort();
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

  /** Give dynamic tools bounded, non-replaying recovery for crashed stdio servers. */
  private createResilientClient(runtime: McpServerRuntime): McpRuntimeClient {
    const base = runtime.client;
    const call = async <T>(
      operation: () => Promise<T>,
      abortSignal?: AbortSignal,
      toolName?: string,
    ): Promise<T> => {
      await this.ensureConnected(runtime, abortSignal, toolName);
      try {
        return await operation();
      } catch (error: unknown) {
        this.noteDisconnected(runtime, error);
        // A tool call may have had side effects before a transport failure;
        // recover the session for the next explicit attempt, but never replay
        // an ambiguous call automatically.
        throw error;
      }
    };
    return {
      start: () => base.start(),
      stop: () => base.stop(),
      callTool: (name, args, signal) =>
        call(() => base.callTool(name, args, signal), signal, name),
      ...(base.callToolTask
        ? {
            callToolTask: (
              name: string,
              args: Record<string, unknown>,
              options?: { ttl?: number; abortSignal?: AbortSignal },
            ) =>
              call(
                () => base.callToolTask!(name, args, options),
                options?.abortSignal,
                name,
              ),
          }
        : {}),
      ...(base.getServerCapabilities
        ? { getServerCapabilities: () => base.getServerCapabilities!() }
        : {}),
      ...(base.getNegotiatedProtocol
        ? { getNegotiatedProtocol: () => base.getNegotiatedProtocol!() }
        : {}),
      ...(base.getProtocolWarnings
        ? { getProtocolWarnings: () => base.getProtocolWarnings!() }
        : {}),
      listTools: (signal) => base.listTools?.(signal) ?? Promise.resolve([]),
      ...(base.getRuntimeHealth
        ? { getRuntimeHealth: () => base.getRuntimeHealth!() }
        : {}),
      listResources: (signal) =>
        base.listResources?.(signal) ?? Promise.resolve([]),
      listResourceTemplates: (signal) =>
        base.listResourceTemplates?.(signal) ?? Promise.resolve([]),
      readResource: (uri, signal) =>
        call(
          () =>
            base.readResource?.(uri, signal) ??
            Promise.reject(new Error("MCP resource support is unavailable.")),
          signal,
          "read_resource",
        ),
      listPrompts: (signal) =>
        base.listPrompts?.(signal) ?? Promise.resolve([]),
      getPrompt: (name, args, signal) =>
        base.getPrompt?.(name, args, signal) ??
        Promise.reject(new Error("MCP prompt support is unavailable.")),
    };
  }

  private async ensureConnected(
    runtime: McpServerRuntime,
    abortSignal?: AbortSignal,
    toolName?: string,
  ): Promise<void> {
    if (runtime.client.getRuntimeHealth?.().connected ?? true) return;
    const recovery = runtime.config.recovery ?? {
      enabled: true,
      maxAttempts: 3,
      windowMs: 60_000,
      initialBackoffMs: 250,
      maxBackoffMs: 4_000,
    };
    if (runtime.config.transport !== "stdio" || !recovery.enabled) {
      throw new Error(
        `MCP server "${runtime.serverName}" is disconnected; automatic recovery is disabled.`,
      );
    }
    if (runtime.recoveryPromise) {
      await runtime.recoveryPromise;
      return;
    }
    const promise = this.recoverRuntime(
      runtime,
      recovery,
      abortSignal,
      toolName,
    );
    runtime.recoveryPromise = promise;
    try {
      await promise;
    } finally {
      if (runtime.recoveryPromise === promise)
        runtime.recoveryPromise = undefined;
    }
  }

  private async recoverRuntime(
    runtime: McpServerRuntime,
    recovery: {
      enabled: boolean;
      maxAttempts: number;
      windowMs: number;
      initialBackoffMs: number;
      maxBackoffMs: number;
    },
    abortSignal?: AbortSignal,
    toolName?: string,
  ): Promise<void> {
    const now = Date.now();
    runtime.recoveryAttempts = runtime.recoveryAttempts.filter(
      (timestamp) => now - timestamp < recovery.windowMs,
    );
    if (runtime.recoveryAttempts.length >= recovery.maxAttempts) {
      this.markRecoveryFailure(
        runtime,
        `Automatic MCP recovery paused after ${recovery.maxAttempts} attempts in ${recovery.windowMs}ms. Restart the session or inspect the server before retrying${toolName ? ` ${toolName}` : ""}.`,
      );
      throw new Error(
        `MCP server "${runtime.serverName}" exceeded its automatic recovery budget.`,
      );
    }
    const attempt = runtime.recoveryAttempts.length;
    const delay = Math.min(
      recovery.maxBackoffMs,
      recovery.initialBackoffMs * 2 ** attempt,
    );
    await waitForRecoveryDelay(
      delay,
      abortSignal,
      runtime.recoveryAbortController.signal,
    );
    runtime.recoveryAttempts.push(Date.now());
    runtime.report(
      `  ● Recovering MCP server "${runtime.serverName}" (attempt ${attempt + 1}/${recovery.maxAttempts})...`,
    );
    try {
      if (!runtime.client.reconnect) {
        throw new Error("The MCP transport does not support reconnect.");
      }
      const definitions = await runtime.client.reconnect();
      if (runtime.client.getServerCapabilities?.().tools) {
        await this.refreshTools(runtime, definitions);
      }
      const health = runtime.client.getRuntimeHealth?.();
      this.healthByServer.set(runtime.serverName, {
        ...(this.healthByServer.get(runtime.serverName) ?? {
          serverName: runtime.serverName,
          registeredTools: runtime.toolNames.size,
          recoveryCount: 0,
        }),
        status: "healthy",
        connected: health?.connected ?? true,
        registeredTools: runtime.toolNames.size,
        recoveryCount: health?.recoveryCount ?? 0,
        lastRefreshAt: new Date().toISOString(),
        lastError: undefined,
      });
      runtime.report(`  ✔ Recovered MCP server "${runtime.serverName}".`);
    } catch (error: unknown) {
      const message = safeMcpRuntimeMessage(error);
      this.markRecoveryFailure(runtime, message);
      runtime.report(
        `  ⚠️ MCP recovery failed for "${runtime.serverName}": ${message}`,
      );
      throw error;
    }
  }

  private noteDisconnected(runtime: McpServerRuntime, error: unknown): void {
    if (runtime.client.getRuntimeHealth?.().connected ?? true) return;
    this.markRecoveryFailure(runtime, safeMcpRuntimeMessage(error));
    if (
      runtime.config.recovery?.enabled !== false &&
      !runtime.recoveryPromise
    ) {
      void this.ensureConnected(runtime).catch(() => undefined);
    }
  }

  private markRecoveryFailure(
    runtime: McpServerRuntime,
    message: string,
  ): void {
    const current = this.healthByServer.get(runtime.serverName);
    this.healthByServer.set(runtime.serverName, {
      ...(current ?? {
        serverName: runtime.serverName,
        registeredTools: runtime.toolNames.size,
        recoveryCount: runtime.client.getRuntimeHealth?.().recoveryCount ?? 0,
      }),
      status: "degraded",
      connected: false,
      registeredTools: runtime.toolNames.size,
      recoveryCount: runtime.client.getRuntimeHealth?.().recoveryCount ?? 0,
      lastError: safeMcpRuntimeMessage(message),
    });
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
    const runtimes = [...this.runtimes.values()];
    for (const runtime of runtimes) {
      runtime.recoveryAbortController.abort();
      runtime.unsubscribeCatalog?.();
      runtime.unsubscribeElicitationComplete?.();
      runtime.unsubscribeRootsListChanged?.();
    }
    await Promise.allSettled(
      runtimes.flatMap((runtime) =>
        runtime.recoveryPromise ? [runtime.recoveryPromise] : [],
      ),
    );
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
      const initialHealth = runtime.client.getRuntimeHealth?.();
      if (initialHealth && !initialHealth.connected) {
        await this.ensureConnected(runtime);
      }
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
        this.createResilientClient(runtime),
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
        this.createResilientClient(runtime),
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

function waitForRecoveryDelay(
  delayMs: number,
  callerSignal: AbortSignal | undefined,
  managerSignal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onAbort);
      managerSignal.removeEventListener("abort", onAbort);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("MCP recovery was cancelled."));
    };
    const timer = setTimeout(finish, Math.max(1, delayMs));
    timer.unref?.();
    callerSignal?.addEventListener("abort", onAbort, { once: true });
    managerSignal.addEventListener("abort", onAbort, { once: true });
    if (callerSignal?.aborted || managerSignal.aborted) onAbort();
  });
}
