import type { OrbitConfig } from "@orbit-build/config";
import {
  DynamicMCPTool,
  MCPClient,
  McpResourceTool,
  StreamableHttpMCPClient,
  createMcpTokenStore,
  type MCPPrompt,
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
    for (const [toolName, tool] of this.registeredTools) {
      this.registry.unregister(toolName, tool);
    }
    this.registeredTools.clear();
    this.promptsByServer.clear();

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
    if (!prompts.length) return;
    this.promptsByServer.set(serverName, { client, prompts });
    report(
      `  ✔ Discovered ${prompts.length} MCP prompt${prompts.length === 1 ? "" : "s"} on "${serverName}"`,
    );
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
