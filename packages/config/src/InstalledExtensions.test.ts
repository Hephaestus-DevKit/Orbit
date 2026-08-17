import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  lstatSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { createHash } from "crypto";
import { tmpdir } from "os";
import { join, relative } from "path";
import { DEFAULT_CONFIG } from "./defaults.js";
import { ManagedPolicySchema } from "./ManagedPolicy.js";
import {
  applyInstalledExtensionContributions,
  getInstalledExtensionToolContributions,
  hashExtensionDirectory,
  MAX_EXTENSION_REGISTRY_BYTES,
  MAX_EXTENSION_TREE_DEPTH,
} from "./InstalledExtensions.js";

describe("installed extension contributions", () => {
  let home: string;
  let extensionRoot: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "orbit-installed-extension-"));
    extensionRoot = join(home, ".orbit", "extensions", "com.example.docs");
    mkdirSync(extensionRoot, { recursive: true });
    writeFileSync(
      join(extensionRoot, "extension.yaml"),
      [
        "schemaVersion: 1",
        "id: com.example.docs",
        "displayName: Docs",
        "version: 1.0.0",
        "orbit:",
        "  minVersion: 0.1.0",
        "permissions:",
        "  network: [docs.example.com]",
        "contributes:",
        "  mcpServers:",
        "    docs:",
        "      transport: streamable-http",
        "      url: https://docs.example.com/mcp",
      ].join("\n"),
    );
  });

  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("loads trusted MCP contributions only while their digest matches", () => {
    const registryPath = join(home, ".orbit", "extensions.json");
    writeFileSync(
      registryPath,
      JSON.stringify({
        schemaVersion: 1,
        extensions: [
          {
            id: "com.example.docs",
            digest: hashDirectory(extensionRoot),
            trusted: true,
            path: extensionRoot,
            manifestFile: "extension.yaml",
          },
        ],
      }),
    );

    const loaded = applyInstalledExtensionContributions(
      structuredClone(DEFAULT_CONFIG),
      home,
    );
    expect(loaded.tools.mcp.enabled).toBe(true);
    expect(loaded.mcpServers["com.example.docs.docs"]).toMatchObject({
      transport: "streamable-http",
      url: "https://docs.example.com/mcp",
    });

    writeFileSync(join(extensionRoot, "tampered.txt"), "tampered");
    const rejected = applyInstalledExtensionContributions(
      structuredClone(DEFAULT_CONFIG),
      home,
    );
    expect(rejected.mcpServers).toEqual({});
  });

  it("fails closed when managed policy excludes an otherwise trusted extension", () => {
    const registryPath = join(home, ".orbit", "extensions.json");
    writeFileSync(
      registryPath,
      JSON.stringify({
        schemaVersion: 1,
        extensions: [
          {
            id: "com.example.docs",
            digest: hashDirectory(extensionRoot),
            trusted: true,
            path: extensionRoot,
            manifestFile: "extension.yaml",
          },
        ],
      }),
    );

    const config = structuredClone(DEFAULT_CONFIG);
    const policy = ManagedPolicySchema.parse({
      schemaVersion: 1,
      allowedExtensions: ["com.example.approved"],
    });
    config.managedPolicy = policy;
    const rejected = applyInstalledExtensionContributions(config, home);
    expect(rejected.mcpServers).toEqual({});

    policy.allowedExtensions = ["com.example.docs"];
    const allowed = applyInstalledExtensionContributions(config, home);
    expect(allowed.mcpServers["com.example.docs.docs"]).toBeDefined();
  });

  it("materializes trusted extension hooks with provenance and sandbox roots", () => {
    writeFileSync(
      join(extensionRoot, "extension.yaml"),
      [
        "schemaVersion: 1",
        "id: com.example.docs",
        "displayName: Docs",
        "version: 1.0.0",
        "orbit:",
        "  minVersion: 0.1.0",
        "permissions:",
        "  process: true",
        "contributes:",
        "  hooks:",
        "    - event: pre_tool",
        "      command: node hook.mjs",
        "      matcher: write_*",
        "      onFailure: block",
      ].join("\n"),
    );
    const registryPath = join(home, ".orbit", "extensions.json");
    writeFileSync(
      registryPath,
      JSON.stringify({
        schemaVersion: 1,
        extensions: [
          {
            id: "com.example.docs",
            digest: hashDirectory(extensionRoot),
            trusted: true,
            path: extensionRoot,
            manifestFile: "extension.yaml",
          },
        ],
      }),
    );

    const loaded = applyInstalledExtensionContributions(
      structuredClone(DEFAULT_CONFIG),
      home,
    );
    expect(loaded.hooks.lifecycle?.preToolUse).toEqual([
      {
        command: "node hook.mjs",
        matcher: "write_*",
        timeoutMs: 30_000,
        onFailure: "block",
        extension: { id: "com.example.docs", root: extensionRoot },
      },
    ]);

    writeFileSync(
      join(extensionRoot, "extension.yaml"),
      readFileSync(join(extensionRoot, "extension.yaml"), "utf8").replace(
        "  process: true",
        "  process: false",
      ),
    );
    writeFileSync(
      registryPath,
      JSON.stringify({
        schemaVersion: 1,
        extensions: [
          {
            id: "com.example.docs",
            digest: hashDirectory(extensionRoot),
            trusted: true,
            path: extensionRoot,
            manifestFile: "extension.yaml",
          },
        ],
      }),
    );
    const rejected = applyInstalledExtensionContributions(
      structuredClone(DEFAULT_CONFIG),
      home,
    );
    expect(rejected.hooks.lifecycle?.preToolUse).toBeUndefined();
  });

  it("materializes only versioned, network-denied extension tool contracts", () => {
    mkdirSync(join(extensionRoot, "tools"));
    writeFileSync(
      join(extensionRoot, "tools", "run.mjs"),
      "process.exit(0);",
      "utf8",
    );
    writeFileSync(
      join(extensionRoot, "tools", "definition.yaml"),
      [
        "schemaVersion: 1",
        "description: Local extension tool",
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
    writeFileSync(
      join(extensionRoot, "extension.yaml"),
      [
        "schemaVersion: 1",
        "id: com.example.docs",
        "displayName: Docs",
        "version: 1.0.0",
        "orbit:",
        "  minVersion: 0.1.0",
        "permissions:",
        "  process: true",
        "contributes:",
        "  tools:",
        "    - name: local",
        "      path: tools/definition.yaml",
        "      risk: execute",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(home, ".orbit", "extensions.json"),
      JSON.stringify({
        schemaVersion: 1,
        extensions: [
          {
            id: "com.example.docs",
            digest: hashDirectory(extensionRoot),
            trusted: true,
            path: extensionRoot,
            manifestFile: "extension.yaml",
          },
        ],
      }),
      "utf8",
    );

    const loaded = applyInstalledExtensionContributions(
      structuredClone(DEFAULT_CONFIG),
      home,
    );
    expect(getInstalledExtensionToolContributions(loaded)).toMatchObject([
      {
        extensionId: "com.example.docs",
        contributionName: "local",
        risk: "execute",
      },
    ]);

    const disabled = structuredClone(DEFAULT_CONFIG);
    disabled.managedPolicy = ManagedPolicySchema.parse({
      schemaVersion: 1,
      disableExtensionTools: true,
    });
    const rejected = applyInstalledExtensionContributions(disabled, home);
    expect(getInstalledExtensionToolContributions(rejected)).toEqual([]);
  });

  it("uses framed v2 digests while preserving legacy registry verification", () => {
    const first = join(home, "digest-first");
    const second = join(home, "digest-second");
    mkdirSync(first);
    mkdirSync(second);
    writeFileSync(join(first, "a"), "bc");
    writeFileSync(join(second, "ab"), "c");

    expect(hashExtensionDirectory(first, "sha256-v1")).toBe(
      hashExtensionDirectory(second, "sha256-v1"),
    );
    expect(hashExtensionDirectory(first)).not.toBe(
      hashExtensionDirectory(second),
    );
  });

  it.skipIf(process.platform === "win32")(
    "does not follow a symlinked extension registry",
    () => {
      const registryPath = join(home, ".orbit", "extensions.json");
      const externalRegistry = join(home, "external-extensions.json");
      writeFileSync(
        externalRegistry,
        JSON.stringify({
          schemaVersion: 1,
          extensions: [
            {
              id: "com.example.docs",
              digest: hashExtensionDirectory(extensionRoot),
              digestAlgorithm: "sha256-v2",
              trusted: true,
              path: extensionRoot,
              manifestFile: "extension.yaml",
            },
          ],
        }),
      );
      symlinkSync(externalRegistry, registryPath, "file");

      expect(
        applyInstalledExtensionContributions(
          structuredClone(DEFAULT_CONFIG),
          home,
        ).mcpServers,
      ).toEqual({});
    },
  );

  it("ignores an oversized extension registry", () => {
    const registryPath = join(home, ".orbit", "extensions.json");
    writeFileSync(registryPath, " ".repeat(MAX_EXTENSION_REGISTRY_BYTES + 1));
    expect(
      applyInstalledExtensionContributions(
        structuredClone(DEFAULT_CONFIG),
        home,
      ).mcpServers,
    ).toEqual({});
  });

  it("ignores unsafe or unreadable extension trees without breaking config loading", () => {
    const registryPath = join(home, ".orbit", "extensions.json");
    writeFileSync(
      registryPath,
      JSON.stringify({
        schemaVersion: 1,
        extensions: [
          {
            id: "com.example.docs",
            digest: hashDirectory(extensionRoot),
            trusted: true,
            path: extensionRoot,
            manifestFile: "extension.yaml",
          },
        ],
      }),
    );
    const outside = join(home, "outside-extension-content");
    mkdirSync(outside);
    symlinkSync(
      outside,
      join(extensionRoot, "linked-content"),
      process.platform === "win32" ? "junction" : "dir",
    );

    expect(() =>
      applyInstalledExtensionContributions(
        structuredClone(DEFAULT_CONFIG),
        home,
      ),
    ).not.toThrow();
    expect(
      applyInstalledExtensionContributions(
        structuredClone(DEFAULT_CONFIG),
        home,
      ).mcpServers,
    ).toEqual({});
  });

  it("rejects a registry entry whose path is outside its managed extension slot", () => {
    const rogueRoot = join(home, "rogue", "com.example.docs");
    mkdirSync(rogueRoot, { recursive: true });
    writeFileSync(
      join(rogueRoot, "extension.yaml"),
      readFileSync(join(extensionRoot, "extension.yaml"), "utf8"),
    );
    writeFileSync(
      join(home, ".orbit", "extensions.json"),
      JSON.stringify({
        schemaVersion: 1,
        extensions: [
          {
            id: "com.example.docs",
            digest: hashExtensionDirectory(rogueRoot),
            digestAlgorithm: "sha256-v2",
            trusted: true,
            path: rogueRoot,
            manifestFile: "extension.yaml",
          },
        ],
      }),
    );

    expect(
      applyInstalledExtensionContributions(
        structuredClone(DEFAULT_CONFIG),
        home,
      ).mcpServers,
    ).toEqual({});
  });

  it("bounds extension tree depth before hashing untrusted content", () => {
    const deepRoot = join(home, "deep-extension");
    let current = deepRoot;
    mkdirSync(current);
    for (let depth = 0; depth <= MAX_EXTENSION_TREE_DEPTH; depth += 1) {
      current = join(current, "d");
      mkdirSync(current);
    }
    writeFileSync(join(current, "leaf.txt"), "leaf");

    expect(() => hashExtensionDirectory(deepRoot)).toThrow("maximum depth");
  });
});

function hashDirectory(root: string): string {
  const hash = createHash("sha256");
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry);
      const stats = lstatSync(path);
      hash.update(relative(root, path).replace(/\\/g, "/"));
      if (stats.isDirectory()) visit(path);
      else hash.update(readFileSync(path));
    }
  };
  visit(root);
  return hash.digest("hex");
}
