import { Buffer } from "buffer";
import { z } from "zod";

/** Stateless MCP revisions that carry capabilities on every request. */
export const MCP_MODERN_PROTOCOL_VERSIONS = ["2026-07-28"] as const;

/** Session-oriented MCP revisions that use the initialize handshake. */
export const MCP_LEGACY_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;

export const MCP_SUPPORTED_PROTOCOL_VERSIONS = [
  ...MCP_MODERN_PROTOCOL_VERSIONS,
  ...MCP_LEGACY_PROTOCOL_VERSIONS,
] as const;
export const MCP_LATEST_PROTOCOL_VERSION = MCP_MODERN_PROTOCOL_VERSIONS[0];
export const MCP_LATEST_LEGACY_PROTOCOL_VERSION =
  MCP_LEGACY_PROTOCOL_VERSIONS[0];

export type McpProtocolEra = "modern" | "legacy";

export interface McpNegotiatedProtocol {
  era: McpProtocolEra;
  version: string;
}

/** Durable MCP task state shared by stdio and HTTP clients. */
export const MCP_TASK_STATUS_VALUES = [
  "working",
  "input_required",
  "completed",
  "failed",
  "cancelled",
] as const;

export const MCPTaskSchema = z.object({
  taskId: z.string().min(1).max(512),
  status: z.enum(MCP_TASK_STATUS_VALUES),
  statusMessage: z.string().max(10_000).optional(),
  createdAt: z.string().datetime(),
  lastUpdatedAt: z.string().datetime(),
  ttl: z.number().int().nonnegative().nullable().optional(),
  pollInterval: z.number().int().positive().max(300_000).optional(),
});

export const MCPCreateTaskResultSchema = z.object({
  task: MCPTaskSchema,
  _meta: z.record(z.unknown()).optional(),
});

/** Bounded user-input envelopes returned by modern MCP operations. */
export const MCPInputRequiredResultSchema = z
  .object({
    resultType: z.literal("input_required"),
    inputRequests: z.array(z.record(z.unknown())).max(32).default([]),
  })
  .passthrough();

export type MCPTask = z.infer<typeof MCPTaskSchema>;

const MCP_IMPLEMENTATION_NAME_MAX_CHARS = 512;
const MCP_VERSION_MAX_CHARS = 100;
const MCP_DISCOVERY_INSTRUCTIONS_MAX_CHARS = 100_000;

export const MCPDiscoverResultSchema = z
  .object({
    resultType: z.string().min(1).max(100),
    supportedVersions: z
      .array(z.string().min(1).max(MCP_VERSION_MAX_CHARS))
      .min(1)
      .max(100),
    capabilities: z.record(z.unknown()).default({}),
    instructions: z
      .string()
      .max(MCP_DISCOVERY_INSTRUCTIONS_MAX_CHARS)
      .optional(),
    ttlMs: z.number().finite().nonnegative(),
    cacheScope: z.enum(["public", "private"]),
    _meta: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type MCPDiscoverResult = z.infer<typeof MCPDiscoverResultSchema>;

/** Preserve structured protocol errors so dual-era negotiation stays deterministic. */
export class McpJsonRpcError extends Error {
  public readonly name: string = "McpJsonRpcError";

  public constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(`MCP error ${code}: ${message}`);
  }
}

/** A URL elicitation that a server says must complete before retrying work. */
export const MCPUrlElicitationSchema = z.object({
  mode: z.literal("url"),
  elicitationId: z.string().min(1).max(512),
  url: z.string().url().max(4_096),
  message: z.string().min(1).max(10_000),
});

export const MCPUrlElicitationRequiredDataSchema = z.object({
  elicitations: z.array(MCPUrlElicitationSchema).min(1).max(32),
});

export type MCPUrlElicitation = z.infer<typeof MCPUrlElicitationSchema>;

/**
 * Structured MCP error for the URL-mode out-of-band authorization flow.
 *
 * Keeping the required elicitations typed lets a UI show the exact host and
 * provide retry/cancel controls without scraping an error string.
 */
export class McpUrlElicitationRequiredError extends McpJsonRpcError {
  public readonly name = "McpUrlElicitationRequiredError";
  public readonly elicitations: readonly MCPUrlElicitation[];

  public constructor(
    message: string,
    elicitations: readonly MCPUrlElicitation[],
  ) {
    super(-32042, message, { elicitations });
    this.elicitations = elicitations;
  }
}

/** Preserve the protocol-specific URL elicitation error when decoding JSON-RPC. */
export function createMcpJsonRpcError(
  code: number,
  message: string,
  data?: unknown,
): McpJsonRpcError {
  if (code === -32042) {
    const parsed = MCPUrlElicitationRequiredDataSchema.safeParse(data);
    if (parsed.success) {
      return new McpUrlElicitationRequiredError(
        message,
        parsed.data.elicitations,
      );
    }
  }
  return new McpJsonRpcError(code, message, data);
}

/** Structured modern-protocol pause that must be surfaced to a user/UI. */
export class McpInputRequiredError extends Error {
  public readonly name = "McpInputRequiredError";

  public constructor(
    public readonly method: string,
    public readonly inputRequests: readonly Record<string, unknown>[],
  ) {
    super(
      `Modern MCP ${method} requires additional client input; Orbit paused the operation instead of guessing.`,
    );
  }
}

/** Metadata required on every request in stateless MCP revisions. */
export function createModernRequestParams(
  params: Record<string, unknown>,
  protocolVersion: string,
  clientVersion: string,
  clientCapabilities: Record<string, unknown> = {},
): Record<string, unknown> {
  const existingMeta = isRecord(params._meta) ? params._meta : {};
  return {
    ...params,
    _meta: {
      ...existingMeta,
      "io.modelcontextprotocol/protocolVersion": protocolVersion,
      "io.modelcontextprotocol/clientInfo": {
        name: "orbit-client".slice(0, MCP_IMPLEMENTATION_NAME_MAX_CHARS),
        version: clientVersion.slice(0, MCP_VERSION_MAX_CHARS),
      },
      "io.modelcontextprotocol/clientCapabilities": clientCapabilities,
    },
  };
}

/** Pick Orbit's most recent modern revision also advertised by the server. */
export function selectModernProtocolVersion(
  supportedVersions: readonly string[],
): string | undefined {
  return MCP_MODERN_PROTOCOL_VERSIONS.find((version) =>
    supportedVersions.includes(version),
  );
}

export function isModernProtocolVersion(version: string): boolean {
  return (MCP_MODERN_PROTOCOL_VERSIONS as readonly string[]).includes(version);
}

export function isLegacyProtocolVersion(version: string): boolean {
  return (MCP_LEGACY_PROTOCOL_VERSIONS as readonly string[]).includes(version);
}

/** Errors allocated by the stateless protocol must not trigger legacy fallback. */
export function isRecognizedModernProtocolError(error: unknown): boolean {
  return (
    error instanceof McpJsonRpcError &&
    [-32022, -32021, -32020].includes(error.code)
  );
}

export function modernVersionsFromUnsupportedError(error: unknown): string[] {
  if (!(error instanceof McpJsonRpcError) || error.code !== -32022) return [];
  if (!isRecord(error.data) || !Array.isArray(error.data.supported)) return [];
  return error.data.supported.filter(
    (value): value is string => typeof value === "string",
  );
}

/** Modern results are explicitly typed; Orbit currently consumes completed results. */
export function assertCompleteModernResult(
  result: unknown,
  method: string,
): void {
  const parsed = z
    .object({ resultType: z.string().min(1).max(100) })
    .passthrough()
    .safeParse(result);
  if (!parsed.success) {
    throw new Error(
      `Modern MCP ${method} returned a result without a valid resultType.`,
    );
  }
  if (parsed.data.resultType === "complete") return;
  if (parsed.data.resultType === "input_required") {
    const inputRequired = MCPInputRequiredResultSchema.parse(parsed.data);
    throw new McpInputRequiredError(method, inputRequired.inputRequests);
  }
  throw new Error(
    `Modern MCP ${method} returned unsupported resultType "${parsed.data.resultType}".`,
  );
}

/** Encode mirrored HTTP metadata without allowing header injection. */
export function encodeMcpHeaderValue(value: string): string {
  const plainAscii = /^[\x20-\x7e]+$/.test(value);
  const trimmed = value.trim() === value;
  const sentinel = value.startsWith("=?base64?") && value.endsWith("?=");
  if (plainAscii && trimmed && !sentinel) return value;
  return `=?base64?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export function createModernHttpHeaders(
  method: string,
  params: Record<string, unknown>,
  protocolVersion: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "MCP-Protocol-Version": protocolVersion,
    "Mcp-Method": method,
  };
  const name =
    typeof params.name === "string"
      ? params.name
      : typeof params.uri === "string"
        ? params.uri
        : undefined;
  if (
    name !== undefined &&
    ["tools/call", "resources/read", "prompts/get"].includes(method)
  ) {
    headers["Mcp-Name"] = encodeMcpHeaderValue(name);
  }
  return headers;
}

export interface MirroredToolParameter {
  headerName: string;
  path: string[];
  type: "string" | "number" | "integer" | "boolean";
}

const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Validate and compile modern `x-mcp-header` annotations from a tool schema. */
export function compileMirroredToolParameters(
  inputSchema: Record<string, unknown>,
): MirroredToolParameter[] {
  const parameters: MirroredToolParameter[] = [];
  const headerNames = new Set<string>();

  const visit = (
    value: unknown,
    path: string[],
    annotationAllowed: boolean,
  ): void => {
    if (Array.isArray(value)) {
      for (const nested of value) visit(nested, path, false);
      return;
    }
    if (!isRecord(value)) return;
    if ("x-mcp-header" in value) {
      const headerName = value["x-mcp-header"];
      const type = value.type;
      if (
        !annotationAllowed ||
        typeof headerName !== "string" ||
        !HTTP_TOKEN.test(headerName) ||
        !["string", "number", "integer", "boolean"].includes(String(type))
      ) {
        throw new Error("invalid x-mcp-header annotation");
      }
      const normalizedName = headerName.toLowerCase();
      if (headerNames.has(normalizedName)) {
        throw new Error(`duplicate x-mcp-header annotation "${headerName}"`);
      }
      headerNames.add(normalizedName);
      parameters.push({
        headerName,
        path,
        type: type as MirroredToolParameter["type"],
      });
    }

    for (const [key, nested] of Object.entries(value)) {
      if (key === "x-mcp-header") continue;
      if (key === "properties" && isRecord(nested)) {
        for (const [propertyName, propertySchema] of Object.entries(nested)) {
          visit(propertySchema, [...path, propertyName], true);
        }
        continue;
      }
      if (key !== "type" && key !== "description" && key !== "default") {
        visit(nested, path, false);
      }
    }
  };

  visit(inputSchema, [], false);
  return parameters;
}

export function createMirroredToolHeaders(
  parameters: readonly MirroredToolParameter[],
  args: Record<string, unknown>,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const parameter of parameters) {
    let value: unknown = args;
    for (const segment of parameter.path) {
      value = isRecord(value) ? value[segment] : undefined;
    }
    if (value === undefined || value === null) continue;
    const valid =
      (parameter.type === "string" && typeof value === "string") ||
      (parameter.type === "boolean" && typeof value === "boolean") ||
      ((parameter.type === "number" || parameter.type === "integer") &&
        typeof value === "number" &&
        Number.isFinite(value) &&
        (parameter.type === "number" || Number.isSafeInteger(value)));
    if (!valid) {
      throw new Error(
        `MCP mirrored parameter "${parameter.path.join(".")}" has an invalid value.`,
      );
    }
    headers[`Mcp-Param-${parameter.headerName}`] = encodeMcpHeaderValue(
      String(value),
    );
  }
  return headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
