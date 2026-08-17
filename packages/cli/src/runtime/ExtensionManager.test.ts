import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MAX_EXTENSION_REGISTRY_BYTES } from "@orbit-build/config";
import { ExtensionManager } from "./ExtensionManager.js";

describe("ExtensionManager", () => {
  let cwd: string;
  let home: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-extension-source-"));
    home = mkdtempSync(join(tmpdir(), "orbit-extension-home-"));
    mkdirSync(join(cwd, "commands"), { recursive: true });
    writeFileSync(join(cwd, "commands", "review.md"), "Review this project.\n");
    mkdirSync(join(cwd, "agents"), { recursive: true });
    writeFileSync(
      join(cwd, "agents", "reviewer.yaml"),
      "name: reviewer\ndescription: Review extension profile\n",
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  function writeManifest(extra = ""): void {
    writeFileSync(
      join(cwd, "extension.yaml"),
      [
        "schemaVersion: 1",
        "id: com.example.review",
        "displayName: Review extension",
        "version: 1.0.0",
        "orbit:",
        "  minVersion: 0.1.0",
        "contributes:",
        "  commands:",
        "    - name: review",
        "      path: commands/review.md",
        "  agents:",
        "    - name: reviewer",
        "      path: agents/reviewer.yaml",
        extra,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  it("installs, updates, materializes, inventories, and removes declarative contributions", () => {
    writeManifest();
    const manager = new ExtensionManager(home);

    const installed = manager.install(cwd, "extension.yaml");
    const commandPath = join(
      home,
      ".orbit",
      "commands",
      "extensions",
      installed.id,
      "review.md",
    );
    const agentPath = join(
      home,
      ".orbit",
      "agents",
      "extensions",
      installed.id,
      "reviewer.yaml",
    );

    expect(installed.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(installed.digestAlgorithm).toBe("sha256-v2");
    expect(readFileSync(commandPath, "utf8")).toContain("Review this project");
    expect(readFileSync(agentPath, "utf8")).toContain("name: reviewer");
    expect(manager.list()).toHaveLength(1);

    writeFileSync(join(cwd, "commands", "review.md"), "Updated review.\n");
    manager.install(cwd, "extension.yaml");
    expect(manager.list()).toHaveLength(1);
    expect(readFileSync(commandPath, "utf8")).toContain("Updated review");

    expect(manager.remove(installed.id)).toBe(true);
    expect(manager.list()).toEqual([]);
    expect(existsSync(commandPath)).toBe(false);
    expect(existsSync(agentPath)).toBe(false);
  });

  it("rejects unsafe Agent Profile contribution shapes", () => {
    writeManifest();
    rmSync(join(cwd, "agents", "reviewer.yaml"));
    mkdirSync(join(cwd, "agents", "reviewer.yaml"));

    expect(() =>
      new ExtensionManager(home).install(cwd, "extension.yaml"),
    ).toThrow("must be a YAML or JSON file");

    rmSync(join(cwd, "agents", "reviewer.yaml"), {
      recursive: true,
      force: true,
    });
    writeFileSync(join(cwd, "agents", "reviewer.txt"), "name: reviewer\n");
    writeFileSync(
      join(cwd, "extension.yaml"),
      readFileSync(join(cwd, "extension.yaml"), "utf8").replace(
        "agents/reviewer.yaml",
        "agents/reviewer.txt",
      ),
    );
    expect(() =>
      new ExtensionManager(home).install(cwd, "extension.yaml"),
    ).toThrow("must be a YAML or JSON file");
  });

  it("rejects invalid or mismatched Agent Profile manifests before installation", () => {
    writeManifest();
    writeFileSync(
      join(cwd, "agents", "reviewer.yaml"),
      "name: other\ndescription: mismatched\n",
    );
    expect(() =>
      new ExtensionManager(home).install(cwd, "extension.yaml"),
    ).toThrow("name must match reviewer");

    writeFileSync(join(cwd, "agents", "reviewer.yaml"), "name: BAD NAME\n");
    expect(() =>
      new ExtensionManager(home).install(cwd, "extension.yaml"),
    ).toThrow("Agent Profile contribution is invalid");
  });

  it("requires explicit trust for process-capable extensions", () => {
    writeManifest("permissions:\n  process: true");
    const manager = new ExtensionManager(home);

    expect(() => manager.install(cwd, "extension.yaml")).toThrow("--trust");
    expect(
      manager.install(cwd, "extension.yaml", { trust: true }).trusted,
    ).toBe(true);
  });

  it("requires process permission for manifest lifecycle hooks", () => {
    writeManifest(
      [
        "  hooks:",
        "    - event: session_start",
        "      command: node hook.mjs",
      ].join("\n"),
    );
    expect(() =>
      new ExtensionManager(home).install(cwd, "extension.yaml"),
    ).toThrow("require process permission");
  });

  it("requires explicit trust for extension Agent Profiles that own hooks", () => {
    writeManifest();
    writeFileSync(
      join(cwd, "agents", "reviewer.yaml"),
      [
        "name: reviewer",
        "hooks:",
        "  sessionStart:",
        "    - command: echo ready",
      ].join("\n"),
    );
    const manager = new ExtensionManager(home);
    expect(() => manager.install(cwd, "extension.yaml")).toThrow("--trust");
    expect(
      manager.install(cwd, "extension.yaml", { trust: true }).trusted,
    ).toBe(true);
  });

  it("refuses an invalid registry without replacing the previous extension", () => {
    writeManifest();
    const manager = new ExtensionManager(home);
    const installed = manager.install(cwd, "extension.yaml");
    const installedCommand = join(
      home,
      ".orbit",
      "extensions",
      installed.id,
      "commands",
      "review.md",
    );
    const materializedCommand = join(
      home,
      ".orbit",
      "commands",
      "extensions",
      installed.id,
      "review.md",
    );
    writeFileSync(join(cwd, "commands", "review.md"), "Broken update.\n");
    const registryPath = join(home, ".orbit", "extensions.json");
    rmSync(registryPath);
    mkdirSync(registryPath);

    expect(() => manager.install(cwd, "extension.yaml")).toThrow(
      "registry is invalid",
    );
    expect(readFileSync(installedCommand, "utf8")).toContain(
      "Review this project",
    );
    expect(readFileSync(materializedCommand, "utf8")).toContain(
      "Review this project",
    );
  });

  it("refuses an oversized registry before mutating extension files", () => {
    writeManifest();
    const registryDirectory = join(home, ".orbit");
    mkdirSync(registryDirectory, { recursive: true });
    writeFileSync(
      join(registryDirectory, "extensions.json"),
      " ".repeat(MAX_EXTENSION_REGISTRY_BYTES + 1),
    );

    expect(() =>
      new ExtensionManager(home).install(cwd, "extension.yaml"),
    ).toThrow("registry is invalid");
    expect(
      existsSync(join(home, ".orbit", "extensions", "com.example.review")),
    ).toBe(false);
  });

  it("rejects traversal-shaped registry ids without touching outside paths", () => {
    const outside = join(home, "outside");
    const marker = join(outside, "keep.txt");
    mkdirSync(outside, { recursive: true });
    writeFileSync(marker, "keep");
    const registryDirectory = join(home, ".orbit");
    mkdirSync(registryDirectory, { recursive: true });
    writeFileSync(
      join(registryDirectory, "extensions.json"),
      JSON.stringify({
        schemaVersion: 1,
        extensions: [
          {
            id: "../../outside",
            displayName: "Tampered extension",
            version: "1.0.0",
            digest: "a".repeat(64),
            digestAlgorithm: "sha256-v2",
            installedAt: new Date().toISOString(),
            trusted: true,
            path: outside,
            manifestFile: "extension.yaml",
          },
        ],
      }),
    );

    expect(() => new ExtensionManager(home).remove("../../outside")).toThrow(
      "registry is invalid",
    );
    expect(readFileSync(marker, "utf8")).toBe("keep");
  });

  it("removes a staged extension when prompt materialization fails", () => {
    writeManifest();
    const blockingParent = join(home, ".orbit", "commands", "extensions");
    mkdirSync(join(home, ".orbit", "commands"), { recursive: true });
    writeFileSync(blockingParent, "not a directory");

    expect(() =>
      new ExtensionManager(home).install(cwd, "extension.yaml"),
    ).toThrow();
    expect(
      existsSync(join(home, ".orbit", "extensions", "com.example.review")),
    ).toBe(false);
    expect(readFileSync(blockingParent, "utf8")).toBe("not a directory");
    expect(existsSync(join(home, ".orbit", "extensions.json"))).toBe(false);
  });

  it("fails closed when a materialization parent is replaced by a file", () => {
    writeManifest();
    const commandsRoot = join(home, ".orbit", "commands");
    mkdirSync(join(home, ".orbit"), { recursive: true });
    writeFileSync(commandsRoot, "not a directory");

    expect(() =>
      new ExtensionManager(home).install(cwd, "extension.yaml"),
    ).toThrow("non-directory parent");
    expect(existsSync(join(home, ".orbit", "extensions.json"))).toBe(false);
  });

  it("restores package and prompt files when registry removal fails", () => {
    writeManifest();
    const manager = new ExtensionManager(home);
    const installed = manager.install(cwd, "extension.yaml");
    const installedCommand = join(installed.path, "commands", "review.md");
    const materializedCommand = join(
      home,
      ".orbit",
      "commands",
      "extensions",
      installed.id,
      "review.md",
    );
    type ExtensionManagerInternals = {
      writeRegistry(extensions: unknown[]): void;
    };
    vi.spyOn(
      ExtensionManager.prototype as unknown as ExtensionManagerInternals,
      "writeRegistry",
    ).mockImplementationOnce(() => {
      throw new Error("Simulated registry failure");
    });

    expect(() => manager.remove(installed.id)).toThrow(
      "Simulated registry failure",
    );
    expect(readFileSync(installedCommand, "utf8")).toContain(
      "Review this project",
    );
    expect(readFileSync(materializedCommand, "utf8")).toContain(
      "Review this project",
    );
    expect(manager.list()).toHaveLength(1);
  });

  it("rejects MCP capabilities that are not declared in permissions", () => {
    writeFileSync(
      join(cwd, "extension.yaml"),
      [
        "schemaVersion: 1",
        "id: com.example.unsafe",
        "displayName: Unsafe extension",
        "version: 1.0.0",
        "orbit:",
        "  minVersion: 0.1.0",
        "contributes:",
        "  mcpServers:",
        "    local:",
        "      transport: stdio",
        "      command: node",
      ].join("\n"),
    );

    expect(() =>
      new ExtensionManager(home).install(cwd, "extension.yaml", {
        trust: true,
      }),
    ).toThrow("requires process permission");
  });

  it("rejects excessively deep extension trees without leaving install state", () => {
    writeManifest();
    let current = cwd;
    for (let depth = 0; depth < 66; depth += 1) {
      current = join(current, "d");
      mkdirSync(current);
    }
    writeFileSync(join(current, "leaf.txt"), "leaf");

    expect(() =>
      new ExtensionManager(home).install(cwd, "extension.yaml"),
    ).toThrow("maximum depth");
    expect(
      existsSync(join(home, ".orbit", "extensions", "com.example.review")),
    ).toBe(false);
  });
});
