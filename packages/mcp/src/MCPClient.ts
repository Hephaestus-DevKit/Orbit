import { spawn, type ChildProcess } from "child_process";
import { createHash } from "crypto";
import {
  readRuntimePackageVersion,
  redactSecrets,
  type ToolRisk,
} from "@orbit-build/shared";
import {
  type OrbitTool,
  type ToolContext,
  type ToolResult,
} from "@orbit-build/tools";
import { z } from "zod";

const MCP_REQUEST_TIMEOUT_MS = 30_000;
const MCP_STDIO_LINE_LIMIT_BYTES = 8 * 1024 * 1024;
const MCP_STDERR_LIMIT_CHARS = 4_000;

export const MCPToolDefinitionSchema = z.object({
  name: z.string().min(1).max(512),
  description: z.string().max(10_000).default(""),
  inputSchema: z.record(z.unknown()).default({}),
});
export const MCPToolsListSchema = z.object({
  tools: z.array(MCPToolDefinitionSchema).max(10_000).default([]),
});
export const MCPToolCallResultSchema = z
  .object({
    content: z
      .array(
        z
          .object({
            type: z.string().max(100),
            text: z.string().max(MCP_STDIO_LINE_LIMIT_BYTES).optional(),
          })
          .passthrough(),
      )
      .max(10_000)
      .default([]),
    isError: z.boolean().default(false),
  })
  .passthrough();
export const MCPResourceSchema = z
  .object({
    uri: z.string().min(1).max(2_048),
    name: z.string().max(512).default(""),
    description: z.string().max(10_000).default(""),
    mimeType: z.string().max(200).optional(),
  })
  .passthrough();
export const MCPResourcesListSchema = z.object({
  resources: z.array(MCPResourceSchema).max(10_000).default([]),
});
export const MCPResourceReadResultSchema = z.object({
  contents: z
    .array(
      z
        .object({
          uri: z.string().max(2_048).default(""),
          mimeType: z.string().max(200).optional(),
          text: z.string().max(MCP_STDIO_LINE_LIMIT_BYTES).optional(),
          blob: z.string().max(MCP_STDIO_LINE_LIMIT_BYTES).optional(),
        })
        .passthrough(),
    )
    .max(10_000)
    .default([]),
});
export const MCPPromptSchema = z
  .object({
    name: z.string().min(1).max(512),
    description: z.string().max(10_000).default(""),
    arguments: z
      .array(
        z
          .object({
            name: z.string().min(1).max(200),
            description: z.string().max(2_000).default(""),
            required: z.boolean().default(false),
          })
          .passthrough(),
      )
      .max(100)
      .default([]),
  })
  .passthrough();
export const MCPPromptsListSchema = z.object({
  prompts: z.array(MCPPromptSchema).max(10_000).default([]),
});
export const MCPPromptGetResultSchema = z.object({
  description: z.string().max(10_000).optional(),
  messages: z
    .array(
      z
        .object({
          role: z.string().max(100).default("user"),
          content: z
            .object({
              type: z.string().max(100).default("text"),
              text: z.string().max(MCP_STDIO_LINE_LIMIT_BYTES).optional(),
            })
            .passthrough(),
        })
        .passthrough(),
    )
    .max(1_000)
    .default([]),
});
const MCPResponseSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.number().int().positive(),
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.number().int(),
        message: z.string().max(10_000),
      })
      .passthrough()
      .optional(),
  })
  .refine((message) => message.result !== undefined || message.error, {
    message: "MCP response requires a result or error.",
  });

export type MCPToolDefinition = z.infer<typeof MCPToolDefinitionSchema>;
export type MCPToolCallResult = z.infer<typeof MCPToolCallResultSchema>;
export type MCPResource = z.infer<typeof MCPResourceSchema>;
export type MCPPrompt = z.infer<typeof MCPPromptSchema>;

/** Optional MCP surfaces advertised by a server during `initialize`. */
export interface MCPServerCapabilities {
  resources: boolean;
  prompts: boolean;
}

export function parseServerCapabilities(
  initializeResult: unknown,
): MCPServerCapabilities {
  const capabilities =
    typeof initializeResult === "object" &&
    initializeResult !== null &&
    "capabilities" in initializeResult
      ? (initializeResult as { capabilities?: unknown }).capabilities
      : undefined;
  const has = (surface: string): boolean =>
    typeof capabilities === "object" &&
    capabilities !== null &&
    typeof (capabilities as Record<string, unknown>)[surface] === "object" &&
    (capabilities as Record<string, unknown>)[surface] !== null;
  return { resources: has("resources"), prompts: has("prompts") };
}

/** Flatten `resources/read` contents into a bounded display string. */
export function flattenResourceContents(
  result: z.infer<typeof MCPResourceReadResultSchema>,
): string {
  return result.contents
    .map((content) => {
      if (content.text) return content.text;
      if (content.blob) {
        const label = content.mimeType || "binary";
        return `[${label} resource: ${content.blob.length} base64 chars]`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/** Flatten `prompts/get` messages into one prompt text block. */
export function flattenPromptMessages(
  result: z.infer<typeof MCPPromptGetResultSchema>,
): string {
  return result.messages
    .map((message) => message.content.text || "")
    .filter(Boolean)
    .join("\n\n");
}

export interface MCPToolClient {
  callTool(
    originalToolName: string,
    args: Record<string, unknown>,
    abortSignal?: AbortSignal,
  ): Promise<MCPToolCallResult>;
  getServerCapabilities?(): MCPServerCapabilities;
  listResources?(abortSignal?: AbortSignal): Promise<MCPResource[]>;
  readResource?(uri: string, abortSignal?: AbortSignal): Promise<string>;
  listPrompts?(abortSignal?: AbortSignal): Promise<MCPPrompt[]>;
  getPrompt?(
    name: string,
    args?: Record<string, string>,
    abortSignal?: AbortSignal,
  ): Promise<string>;
}

const REQUIRED_RUNTIME_ENV = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA",
] as const;

export function buildMcpEnvironment(
  configured: Record<string, string>,
  inheritNames: string[],
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const name of new Set([...REQUIRED_RUNTIME_ENV, ...inheritNames])) {
    const value = source[name];
    if (value !== undefined) result[name] = value;
  }
  return { ...result, ...configured };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  removeAbortListener?: () => void;
}

/** A bounded, validated JSON-RPC client for one stdio MCP server. */
export class MCPClient {
  private child: ChildProcess | null = null;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private isConnected = false;
  private stdoutBuffer = Buffer.alloc(0);
  private stderrTail = "";
  private serverCapabilities: MCPServerCapabilities = {
    resources: false,
    prompts: false,
  };

  public constructor(
    public readonly serverName: string,
    private readonly command: string,
    private readonly args: string[] = [],
    private readonly env: Record<string, string> = {},
    private readonly inheritEnv: string[] = [],
    private readonly clientVersion?: string,
    private readonly requestTimeoutMs?: number,
  ) {}

  private get effectiveRequestTimeoutMs(): number {
    return this.requestTimeoutMs ?? MCP_REQUEST_TIMEOUT_MS;
  }

  /** Start the server, complete the MCP handshake, and return validated tools. */
  public async start(): Promise<MCPToolDefinition[]> {
    if (this.child || this.isConnected) {
      throw new Error(`MCP client "${this.serverName}" has already started.`);
    }
    const child = spawn(this.command, this.args, {
      env: buildMcpEnvironment(this.env, this.inheritEnv),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.stdoutBuffer = Buffer.alloc(0);
    this.stderrTail = "";

    child.on("error", (error) => {
      this.cleanup(
        new Error(
          `MCP server "${this.serverName}" failed to start: ${safeMessage(error)}`,
        ),
      );
    });
    child.on("exit", (code, signal) => {
      const detail = this.stderrTail ? `: ${this.stderrTail}` : "";
      this.cleanup(
        new Error(
          `MCP server "${this.serverName}" exited with code ${code} and signal ${signal}${detail}`,
        ),
      );
    });
    child.stdout?.on("data", (data: Buffer | string) => {
      this.handleStdoutChunk(Buffer.isBuffer(data) ? data : Buffer.from(data));
    });
    child.stderr?.on("data", (data: Buffer | string) => {
      const text = Buffer.isBuffer(data) ? data.toString("utf8") : data;
      this.stderrTail = redactSecrets(`${this.stderrTail}${text}`)
        .replace(/[\r\n]+/g, " ")
        .trim()
        .slice(-MCP_STDERR_LIMIT_CHARS);
    });
    // Windows may report a late EPIPE on the writable stream when an MCP
    // process exits immediately after cancellation. Writable stream errors are
    // otherwise uncaught even when write callbacks are present.
    child.stdin?.on("error", (error) => {
      if (this.child !== child) return;
      this.cleanup(
        new Error(
          `MCP server "${this.serverName}" stdin failed: ${safeMessage(error)}`,
        ),
      );
    });

    if (!child.stdin || !child.stdout) {
      await this.stop();
      throw new Error(`MCP server "${this.serverName}" has no stdio channel.`);
    }
    this.isConnected = true;
    try {
      await this.initializeHandshake();
      return await this.listTools();
    } catch (error: unknown) {
      await this.stop();
      throw error;
    }
  }

  /** Call one validated MCP tool with JSON-object arguments. */
  public async callTool(
    originalToolName: string,
    args: Record<string, unknown>,
    abortSignal?: AbortSignal,
  ): Promise<MCPToolCallResult> {
    if (!this.isConnected) {
      throw new Error(`MCP client "${this.serverName}" is not connected.`);
    }
    const result = await this.sendRequest(
      "tools/call",
      {
        name: originalToolName,
        arguments: args,
      },
      abortSignal,
    );
    return MCPToolCallResultSchema.parse(result);
  }

  /** Stop the child and reject outstanding requests. */
  public async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.isConnected = false;
    if (child) {
      child.removeAllListeners("exit");
      child.removeAllListeners("error");
      child.stdout?.removeAllListeners("data");
      child.stderr?.removeAllListeners("data");
      child.kill();
    }
    this.cleanup(new Error(`MCP client "${this.serverName}" stopped.`));
  }

  public getServerCapabilities(): MCPServerCapabilities {
    return { ...this.serverCapabilities };
  }

  /** List resources when the server advertises them; empty list otherwise. */
  public async listResources(
    abortSignal?: AbortSignal,
  ): Promise<MCPResource[]> {
    if (!this.serverCapabilities.resources) return [];
    const result = MCPResourcesListSchema.parse(
      await this.sendRequest("resources/list", {}, abortSignal),
    );
    return result.resources;
  }

  /** Read one resource by URI and flatten its contents to text. */
  public async readResource(
    uri: string,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const result = MCPResourceReadResultSchema.parse(
      await this.sendRequest("resources/read", { uri }, abortSignal),
    );
    return flattenResourceContents(result);
  }

  /** List prompts when the server advertises them; empty list otherwise. */
  public async listPrompts(abortSignal?: AbortSignal): Promise<MCPPrompt[]> {
    if (!this.serverCapabilities.prompts) return [];
    const result = MCPPromptsListSchema.parse(
      await this.sendRequest("prompts/list", {}, abortSignal),
    );
    return result.prompts;
  }

  /** Resolve one prompt with arguments and flatten it to prompt text. */
  public async getPrompt(
    name: string,
    args?: Record<string, string>,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const result = MCPPromptGetResultSchema.parse(
      await this.sendRequest(
        "prompts/get",
        { name, arguments: args ?? {} },
        abortSignal,
      ),
    );
    return flattenPromptMessages(result);
  }

  private async initializeHandshake(): Promise<void> {
    const initializeResult = await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "orbit-client",
        version:
          this.clientVersion ?? readRuntimePackageVersion(import.meta.url),
      },
    });
    this.serverCapabilities = parseServerCapabilities(initializeResult);
    this.sendNotification("notifications/initialized");
  }

  private async listTools(): Promise<MCPToolDefinition[]> {
    const result = MCPToolsListSchema.parse(
      await this.sendRequest("tools/list", {}),
    );
    return result.tools;
  }

  private sendRequest(
    method: string,
    params: Record<string, unknown>,
    abortSignal?: AbortSignal,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (abortSignal?.aborted) {
        reject(createAbortError(`MCP request "${method}" was cancelled.`));
        return;
      }
      const stdin = this.child?.stdin;
      if (!this.isConnected || !stdin || !stdin.writable) {
        reject(new Error("MCP server process is not running."));
        return;
      }
      const id = this.nextRequestId++;
      const timeoutMs = this.effectiveRequestTimeoutMs;
      const timeout = setTimeout(() => {
        const pending = this.pendingRequests.get(id);
        this.pendingRequests.delete(id);
        pending?.removeAbortListener?.();
        reject(
          new Error(
            `MCP request "${method}" (id: ${id}) timed out after ${timeoutMs}ms.`,
          ),
        );
      }, timeoutMs);
      const onAbort = () => {
        const pending = this.pendingRequests.get(id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(id);
        pending.removeAbortListener?.();
        this.sendNotification("notifications/cancelled", {
          requestId: id,
          reason: "Orbit tool execution cancelled",
        });
        pending.reject(
          createAbortError(`MCP request "${method}" was cancelled.`),
        );
      };
      const removeAbortListener = abortSignal
        ? () => abortSignal.removeEventListener("abort", onAbort)
        : undefined;
      abortSignal?.addEventListener("abort", onAbort, { once: true });
      this.pendingRequests.set(id, {
        resolve,
        reject,
        timeout,
        removeAbortListener,
      });
      stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
        (error) => {
          if (!error) return;
          const pending = this.pendingRequests.get(id);
          if (!pending) return;
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(id);
          pending.removeAbortListener?.();
          pending.reject(
            new Error(`Unable to write MCP request: ${safeMessage(error)}`),
          );
        },
      );
    });
  }

  private sendNotification(
    method: string,
    params?: Record<string, unknown>,
  ): void {
    const stdin = this.child?.stdin;
    if (!this.isConnected || !stdin || !stdin.writable) return;
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  private handleStdoutChunk(chunk: Buffer): void {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
    if (this.stdoutBuffer.length > MCP_STDIO_LINE_LIMIT_BYTES) {
      const error = new Error(
        `MCP server "${this.serverName}" exceeded the 8 MiB response-line limit.`,
      );
      this.child?.kill();
      this.cleanup(error);
      return;
    }
    while (true) {
      const newline = this.stdoutBuffer.indexOf(0x0a);
      if (newline < 0) return;
      const line = this.stdoutBuffer
        .subarray(0, newline)
        .toString("utf8")
        .trim();
      this.stdoutBuffer = this.stdoutBuffer.subarray(newline + 1);
      if (line) this.handleIncomingMessage(line);
    }
  }

  private handleIncomingMessage(line: string): void {
    let response: z.infer<typeof MCPResponseSchema>;
    try {
      response = MCPResponseSchema.parse(JSON.parse(line) as unknown);
    } catch {
      return;
    }
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);
    pending.removeAbortListener?.();
    if (response.error) {
      pending.reject(
        new Error(
          `MCP error ${response.error.code}: ${safeMessage(response.error.message)}`,
        ),
      );
      return;
    }
    pending.resolve(response.result);
  }

  private cleanup(error: Error): void {
    this.isConnected = false;
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.removeAbortListener?.();
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 2_000);
}

/** Adapt one remote MCP tool to Orbit's validated local tool contract. */
export class DynamicMCPTool implements OrbitTool<
  Record<string, unknown>,
  string
> {
  public readonly name: string;
  public readonly description: string;
  public readonly inputSchema = z.record(z.unknown());
  public readonly inputJsonSchema: Record<string, unknown>;
  public readonly risk: ToolRisk;
  private readonly originalToolName: string;

  public constructor(
    serverName: string,
    toolDefinition: MCPToolDefinition,
    risk: ToolRisk,
    private readonly client: MCPToolClient,
  ) {
    this.name = createMcpToolName(serverName, toolDefinition.name);
    this.description = `[MCP Tool: ${serverName}] ${toolDefinition.description}`;
    this.risk = risk;
    this.originalToolName = toolDefinition.name;
    this.inputJsonSchema = toolDefinition.inputSchema;
  }

  public async execute(
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult<string>> {
    try {
      const response = await this.client.callTool(
        this.originalToolName,
        input,
        context.abortSignal,
      );
      const text = response.content
        .map((content) => content.text || "")
        .filter(Boolean)
        .join("\n");
      if (response.isError) {
        return {
          ok: false,
          error: text || "Unknown MCP tool execution error.",
        };
      }
      return { ok: true, data: text, display: text };
    } catch (error: unknown) {
      return {
        ok: false,
        error: `MCP tool execution failed: ${safeMessage(error)}`,
      };
    }
  }
}

const MCP_RESOURCE_LIST_LIMIT = 25;
const MCP_RESOURCE_DESCRIPTION_LIMIT = 4_000;

/** One read-only tool per server exposing `resources/read` to the model. */
export class McpResourceTool implements OrbitTool<
  Record<string, unknown>,
  string
> {
  public readonly name: string;
  public readonly description: string;
  public readonly inputSchema = z.record(z.unknown());
  public readonly inputJsonSchema: Record<string, unknown> = {
    type: "object",
    properties: {
      uri: {
        type: "string",
        description: "URI of the MCP resource to read.",
      },
    },
    required: ["uri"],
  };
  public readonly risk: ToolRisk = "read";

  public constructor(
    serverName: string,
    resources: MCPResource[],
    private readonly client: MCPToolClient,
  ) {
    this.name = createMcpToolName(serverName, "read_resource");
    const catalog = resources
      .slice(0, MCP_RESOURCE_LIST_LIMIT)
      .map((resource) => {
        const label = resource.name ? ` (${resource.name})` : "";
        const detail = resource.description ? `: ${resource.description}` : "";
        return `- ${resource.uri}${label}${detail}`;
      })
      .join("\n")
      .slice(0, MCP_RESOURCE_DESCRIPTION_LIMIT);
    const overflow =
      resources.length > MCP_RESOURCE_LIST_LIMIT
        ? `\n… and ${resources.length - MCP_RESOURCE_LIST_LIMIT} more resources.`
        : "";
    this.description =
      `[MCP Resources: ${serverName}] Read a resource this server exposes ` +
      `by URI.` +
      (catalog ? `\nKnown resources:\n${catalog}${overflow}` : "");
  }

  public async execute(
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult<string>> {
    const uri = typeof input.uri === "string" ? input.uri.trim() : "";
    if (!uri) {
      return { ok: false, error: "A non-empty resource `uri` is required." };
    }
    if (!this.client.readResource) {
      return { ok: false, error: "This MCP server has no resource support." };
    }
    try {
      const text = await this.client.readResource(uri, context.abortSignal);
      return { ok: true, data: text, display: text };
    } catch (error: unknown) {
      return {
        ok: false,
        error: `MCP resource read failed: ${safeMessage(error)}`,
      };
    }
  }
}

/** Build an OpenAI/DeepSeek-compatible function name without losing identity. */
export function createMcpToolName(
  serverName: string,
  originalToolName: string,
): string {
  const rawName = `mcp__${serverName}__${originalToolName}`;
  if (/^[A-Za-z0-9_-]{1,64}$/.test(rawName)) return rawName;

  const normalized = rawName
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const digest = createHash("sha256").update(rawName).digest("hex").slice(0, 8);
  const prefix = (normalized || "mcp_tool").slice(0, 55).replace(/_+$/g, "");
  return `${prefix}_${digest}`;
}

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}
