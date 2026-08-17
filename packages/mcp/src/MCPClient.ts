import { spawn, type ChildProcess } from "child_process";
import { createHash } from "crypto";
import {
  readRuntimePackageVersion,
  redactSecrets,
  sanitizeExternalErrorMessage,
  type ToolRisk,
} from "@orbit-build/shared";
import {
  type OrbitTool,
  type ToolContext,
  type ToolResult,
} from "@orbit-build/tools";
import { z } from "zod";
import {
  createMcpInputSchema,
  createMcpOutputValidator,
} from "./JsonSchemaInput.js";
import {
  MCPDiscoverResultSchema,
  MCP_LATEST_LEGACY_PROTOCOL_VERSION,
  MCP_LATEST_PROTOCOL_VERSION,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
  McpJsonRpcError,
  assertCompleteModernResult,
  createModernRequestParams,
  isLegacyProtocolVersion,
  isRecognizedModernProtocolError,
  modernVersionsFromUnsupportedError,
  selectModernProtocolVersion,
  MCPCreateTaskResultSchema,
  MCPInputRequiredResultSchema,
  MCPTaskSchema,
  createMcpJsonRpcError,
  type MCPTask,
  type McpNegotiatedProtocol,
} from "./McpProtocol.js";

const MCP_REQUEST_TIMEOUT_MS = 30_000;
const MCP_STDIO_LINE_LIMIT_BYTES = 8 * 1024 * 1024;
const MCP_STDERR_LIMIT_CHARS = 4_000;
const MCP_SHUTDOWN_GRACE_MS = 1_000;
const MCP_MAX_LIST_PAGES = 100;
const MCP_MAX_LIST_ITEMS = 10_000;
const MCP_CURSOR_MAX_CHARS = 4_096;

export {
  MCP_LATEST_LEGACY_PROTOCOL_VERSION,
  MCP_LATEST_PROTOCOL_VERSION,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
} from "./McpProtocol.js";
const MCPPaginationCursorSchema = z.string().min(1).max(MCP_CURSOR_MAX_CHARS);

export const MCPToolDefinitionSchema = z
  .object({
    name: z.string().min(1).max(512),
    title: z.string().max(512).optional(),
    description: z.string().max(10_000).default(""),
    inputSchema: z.record(z.unknown()).default({}),
    outputSchema: z.record(z.unknown()).optional(),
    annotations: z.record(z.unknown()).optional(),
    icons: z.array(z.record(z.unknown())).max(20).optional(),
    execution: z
      .object({
        taskSupport: z.enum(["required", "optional", "forbidden"]).optional(),
      })
      .optional(),
  })
  .passthrough();
export const MCPToolsListSchema = z.object({
  tools: z.array(MCPToolDefinitionSchema).max(10_000).default([]),
  nextCursor: MCPPaginationCursorSchema.optional(),
});
export const MCPToolCallResultSchema = z
  .object({
    content: z
      .array(
        z
          .object({
            type: z.string().max(100),
            text: z.string().max(MCP_STDIO_LINE_LIMIT_BYTES).optional(),
            data: z.string().max(MCP_STDIO_LINE_LIMIT_BYTES).optional(),
            mimeType: z.string().max(200).optional(),
            uri: z.string().max(2_048).optional(),
            resource: z
              .object({
                uri: z.string().max(2_048).default(""),
                mimeType: z.string().max(200).optional(),
                text: z.string().max(MCP_STDIO_LINE_LIMIT_BYTES).optional(),
                blob: z.string().max(MCP_STDIO_LINE_LIMIT_BYTES).optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .max(10_000)
      .default([]),
    isError: z.boolean().default(false),
    resultType: z.string().min(1).max(100).optional(),
    structuredContent: z.unknown().optional(),
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
  nextCursor: MCPPaginationCursorSchema.optional(),
});
export const MCPResourceTemplateSchema = z
  .object({
    uriTemplate: z.string().min(1).max(4_096),
    name: z.string().max(512).default(""),
    description: z.string().max(10_000).default(""),
    mimeType: z.string().max(200).optional(),
  })
  .passthrough();
export const MCPResourceTemplatesListSchema = z.object({
  resourceTemplates: z.array(MCPResourceTemplateSchema).max(10_000).default([]),
  nextCursor: MCPPaginationCursorSchema.optional(),
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
  nextCursor: MCPPaginationCursorSchema.optional(),
});
export const MCPTasksListSchema = z.object({
  tasks: z.array(MCPTaskSchema).max(10_000).default([]),
  nextCursor: MCPPaginationCursorSchema.optional(),
});
export const MCPRootSchema = z
  .object({
    uri: z.string().min(1).max(2_048),
    name: z.string().max(512).optional(),
  })
  .passthrough();
export const MCPRootsListSchema = z.object({
  roots: z.array(MCPRootSchema).max(1_000).default([]),
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

export const MCP_CATALOG_KINDS = ["tools", "resources", "prompts"] as const;
export type McpCatalogKind = (typeof MCP_CATALOG_KINDS)[number];

const MCPNotificationSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string().min(1).max(256),
  params: z.record(z.unknown()).optional(),
});
export const MCPServerRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.number().int().positive(), z.string().min(1).max(256)]),
  method: z.string().min(1).max(256),
  params: z.record(z.unknown()).default({}),
});

export interface McpRuntimeHealth {
  connected: boolean;
  recoveryCount: number;
  lastError?: string;
}

export type MCPToolDefinition = z.infer<typeof MCPToolDefinitionSchema>;
export type MCPToolCallResult = z.infer<typeof MCPToolCallResultSchema>;
export type MCPResource = z.infer<typeof MCPResourceSchema>;
export type MCPResourceTemplate = z.infer<typeof MCPResourceTemplateSchema>;
export type MCPPrompt = z.infer<typeof MCPPromptSchema>;
export type MCPRoot = z.infer<typeof MCPRootSchema>;
export type MCPRootsList = z.infer<typeof MCPRootsListSchema>;
export type MCPTaskSnapshot = MCPTask;

export interface MCPTaskWaitOptions {
  abortSignal?: AbortSignal;
  maxWaitMs?: number;
}

export interface MCPTaskWaitResult {
  task: MCPTaskSnapshot;
  /** A completed tool result or the structured input request for a paused task. */
  result?: MCPTaskResult;
}

export const MCPTaskResultSchema = z.union([
  MCPInputRequiredResultSchema,
  MCPToolCallResultSchema,
]);

export type MCPTaskResult = z.infer<typeof MCPTaskResultSchema>;

export interface MCPServerInteractionRequest {
  method: "elicitation/create" | "sampling/createMessage" | "roots/list";
  params: Record<string, unknown>;
  /** Local transport identity; never serialized onto the MCP wire. */
  serverName?: string;
}

export interface MCPInteractionHandlers {
  /** Return the exact protocol result after user approval/input. */
  onElicitation?: (
    request: MCPServerInteractionRequest,
    abortSignal: AbortSignal,
  ) => Promise<Record<string, unknown>>;
  /** Return the exact protocol result after the host model/UI approves sampling. */
  onSampling?: (
    request: MCPServerInteractionRequest,
    abortSignal: AbortSignal,
  ) => Promise<Record<string, unknown>>;
  /** Return the roots the host permits this server to access. */
  onRootsList?: (
    request: MCPServerInteractionRequest,
    abortSignal: AbortSignal,
  ) => Promise<MCPRootsList>;
}

interface McpPaginatedPage<T> {
  items: T[];
  nextCursor?: string;
}

/**
 * Collect an MCP cursor sequence without interpreting opaque cursors. Page,
 * item, and cursor bounds prevent a malicious server from exhausting memory
 * or cycling forever.
 */
export async function collectMcpPaginatedItems<T>(options: {
  method: string;
  request: (params: Record<string, unknown>) => Promise<unknown>;
  parse: (value: unknown) => McpPaginatedPage<T>;
  identity: (item: T) => string;
  /** Restart once when transport recovery invalidates session-scoped cursors. */
  restartOnError?: (error: unknown) => boolean;
}): Promise<T[]> {
  try {
    return await collectMcpPaginationAttempt(options);
  } catch (error: unknown) {
    if (!options.restartOnError?.(error)) throw error;
    return collectMcpPaginationAttempt(options);
  }
}

async function collectMcpPaginationAttempt<T>(options: {
  method: string;
  request: (params: Record<string, unknown>) => Promise<unknown>;
  parse: (value: unknown) => McpPaginatedPage<T>;
  identity: (item: T) => string;
}): Promise<T[]> {
  const items: T[] = [];
  const seenCursors = new Set<string>();
  const seenItems = new Set<string>();
  let cursor: string | undefined;

  for (let pageNumber = 1; pageNumber <= MCP_MAX_LIST_PAGES; pageNumber += 1) {
    const page = options.parse(await options.request(cursor ? { cursor } : {}));
    for (const item of page.items) {
      const identity = options.identity(item);
      if (seenItems.has(identity)) {
        throw new Error(
          `MCP ${options.method} returned duplicate item "${identity}" across pages.`,
        );
      }
      seenItems.add(identity);
      items.push(item);
      if (items.length > MCP_MAX_LIST_ITEMS) {
        throw new Error(
          `MCP ${options.method} exceeded the ${MCP_MAX_LIST_ITEMS}-item limit.`,
        );
      }
    }

    const nextCursor = page.nextCursor;
    if (!nextCursor) return items;
    if (seenCursors.has(nextCursor)) {
      throw new Error(`MCP ${options.method} repeated a pagination cursor.`);
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  throw new Error(
    `MCP ${options.method} exceeded the ${MCP_MAX_LIST_PAGES}-page limit.`,
  );
}

/** Optional MCP surfaces advertised by a server during `initialize`. */
export interface MCPServerCapabilities {
  tools: boolean;
  resources: boolean;
  prompts: boolean;
  tasks: boolean;
  resourceSubscriptions: boolean;
  resourceListChanged: boolean;
  toolListChanged: boolean;
  promptListChanged: boolean;
  elicitation: boolean;
  sampling: boolean;
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
  const hasNested = (surface: string, feature: string): boolean => {
    if (
      typeof capabilities !== "object" ||
      capabilities === null ||
      typeof (capabilities as Record<string, unknown>)[surface] !== "object" ||
      (capabilities as Record<string, unknown>)[surface] === null
    ) {
      return false;
    }
    const nested = (capabilities as Record<string, unknown>)[surface] as Record<
      string,
      unknown
    >;
    return (
      nested[feature] === true ||
      (typeof nested[feature] === "object" && nested[feature] !== null)
    );
  };
  return {
    tools: has("tools"),
    resources: has("resources"),
    prompts: has("prompts"),
    tasks: has("tasks"),
    resourceSubscriptions: hasNested("resources", "subscribe"),
    resourceListChanged: hasNested("resources", "listChanged"),
    toolListChanged: hasNested("tools", "listChanged"),
    promptListChanged: hasNested("prompts", "listChanged"),
    elicitation: has("elicitation"),
    sampling: has("sampling"),
  };
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

/** Preserve useful non-text MCP content instead of silently dropping it. */
export function flattenToolContents(result: MCPToolCallResult): string {
  const contentText = result.content
    .map((content) => {
      if (content.text) return content.text;
      if (content.resource?.text) return content.resource.text;
      if (content.resource?.blob) {
        return `[${content.resource.mimeType || "binary"} MCP resource: ${content.resource.blob.length} base64 chars]`;
      }
      if (content.uri) return `[MCP resource link: ${content.uri}]`;
      if (content.data) {
        return `[${content.mimeType || content.type} MCP content: ${content.data.length} base64 chars]`;
      }
      return `[MCP ${content.type} content]`;
    })
    .join("\n");
  if (contentText || result.structuredContent === undefined) return contentText;
  const structuredText = JSON.stringify(result.structuredContent, null, 2);
  return structuredText.length > MCP_STDIO_LINE_LIMIT_BYTES
    ? `${structuredText.slice(0, MCP_STDIO_LINE_LIMIT_BYTES)}\n…[truncated]`
    : structuredText;
}

export interface MCPToolClient {
  callTool(
    originalToolName: string,
    args: Record<string, unknown>,
    abortSignal?: AbortSignal,
  ): Promise<MCPToolCallResult>;
  callToolTask?(
    originalToolName: string,
    args: Record<string, unknown>,
    options?: { ttl?: number; abortSignal?: AbortSignal },
  ): Promise<MCPTaskSnapshot>;
  getServerCapabilities?(): MCPServerCapabilities;
  getNegotiatedProtocol?(): McpNegotiatedProtocol | undefined;
  getProtocolWarnings?(): string[];
  listTools?(abortSignal?: AbortSignal): Promise<MCPToolDefinition[]>;
  onCatalogChanged?(listener: (kinds: McpCatalogKind[]) => void): () => void;
  /** Fired when a server reports that a previously requested URL flow completed. */
  onElicitationComplete?(listener: (elicitationId: string) => void): () => void;
  /** Fired when a server asks the client to refresh its roots view. */
  onRootsListChanged?(listener: () => void): () => void;
  /** Notify the server that the client's permitted roots changed. */
  notifyRootsListChanged?(): Promise<void>;
  /** Recreate a lost transport session and return its current tool catalog. */
  reconnect?(): Promise<MCPToolDefinition[]>;
  getRuntimeHealth?(): McpRuntimeHealth;
  listResources?(abortSignal?: AbortSignal): Promise<MCPResource[]>;
  listResourceTemplates?(
    abortSignal?: AbortSignal,
  ): Promise<MCPResourceTemplate[]>;
  readResource?(uri: string, abortSignal?: AbortSignal): Promise<string>;
  listPrompts?(abortSignal?: AbortSignal): Promise<MCPPrompt[]>;
  getPrompt?(
    name: string,
    args?: Record<string, string>,
    abortSignal?: AbortSignal,
  ): Promise<string>;
  subscribeResource?(uri: string, abortSignal?: AbortSignal): Promise<void>;
  unsubscribeResource?(uri: string, abortSignal?: AbortSignal): Promise<void>;
  getTask?(taskId: string, abortSignal?: AbortSignal): Promise<MCPTaskSnapshot>;
  listTasks?(abortSignal?: AbortSignal): Promise<MCPTaskSnapshot[]>;
  cancelTask?(
    taskId: string,
    abortSignal?: AbortSignal,
  ): Promise<MCPTaskSnapshot>;
  getTaskResult?(
    taskId: string,
    abortSignal?: AbortSignal,
  ): Promise<MCPTaskResult>;
  waitForTask?(
    taskId: string,
    options?: MCPTaskWaitOptions,
  ): Promise<MCPTaskWaitResult>;
  onTaskStatus?(listener: (task: MCPTaskSnapshot) => void): () => void;
  onResourceUpdated?(listener: (uri: string) => void): () => void;
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

interface McpRequestOptions {
  modernVersion?: string;
  timeoutMs?: number;
  skipModernResultCheck?: boolean;
}

/** A bounded, validated JSON-RPC client for one stdio MCP server. */
export class MCPClient {
  private child: ChildProcess | null = null;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private isConnected = false;
  private stdoutBuffer = Buffer.alloc(0);
  private stderrTail = "";
  private negotiatedProtocol: McpNegotiatedProtocol | undefined;
  private serverCapabilities: MCPServerCapabilities = {
    tools: false,
    resources: false,
    prompts: false,
    tasks: false,
    resourceSubscriptions: false,
    resourceListChanged: false,
    toolListChanged: false,
    promptListChanged: false,
    elicitation: false,
    sampling: false,
  };
  private readonly catalogListeners = new Set<
    (kinds: McpCatalogKind[]) => void
  >();
  private readonly taskStatusListeners = new Set<
    (task: MCPTaskSnapshot) => void
  >();
  private readonly resourceUpdateListeners = new Set<(uri: string) => void>();
  private readonly toolDefinitions = new Map<string, MCPToolDefinition>();
  private readonly elicitationCompleteListeners = new Set<
    (elicitationId: string) => void
  >();
  private readonly rootsListChangedListeners = new Set<() => void>();
  private recoveryCount = 0;
  private reconnectPromise: Promise<MCPToolDefinition[]> | undefined;
  private lastError: string | undefined;

  public constructor(
    public readonly serverName: string,
    private readonly command: string,
    private readonly args: string[] = [],
    private readonly env: Record<string, string> = {},
    private readonly inheritEnv: string[] = [],
    private readonly clientVersion?: string,
    private readonly requestTimeoutMs?: number,
    private readonly interactionHandlers: MCPInteractionHandlers = {},
  ) {}

  private get effectiveRequestTimeoutMs(): number {
    return this.requestTimeoutMs ?? MCP_REQUEST_TIMEOUT_MS;
  }

  private get effectiveClientVersion(): string {
    return this.clientVersion ?? readRuntimePackageVersion(import.meta.url);
  }

  /** Advertise only server-interaction capabilities for which Orbit has an explicit handler. */
  private clientCapabilities(): Record<string, unknown> {
    return {
      ...(this.interactionHandlers.onElicitation
        ? { elicitation: { form: {}, url: {} } }
        : {}),
      ...(this.interactionHandlers.onSampling ? { sampling: {} } : {}),
      ...(this.interactionHandlers.onRootsList
        ? { roots: { listChanged: true } }
        : {}),
    };
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
    this.negotiatedProtocol = undefined;
    this.lastError = undefined;
    this.serverCapabilities = {
      tools: false,
      resources: false,
      prompts: false,
      tasks: false,
      resourceSubscriptions: false,
      resourceListChanged: false,
      toolListChanged: false,
      promptListChanged: false,
      elicitation: false,
      sampling: false,
    };

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
      await this.negotiateProtocol();
      return this.serverCapabilities.tools ? await this.listTools() : [];
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
    this.negotiatedProtocol = undefined;
    this.toolDefinitions.clear();
    this.cleanup(new Error(`MCP client "${this.serverName}" stopped.`));
    if (child) {
      child.stdin?.end();
      if (!(await waitForChildExit(child, MCP_SHUTDOWN_GRACE_MS))) {
        child.kill("SIGTERM");
        if (!(await waitForChildExit(child, MCP_SHUTDOWN_GRACE_MS))) {
          child.kill("SIGKILL");
          await waitForChildExit(child, MCP_SHUTDOWN_GRACE_MS);
        }
      }
      child.removeAllListeners();
      child.stdout?.removeAllListeners();
      child.stderr?.removeAllListeners();
      child.stdin?.removeAllListeners();
    }
  }

  /**
   * Explicitly recover a crashed stdio server.
   *
   * Recovery is deliberately caller-triggered: Orbit never starts an
   * unbounded restart loop for an arbitrary third-party process. Concurrent
   * callers share one bounded handshake and receive the same catalog result.
   */
  public async reconnect(): Promise<MCPToolDefinition[]> {
    if (this.reconnectPromise) return this.reconnectPromise;
    this.reconnectPromise = (async () => {
      await this.stop();
      this.recoveryCount += 1;
      return this.start();
    })().finally(() => {
      this.reconnectPromise = undefined;
    });
    return this.reconnectPromise;
  }

  public getServerCapabilities(): MCPServerCapabilities {
    return { ...this.serverCapabilities };
  }

  public getNegotiatedProtocol(): McpNegotiatedProtocol | undefined {
    return this.negotiatedProtocol ? { ...this.negotiatedProtocol } : undefined;
  }

  public onCatalogChanged(
    listener: (kinds: McpCatalogKind[]) => void,
  ): () => void {
    this.catalogListeners.add(listener);
    return () => this.catalogListeners.delete(listener);
  }

  public getRuntimeHealth(): McpRuntimeHealth {
    return {
      connected: this.isConnected,
      recoveryCount: this.recoveryCount,
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  /** List resources when the server advertises them; empty list otherwise. */
  public async listResources(
    abortSignal?: AbortSignal,
  ): Promise<MCPResource[]> {
    if (!this.serverCapabilities.resources) return [];
    return collectMcpPaginatedItems({
      method: "resources/list",
      request: (params) =>
        this.sendRequest("resources/list", params, abortSignal),
      parse: (value) => {
        const page = MCPResourcesListSchema.parse(value);
        return { items: page.resources, nextCursor: page.nextCursor };
      },
      identity: (resource) => resource.uri,
    });
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

  /** List URI templates, degrading only when an older server lacks the method. */
  public async listResourceTemplates(
    abortSignal?: AbortSignal,
  ): Promise<MCPResourceTemplate[]> {
    if (!this.serverCapabilities.resources) return [];
    try {
      return await collectMcpPaginatedItems({
        method: "resources/templates/list",
        request: (params) =>
          this.sendRequest("resources/templates/list", params, abortSignal),
        parse: (value) => {
          const page = MCPResourceTemplatesListSchema.parse(value);
          return {
            items: page.resourceTemplates,
            nextCursor: page.nextCursor,
          };
        },
        identity: (template) => template.uriTemplate,
      });
    } catch (error: unknown) {
      if (isMethodNotFound(error)) return [];
      throw error;
    }
  }

  /** List prompts when the server advertises them; empty list otherwise. */
  public async listPrompts(abortSignal?: AbortSignal): Promise<MCPPrompt[]> {
    if (!this.serverCapabilities.prompts) return [];
    return collectMcpPaginatedItems({
      method: "prompts/list",
      request: (params) =>
        this.sendRequest("prompts/list", params, abortSignal),
      parse: (value) => {
        const page = MCPPromptsListSchema.parse(value);
        return { items: page.prompts, nextCursor: page.nextCursor };
      },
      identity: (prompt) => prompt.name,
    });
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

  /** Subscribe to updates for one MCP resource. */
  public async subscribeResource(
    uri: string,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    this.requireResourceSubscriptionCapability();
    await this.sendRequest(
      "resources/subscribe",
      { uri: validateResourceUri(uri) },
      abortSignal,
    );
  }

  /** Stop receiving updates for one MCP resource. */
  public async unsubscribeResource(
    uri: string,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    this.requireResourceSubscriptionCapability();
    await this.sendRequest(
      "resources/unsubscribe",
      { uri: validateResourceUri(uri) },
      abortSignal,
    );
  }

  /** Create a durable task-augmented MCP tool call. */
  public async callToolTask(
    originalToolName: string,
    args: Record<string, unknown>,
    options: { ttl?: number; abortSignal?: AbortSignal } = {},
  ): Promise<MCPTaskSnapshot> {
    this.requireTaskCapability();
    const taskSupport =
      this.toolDefinitions.get(originalToolName)?.execution?.taskSupport;
    if (taskSupport !== "optional" && taskSupport !== "required") {
      throw new Error(
        `MCP tool "${originalToolName}" does not advertise task support; refusing task augmentation.`,
      );
    }
    const ttl = options.ttl;
    if (
      ttl !== undefined &&
      (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 7 * 24 * 60 * 60 * 1_000)
    ) {
      throw new Error(
        "MCP task ttl must be an integer between 1ms and 7 days.",
      );
    }
    const result = await this.sendRequest(
      "tools/call",
      {
        name: originalToolName,
        arguments: args,
        task: ttl === undefined ? {} : { ttl },
      },
      options.abortSignal,
      { skipModernResultCheck: true },
    );
    return MCPCreateTaskResultSchema.parse(result).task;
  }

  /** Read one durable task state without assuming a live notification stream. */
  public async getTask(
    taskId: string,
    abortSignal?: AbortSignal,
  ): Promise<MCPTaskSnapshot> {
    this.requireTaskCapability();
    return MCPTaskSchema.parse(
      await this.sendRequest(
        "tasks/get",
        { taskId: validateTaskId(taskId) },
        abortSignal,
        { skipModernResultCheck: true },
      ),
    );
  }

  /** List tasks through opaque cursor pagination with bounded memory. */
  public async listTasks(
    abortSignal?: AbortSignal,
  ): Promise<MCPTaskSnapshot[]> {
    this.requireTaskCapability();
    return collectMcpPaginatedItems({
      method: "tasks/list",
      request: (params) =>
        this.sendRequest("tasks/list", params, abortSignal, {
          skipModernResultCheck: true,
        }),
      parse: (value) => {
        const page = MCPTasksListSchema.parse(value);
        return { items: page.tasks, nextCursor: page.nextCursor };
      },
      identity: (task) => task.taskId,
    });
  }

  /** Request cancellation and return the receiver's authoritative state. */
  public async cancelTask(
    taskId: string,
    abortSignal?: AbortSignal,
  ): Promise<MCPTaskSnapshot> {
    this.requireTaskCapability();
    return MCPTaskSchema.parse(
      await this.sendRequest(
        "tasks/cancel",
        { taskId: validateTaskId(taskId) },
        abortSignal,
        { skipModernResultCheck: true },
      ),
    );
  }

  /** Retrieve the underlying tool result after a task reaches a terminal state. */
  public async getTaskResult(
    taskId: string,
    abortSignal?: AbortSignal,
  ): Promise<MCPTaskResult> {
    this.requireTaskCapability();
    return MCPTaskResultSchema.parse(
      await this.sendRequest(
        "tasks/result",
        { taskId: validateTaskId(taskId) },
        abortSignal,
        { skipModernResultCheck: true },
      ),
    );
  }

  /** Poll a durable task with bounded backoff until terminal or input-required. */
  public async waitForTask(
    taskId: string,
    options: MCPTaskWaitOptions = {},
  ): Promise<MCPTaskWaitResult> {
    const maxWaitMs = Math.max(
      1_000,
      Math.min(options.maxWaitMs ?? 10 * 60_000, 24 * 60 * 60_000),
    );
    const deadline = Date.now() + maxWaitMs;
    while (true) {
      const task = await this.getTask(taskId, options.abortSignal);
      if (task.status === "input_required") {
        return {
          task,
          result: await this.getTaskResult(task.taskId, options.abortSignal),
        };
      }
      if (["completed", "failed", "cancelled"].includes(task.status)) {
        return {
          task,
          result: await this.getTaskResult(task.taskId, options.abortSignal),
        };
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(
          `MCP task "${task.taskId}" did not finish within ${maxWaitMs}ms.`,
        );
      }
      await waitForMcpTaskPoll(
        Math.min(task.pollInterval ?? 1_000, remaining),
        options.abortSignal,
      );
    }
  }

  public onTaskStatus(listener: (task: MCPTaskSnapshot) => void): () => void {
    this.taskStatusListeners.add(listener);
    return () => this.taskStatusListeners.delete(listener);
  }

  public onResourceUpdated(listener: (uri: string) => void): () => void {
    this.resourceUpdateListeners.add(listener);
    return () => this.resourceUpdateListeners.delete(listener);
  }

  public onElicitationComplete(
    listener: (elicitationId: string) => void,
  ): () => void {
    this.elicitationCompleteListeners.add(listener);
    return () => this.elicitationCompleteListeners.delete(listener);
  }

  public onRootsListChanged(listener: () => void): () => void {
    this.rootsListChangedListeners.add(listener);
    return () => this.rootsListChangedListeners.delete(listener);
  }

  /** Tell an MCP server that the roots returned by the host have changed. */
  public async notifyRootsListChanged(): Promise<void> {
    if (!this.interactionHandlers.onRootsList) {
      throw new Error(
        `MCP client "${this.serverName}" has no roots handler to notify from.`,
      );
    }
    if (!this.isConnected) {
      throw new Error(`MCP client "${this.serverName}" is not connected.`);
    }
    this.sendNotification("notifications/roots/list_changed");
  }

  private requireTaskCapability(): void {
    if (!this.serverCapabilities.tasks) {
      throw new Error(
        `MCP server "${this.serverName}" does not advertise durable task support.`,
      );
    }
  }

  private requireResourceSubscriptionCapability(): void {
    if (!this.serverCapabilities.resourceSubscriptions) {
      throw new Error(
        `MCP server "${this.serverName}" does not advertise resource subscriptions.`,
      );
    }
  }

  private async negotiateProtocol(): Promise<void> {
    let rawDiscoverResult: unknown;
    try {
      rawDiscoverResult = await this.sendRequest(
        "server/discover",
        {},
        undefined,
        {
          modernVersion: MCP_LATEST_PROTOCOL_VERSION,
          timeoutMs: Math.min(this.effectiveRequestTimeoutMs, 1_500),
        },
      );
    } catch (error: unknown) {
      if (error instanceof McpJsonRpcError && error.code === -32022) {
        const versions = modernVersionsFromUnsupportedError(error);
        const mutuallySupported = selectModernProtocolVersion(versions);
        if (mutuallySupported) throw error;
        if (versions.some(isLegacyProtocolVersion)) {
          await this.initializeHandshake();
          return;
        }
        throw new Error(
          `MCP server "${this.serverName}" has no protocol revision supported by Orbit. ` +
            `Server versions: ${versions.join(", ") || "unknown"}.`,
        );
      }
      if (isRecognizedModernProtocolError(error)) throw error;
      await this.initializeHandshake();
      return;
    }

    const parsedDiscover = MCPDiscoverResultSchema.safeParse(rawDiscoverResult);
    if (!parsedDiscover.success) {
      // Tolerate session-era servers that return a generic success payload for
      // unknown methods instead of a JSON-RPC method-not-found error.
      await this.initializeHandshake();
      return;
    }
    const discoverResult = parsedDiscover.data;
    const version = selectModernProtocolVersion(
      discoverResult.supportedVersions,
    );
    if (!version) {
      throw new Error(
        `MCP server "${this.serverName}" supports modern versions ` +
          `${discoverResult.supportedVersions.join(", ")}, but Orbit supports ` +
          `${MCP_LATEST_PROTOCOL_VERSION}.`,
      );
    }
    this.negotiatedProtocol = { era: "modern", version };
    this.serverCapabilities = parseServerCapabilities(discoverResult);
  }

  private async initializeHandshake(): Promise<void> {
    const initializeResult = await this.sendRequest("initialize", {
      protocolVersion: MCP_LATEST_LEGACY_PROTOCOL_VERSION,
      capabilities: this.clientCapabilities(),
      clientInfo: {
        name: "orbit-client",
        version: this.effectiveClientVersion,
      },
    });
    assertSupportedProtocolVersion(initializeResult);
    const version = (initializeResult as { protocolVersion: string })
      .protocolVersion;
    if (!isLegacyProtocolVersion(version)) {
      throw new Error(
        `MCP server "${this.serverName}" selected stateless protocol ${version} ` +
          `through the legacy initialize handshake.`,
      );
    }
    this.negotiatedProtocol = { era: "legacy", version };
    this.serverCapabilities = parseServerCapabilities(initializeResult);
    this.sendNotification("notifications/initialized");
  }

  public async listTools(): Promise<MCPToolDefinition[]> {
    const tools = await collectMcpPaginatedItems({
      method: "tools/list",
      request: (params) => this.sendRequest("tools/list", params),
      parse: (value) => {
        const page = MCPToolsListSchema.parse(value);
        return { items: page.tools, nextCursor: page.nextCursor };
      },
      identity: (tool) => tool.name,
    });
    this.toolDefinitions.clear();
    for (const tool of tools) this.toolDefinitions.set(tool.name, tool);
    return tools;
  }

  private sendRequest(
    method: string,
    params: Record<string, unknown>,
    abortSignal?: AbortSignal,
    options: McpRequestOptions = {},
  ): Promise<unknown> {
    const modernVersion =
      options.modernVersion ??
      (this.negotiatedProtocol?.era === "modern"
        ? this.negotiatedProtocol.version
        : undefined);
    const wireParams = modernVersion
      ? createModernRequestParams(
          params,
          modernVersion,
          this.effectiveClientVersion,
          this.clientCapabilities(),
        )
      : params;
    const request = new Promise<unknown>((resolve, reject) => {
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
      const timeoutMs = options.timeoutMs ?? this.effectiveRequestTimeoutMs;
      const timeout = setTimeout(() => {
        const pending = this.pendingRequests.get(id);
        this.pendingRequests.delete(id);
        pending?.removeAbortListener?.();
        if (this.negotiatedProtocol?.era === "legacy") {
          this.sendNotification("notifications/cancelled", {
            requestId: id,
            reason: `Orbit request timed out after ${timeoutMs}ms`,
          });
        }
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
        if (this.negotiatedProtocol?.era === "legacy") {
          this.sendNotification("notifications/cancelled", {
            requestId: id,
            reason: "Orbit tool execution cancelled",
          });
        }
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
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params: wireParams })}\n`,
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
    return request.then((result) => {
      if (
        modernVersion &&
        method !== "server/discover" &&
        !options.skipModernResultCheck
      ) {
        assertCompleteModernResult(result, method);
      }
      return result;
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
    let raw: unknown;
    try {
      raw = JSON.parse(line) as unknown;
    } catch {
      return;
    }
    const serverRequest = MCPServerRequestSchema.safeParse(raw);
    if (serverRequest.success) {
      void this.handleServerRequest(serverRequest.data);
      return;
    }
    const notification = MCPNotificationSchema.safeParse(raw);
    if (
      notification.success &&
      typeof raw === "object" &&
      raw !== null &&
      !("id" in raw)
    ) {
      if (notification.data.method === "notifications/tasks/status") {
        const task = MCPTaskSchema.safeParse(notification.data.params);
        if (task.success) {
          for (const listener of this.taskStatusListeners) {
            listener(task.data);
          }
        }
      }
      if (notification.data.method === "notifications/resources/updated") {
        const uri = z
          .string()
          .trim()
          .min(1)
          .max(2_048)
          .safeParse(notification.data.params?.uri);
        if (uri.success) {
          for (const listener of this.resourceUpdateListeners) {
            listener(uri.data);
          }
        }
      }
      if (notification.data.method === "notifications/elicitation/complete") {
        const elicitationId = z
          .string()
          .trim()
          .min(1)
          .max(512)
          .safeParse(notification.data.params?.elicitationId);
        if (elicitationId.success) {
          for (const listener of this.elicitationCompleteListeners) {
            listener(elicitationId.data);
          }
        }
      }
      if (notification.data.method === "notifications/roots/list_changed") {
        for (const listener of this.rootsListChangedListeners) listener();
      }
      const kinds = catalogKindsFromNotification(
        notification.data.method,
        notification.data.params,
      );
      if (kinds.length > 0) {
        for (const listener of this.catalogListeners) listener(kinds);
      }
      return;
    }
    const parsed = MCPResponseSchema.safeParse(raw);
    if (!parsed.success) return;
    const response = parsed.data;
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);
    pending.removeAbortListener?.();
    if (response.error) {
      pending.reject(
        createMcpJsonRpcError(
          response.error.code,
          safeMessage(response.error.message),
          "data" in response.error ? response.error.data : undefined,
        ),
      );
      return;
    }
    pending.resolve(response.result);
  }

  private async handleServerRequest(
    request: z.infer<typeof MCPServerRequestSchema>,
  ): Promise<void> {
    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      this.effectiveRequestTimeoutMs,
    );
    try {
      const interactionMethod =
        request.method === "elicitation/create" ||
        request.method === "sampling/createMessage" ||
        request.method === "roots/list"
          ? request.method
          : undefined;
      const interaction = interactionMethod
        ? {
            handler:
              interactionMethod === "elicitation/create"
                ? this.interactionHandlers.onElicitation
                : interactionMethod === "sampling/createMessage"
                  ? this.interactionHandlers.onSampling
                  : this.interactionHandlers.onRootsList,
            method: interactionMethod as MCPServerInteractionRequest["method"],
          }
        : undefined;
      if (!interaction?.handler) {
        this.sendResponse(request.id, undefined, {
          code: -32601,
          message:
            "Orbit has no approved handler for this MCP server interaction.",
        });
        return;
      }
      const result = await interaction.handler(
        {
          method: interaction.method,
          params: request.params,
          serverName: this.serverName,
        },
        abortController.signal,
      );
      const parsed =
        interaction.method === "roots/list"
          ? MCPRootsListSchema.safeParse(result)
          : z.record(z.unknown()).safeParse(result);
      if (!parsed.success) {
        this.sendResponse(request.id, undefined, {
          code: -32602,
          message:
            interaction.method === "roots/list"
              ? "MCP roots handler returned an invalid result."
              : "MCP interaction handler returned an invalid result.",
        });
        return;
      }
      this.sendResponse(request.id, parsed.data);
    } catch (error: unknown) {
      this.sendResponse(request.id, undefined, {
        code: -32000,
        message: redactSecrets(
          error instanceof Error ? error.message : String(error),
        ).slice(0, 2_000),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private sendResponse(
    id: number | string,
    result?: Record<string, unknown>,
    error?: { code: number; message: string },
  ): void {
    const stdin = this.child?.stdin;
    if (!this.isConnected || !stdin || !stdin.writable) return;
    stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id,
        ...(error ? { error } : { result: result ?? {} }),
      })}\n`,
    );
  }

  private cleanup(error: Error): void {
    this.isConnected = false;
    this.lastError = safeMessage(error);
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.removeAbortListener?.();
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}

function catalogKindsFromNotification(
  method: string,
  params: Record<string, unknown> | undefined,
): McpCatalogKind[] {
  const direct: Record<string, McpCatalogKind> = {
    "notifications/tools/list_changed": "tools",
    "notifications/resources/list_changed": "resources",
    "notifications/prompts/list_changed": "prompts",
  };
  if (direct[method]) return [direct[method]];
  if (
    method !== "notifications/list_changed" &&
    method !== "notifications/catalog_changed"
  ) {
    return [];
  }
  const candidates = [
    params?.collection,
    ...(Array.isArray(params?.collections) ? params.collections : []),
  ];
  return [...new Set(candidates)].filter(
    (value): value is McpCatalogKind =>
      typeof value === "string" &&
      MCP_CATALOG_KINDS.includes(value as McpCatalogKind),
  );
}

function waitForChildExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeListener("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
  });
}

/** Reject an initialization result that selects a protocol Orbit cannot honor. */
export function assertSupportedProtocolVersion(
  initializeResult: unknown,
): void {
  const result = z
    .object({ protocolVersion: z.string().min(1).max(100) })
    .passthrough()
    .parse(initializeResult);
  if (
    !MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(
      result.protocolVersion as (typeof MCP_SUPPORTED_PROTOCOL_VERSIONS)[number],
    )
  ) {
    throw new Error(
      `MCP server selected unsupported protocol version "${result.protocolVersion}". ` +
        `Supported versions: ${MCP_SUPPORTED_PROTOCOL_VERSIONS.join(", ")}.`,
    );
  }
}

function safeMessage(error: unknown): string {
  return sanitizeExternalErrorMessage(error, { singleLine: true });
}

function validateTaskId(taskId: string): string {
  const parsed = z.string().trim().min(1).max(512).safeParse(taskId);
  if (!parsed.success)
    throw new Error("MCP task id must be a non-empty string.");
  return parsed.data;
}

function validateResourceUri(uri: string): string {
  const parsed = z.string().trim().min(1).max(2_048).safeParse(uri);
  if (!parsed.success) {
    throw new Error("MCP resource URI must be a non-empty string.");
  }
  return parsed.data;
}

function waitForMcpTaskPoll(
  delayMs: number,
  abortSignal?: AbortSignal,
): Promise<void> {
  if (abortSignal?.aborted) {
    return Promise.reject(createAbortError("MCP task polling was cancelled."));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(
      () => {
        settled = true;
        abortSignal?.removeEventListener("abort", onAbort);
        resolve();
      },
      Math.max(1, delayMs),
    );
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      abortSignal?.removeEventListener("abort", onAbort);
      reject(createAbortError("MCP task polling was cancelled."));
    };
    abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Adapt one remote MCP tool to Orbit's validated local tool contract. */
export class DynamicMCPTool implements OrbitTool<
  Record<string, unknown>,
  string
> {
  public readonly name: string;
  public readonly description: string;
  public readonly inputSchema: z.ZodType<Record<string, unknown>>;
  public readonly inputJsonSchema: Record<string, unknown>;
  public readonly risk: ToolRisk;
  private readonly originalToolName: string;
  private readonly outputValidator?: (value: unknown) => void;

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
    this.inputSchema = createMcpInputSchema(
      toolDefinition.inputSchema,
      this.name,
    );
    this.outputValidator = toolDefinition.outputSchema
      ? createMcpOutputValidator(toolDefinition.outputSchema, this.name)
      : undefined;
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
      const text = flattenToolContents(response);
      if (response.isError) {
        return {
          ok: false,
          error: text || "Unknown MCP tool execution error.",
        };
      }
      if (this.outputValidator) {
        if (response.structuredContent === undefined) {
          return {
            ok: false,
            error:
              "MCP tool execution failed: the server omitted structured " +
              "content required by its output schema.",
          };
        }
        this.outputValidator(response.structuredContent);
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
  public readonly inputSchema = z.object({
    uri: z.string().trim().min(1).max(2_048),
  });
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
    resourceTemplates: MCPResourceTemplate[] = [],
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
    const templateCatalog = resourceTemplates
      .slice(0, MCP_RESOURCE_LIST_LIMIT)
      .map((template) => {
        const label = template.name ? ` (${template.name})` : "";
        return `- ${template.uriTemplate}${label}`;
      })
      .join("\n")
      .slice(0, MCP_RESOURCE_DESCRIPTION_LIMIT);
    this.description =
      `[MCP Resources: ${serverName}] Read a resource this server exposes ` +
      `by URI.` +
      (catalog ? `\nKnown resources:\n${catalog}${overflow}` : "") +
      (templateCatalog ? `\nKnown URI templates:\n${templateCatalog}` : "");
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

function isMethodNotFound(error: unknown): boolean {
  return error instanceof Error && /MCP error -32601\b/.test(error.message);
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
