import { describe, it, expect, vi } from "vitest";
import {
  buildMcpEnvironment,
  collectMcpPaginatedItems,
  createMcpToolName,
  flattenPromptMessages,
  flattenResourceContents,
  flattenToolContents,
  parseServerCapabilities,
  MCPClient,
  DynamicMCPTool,
  McpResourceTool,
  assertSupportedProtocolVersion,
} from "./MCPClient.js";
import path from "path";
import { writeFileSync, unlinkSync } from "fs";

describe("MCPClient", () => {
  it("collects opaque cursor pages and rejects cursor cycles", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ values: ["first"], nextCursor: "opaque:2" })
      .mockResolvedValueOnce({ values: ["second"] });
    await expect(
      collectMcpPaginatedItems({
        method: "example/list",
        request,
        parse: (value) => {
          const page = value as { values: string[]; nextCursor?: string };
          return { items: page.values, nextCursor: page.nextCursor };
        },
        identity: (item) => item,
      }),
    ).resolves.toEqual(["first", "second"]);
    expect(request).toHaveBeenNthCalledWith(1, {});
    expect(request).toHaveBeenNthCalledWith(2, { cursor: "opaque:2" });

    await expect(
      collectMcpPaginatedItems({
        method: "cycle/list",
        request: vi.fn(async () => ({ values: [], nextCursor: "same" })),
        parse: (value) => {
          const page = value as { values: string[]; nextCursor?: string };
          return { items: page.values, nextCursor: page.nextCursor };
        },
        identity: (item) => item,
      }),
    ).rejects.toThrow("repeated a pagination cursor");
  });

  it("accepts known negotiated versions and rejects unknown revisions", () => {
    expect(() =>
      assertSupportedProtocolVersion({ protocolVersion: "2025-11-25" }),
    ).not.toThrow();
    expect(() =>
      assertSupportedProtocolVersion({ protocolVersion: "2030-01-01" }),
    ).toThrow("unsupported protocol version");
  });

  it("enforces each remote tool's JSON Schema before execution", () => {
    const client = {
      callTool: vi.fn(),
    };
    const tool = new DynamicMCPTool(
      "docs",
      {
        name: "lookup",
        description: "Look up documentation",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: { type: "string", minLength: 2 },
            limit: { type: "integer", minimum: 1, maximum: 10 },
          },
          required: ["query"],
        },
      },
      "read",
      client,
    );

    expect(tool.inputSchema.safeParse({ query: "api", limit: 3 }).success).toBe(
      true,
    );
    expect(tool.inputSchema.safeParse({ query: "", limit: 99 }).success).toBe(
      false,
    );
    expect(
      tool.inputSchema.safeParse({ query: "api", unexpected: true }).success,
    ).toBe(false);
  });

  it("validates structured tool results against the advertised output schema", async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({
        content: [],
        structuredContent: { count: 2 },
        isError: false,
      })
      .mockResolvedValueOnce({
        content: [],
        structuredContent: { count: "wrong" },
        isError: false,
      });
    const tool = new DynamicMCPTool(
      "analytics",
      {
        name: "count",
        description: "Count results",
        inputSchema: { type: "object" },
        outputSchema: {
          type: "object",
          properties: { count: { type: "integer" } },
          required: ["count"],
          additionalProperties: false,
        },
      },
      "read",
      { callTool },
    );

    await expect(
      tool.execute({}, { cwd: process.cwd() } as never),
    ).resolves.toMatchObject({ ok: true, data: '{\n  "count": 2\n}' });
    await expect(
      tool.execute({}, { cwd: process.cwd() } as never),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("does not match its output schema"),
    });
  });

  it("creates stable DeepSeek-compatible names for arbitrary MCP tools", () => {
    expect(createMcpToolName("docs", "lookup")).toBe("mcp__docs__lookup");
    const normalized = createMcpToolName(
      "server.with spaces",
      "工具/read.document.with.a.very.long.name.that.exceeds.provider.limits",
    );
    expect(normalized).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(
      createMcpToolName(
        "server.with spaces",
        "工具/read.document.with.a.very.long.name.that.exceeds.provider.limits",
      ),
    ).toBe(normalized);
  });
  it("inherits only runtime variables and explicitly requested names", () => {
    const result = buildMcpEnvironment(
      { EXPLICIT_VALUE: "configured" },
      ["ALLOWED_VALUE"],
      {
        PATH: "runtime-path",
        ALLOWED_VALUE: "allowed",
        OPENAI_API_KEY: "must-not-leak",
      },
    );

    expect(result.PATH).toBe("runtime-path");
    expect(result.ALLOWED_VALUE).toBe("allowed");
    expect(result.EXPLICIT_VALUE).toBe("configured");
    expect(result.OPENAI_API_KEY).toBeUndefined();
  });

  it("should handshake and list/call tools from a stdio MCP server", async () => {
    const dummyServerPath = path.resolve(
      process.cwd(),
      "packages/mcp/src/dummy-server-test.js",
    );

    // Create a simple dummy MCP server script
    const dummyServerCode = `
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === 'server/discover') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      error: { code: -32601, message: 'Method not found' }
    }) + '\\n');
  } else if (msg.method === 'initialize') {
    if (msg.params.clientInfo.version !== '9.8.7') {
      process.stderr.write('unexpected client version');
      process.exit(2);
    }
    if (msg.params.protocolVersion !== '2025-11-25') {
      process.stderr.write('unexpected protocol version');
      process.exit(5);
    }
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'dummy', version: '0.1.3' }
      }
    }) + '\\n');
  } else if (msg.method === 'tools/list') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [
          {
            name: 'hello',
            description: 'Says hello',
            inputSchema: { type: 'object', properties: { name: { type: 'string' } } }
          }
        ]
      }
    }) + '\\n');
  } else if (msg.method === 'tools/call') {
    const args = msg.params.arguments;
    if (args?.wait === true) return;
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        content: [{ type: 'text', text: \`Hello, \${args?.name || 'World'}!\` }],
        isError: false
      }
    }) + '\\n');
  }
});
`;
    writeFileSync(dummyServerPath, dummyServerCode);

    const client = new MCPClient(
      "dummy-server",
      "node",
      [dummyServerPath],
      {},
      [],
      "9.8.7",
    );
    try {
      const tools = await client.start();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("hello");

      const res = await client.callTool("hello", { name: "Orbit" });
      expect(res.content[0].text).toBe("Hello, Orbit!");

      const controller = new AbortController();
      const pending = client.callTool(
        "hello",
        { wait: true },
        controller.signal,
      );
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      await client.stop();
      try {
        unlinkSync(dummyServerPath);
      } catch {
        // Ignored
      }
    }
  });

  it("surfaces bounded legacy catalog-change notifications", async () => {
    const serverPath = path.resolve(
      process.cwd(),
      "packages/mcp/src/dummy-catalog-notification-test.js",
    );
    const serverCode = `
import readline from 'readline';
const rl = readline.createInterface({ input: process.stdin, terminal: false });
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'server/discover') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'missing' } }) + '\\n');
  } else if (msg.method === 'initialize') {
    reply(msg.id, { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'catalog', version: '1' } });
  } else if (msg.method === 'tools/list') {
    reply(msg.id, { tools: [] });
    setTimeout(() => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed', params: {} }) + '\\n'), 10);
  }
});
`;
    writeFileSync(serverPath, serverCode);
    const client = new MCPClient("catalog", "node", [serverPath]);
    const changed = new Promise<string[]>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("catalog notification timed out")),
        2_000,
      );
      client.onCatalogChanged((kinds) => {
        clearTimeout(timeout);
        resolve(kinds);
      });
    });
    try {
      await client.start();
      await expect(changed).resolves.toEqual(["tools"]);
    } finally {
      await client.stop();
      try {
        unlinkSync(serverPath);
      } catch {
        // Ignored
      }
    }
  });

  it("uses stateless request metadata with a modern stdio server", async () => {
    const dummyServerPath = path.resolve(
      process.cwd(),
      "packages/mcp/src/dummy-modern-server-test.js",
    );
    const dummyServerCode = `
import readline from 'readline';
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  const meta = msg.params?._meta;
  if (meta?.['io.modelcontextprotocol/protocolVersion'] !== '2026-07-28') {
    process.stderr.write('missing modern metadata');
    process.exit(2);
  }
  const result = msg.method === 'server/discover'
    ? {
        resultType: 'complete',
        supportedVersions: ['2026-07-28'],
        capabilities: { tools: {} },
        ttlMs: 60000,
        cacheScope: 'private'
      }
    : msg.method === 'tools/list'
      ? {
          resultType: 'complete',
          tools: [{ name: 'modern_status', inputSchema: { type: 'object' } }]
        }
      : {
          resultType: 'complete',
          content: [{ type: 'text', text: 'modern-ok' }]
        };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\\n');
});
`;
    writeFileSync(dummyServerPath, dummyServerCode);
    const client = new MCPClient(
      "modern-dummy",
      "node",
      [dummyServerPath],
      {},
      [],
      "9.8.7",
    );
    try {
      await expect(client.start()).resolves.toEqual([
        expect.objectContaining({ name: "modern_status" }),
      ]);
      await expect(client.callTool("modern_status", {})).resolves.toMatchObject(
        { content: [{ text: "modern-ok" }] },
      );
    } finally {
      await client.stop();
      try {
        unlinkSync(dummyServerPath);
      } catch {
        // Ignored
      }
    }
  });

  it("downgrades stdio when discovery advertises only a legacy revision", async () => {
    const dummyServerPath = path.resolve(
      process.cwd(),
      "packages/mcp/src/dummy-legacy-downgrade-test.js",
    );
    const dummyServerCode = `
import readline from 'readline';
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'server/discover') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      error: {
        code: -32022,
        message: 'Unsupported protocol version',
        data: { supported: ['2025-11-25'] }
      }
    }) + '\\n');
    return;
  }
  if (msg.method === 'initialize') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        serverInfo: { name: 'legacy-only', version: '1.0.0' }
      }
    }) + '\\n');
  }
});
`;
    writeFileSync(dummyServerPath, dummyServerCode);
    const client = new MCPClient("legacy-downgrade", "node", [dummyServerPath]);
    try {
      await expect(client.start()).resolves.toEqual([]);
      expect(client.getNegotiatedProtocol()).toEqual({
        era: "legacy",
        version: "2025-11-25",
      });
    } finally {
      await client.stop();
      try {
        unlinkSync(dummyServerPath);
      } catch {
        // Ignored
      }
    }
  });

  it("detects advertised capability surfaces from the initialize result", () => {
    expect(
      parseServerCapabilities({
        capabilities: {
          tools: {},
          resources: { subscribe: true },
          prompts: {},
        },
      }),
    ).toEqual({ tools: true, resources: true, prompts: true });
    expect(parseServerCapabilities({ capabilities: { tools: {} } })).toEqual({
      tools: true,
      resources: false,
      prompts: false,
    });
    expect(parseServerCapabilities(undefined)).toEqual({
      tools: false,
      resources: false,
      prompts: false,
    });
  });

  it("flattens resource contents and prompt messages to bounded text", () => {
    expect(
      flattenResourceContents({
        contents: [
          { uri: "a", text: "line one" },
          { uri: "b", mimeType: "image/png", blob: "aGVsbG8=" },
        ],
      }),
    ).toBe("line one\n[image/png resource: 8 base64 chars]");
    expect(
      flattenPromptMessages({
        messages: [
          { role: "user", content: { type: "text", text: "first" } },
          { role: "assistant", content: { type: "text", text: "second" } },
        ],
      }),
    ).toBe("first\n\nsecond");
    expect(
      flattenToolContents({
        isError: false,
        content: [
          { type: "text", text: "plain" },
          { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
          { type: "resource_link", uri: "docs://api" },
          {
            type: "resource",
            resource: { uri: "docs://inline", text: "inline" },
          },
        ],
      }),
    ).toBe(
      "plain\n[image/png MCP content: 8 base64 chars]\n[MCP resource link: docs://api]\ninline",
    );
  });

  it("lists and reads resources and prompts from a stdio MCP server", async () => {
    const resourceServerPath = path.resolve(
      process.cwd(),
      "packages/mcp/src/dummy-resource-server-test.js",
    );
    const resourceServerCode = `
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

const reply = (id, result) => {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
};

rl.on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    reply(msg.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {}, resources: { subscribe: false }, prompts: {} },
      serverInfo: { name: 'resourceful', version: '0.0.1' }
    });
  } else if (msg.method === 'tools/list') {
    reply(msg.id, { tools: [] });
  } else if (msg.method === 'resources/list') {
    if (!msg.params.cursor) {
      reply(msg.id, {
        resources: [
          { uri: 'docs://readme', name: 'README', description: 'Project intro' }
        ],
        nextCursor: 'resource-page-2'
      });
    } else {
      if (msg.params.cursor !== 'resource-page-2') process.exit(3);
      reply(msg.id, {
        resources: [{ uri: 'docs://api', name: 'API' }]
      });
    }
  } else if (msg.method === 'resources/read') {
    reply(msg.id, {
      contents: [{ uri: msg.params.uri, mimeType: 'text/plain', text: 'resource body' }]
    });
  } else if (msg.method === 'resources/templates/list') {
    reply(msg.id, {
      resourceTemplates: [
        { uriTemplate: 'docs://topic/{name}', name: 'Topic' }
      ]
    });
  } else if (msg.method === 'prompts/list') {
    if (!msg.params.cursor) {
      reply(msg.id, {
        prompts: [
          {
            name: 'summarize',
            description: 'Summarize a document',
            arguments: [{ name: 'topic', required: true }]
          }
        ],
        nextCursor: 'prompt-page-2'
      });
    } else {
      if (msg.params.cursor !== 'prompt-page-2') process.exit(4);
      reply(msg.id, { prompts: [{ name: 'review' }] });
    }
  } else if (msg.method === 'prompts/get') {
    reply(msg.id, {
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: 'Summarize ' + (msg.params.arguments?.topic || '') }
        }
      ]
    });
  }
});
`;
    writeFileSync(resourceServerPath, resourceServerCode);

    const client = new MCPClient("resourceful", "node", [resourceServerPath]);
    try {
      await client.start();
      expect(client.getServerCapabilities()).toEqual({
        tools: true,
        resources: true,
        prompts: true,
      });

      const resources = await client.listResources();
      expect(resources).toHaveLength(2);
      expect(resources[0].uri).toBe("docs://readme");
      await expect(client.readResource("docs://readme")).resolves.toBe(
        "resource body",
      );
      await expect(client.listResourceTemplates()).resolves.toEqual([
        expect.objectContaining({ uriTemplate: "docs://topic/{name}" }),
      ]);

      const prompts = await client.listPrompts();
      expect(prompts).toHaveLength(2);
      expect(prompts[0].name).toBe("summarize");
      await expect(
        client.getPrompt("summarize", { topic: "auth" }),
      ).resolves.toBe("Summarize auth");

      const templates = await client.listResourceTemplates();
      const tool = new McpResourceTool(
        "resourceful",
        resources,
        client,
        templates,
      );
      expect(tool.name).toBe("mcp__resourceful__read_resource");
      expect(tool.risk).toBe("read");
      expect(tool.description).toContain("docs://readme");
      expect(tool.description).toContain("docs://topic/{name}");
      const toolResult = await tool.execute({ uri: "docs://readme" }, {
        cwd: process.cwd(),
      } as never);
      expect(toolResult).toMatchObject({ ok: true, data: "resource body" });
      await expect(
        tool.execute({}, { cwd: process.cwd() } as never),
      ).resolves.toMatchObject({ ok: false });
    } finally {
      await client.stop();
      try {
        unlinkSync(resourceServerPath);
      } catch {
        // Ignored
      }
    }
  });

  it("honors a configured per-server request timeout", async () => {
    const silentServerPath = path.resolve(
      process.cwd(),
      "packages/mcp/src/dummy-silent-server-test.js",
    );
    // Answers the handshake and tools/list, then never replies to tools/call.
    const silentServerCode = `
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'silent', version: '0.0.1' }
      }
    }) + '\\n');
  } else if (msg.method === 'tools/list') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [{ name: 'slow', description: 'Never answers', inputSchema: { type: 'object' } }]
      }
    }) + '\\n');
  }
});
`;
    writeFileSync(silentServerPath, silentServerCode);

    const client = new MCPClient(
      "silent-server",
      "node",
      [silentServerPath],
      {},
      [],
      undefined,
      // Keep this far below the production default while leaving enough room
      // for the real Node child process to start on loaded Windows runners.
      2_000,
    );
    try {
      await client.start();
      await expect(client.callTool("slow", {})).rejects.toThrow(
        /timed out after 2000ms/,
      );
    } finally {
      await client.stop();
      try {
        unlinkSync(silentServerPath);
      } catch {
        // Ignored
      }
    }
  });
});
