import { createServer, type Server } from "http";
import { afterEach, describe, expect, it } from "vitest";
import { runMcpPkceLogin } from "./McpOAuthLogin.js";

const CLIENT_ID_ENV = "TEST_ORBIT_MCP_LOGIN_CLIENT_ID";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not expose a TCP port.");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server | undefined): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

describe("runMcpPkceLogin", () => {
  let tokenServer: Server | undefined;

  afterEach(async () => {
    delete process.env[CLIENT_ID_ENV];
    await close(tokenServer);
  });

  it("validates state, exchanges the code, and closes the loopback server", async () => {
    process.env[CLIENT_ID_ENV] = "orbit-test-client";
    const tokenRequests: URLSearchParams[] = [];
    tokenServer = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += String(chunk)));
      request.on("end", () => {
        tokenRequests.push(new URLSearchParams(body));
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            access_token: "access-token",
            expires_in: 120,
            refresh_token: "refresh-token",
          }),
        );
      });
    });
    const tokenBaseUrl = await listen(tokenServer);
    let redirectUri = "";
    let browserCallback: Promise<void> | undefined;

    const login = runMcpPkceLogin({
      serverName: "test",
      oauth: {
        mode: "authorization_code",
        authorizationUrl: `${tokenBaseUrl}/authorize`,
        tokenUrl: `${tokenBaseUrl}/token`,
        clientIdEnv: CLIENT_ID_ENV,
        scope: "tools.read",
      },
      onAuthorizationUrl(url) {
        const authorizationUrl = new URL(url);
        redirectUri = authorizationUrl.searchParams.get("redirect_uri") ?? "";
        const state = authorizationUrl.searchParams.get("state") ?? "";
        browserCallback = (async () => {
          const invalid = await fetch(
            `${redirectUri}?code=ignored&state=incorrect`,
          );
          expect(invalid.status).toBe(400);
          const valid = await fetch(
            `${redirectUri}?code=test-code&state=${encodeURIComponent(state)}`,
          );
          expect(valid.status).toBe(200);
        })();
      },
      timeoutMs: 2_000,
    });

    await expect(login).resolves.toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
    });
    await browserCallback;
    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0]?.get("grant_type")).toBe("authorization_code");
    expect(tokenRequests[0]?.get("code")).toBe("test-code");
    expect(tokenRequests[0]?.get("client_id")).toBe("orbit-test-client");
    expect(tokenRequests[0]?.get("code_verifier")).toBeTruthy();
    await expect(fetch(redirectUri)).rejects.toThrow();
  });

  it("closes the loopback server after a redirect timeout", async () => {
    process.env[CLIENT_ID_ENV] = "orbit-test-client";
    let redirectUri = "";

    await expect(
      runMcpPkceLogin({
        serverName: "test",
        oauth: {
          mode: "authorization_code",
          authorizationUrl: "http://127.0.0.1/authorize",
          tokenUrl: "http://127.0.0.1/token",
          clientIdEnv: CLIENT_ID_ENV,
        },
        onAuthorizationUrl(url) {
          redirectUri = new URL(url).searchParams.get("redirect_uri") ?? "";
        },
        timeoutMs: 25,
      }),
    ).rejects.toThrow("timed out");

    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    await expect(fetch(redirectUri)).rejects.toThrow();
  });

  it("redacts and strips control characters from OAuth callback errors", async () => {
    process.env[CLIENT_ID_ENV] = "orbit-test-client";
    let browserCallback: Promise<void> | undefined;

    const login = runMcpPkceLogin({
      serverName: "test",
      oauth: {
        mode: "authorization_code",
        authorizationUrl: "http://127.0.0.1/authorize",
        tokenUrl: "http://127.0.0.1/token",
        clientIdEnv: CLIENT_ID_ENV,
      },
      onAuthorizationUrl(url) {
        const authorizationUrl = new URL(url);
        const redirectUri = authorizationUrl.searchParams.get("redirect_uri");
        const state = authorizationUrl.searchParams.get("state");
        browserCallback = (async () => {
          const callback = new URL(redirectUri ?? "");
          callback.searchParams.set("state", state ?? "");
          callback.searchParams.set(
            "error",
            "Bearer private-token\n\u001b[31mdenied",
          );
          const response = await fetch(callback);
          expect(response.status).toBe(400);
        })();
      },
      timeoutMs: 2_000,
    });

    await expect(login).rejects.toThrow(
      "MCP OAuth authorization failed: Bearer ***REDACTED*** denied",
    );
    await browserCallback;
  });
});
