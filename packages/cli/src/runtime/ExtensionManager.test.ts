import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import { ExtensionManager } from "./ExtensionManager.js";

describe("ExtensionManager", () => {
  let cwd: string;
  let home: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-extension-source-"));
    home = mkdtempSync(join(tmpdir(), "orbit-extension-home-"));
    mkdirSync(join(cwd, "commands"), { recursive: true });
    writeFileSync(join(cwd, "commands", "review.md"), "Review this project.\n");
  });

  afterEach(() => {
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
        extra,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  it("installs, updates, materializes, inventories, and removes prompt contributions", () => {
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

    expect(installed.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(commandPath, "utf8")).toContain("Review this project");
    expect(manager.list()).toHaveLength(1);

    writeFileSync(join(cwd, "commands", "review.md"), "Updated review.\n");
    manager.install(cwd, "extension.yaml");
    expect(manager.list()).toHaveLength(1);
    expect(readFileSync(commandPath, "utf8")).toContain("Updated review");

    expect(manager.remove(installed.id)).toBe(true);
    expect(manager.list()).toEqual([]);
    expect(existsSync(commandPath)).toBe(false);
  });

  it("requires explicit trust for process-capable extensions", () => {
    writeManifest("permissions:\n  process: true");
    const manager = new ExtensionManager(home);

    expect(() => manager.install(cwd, "extension.yaml")).toThrow("--trust");
    expect(
      manager.install(cwd, "extension.yaml", { trust: true }).trusted,
    ).toBe(true);
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
});
