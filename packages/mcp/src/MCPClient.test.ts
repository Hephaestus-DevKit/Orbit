import { describe, it, expect, vi } from "vitest";
import {
  buildMcpEnvironment,
  createMcpToolName,
  flattenPromptMessages,
  flattenResourceContents,
  parseServerCapabilities,
  MCPClient,
  DynamicMCPTool,
  McpResourceTool,
} from "./MCPClient.js";
import path from "path";
import { writeFileSync, unlinkSync } from "fs";

describe("MCPClient", () => {
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
  if (msg.method === 'initialize') {
    if (msg.params.clientInfo.version !== '9.8.7') {
      process.stderr.write('unexpected client version');
      process.exit(2);
    }
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {},
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

  it("detects advertised capability surfaces from the initialize result", () => {
    expect(
      parseServerCapabilities({
        capabilities: { resources: { subscribe: true }, prompts: {} },
      }),
    ).toEqual({ resources: true, prompts: true });
    expect(parseServerCapabilities({ capabilities: { tools: {} } })).toEqual({
      resources: false,
      prompts: false,
    });
    expect(parseServerCapabilities(undefined)).toEqual({
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
      capabilities: { resources: { subscribe: false }, prompts: {} },
      serverInfo: { name: 'resourceful', version: '0.0.1' }
    });
  } else if (msg.method === 'tools/list') {
    reply(msg.id, { tools: [] });
  } else if (msg.method === 'resources/list') {
    reply(msg.id, {
      resources: [
        { uri: 'docs://readme', name: 'README', description: 'Project intro' }
      ]
    });
  } else if (msg.method === 'resources/read') {
    reply(msg.id, {
      contents: [{ uri: msg.params.uri, mimeType: 'text/plain', text: 'resource body' }]
    });
  } else if (msg.method === 'prompts/list') {
    reply(msg.id, {
      prompts: [
        {
          name: 'summarize',
          description: 'Summarize a document',
          arguments: [{ name: 'topic', required: true }]
        }
      ]
    });
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
        resources: true,
        prompts: true,
      });

      const resources = await client.listResources();
      expect(resources).toHaveLength(1);
      expect(resources[0].uri).toBe("docs://readme");
      await expect(client.readResource("docs://readme")).resolves.toBe(
        "resource body",
      );

      const prompts = await client.listPrompts();
      expect(prompts).toHaveLength(1);
      expect(prompts[0].name).toBe("summarize");
      await expect(
        client.getPrompt("summarize", { topic: "auth" }),
      ).resolves.toBe("Summarize auth");

      const tool = new McpResourceTool("resourceful", resources, client);
      expect(tool.name).toBe("mcp__resourceful__read_resource");
      expect(tool.risk).toBe("read");
      expect(tool.description).toContain("docs://readme");
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
        capabilities: {},
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
      250,
    );
    try {
      await client.start();
      await expect(client.callTool("slow", {})).rejects.toThrow(
        /timed out after 250ms/,
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
