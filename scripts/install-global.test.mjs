import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertStandalonePackageDirectory,
  resolveGlobalPackageDirectory,
  sanitizeNpmEnvironment,
} from "./install-global.mjs";

describe("install-global", () => {
  it("packs and installs a standalone artifact instead of linking source", () => {
    const source = readFileSync(
      join(process.cwd(), "scripts", "install-global.mjs"),
      "utf8",
    );

    expect(source).toContain('"pack",');
    expect(source).toContain('"install",');
    expect(source).toContain('"--global",');
    expect(source).toContain('"--ignore-scripts",');
    expect(source).toContain('"@orbit-build/cli..."');
    expect(source).not.toContain('"link",');
    expect(source).not.toContain("shell: true");
  });

  it("resolves platform-specific global package directories", () => {
    expect(resolveGlobalPackageDirectory("C:\\npm", "win32")).toBe(
      join("C:\\npm", "node_modules", "@orbit-build", "cli"),
    );
    expect(resolveGlobalPackageDirectory("/opt/npm", "linux")).toBe(
      join("/opt/npm", "lib", "node_modules", "@orbit-build", "cli"),
    );
  });

  it("removes pnpm-only npm settings without dropping normal environment", () => {
    expect(
      sanitizeNpmEnvironment({
        PATH: "bin",
        npm_config_user_agent: "pnpm/10",
        npm_config_npm_globalconfig: "ignored",
        npm_config_overrides: "ignored",
        npm_config_verify_deps_before_run: "true",
        npm_config__jsr_registry: "https://npm.jsr.io",
      }),
    ).toEqual({
      PATH: "bin",
      npm_config_user_agent: "pnpm/10",
    });
  });

  it("accepts an independent package and rejects a source link", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "orbit-install-test-"));
    const sourceDirectory = join(temporaryRoot, "source");
    const standaloneDirectory = join(temporaryRoot, "standalone");
    const linkedDirectory = join(temporaryRoot, "linked");
    try {
      mkdirSync(sourceDirectory);
      mkdirSync(standaloneDirectory);
      symlinkSync(
        sourceDirectory,
        linkedDirectory,
        process.platform === "win32" ? "junction" : "dir",
      );

      expect(() =>
        assertStandalonePackageDirectory(sourceDirectory, standaloneDirectory),
      ).not.toThrow();
      expect(() =>
        assertStandalonePackageDirectory(sourceDirectory, linkedDirectory),
      ).toThrow("still links to the source workspace");
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
