import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "http";
import {
  StreamableHttpMCPClient,
  type McpOAuthTokenStore,
} from "./StreamableHttpMCPClient.js";
import { mcpRefreshTokenKey } from "./McpTokenStore.js";

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
  });
});
