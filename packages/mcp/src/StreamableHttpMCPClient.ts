import { randomUUID } from "crypto";
import { z } from "zod";
import {
  readResponseJsonWithinLimit,
  readResponseTextWithinLimit,
  readRuntimePackageVersion,
  redactSecrets,
} from "@orbit-build/shared";
import {
  MCPPromptGetResultSchema,
  MCPPromptsListSchema,
  MCPResourceReadResultSchema,
  MCPResourcesListSchema,
  MCPToolCallResultSchema,
  MCPToolsListSchema,
  flattenPromptMessages,
  flattenResourceContents,
  parseServerCapabilities,
  type MCPPrompt,
  type MCPResource,
  type MCPServerCapabilities,
  type MCPToolCallResult,
  type MCPToolClient,
  type MCPToolDefinition,
} from "./MCPClient.js";

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_OAUTH_CREDENTIAL_BYTES = 16_384;
const MAX_OAUTH_EXPIRES_IN_SECONDS = 365 * 24 * 60 * 60;
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

/** MCP Streamable HTTP client with bounded responses and OAuth client credentials. */
export class StreamableHttpMCPClient implements MCPToolClient {
  private requestId = 1;
  private sessionId: string | undefined;
  private token: OAuthToken | undefined;
  private started = false;
  private serverCapabilities: MCPServerCapabilities = {
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
    const initializeResult = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "orbit-client",
        version:
          this.options.clientVersion ??
          readRuntimePackageVersion(import.meta.url),
      },
    });
    this.serverCapabilities = parseServerCapabilities(initializeResult);
    this.started = true;
    await this.notify("notifications/initialized");
    const result = MCPToolsListSchema.parse(
      await this.request("tools/list", {}),
    );
    return result.tools;
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
      await this.request("resources/list", {}, abortSignal),
    );
    return result.resources;
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

  /** List prompts when the server advertises them; empty list otherwise. */
  public async listPrompts(abortSignal?: AbortSignal): Promise<MCPPrompt[]> {
    if (!this.serverCapabilities.prompts) return [];
    const result = MCPPromptsListSchema.parse(
      await this.request("prompts/list", {}, abortSignal),
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
    return MCPToolCallResultSchema.parse(
      await this.request(
        "tools/call",
        { name: originalToolName, arguments: args },
        abortSignal,
      ),
    );
  }

  public async stop(): Promise<void> {
    if (this.started) {
      await this.notify("notifications/cancelled", {
        requestId: randomUUID(),
        reason: "Orbit MCP runtime stopped",
      }).catch(() => undefined);
    }
    this.started = false;
    this.sessionId = undefined;
    this.token = undefined;
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
    abortSignal?: AbortSignal,
  ): Promise<unknown> {
    const id = this.requestId++;
    const response = await this.post(
      { jsonrpc: "2.0", id, method, params },
      abortSignal,
    );
    if (!response || typeof response !== "object") {
      throw new Error(`MCP server "${this.serverName}" returned no response.`);
    }
    const record = response as Record<string, unknown>;
    if (record.error && typeof record.error === "object") {
      const error = record.error as Record<string, unknown>;
      throw new Error(
        `MCP error ${String(error.code ?? "unknown")}: ${safeMessage(error.message)}`,
      );
    }
    return record.result;
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
  ): Promise<unknown> {
    let refreshed = false;
    while (true) {
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
            Accept: "application/json, text/event-stream",
            "Content-Type": "application/json",
            ...this.options.headers,
            ...(authorization ? { Authorization: authorization } : {}),
            ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
          redirect: "error",
        });
        if (response.status === 401 && this.options.oauth && !refreshed) {
          await response.body?.cancel().catch(() => undefined);
          this.token = undefined;
          refreshed = true;
          continue;
        }
        if (!response.ok) {
          const detail = (
            await readResponseTextWithinLimit(
              response,
              64 * 1024,
              "MCP error response",
            )
          ).slice(0, 2_000);
          throw new Error(
            `MCP HTTP ${response.status}: ${safeMessage(detail || response.statusText)}`,
          );
        }
        const sessionId = response.headers.get("mcp-session-id");
        if (sessionId) this.sessionId = sessionId.slice(0, 512);
        if (response.status === 202 || response.status === 204)
          return undefined;
        const body = await readResponseTextWithinLimit(
          response,
          MAX_RESPONSE_BYTES,
          "MCP HTTP response",
        );
        const contentType = response.headers.get("content-type") || "";
        return contentType.includes("text/event-stream")
          ? parseSseJson(body)
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
        throw new Error(
          `MCP server "${this.serverName}" request failed: ${safeMessage(error)}`,
        );
      } finally {
        clearTimeout(timeout);
        externalSignal?.removeEventListener("abort", onAbort);
      }
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

function parseSseJson(body: string): unknown {
  const data = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]")
    .pop();
  if (!data) throw new Error("MCP SSE response contained no JSON data.");
  return JSON.parse(data);
}

function safeMessage(value: unknown): string {
  return redactSecrets(value instanceof Error ? value.message : String(value))
    .replace(/[\r\n]+/g, " ")
    .slice(0, 2_000);
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
