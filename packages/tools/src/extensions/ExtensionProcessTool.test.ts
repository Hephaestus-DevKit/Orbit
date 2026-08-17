import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("@orbit-build/sandbox", () => ({
  sandboxInvocation: (invocation: { file: string; args: string[] }) => ({
    ...invocation,
    backend: "none",
    networkIsolation: true,
    degraded: false,
  }),
}));

import type { InstalledExtensionToolContribution } from "@orbit-build/config";
import { ExtensionProcessTool } from "./ExtensionProcessTool.js";

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

    await expect(
      tool.execute({ text: "hello" }, { cwd: root, sessionId: "session-1" }),
    ).resolves.toMatchObject({
      ok: true,
      data: { echo: "hello" },
      display: "hello",
    });
  });

  it("rejects invalid input before starting an extension process", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-extension-process-"));
    roots.push(root);
    writeFileSync(join(root, "tool.mjs"), "process.exit(99);", "utf8");
    const tool = new ExtensionProcessTool(createContribution(root));

    await expect(
      tool.execute(
        { text: "x", unexpected: true },
        { cwd: root, sessionId: "session-1" },
      ),
    ).resolves.toMatchObject({ ok: false });
  });
});
