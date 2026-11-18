import {
  mockModule,
  afterEach,
  describe,
  expect,
  it,
  mockTools as vi,
} from "../../../../scripts/testing/support.mjs";

await mockModule(import.meta.resolve("@orbit-build/sandbox"), () => ({
  sandboxInvocation: (invocation: { file: string; args: string[] }) => ({
    ...invocation,
    backend: "none",
    networkIsolation: true,
    degraded: false,
  }),
}));

const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = await import("fs");
const { tmpdir } = await import("os");
const { join } = await import("path");
const { ExtensionProcessTool } = await import("./ExtensionProcessTool.js");

import type { InstalledExtensionToolContribution } from "@orbit-build/config";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createContribution(root: string): InstalledExtensionToolContribution {
  return {
    extensionId: "com.example.local",
    extensionRoot: root,
    contributionName: "echo",
    runtimeName: "ext__com_example_local_echo__12345678",
    risk: "read",
    filesystem: [],
    definition: {
      schemaVersion: 1,
      description: "Echo a bounded input.",
      runtime: "node",
      entrypoint: "tool.mjs",
      args: [],
      inputSchema: {
        type: "object",
        properties: { text: { type: "string", maxLength: 100 } },
        required: ["text"],
        additionalProperties: false,
      },
      timeoutMs: 5_000,
      maxOutputBytes: 64 * 1024,
    },
  };
}

describe("ExtensionProcessTool", () => {
  it("executes the versioned stdin/stdout protocol with a sanitized result", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-extension-process-"));
    roots.push(root);
    writeFileSync(
      join(root, "tool.mjs"),
      [
        "let value = '';",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (chunk) => value += chunk);",
        "process.stdin.on('end', () => {",
        "  const request = JSON.parse(value);",
        "  console.log(JSON.stringify({ protocol: 'orbit-extension-tool-result-v1', ok: true, data: { echo: request.input.text }, display: request.input.text }));",
        "});",
      ].join("\n"),
      "utf8",
    );
    const tool = new ExtensionProcessTool(createContribution(root));

    const result = await tool.execute(
      { text: "hello" },
      { cwd: root, sessionId: "session-1" },
    );
    if (result.error) throw new Error(result.error);
    expect(result).toMatchObject({
      ok: true,
      data: { echo: "hello" },
      display: "hello",
    });
  });

  it("rejects invalid input before starting an extension process", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-extension-process-"));
    roots.push(root);
    writeFileSync(
      join(root, "tool.mjs"),
      "import {writeFileSync} from 'node:fs'; writeFileSync('started','yes'); process.exit(99);",
      "utf8",
    );
    const tool = new ExtensionProcessTool(createContribution(root));

    await expect(
      tool.execute(
        { text: "x", unexpected: true },
        { cwd: root, sessionId: "session-1" },
      ),
    ).resolves.toMatchObject({ ok: false });
    expect(existsSync(join(root, "started"))).toBe(false);
  });

  it("denies extension child processes even when their own code requests one", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-extension-process-"));
    roots.push(root);
    writeFileSync(
      join(root, "tool.mjs"),
      `import {spawnSync} from 'node:child_process';
      let denied=false;try {spawnSync(process.execPath,['-e','process.exit(0)']);} catch(e) {denied=e.code==='ERR_ACCESS_DENIED';}
      console.log(JSON.stringify({protocol:'orbit-extension-tool-result-v1',ok:denied,data:{denied}}));`,
    );
    const tool = new ExtensionProcessTool(createContribution(root));
    await expect(
      tool.execute({ text: "test" }, { cwd: root, sessionId: "test" }),
    ).resolves.toMatchObject({ ok: true, data: { denied: true } });
  });

  it("kills a process ignoring graceful cancellation before releasing execution", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-extension-process-"));
    roots.push(root);
    writeFileSync(
      join(root, "tool.mjs"),
      `import {writeFileSync} from 'node:fs';
      process.on('SIGTERM',()=>{});process.stdin.resume();process.stdin.on('end',()=>{
      writeFileSync('ready',String(process.pid));setInterval(()=>{},1000);});`,
    );
    const contribution = createContribution(root);
    contribution.filesystem = [{ mode: "write", scope: "*" }];
    const tool = new ExtensionProcessTool(contribution);
    const controller = new AbortController();
    const pending = tool.execute(
      { text: "test" },
      { cwd: root, sessionId: "test", abortSignal: controller.signal },
    );
    try {
      await vi.waitFor(
        () => expect(existsSync(join(root, "ready"))).toBe(true),
        { timeout: 5000 },
      );
      const pid = Number(readFileSync(join(root, "ready"), "utf8"));
      controller.abort();
      await expect(pending).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining("cancelled"),
      });
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      controller.abort();
      await pending;
    }
  });
});
