import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  createExtensionToolInputSchema,
  createExtensionToolRuntimeName,
  ExtensionToolDefinitionSchema,
  loadExtensionToolDefinition,
} from "./ExtensionTool.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("extension tool contracts", () => {
  it("normalizes a strict, bounded input schema and validates nested values", () => {
    const definition = ExtensionToolDefinitionSchema.parse({
      schemaVersion: 1,
      description: "Summarize local files.",
      runtime: "node",
      entrypoint: "tools/summarize.mjs",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", minLength: 1, maxLength: 4096 },
          options: {
            type: "object",
            properties: {
              format: { type: "string", enum: ["text", "json"] },
            },
            required: ["format"],
            additionalProperties: false,
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    });
    const input = createExtensionToolInputSchema(definition.inputSchema);

    expect(
      input.safeParse({ path: "README.md", options: { format: "json" } })
        .success,
    ).toBe(true);
    expect(input.safeParse({ path: "", extra: true }).success).toBe(false);
    expect(
      input.safeParse({ path: "README.md", options: { format: "xml" } })
        .success,
    ).toBe(false);
  });

  it("rejects permissive, unknown, and excessively deep schema features", () => {
    expect(() =>
      ExtensionToolDefinitionSchema.parse({
        schemaVersion: 1,
        description: "Unsafe",
        runtime: "node",
        entrypoint: "tool.mjs",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: true,
        },
      }),
    ).toThrow("additionalProperties must be false");
    expect(() =>
      ExtensionToolDefinitionSchema.parse({
        schemaVersion: 1,
        description: "Unsafe",
        runtime: "node",
        entrypoint: "tool.mjs",
        inputSchema: {
          type: "object",
          properties: { value: { type: "string", pattern: ".*" } },
          additionalProperties: false,
        },
      }),
    ).toThrow("unsupported keyword pattern");
  });

  it("loads only bounded in-tree definitions and creates stable tool names", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-extension-tool-"));
    roots.push(root);
    mkdirSync(join(root, "tools"));
    writeFileSync(
      join(root, "tools", "definition.yaml"),
      [
        "schemaVersion: 1",
        "description: Safe tool",
        "runtime: node",
        "entrypoint: tools/run.mjs",
        "inputSchema:",
        "  type: object",
        "  properties: {}",
        "  required: []",
        "  additionalProperties: false",
      ].join("\n"),
      "utf8",
    );

    expect(
      loadExtensionToolDefinition(root, "tools/definition.yaml").runtime,
    ).toBe("node");
    expect(() => loadExtensionToolDefinition(root, "../outside.yaml")).toThrow(
      "outside workspace boundary",
    );
    const first = createExtensionToolRuntimeName(
      "com.example.really-long-extension-identifier",
      "summarize",
    );
    expect(first).toBe(
      createExtensionToolRuntimeName(
        "com.example.really-long-extension-identifier",
        "summarize",
      ),
    );
    expect(first).toMatch(/^ext__[A-Za-z0-9_-]+__[a-f0-9]{8}$/);
    expect(first.length).toBeLessThanOrEqual(64);
  });
});
