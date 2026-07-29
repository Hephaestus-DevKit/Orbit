import { createHash, randomBytes } from "crypto";
import http from "http";
import type { AddressInfo } from "net";
import {
  exchangeOAuthGrant,
  type McpOAuthConfig,
} from "./StreamableHttpMCPClient.js";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1_000;

async function closeLoopbackServer(server: http.Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve) => {
    const forceClose = setTimeout(() => server.closeAllConnections(), 250);
    forceClose.unref();
    server.close(() => {
      clearTimeout(forceClose);
      resolve();
    });
    server.closeIdleConnections();
  });
}

export interface McpPkceLoginOptions {
  serverName: string;
  oauth: McpOAuthConfig;
  /** Called with the authorization URL the user must open in a browser. */
  onAuthorizationUrl: (url: string) => void;
  /** Loopback port for the redirect listener; 0 picks an ephemeral port. */
  redirectPort?: number;
  timeoutMs?: number;
}

export interface McpPkceLoginResult {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
}

/**
 * Run the OAuth authorization-code flow with PKCE (RFC 7636, S256) against a
 * loopback redirect. The caller surfaces the authorization URL to the user;
 * this helper waits for the redirect, validates `state`, and exchanges the
 * code. No secrets are required — public clients are supported.
 */
export async function runMcpPkceLogin(
  options: McpPkceLoginOptions,
): Promise<McpPkceLoginResult> {
  const { oauth } = options;
  if (oauth.mode !== "authorization_code" || !oauth.authorizationUrl) {
    throw new Error(
      `MCP server "${options.serverName}" is not configured for ` +
        "authorization_code OAuth. Set oauth.mode and oauth.authorizationUrl.",
    );
  }
  const clientId = process.env[oauth.clientIdEnv];
  if (!clientId) {
    throw new Error(
      `MCP OAuth credentials are missing. Set ${oauth.clientIdEnv}.`,
    );
  }

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");

  const server = http.createServer();
  try {
    const port = await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.redirectPort ?? 0, "127.0.0.1", () => {
        resolve((server.address() as AddressInfo).port);
      });
    });
    const redirectUri = `http://127.0.0.1:${port}/callback`;

    const authorizationUrl = new URL(oauth.authorizationUrl);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("code_challenge", challenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    authorizationUrl.searchParams.set("state", state);
    if (oauth.scope) authorizationUrl.searchParams.set("scope", oauth.scope);
    if (oauth.audience) {
      authorizationUrl.searchParams.set("audience", oauth.audience);
    }

    const code = await new Promise<string>((resolve, reject) => {
      let settled = false;
      const cleanup = (): boolean => {
        if (settled) return false;
        settled = true;
        clearTimeout(timeout);
        server.off("request", handleRequest);
        return true;
      };
      const succeed = (value: string): void => {
        if (cleanup()) resolve(value);
      };
      const fail = (error: Error): void => {
        if (cleanup()) reject(error);
      };
      const timeout = setTimeout(() => {
        fail(
          new Error(
            "MCP OAuth login timed out waiting for the browser redirect.",
          ),
        );
      }, options.timeoutMs ?? LOGIN_TIMEOUT_MS);
      timeout.unref();
      const handleRequest = (
        request: http.IncomingMessage,
        response: http.ServerResponse,
      ): void => {
        const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
        if (url.pathname !== "/callback") {
          response.writeHead(404).end();
          return;
        }
        const finish = (status: number, message: string): void => {
          response
            .writeHead(status, { "Content-Type": "text/html; charset=utf-8" })
            .end(
              `<!doctype html><meta charset="utf-8"><title>Orbit</title>` +
                `<p style="font-family:sans-serif">${message}</p>`,
            );
        };
        if (url.searchParams.get("state") !== state) {
          finish(400, "State mismatch. Close this window and retry.");
          return;
        }
        const oauthError = url.searchParams.get("error");
        if (oauthError) {
          finish(400, "Authorization failed. Close this window and retry.");
          fail(
            new Error(
              `MCP OAuth authorization failed: ${oauthError.slice(0, 200)}`,
            ),
          );
          return;
        }
        const receivedCode = url.searchParams.get("code");
        if (!receivedCode) {
          finish(400, "Missing authorization code.");
          return;
        }
        finish(200, "Login complete. You can close this window.");
        succeed(receivedCode);
      };
      server.on("request", handleRequest);
      try {
        options.onAuthorizationUrl(authorizationUrl.toString());
      } catch (error) {
        fail(
          error instanceof Error
            ? error
            : new Error("MCP OAuth authorization callback failed."),
        );
      }
    });

    const grant = await exchangeOAuthGrant(oauth, {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    return {
      accessToken: grant.token.accessToken,
      expiresAt: grant.token.expiresAt,
      refreshToken: grant.refreshToken,
    };
  } finally {
    await closeLoopbackServer(server);
  }
}
