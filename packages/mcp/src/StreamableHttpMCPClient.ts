import { z } from "zod";
import {
  readResponseJsonWithinLimit,
  readResponseTextWithinLimit,
  readRuntimePackageVersion,
  sanitizeExternalErrorMessage,
} from "@orbit-build/shared";
import {
  MCPPromptGetResultSchema,
  MCPPromptsListSchema,
  MCPResourceReadResultSchema,
  MCPResourceTemplatesListSchema,
  MCPResourcesListSchema,
  MCPToolCallResultSchema,
  MCPToolsListSchema,
  assertSupportedProtocolVersion,
  collectMcpPaginatedItems,
  flattenPromptMessages,
  flattenResourceContents,
  parseServerCapabilities,
  type MCPPrompt,
  type MCPResource,
  type MCPResourceTemplate,
  type MCPServerCapabilities,
  type MCPToolCallResult,
  type MCPToolClient,
  type MCPToolDefinition,
} from "./MCPClient.js";
import {
  MCPDiscoverResultSchema,
  MCP_LATEST_LEGACY_PROTOCOL_VERSION,
  MCP_LATEST_PROTOCOL_VERSION,
  McpJsonRpcError,
  assertCompleteModernResult,
  compileMirroredToolParameters,
  createMirroredToolHeaders,
  createModernHttpHeaders,
  createModernRequestParams,
  isLegacyProtocolVersion,
  isRecognizedModernProtocolError,
  modernVersionsFromUnsupportedError,
  selectModernProtocolVersion,
  type McpNegotiatedProtocol,
  type MirroredToolParameter,
} from "./McpProtocol.js";

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_OAUTH_CREDENTIAL_BYTES = 16_384;
const MAX_OAUTH_EXPIRES_IN_SECONDS = 365 * 24 * 60 * 60;
const McpSessionIdSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[\x21-\x7e]+$/);
const OAuthCredentialSchema = z
  .string()
  .min(1)
  .max(MAX_OAUTH_CREDENTIAL_BYTES)
  .refine((value) => !/[\r\n]/.test(value));
const OAuthExpiresInSchema = z.preprocess(
  (value) =>
    typeof value === "string" && /^\d{1,8}$/.test(value)
      ? Number(value)
      : value,
  z.number().finite().nonnegative().max(MAX_OAUTH_EXPIRES_IN_SECONDS),
);
const OAuthTokenResponseSchema = z
  .object({
    access_token: OAuthCredentialSchema,
    refresh_token: OAuthCredentialSchema.optional(),
    expires_in: OAuthExpiresInSchema.optional(),
  })
  .passthrough();
const HttpMcpResponseSchema = z
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
  .refine((response) => response.result !== undefined || response.error, {
    message: "MCP response requires a result or error.",
  });

export interface McpOAuthConfig {
  tokenUrl: string;
  clientIdEnv: string;
  /** Required for client_credentials; optional for public PKCE clients. */
  clientSecretEnv?: string;
  scope?: string;
  audience?: string;
  mode?: "client_credentials" | "authorization_code";
  /** Authorization endpoint; required for authorization_code mode. */
  authorizationUrl?: string;
}

/** @deprecated Use {@link McpOAuthConfig}. */
export type McpOAuthClientCredentials = McpOAuthConfig;

/** Persists the OAuth refresh token between Orbit runs (encrypted at rest). */
export interface McpOAuthTokenStore {
  getRefreshToken(): Promise<string | undefined>;
  setRefreshToken(token: string): Promise<void>;
}

export interface StreamableHttpMCPClientOptions {
  headers?: Record<string, string>;
  bearerTokenEnv?: string;
  oauth?: McpOAuthConfig;
  tokenStore?: McpOAuthTokenStore;
  clientVersion?: string;
  requestTimeoutMs?: number;
}

interface OAuthToken {
  accessToken: string;
  expiresAt: number;
}

interface HttpMcpRequestOptions {
  modernVersion?: string;
  extraHeaders?: Record<string, string>;
}

/** MCP Streamable HTTP client with bounded responses and OAuth client credentials. */
export class StreamableHttpMCPClient implements MCPToolClient {
  private requestId = 1;
  private sessionId: string | undefined;
  private token: OAuthToken | undefined;
  private started = false;
  private negotiatedProtocol: McpNegotiatedProtocol | undefined;
  private reinitializePromise: Promise<void> | undefined;
  private readonly mirroredToolParameters = new Map<
    string,
    MirroredToolParameter[]
  >();
  private readonly protocolWarnings: string[] = [];
  private serverCapabilities: MCPServerCapabilities = {
    tools: false,
    resources: false,
    prompts: false,
  };

  public constructor(
    public readonly serverName: string,
    private readonly url: string,
    private readonly options: StreamableHttpMCPClientOptions = {},
  ) {}

  public async start(): Promise<MCPToolDefinition[]> {
    if (this.started) {
      throw new Error(`MCP client "${this.serverName}" has already started.`);
    }
    assertSecureMcpUrl(this.url, "MCP server");
    if (this.options.oauth) {
      assertSecureMcpUrl(
        this.options.oauth.tokenUrl,
        "MCP OAuth token endpoint",
      );
      if (this.options.oauth.authorizationUrl) {
        assertSecureMcpUrl(
          this.options.oauth.authorizationUrl,
          "MCP OAuth authorization endpoint",
        );
      }
    }
    await this.negotiateProtocol();
    if (!this.serverCapabilities.tools) return [];
    return this.listTools();
  }

  private async listTools(): Promise<MCPToolDefinition[]> {
    const tools = await collectMcpPaginatedItems({
      method: "tools/list",
      request: (params) => this.request("tools/list", params),
      parse: (value) => {
        const page = MCPToolsListSchema.parse(value);
        return { items: page.tools, nextCursor: page.nextCursor };
      },
      identity: (tool) => tool.name,
      restartOnError: isPaginationSessionReset,
    });
    if (this.negotiatedProtocol?.era !== "modern") return tools;

    this.mirroredToolParameters.clear();
    return tools.filter((tool) => {
      try {
        this.mirroredToolParameters.set(
          tool.name,
          compileMirroredToolParameters(tool.inputSchema),
        );
        return true;
      } catch (error: unknown) {
        this.protocolWarnings.push(
          `Excluded MCP tool "${tool.name}": ${safeMessage(error)}.`,
        );
        return false;
      }
    });
  }

  public getServerCapabilities(): MCPServerCapabilities {
    return { ...this.serverCapabilities };
  }

  public getNegotiatedProtocol(): McpNegotiatedProtocol | undefined {
    return this.negotiatedProtocol ? { ...this.negotiatedProtocol } : undefined;
  }

  public getProtocolWarnings(): string[] {
    return [...this.protocolWarnings];
  }

  /** List resources when the server advertises them; empty list otherwise. */
  public async listResources(
    abortSignal?: AbortSignal,
  ): Promise<MCPResource[]> {
    if (!this.serverCapabilities.resources) return [];
    return collectMcpPaginatedItems({
      method: "resources/list",
      request: (params) => this.request("resources/list", params, abortSignal),
      parse: (value) => {
        const page = MCPResourcesListSchema.parse(value);
        return { items: page.resources, nextCursor: page.nextCursor };
      },
      identity: (resource) => resource.uri,
      restartOnError: isPaginationSessionReset,
    });
  }

  /** Read one resource by URI and flatten its contents to text. */
  public async readResource(
    uri: string,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const result = MCPResourceReadResultSchema.parse(
      await this.request("resources/read", { uri }, abortSignal),
    );
    return flattenResourceContents(result);
  }

  public async listResourceTemplates(
    abortSignal?: AbortSignal,
  ): Promise<MCPResourceTemplate[]> {
    if (!this.serverCapabilities.resources) return [];
    try {
      return await collectMcpPaginatedItems({
        method: "resources/templates/list",
        request: (params) =>
          this.request("resources/templates/list", params, abortSignal),
        parse: (value) => {
          const page = MCPResourceTemplatesListSchema.parse(value);
          return {
            items: page.resourceTemplates,
            nextCursor: page.nextCursor,
          };
        },
        identity: (template) => template.uriTemplate,
        restartOnError: isPaginationSessionReset,
      });
    } catch (error: unknown) {
      if (error instanceof Error && /MCP error -32601\b/.test(error.message)) {
        return [];
      }
      throw error;
    }
  }

  /** List prompts when the server advertises them; empty list otherwise. */
  public async listPrompts(abortSignal?: AbortSignal): Promise<MCPPrompt[]> {
    if (!this.serverCapabilities.prompts) return [];
    return collectMcpPaginatedItems({
      method: "prompts/list",
      request: (params) => this.request("prompts/list", params, abortSignal),
      parse: (value) => {
        const page = MCPPromptsListSchema.parse(value);
        return { items: page.prompts, nextCursor: page.nextCursor };
      },
      identity: (prompt) => prompt.name,
      restartOnError: isPaginationSessionReset,
    });
  }

  /** Resolve one prompt with arguments and flatten it to prompt text. */
  public async getPrompt(
    name: string,
    args?: Record<string, string>,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const result = MCPPromptGetResultSchema.parse(
      await this.request(
        "prompts/get",
        { name, arguments: args ?? {} },
        abortSignal,
      ),
    );
    return flattenPromptMessages(result);
  }

  public async callTool(
    originalToolName: string,
    args: Record<string, unknown>,
    abortSignal?: AbortSignal,
  ): Promise<MCPToolCallResult> {
    if (!this.started) {
      throw new Error(`MCP client "${this.serverName}" is not connected.`);
    }
    const call = () =>
      this.request(
        "tools/call",
        { name: originalToolName, arguments: args },
        abortSignal,
      );
    try {
      return MCPToolCallResultSchema.parse(await call());
    } catch (error: unknown) {
      if (
        this.negotiatedProtocol?.era !== "modern" ||
        !(error instanceof McpJsonRpcError) ||
        error.code !== -32020
      ) {
        throw error;
      }
      await this.listTools();
      return MCPToolCallResultSchema.parse(await call());
    }
  }

  public async stop(): Promise<void> {
    try {
      if (
        this.started &&
        this.negotiatedProtocol?.era === "legacy" &&
        this.sessionId
      ) {
        await this.terminateSession().catch(() => undefined);
      }
    } finally {
      this.started = false;
      this.sessionId = undefined;
      this.negotiatedProtocol = undefined;
      this.reinitializePromise = undefined;
      this.mirroredToolParameters.clear();
      this.protocolWarnings.length = 0;
      this.token = undefined;
    }
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
    abortSignal?: AbortSignal,
    allowSessionRecovery = true,
    options: HttpMcpRequestOptions = {},
  ): Promise<unknown> {
    if (
      this.negotiatedProtocol?.era === "legacy" &&
      method !== "initialize" &&
      this.reinitializePromise
    ) {
      await this.reinitializePromise;
    }
    const id = this.requestId++;
    let response: unknown;
    try {
      response = await this.post(
        { jsonrpc: "2.0", id, method, params },
        abortSignal,
        options,
      );
    } catch (error: unknown) {
      if (
        error instanceof McpSessionExpiredError &&
        allowSessionRecovery &&
        this.started &&
        this.negotiatedProtocol?.era === "legacy" &&
        method !== "initialize"
      ) {
        await this.reinitialize(abortSignal);
        if ("cursor" in params) {
          throw new McpPaginationSessionResetError(this.serverName);
        }
        return this.request(method, params, abortSignal, false);
      }
      if (
        error instanceof Error &&
        error.name === "AbortError" &&
        this.negotiatedProtocol?.era === "legacy" &&
        method !== "initialize"
      ) {
        void this.notify("notifications/cancelled", {
          requestId: id,
          reason: abortSignal?.aborted
            ? "Orbit request cancelled"
            : "Orbit request timed out",
        }).catch(() => undefined);
      }
      throw error;
    }
    const parsed = HttpMcpResponseSchema.safeParse(response);
    if (!parsed.success || parsed.data.id !== id) {
      throw new Error(
        `MCP server "${this.serverName}" returned an invalid response for request ${id}.`,
      );
    }
    if (parsed.data.error) {
      throw new McpJsonRpcError(
        parsed.data.error.code,
        safeMessage(parsed.data.error.message),
        "data" in parsed.data.error ? parsed.data.error.data : undefined,
      );
    }
    const modernVersion =
      options.modernVersion ??
      (this.negotiatedProtocol?.era === "modern"
        ? this.negotiatedProtocol.version
        : undefined);
    if (modernVersion && method !== "server/discover") {
      assertCompleteModernResult(parsed.data.result, method);
    }
    return parsed.data.result;
  }

  private async negotiateProtocol(abortSignal?: AbortSignal): Promise<void> {
    this.sessionId = undefined;
    this.negotiatedProtocol = undefined;
    let rawDiscoverResult: unknown;
    try {
      rawDiscoverResult = await this.request(
        "server/discover",
        {},
        abortSignal,
        false,
        { modernVersion: MCP_LATEST_PROTOCOL_VERSION },
      );
    } catch (error: unknown) {
      if (error instanceof McpJsonRpcError && error.code === -32022) {
        const versions = modernVersionsFromUnsupportedError(error);
        if (selectModernProtocolVersion(versions)) throw error;
        if (versions.some(isLegacyProtocolVersion)) {
          await this.initializeSession(abortSignal);
          return;
        }
        throw new Error(
          `MCP server "${this.serverName}" has no protocol revision supported by Orbit. ` +
            `Server versions: ${versions.join(", ") || "unknown"}.`,
        );
      }
      if (isRecognizedModernProtocolError(error)) throw error;
      await this.initializeSession(abortSignal);
      return;
    }

    const parsedDiscover = MCPDiscoverResultSchema.safeParse(rawDiscoverResult);
    if (!parsedDiscover.success) {
      // Some session-era servers respond to unknown methods with a generic
      // success envelope instead of JSON-RPC method-not-found. Treat a result
      // that is not structurally modern as a legacy negotiation signal.
      await this.initializeSession(abortSignal);
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
    this.started = true;
  }

  private async initializeSession(abortSignal?: AbortSignal): Promise<void> {
    this.sessionId = undefined;
    this.negotiatedProtocol = { era: "legacy", version: "" };
    const initializeResult = await this.request(
      "initialize",
      {
        protocolVersion: MCP_LATEST_LEGACY_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: "orbit-client",
          version:
            this.options.clientVersion ??
            readRuntimePackageVersion(import.meta.url),
        },
      },
      abortSignal,
      false,
    );
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
    this.started = true;
    await this.notify("notifications/initialized");
  }

  private async reinitialize(abortSignal?: AbortSignal): Promise<void> {
    if (!this.reinitializePromise) {
      this.reinitializePromise = this.initializeSession(abortSignal).finally(
        () => {
          this.reinitializePromise = undefined;
        },
      );
    }
    await this.reinitializePromise;
  }

  private async notify(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<void> {
    await this.post({ jsonrpc: "2.0", method, params });
  }

  private async post(
    payload: Record<string, unknown>,
    externalSignal?: AbortSignal,
    options: HttpMcpRequestOptions = {},
  ): Promise<unknown> {
    let refreshed = false;
    while (true) {
      const isModern =
        options.modernVersion !== undefined ||
        this.negotiatedProtocol?.era === "modern";
      const modernVersion =
        options.modernVersion ??
        (this.negotiatedProtocol?.era === "modern"
          ? this.negotiatedProtocol.version
          : undefined);
      const requestSessionId = isModern ? undefined : this.sessionId;
      const method = typeof payload.method === "string" ? payload.method : "";
      const rawParams =
        typeof payload.params === "object" && payload.params !== null
          ? (payload.params as Record<string, unknown>)
          : {};
      const wireParams = modernVersion
        ? createModernRequestParams(
            rawParams,
            modernVersion,
            this.options.clientVersion ??
              readRuntimePackageVersion(import.meta.url),
          )
        : rawParams;
      const wirePayload = { ...payload, params: wireParams };
      const modernHeaders = modernVersion
        ? createModernHttpHeaders(method, wireParams, modernVersion)
        : {};
      const mirroredHeaders =
        modernVersion && method === "tools/call"
          ? createMirroredToolHeaders(
              this.mirroredToolParameters.get(String(rawParams.name)) ?? [],
              typeof rawParams.arguments === "object" &&
                rawParams.arguments !== null
                ? (rawParams.arguments as Record<string, unknown>)
                : {},
            )
          : {};
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
      );
      const onAbort = () => controller.abort();
      externalSignal?.addEventListener("abort", onAbort, { once: true });
      if (externalSignal?.aborted) onAbort();
      try {
        const authorization = await this.authorizationHeader(
          refreshed,
          controller.signal,
        );
        const response = await fetch(this.url, {
          method: "POST",
          headers: {
            ...this.options.headers,
            Accept: "application/json, text/event-stream",
            "Content-Type": "application/json",
            ...(authorization ? { Authorization: authorization } : {}),
            ...(requestSessionId ? { "Mcp-Session-Id": requestSessionId } : {}),
            ...(!isModern && this.negotiatedProtocol?.version
              ? { "MCP-Protocol-Version": this.negotiatedProtocol.version }
              : {}),
            ...modernHeaders,
            ...mirroredHeaders,
            ...options.extraHeaders,
          },
          body: JSON.stringify(wirePayload),
          signal: controller.signal,
          redirect: "error",
        });
        if (response.status === 401 && this.options.oauth && !refreshed) {
          await response.body?.cancel().catch(() => undefined);
          this.token = undefined;
          refreshed = true;
          continue;
        }
        if (response.status === 404 && requestSessionId) {
          await response.body?.cancel().catch(() => undefined);
          if (this.sessionId === requestSessionId) {
            this.sessionId = undefined;
          }
          throw new McpSessionExpiredError(this.serverName);
        }
        if (!response.ok) {
          const detail = (
            await readResponseTextWithinLimit(
              response,
              64 * 1024,
              "MCP error response",
            )
          ).slice(0, 2_000);
          const protocolError = parseHttpProtocolError(detail);
          if (protocolError) throw protocolError;
          throw new McpHttpResponseError(
            response.status,
            `MCP HTTP ${response.status}: ${safeMessage(detail || response.statusText)}`,
          );
        }
        const sessionId = isModern
          ? null
          : response.headers.get("mcp-session-id");
        if (sessionId) {
          const parsedSessionId = McpSessionIdSchema.safeParse(sessionId);
          if (!parsedSessionId.success) {
            throw new Error(
              `MCP server "${this.serverName}" returned an invalid session ID.`,
            );
          }
          if (this.sessionId && this.sessionId !== parsedSessionId.data) {
            throw new Error(
              `MCP server "${this.serverName}" changed its session ID unexpectedly.`,
            );
          }
          this.sessionId = parsedSessionId.data;
        }
        if (response.status === 202 || response.status === 204)
          return undefined;
        const body = await readResponseTextWithinLimit(
          response,
          MAX_RESPONSE_BYTES,
          "MCP HTTP response",
        );
        const contentType = response.headers.get("content-type") || "";
        return contentType.includes("text/event-stream")
          ? parseSseJson(
              body,
              typeof payload.id === "number" ? payload.id : undefined,
            )
          : JSON.parse(body);
      } catch (error: unknown) {
        if (controller.signal.aborted) {
          const aborted = new Error(
            externalSignal?.aborted
              ? `MCP request to "${this.serverName}" was cancelled.`
              : `MCP request to "${this.serverName}" timed out.`,
          );
          aborted.name = "AbortError";
          throw aborted;
        }
        if (
          error instanceof McpSessionExpiredError ||
          error instanceof McpJsonRpcError ||
          error instanceof McpHttpResponseError
        ) {
          throw error;
        }
        throw new Error(
          `MCP server "${this.serverName}" request failed: ${safeMessage(error)}`,
        );
      } finally {
        clearTimeout(timeout);
        externalSignal?.removeEventListener("abort", onAbort);
      }
    }
  }

  private async terminateSession(): Promise<void> {
    const sessionId = this.sessionId;
    if (!sessionId) return;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
    );
    try {
      const authorization = await this.authorizationHeader(
        false,
        controller.signal,
      );
      const response = await fetch(this.url, {
        method: "DELETE",
        headers: {
          Accept: "application/json, text/event-stream",
          ...this.options.headers,
          ...(authorization ? { Authorization: authorization } : {}),
          "Mcp-Session-Id": sessionId,
          ...(this.negotiatedProtocol?.version
            ? { "MCP-Protocol-Version": this.negotiatedProtocol.version }
            : {}),
        },
        signal: controller.signal,
        redirect: "error",
      });
      await response.body?.cancel().catch(() => undefined);
      if (!response.ok && response.status !== 404 && response.status !== 405) {
        throw new Error(
          `MCP session termination failed with HTTP ${response.status}.`,
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private async authorizationHeader(
    forceRefresh: boolean,
    abortSignal: AbortSignal,
  ): Promise<string> {
    const oauth = this.options.oauth;
    if (oauth) {
      if (
        forceRefresh ||
        !this.token ||
        this.token.expiresAt - Date.now() < 30_000
      ) {
        this.token =
          oauth.mode === "authorization_code"
            ? await this.refreshAuthorizationCodeToken(oauth, abortSignal)
            : await fetchClientCredentialsToken(oauth, abortSignal);
      }
      return `Bearer ${this.token.accessToken}`;
    }
    const token = this.options.bearerTokenEnv
      ? process.env[this.options.bearerTokenEnv]
      : undefined;
    return token ? `Bearer ${token}` : "";
  }

  private async refreshAuthorizationCodeToken(
    oauth: McpOAuthConfig,
    abortSignal: AbortSignal,
  ): Promise<OAuthToken> {
    const refreshToken = await this.options.tokenStore?.getRefreshToken();
    if (!refreshToken) {
      throw new Error(
        `MCP server "${this.serverName}" requires an OAuth login. ` +
          `Run \`orbit mcp login ${this.serverName}\` first.`,
      );
    }
    const grant = await exchangeOAuthGrant(
      oauth,
      {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      },
      { signal: abortSignal, timeoutMs: this.options.requestTimeoutMs },
    );
    if (grant.refreshToken && grant.refreshToken !== refreshToken) {
      await this.options.tokenStore
        ?.setRefreshToken(grant.refreshToken)
        .catch(() => undefined);
    }
    return grant.token;
  }
}

class McpSessionExpiredError extends Error {
  public readonly name = "McpSessionExpiredError";

  public constructor(serverName: string) {
    super(`MCP session for "${serverName}" expired.`);
  }
}

class McpHttpResponseError extends Error {
  public readonly name = "McpHttpResponseError";

  public constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

class McpPaginationSessionResetError extends Error {
  public readonly name = "McpPaginationSessionResetError";

  public constructor(serverName: string) {
    super(`MCP pagination for "${serverName}" must restart after recovery.`);
  }
}

function isPaginationSessionReset(error: unknown): boolean {
  return error instanceof McpPaginationSessionResetError;
}

function parseHttpProtocolError(body: string): McpJsonRpcError | undefined {
  if (!body) return undefined;
  try {
    const parsed = HttpMcpResponseSchema.safeParse(JSON.parse(body) as unknown);
    if (!parsed.success || !parsed.data.error) return undefined;
    return new McpJsonRpcError(
      parsed.data.error.code,
      safeMessage(parsed.data.error.message),
      "data" in parsed.data.error ? parsed.data.error.data : undefined,
    );
  } catch {
    return undefined;
  }
}

interface OAuthGrantResult {
  token: OAuthToken;
  refreshToken?: string;
}

export interface OAuthGrantRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Exchange a grant at the token endpoint. Confidential clients authenticate
 * with HTTP Basic; public (PKCE) clients pass `client_id` in the form body.
 * Error text never includes the response body: token endpoints echo grant
 * parameters back, and opaque codes are not covered by redactSecrets.
 */
export async function exchangeOAuthGrant(
  oauth: McpOAuthConfig,
  grantParams: Record<string, string>,
  options: OAuthGrantRequestOptions = {},
): Promise<OAuthGrantResult> {
  const rawClientId = process.env[oauth.clientIdEnv];
  if (!rawClientId) {
    throw new Error(
      `MCP OAuth credentials are missing. Set ${oauth.clientIdEnv}.`,
    );
  }
  const clientId = OAuthCredentialSchema.safeParse(rawClientId);
  if (!clientId.success) {
    throw new Error(`MCP OAuth client ID in ${oauth.clientIdEnv} is invalid.`);
  }
  const clientSecret = oauth.clientSecretEnv
    ? process.env[oauth.clientSecretEnv]
    : undefined;
  const validatedClientSecret =
    clientSecret === undefined
      ? undefined
      : OAuthCredentialSchema.safeParse(clientSecret);
  if (validatedClientSecret && !validatedClientSecret.success) {
    throw new Error(
      `MCP OAuth client secret in ${oauth.clientSecretEnv} is invalid.`,
    );
  }
  const body = new URLSearchParams(grantParams);
  if (oauth.scope && grantParams.grant_type !== "refresh_token") {
    body.set("scope", oauth.scope);
  }
  if (oauth.audience) body.set("audience", oauth.audience);
  if (!clientSecret) body.set("client_id", clientId.data);
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(),
    options.timeoutMs ?? REQUEST_TIMEOUT_MS,
  );
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutController.signal])
    : timeoutController.signal;
  let parsedResult: unknown;
  try {
    const response = await fetch(oauth.tokenUrl, {
      method: "POST",
      headers: {
        ...(validatedClientSecret?.success
          ? {
              Authorization: `Basic ${Buffer.from(
                `${clientId.data}:${validatedClientSecret.data}`,
              ).toString("base64")}`,
            }
          : {}),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      redirect: "error",
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(
        `MCP OAuth token request failed with HTTP ${response.status}.`,
      );
    }
    parsedResult = await readResponseJsonWithinLimit(
      response,
      1024 * 1024,
      "MCP OAuth response",
    );
  } catch (error: unknown) {
    if (signal.aborted) {
      const aborted = new Error(
        options.signal?.aborted
          ? "MCP OAuth token request was cancelled."
          : "MCP OAuth token request timed out.",
      );
      aborted.name = "AbortError";
      throw aborted;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const result = OAuthTokenResponseSchema.safeParse(parsedResult);
  if (!result.success) {
    throw new Error(
      "MCP OAuth response did not include a valid bounded access token.",
    );
  }
  const expiresIn =
    result.data.expires_in !== undefined
      ? Math.max(60, result.data.expires_in)
      : 3600;
  return {
    token: {
      accessToken: result.data.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    },
    refreshToken: result.data.refresh_token,
  };
}

async function fetchClientCredentialsToken(
  oauth: McpOAuthConfig,
  abortSignal: AbortSignal,
): Promise<OAuthToken> {
  if (!oauth.clientSecretEnv) {
    throw new Error(
      "MCP OAuth client_credentials mode requires clientSecretEnv.",
    );
  }
  if (!process.env[oauth.clientSecretEnv]) {
    throw new Error(
      `MCP OAuth credentials are missing. Set ${oauth.clientIdEnv} and ${oauth.clientSecretEnv}.`,
    );
  }
  const grant = await exchangeOAuthGrant(
    oauth,
    {
      grant_type: "client_credentials",
    },
    { signal: abortSignal },
  );
  return grant.token;
}

function parseSseJson(body: string, expectedId?: number): unknown {
  const dataEntries = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]");
  for (const data of dataEntries) {
    const parsed: unknown = JSON.parse(data);
    if (
      expectedId === undefined ||
      (typeof parsed === "object" &&
        parsed !== null &&
        "id" in parsed &&
        parsed.id === expectedId)
    ) {
      return parsed;
    }
  }
  throw new Error("MCP SSE response contained no matching JSON-RPC response.");
}

function safeMessage(value: unknown): string {
  return sanitizeExternalErrorMessage(value, { singleLine: true });
}

function assertSecureMcpUrl(value: string, label: string): void {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const loopback =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(`${label} must use HTTPS unless it is on loopback.`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} cannot contain URL credentials.`);
  }
}
