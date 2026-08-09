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
        if (request.method === "DELETE") {
          methods.push("DELETE");
          expect(request.headers["mcp-session-id"]).toBe("session-123");
          expect(request.headers["mcp-protocol-version"]).toBe("2024-11-05");
          response.writeHead(200).end();
          return;
        }
        const message = JSON.parse(body) as {
          id?: number;
          method: string;
          params?: { cursor?: string; protocolVersion?: string };
        };
        methods.push(message.method);
        if (message.method === "server/discover") {
          expect(request.headers["mcp-protocol-version"]).toBe("2026-07-28");
          expect(request.headers["mcp-method"]).toBe("server/discover");
          expect(
            (message.params as Record<string, unknown> | undefined)?._meta,
          ).toMatchObject({
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          });
          response.writeHead(404, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              error: { code: -32601, message: "Method not found" },
            }),
          );
          return;
        }
        if (message.method === "initialize") {
          expect(message.params?.protocolVersion).toBe("2025-11-25");
        }
        if (
          message.method !== "initialize" &&
          message.method !== "server/discover"
        ) {
          expect(request.headers["mcp-protocol-version"]).toBe("2024-11-05");
        }
        if (message.method === "notifications/initialized") {
          expect(request.headers["mcp-session-id"]).toBe("session-123");
          response.writeHead(202).end();
          return;
        }
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Mcp-Session-Id", "session-123");
        const result =
          message.method === "tools/list"
            ? message.params?.cursor
              ? {
                  tools: [
                    {
                      name: "write_status",
                      description: "Write status",
                      inputSchema: { type: "object" },
                    },
                  ],
                }
              : {
                  tools: [
                    {
                      name: "read_status",
                      description: "Read status",
                      inputSchema: { type: "object" },
                    },
                  ],
                  nextCursor: "tools-page-2",
                }
            : message.method === "tools/call"
              ? { content: [{ type: "text", text: "ok" }], isError: false }
              : {
                  protocolVersion: "2024-11-05",
                  capabilities: { tools: {} },
                };
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
      expect.objectContaining({ name: "write_status" }),
    ]);
    await expect(client.callTool("read_status", {})).resolves.toMatchObject({
      content: [{ type: "text", text: "ok" }],
      isError: false,
    });
    expect(methods).toEqual([
      "server/discover",
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/list",
      "tools/call",
    ]);
    await client.stop();
    expect(methods.at(-1)).toBe("DELETE");
  });

  it("downgrades when modern discovery advertises only a supported legacy revision", async () => {
    const methods: string[] = [];
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += String(chunk)));
      request.on("end", () => {
        const message = JSON.parse(body) as { id?: number; method: string };
        methods.push(message.method);
        if (message.method === "server/discover") {
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              error: {
                code: -32022,
                message: "Unsupported protocol version",
                data: { supported: ["2025-11-25"] },
              },
            }),
          );
          return;
        }
        if (message.method === "notifications/initialized") {
          response.writeHead(202).end();
          return;
        }
        const result =
          message.method === "initialize"
            ? {
                protocolVersion: "2025-11-25",
                capabilities: {},
                serverInfo: { name: "legacy-only", version: "1.0.0" },
              }
            : {};
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({ jsonrpc: "2.0", id: message.id, result }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port");
    const client = new StreamableHttpMCPClient(
      "legacy-only",
      `http://127.0.0.1:${address.port}`,
    );

    await expect(client.start()).resolves.toEqual([]);
    expect(client.getNegotiatedProtocol()).toEqual({
      era: "legacy",
      version: "2025-11-25",
    });
    expect(methods).toEqual([
      "server/discover",
      "initialize",
      "notifications/initialized",
    ]);
    await client.stop();
  });

  it("uses stateless modern HTTP metadata and mirrored tool headers", async () => {
    const methods: string[] = [];
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += String(chunk)));
      request.on("end", () => {
        expect(request.method).toBe("POST");
        const message = JSON.parse(body) as {
          id: number;
          method: string;
          params: Record<string, unknown>;
        };
        methods.push(message.method);
        expect(request.headers["mcp-protocol-version"]).toBe("2026-07-28");
        expect(request.headers["mcp-method"]).toBe(message.method);
        expect(message.params._meta).toMatchObject({
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
        });

        const result =
          message.method === "server/discover"
            ? {
                resultType: "complete",
                supportedVersions: ["2026-07-28"],
                capabilities: { tools: {} },
                ttlMs: 60_000,
                cacheScope: "private",
              }
            : message.method === "tools/list"
              ? {
                  resultType: "complete",
                  tools: [
                    {
                      name: "lookup",
                      description: "Lookup",
                      inputSchema: {
                        type: "object",
                        properties: {
                          tenant: {
                            type: "string",
                            "x-mcp-header": "Tenant",
                          },
                        },
                      },
                      outputSchema: { type: "object" },
                    },
                  ],
                }
              : {
                  resultType: "complete",
                  content: [{ type: "text", text: "modern-ok" }],
                  structuredContent: { ok: true },
                };
        if (message.method === "tools/call") {
          expect(request.headers["mcp-name"]).toBe("lookup");
          expect(request.headers["mcp-param-tenant"]).toBe(
            "=?base64?55So5oi3QQ==?=",
          );
        }
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({ jsonrpc: "2.0", id: message.id, result }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port");
    const client = new StreamableHttpMCPClient(
      "modern-http",
      `http://127.0.0.1:${address.port}`,
      { clientVersion: "0.5.0" },
    );

    await expect(client.start()).resolves.toEqual([
      expect.objectContaining({ name: "lookup" }),
    ]);
    await expect(
      client.callTool("lookup", { tenant: "用户A" }),
    ).resolves.toMatchObject({ structuredContent: { ok: true } });
    await client.stop();
    expect(methods).toEqual(["server/discover", "tools/list", "tools/call"]);
  });

  it("reinitializes once and retries when a server expires the session", async () => {
    let generation = 0;
    const calls: Array<{ method: string; session?: string }> = [];
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += String(chunk)));
      request.on("end", () => {
        if (request.method === "DELETE") {
          response.writeHead(200).end();
          return;
        }
        const message = JSON.parse(body) as {
          id?: number;
          method: string;
          params?: { cursor?: string };
        };
        const session = request.headers["mcp-session-id"] as string | undefined;
        calls.push({ method: message.method, session });
        if (message.method === "notifications/initialized") {
          response.writeHead(202).end();
          return;
        }
        if (message.method === "initialize") {
          generation += 1;
          response.setHeader("Content-Type", "application/json");
          response.setHeader("Mcp-Session-Id", `session-${generation}`);
          response.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: {
                protocolVersion: "2025-11-25",
                capabilities: { tools: {} },
              },
            }),
          );
          return;
        }
        if (
          message.method === "tools/list" &&
          session === "session-1" &&
          message.params?.cursor
        ) {
          response.writeHead(404).end();
          return;
        }
        if (message.method === "tools/call" && session === "session-2") {
          response.writeHead(404).end();
          return;
        }
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result:
              message.method === "tools/list"
                ? message.params?.cursor
                  ? {
                      tools: [
                        {
                          name: "status_detail",
                          description: "status detail",
                          inputSchema: { type: "object" },
                        },
                      ],
                    }
                  : {
                      tools: [
                        {
                          name: "status",
                          description: "status",
                          inputSchema: { type: "object" },
                        },
                      ],
                      nextCursor: "tools-page-2",
                    }
                : { content: [{ type: "text", text: "recovered" }] },
          }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port");
    const client = new StreamableHttpMCPClient(
      "recover",
      `http://127.0.0.1:${address.port}`,
    );

    await expect(client.start()).resolves.toHaveLength(2);
    await expect(
      Promise.all([
        client.callTool("status", { request: 1 }),
        client.callTool("status", { request: 2 }),
      ]),
    ).resolves.toEqual([
      expect.objectContaining({
        content: [expect.objectContaining({ text: "recovered" })],
      }),
      expect.objectContaining({
        content: [expect.objectContaining({ text: "recovered" })],
      }),
    ]);
    expect(generation).toBe(3);
    expect(calls).toEqual(
      expect.arrayContaining([
        { method: "tools/list", session: "session-1" },
        { method: "tools/list", session: "session-2" },
        { method: "tools/call", session: "session-2" },
        { method: "tools/call", session: "session-3" },
      ]),
    );
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

  it("does not call tools/list on a resource-only server", async () => {
    const methods: string[] = [];
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += String(chunk)));
      request.on("end", () => {
        const message = JSON.parse(body) as { id?: number; method: string };
        methods.push(message.method);
        if (message.method === "notifications/initialized") {
          response.writeHead(202).end();
          return;
        }
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: "2025-11-25",
              capabilities: { resources: {} },
            },
          }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port");
    const client = new StreamableHttpMCPClient(
      "resources-only",
      `http://127.0.0.1:${address.port}`,
    );

    await expect(client.start()).resolves.toEqual([]);
    expect(methods).toEqual([
      "server/discover",
      "initialize",
      "notifications/initialized",
    ]);
    await client.stop();
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
            : {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
              };
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
            : {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
              };
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
