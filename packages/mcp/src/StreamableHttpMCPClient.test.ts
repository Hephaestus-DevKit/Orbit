import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "http";
import {
  exchangeOAuthGrant,
  StreamableHttpMCPClient,
  type McpOAuthTokenStore,
} from "./StreamableHttpMCPClient.js";
import { CredentialsManager } from "@orbit-build/config";
import { createMcpTokenStore, mcpRefreshTokenKey } from "./McpTokenStore.js";

describe("StreamableHttpMCPClient", () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>(
      (resolve) => server?.close(() => resolve()) ?? resolve(),
    );
  });

  it("handshakes, retains the session ID, lists tools, and calls tools", async () => {
    const methods: string[] = [];
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += String(chunk)));
      request.on("end", () => {
        const message = JSON.parse(body) as {
          id?: number;
          method: string;
        };
        methods.push(message.method);
        if (message.method === "notifications/initialized") {
          expect(request.headers["mcp-session-id"]).toBe("session-123");
          response.writeHead(202).end();
          return;
        }
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Mcp-Session-Id", "session-123");
        const result =
          message.method === "tools/list"
            ? {
                tools: [
                  {
                    name: "read_status",
                    description: "Read status",
                    inputSchema: { type: "object" },
                  },
                ],
              }
            : message.method === "tools/call"
              ? { content: [{ type: "text", text: "ok" }], isError: false }
              : { protocolVersion: "2024-11-05", capabilities: {} };
        response.end(
          JSON.stringify({ jsonrpc: "2.0", id: message.id, result }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test port");
    const client = new StreamableHttpMCPClient(
      "test",
      `http://127.0.0.1:${address.port}`,
    );

    await expect(client.start()).resolves.toEqual([
      expect.objectContaining({ name: "read_status" }),
    ]);
    await expect(client.callTool("read_status", {})).resolves.toMatchObject({
      content: [{ type: "text", text: "ok" }],
      isError: false,
    });
    expect(methods).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/call",
    ]);
    await client.stop();
  });

  it("rejects plaintext non-loopback endpoints before sending credentials", async () => {
    const client = new StreamableHttpMCPClient(
      "unsafe",
      "http://example.com/mcp",
      { bearerTokenEnv: "MCP_TOKEN" },
    );

    await expect(client.start()).rejects.toThrow("must use HTTPS");
  });

  it("does not send a tool request when its signal is already aborted", async () => {
    let toolCalls = 0;
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += String(chunk)));
      request.on("end", () => {
        const message = JSON.parse(body) as { id?: number; method: string };
        if (message.method === "tools/call") toolCalls += 1;
        if (message.method === "notifications/initialized") {
          response.writeHead(202).end();
          return;
        }
        response.setHeader("Content-Type", "application/json");
        const result =
          message.method === "tools/list"
            ? {
                tools: [
                  {
                    name: "read_status",
                    description: "Read status",
                    inputSchema: { type: "object" },
                  },
                ],
              }
            : { protocolVersion: "2024-11-05", capabilities: {} };
        response.end(
          JSON.stringify({ jsonrpc: "2.0", id: message.id, result }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test port");
    const client = new StreamableHttpMCPClient(
      "aborted",
      `http://127.0.0.1:${address.port}`,
    );
    await client.start();

    const controller = new AbortController();
    controller.abort();
    await expect(
      client.callTool("read_status", {}, controller.signal),
    ).rejects.toThrow("cancelled");
    expect(toolCalls).toBe(0);
    await client.stop();
  });

  it("refreshes authorization-code tokens silently and stores rotations", async () => {
    process.env.TEST_MCP_PKCE_CLIENT_ID = "public-client";
    const tokenRequests: URLSearchParams[] = [];
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += String(chunk)));
      request.on("end", () => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (url.pathname === "/token") {
          tokenRequests.push(new URLSearchParams(body));
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({
              access_token: "fresh-access",
              expires_in: 3600,
              refresh_token: "rotated-refresh",
            }),
          );
          return;
        }
        expect(request.headers.authorization).toBe("Bearer fresh-access");
        const message = JSON.parse(body) as { id?: number; method: string };
        if (message.method === "notifications/initialized") {
          response.writeHead(202).end();
          return;
        }
        response.setHeader("Content-Type", "application/json");
        const result =
          message.method === "tools/list"
            ? { tools: [] }
            : { protocolVersion: "2024-11-05", capabilities: {} };
        response.end(
          JSON.stringify({ jsonrpc: "2.0", id: message.id, result }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test port");
    const base = `http://127.0.0.1:${address.port}`;

    const stored: string[] = [];
    const tokenStore: McpOAuthTokenStore = {
      getRefreshToken: vi.fn(async () => "initial-refresh"),
      setRefreshToken: vi.fn(async (token: string) => {
        stored.push(token);
      }),
    };
    const client = new StreamableHttpMCPClient("pkce", `${base}/mcp`, {
      oauth: {
        mode: "authorization_code",
        tokenUrl: `${base}/token`,
        authorizationUrl: `${base}/authorize`,
        clientIdEnv: "TEST_MCP_PKCE_CLIENT_ID",
      },
      tokenStore,
    });
    try {
      await client.start();
      expect(tokenRequests).toHaveLength(1);
      expect(tokenRequests[0].get("grant_type")).toBe("refresh_token");
      expect(tokenRequests[0].get("refresh_token")).toBe("initial-refresh");
      expect(tokenRequests[0].get("client_id")).toBe("public-client");
      expect(stored).toEqual(["rotated-refresh"]);
    } finally {
      await client.stop();
      delete process.env.TEST_MCP_PKCE_CLIENT_ID;
    }
  });

  it("asks the user to log in when no refresh token exists", async () => {
    process.env.TEST_MCP_PKCE_CLIENT_ID = "public-client";
    const client = new StreamableHttpMCPClient(
      "needs-login",
      "http://127.0.0.1:1/mcp",
      {
        oauth: {
          mode: "authorization_code",
          tokenUrl: "http://127.0.0.1:1/token",
          authorizationUrl: "http://127.0.0.1:1/authorize",
          clientIdEnv: "TEST_MCP_PKCE_CLIENT_ID",
        },
        tokenStore: {
          getRefreshToken: async () => undefined,
          setRefreshToken: async () => undefined,
        },
      },
    );
    try {
      await expect(client.start()).rejects.toThrow(
        /orbit mcp login needs-login/,
      );
    } finally {
      await client.stop();
      delete process.env.TEST_MCP_PKCE_CLIENT_ID;
    }
  });

  it("derives credential-store keys that satisfy the key schema", () => {
    for (const name of [
      "docs",
      "my.ext.server",
      "server with spaces",
      "工具",
    ]) {
      expect(mcpRefreshTokenKey(name)).toMatch(
        /^[A-Za-z_][A-Za-z0-9_]{0,127}$/,
      );
    }
    expect(mcpRefreshTokenKey("my.ext")).not.toBe(mcpRefreshTokenKey("my ext"));
    expect(mcpRefreshTokenKey("工具")).not.toBe(mcpRefreshTokenKey("__"));
  });

  it("times out an unresponsive OAuth token endpoint", async () => {
    server = createServer(() => undefined);
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected an OAuth test TCP address.");
    }
    process.env.TEST_MCP_TIMEOUT_CLIENT_ID = "client";
    try {
      await expect(
        exchangeOAuthGrant(
          {
            tokenUrl: `http://127.0.0.1:${address.port}/token`,
            clientIdEnv: "TEST_MCP_TIMEOUT_CLIENT_ID",
          },
          { grant_type: "authorization_code", code: "opaque" },
          { timeoutMs: 25 },
        ),
      ).rejects.toThrow("timed out");
    } finally {
      delete process.env.TEST_MCP_TIMEOUT_CLIENT_ID;
    }
  });

  it("rejects unbounded OAuth credentials and token metadata", async () => {
    server = createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      response.setHeader("Content-Type", "application/json");
      if (pathname === "/oversized-token") {
        response.end(JSON.stringify({ access_token: "x".repeat(16_385) }));
      } else if (pathname === "/invalid-refresh") {
        response.end(
          JSON.stringify({
            access_token: "access",
            refresh_token: "refresh\r\nX-Injected: yes",
          }),
        );
      } else if (pathname === "/string-expiry") {
        response.end(
          JSON.stringify({
            access_token: "access",
            expires_in: "3600",
          }),
        );
      } else {
        response.end(
          JSON.stringify({
            access_token: "access",
            expires_in: Number.MAX_VALUE,
          }),
        );
      }
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected an OAuth test TCP address.");
    }
    const base = `http://127.0.0.1:${address.port}`;
    process.env.TEST_MCP_BOUNDED_CLIENT_ID = "client";
    const oauth = {
      clientIdEnv: "TEST_MCP_BOUNDED_CLIENT_ID",
      tokenUrl: `${base}/oversized-token`,
    };
    try {
      await expect(
        exchangeOAuthGrant(oauth, { grant_type: "client_credentials" }),
      ).rejects.toThrow("valid bounded access token");
      await expect(
        exchangeOAuthGrant(
          { ...oauth, tokenUrl: `${base}/invalid-refresh` },
          { grant_type: "client_credentials" },
        ),
      ).rejects.toThrow("valid bounded access token");
      await expect(
        exchangeOAuthGrant(
          { ...oauth, tokenUrl: `${base}/invalid-expiry` },
          { grant_type: "client_credentials" },
        ),
      ).rejects.toThrow("valid bounded access token");
      const stringExpiry = await exchangeOAuthGrant(
        { ...oauth, tokenUrl: `${base}/string-expiry` },
        { grant_type: "client_credentials" },
      );
      expect(stringExpiry.token.expiresAt).toBeGreaterThan(
        Date.now() + 3_500_000,
      );

      process.env.TEST_MCP_BOUNDED_CLIENT_ID = "client\r\nX-Injected: yes";
      await expect(
        exchangeOAuthGrant(oauth, { grant_type: "client_credentials" }),
      ).rejects.toThrow("client ID");
    } finally {
      delete process.env.TEST_MCP_BOUNDED_CLIENT_ID;
    }
  });

  it("migrates only unambiguous legacy refresh-token keys", async () => {
    const credentials = new CredentialsManager({
      platform: "linux",
      keyStore: null,
      fallbackKey: Buffer.alloc(32, 1),
    });
    const getSecret = vi
      .spyOn(credentials, "getSecret")
      .mockImplementation((key) =>
        key === "MCP_REFRESH_docs" ? "legacy-token" : null,
      );
    const storeSecret = vi
      .spyOn(credentials, "storeSecret")
      .mockImplementation(() => undefined);
    const deleteSecret = vi
      .spyOn(credentials, "deleteSecret")
      .mockReturnValue(true);

    await expect(
      createMcpTokenStore("docs", credentials).getRefreshToken(),
    ).resolves.toBe("legacy-token");
    expect(storeSecret).toHaveBeenCalledWith(
      mcpRefreshTokenKey("docs"),
      "legacy-token",
    );
    expect(deleteSecret).toHaveBeenCalledWith("MCP_REFRESH_docs");

    storeSecret.mockImplementationOnce(() => {
      throw new Error("secure store is read-only");
    });
    await expect(
      createMcpTokenStore("docs", credentials).getRefreshToken(),
    ).resolves.toBe("legacy-token");

    getSecret.mockClear();
    storeSecret.mockClear();
    deleteSecret.mockClear();
    getSecret.mockImplementation((key) =>
      key === "MCP_REFRESH_my_ext" ? "ambiguous-token" : null,
    );

    await expect(
      createMcpTokenStore("my.ext", credentials).getRefreshToken(),
    ).resolves.toBeUndefined();
    expect(getSecret).toHaveBeenCalledTimes(1);
    expect(storeSecret).not.toHaveBeenCalled();
    expect(deleteSecret).not.toHaveBeenCalled();
  });
});
