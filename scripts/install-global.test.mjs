import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "./testing/support.mjs";
import {
  assertStandalonePackageDirectory,
  resolveGlobalPackageDirectory,
  resolvePnpmBuildInvocation,
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

describe("global install build runner", () => {
  it("uses the pinned installed pnpm when Corepack is missing", () => {
    expect(
      resolvePnpmBuildInvocation({
        corepackAvailable: false,
        pnpmVersion: "10.34.5",
        packageManager: "pnpm@10.34.5",
        platform: "darwin",
      }),
    ).toEqual({
      command: "pnpm",
      args: ["--filter", "@orbit-build/cli...", "build"],
    });
  });
  it("does not silently use a mismatched manager", () => {
    expect(() =>
      resolvePnpmBuildInvocation({
        corepackAvailable: false,
        pnpmVersion: "11.25.0",
        packageManager: "pnpm@10.34.5",
      }),
    ).toThrow("pnpm@10.34.5");
  });
  it("preserves literal Windows command arguments", () => {
    expect(
      resolvePnpmBuildInvocation({
        corepackAvailable: true,
        packageManager: "pnpm@10.34.5",
        platform: "win32",
        commandShell: "C:\\Windows\\System32\\cmd.exe",
      }),
    ).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        "corepack",
        "pnpm",
        "--filter",
        "@orbit-build/cli...",
        "build",
      ],
    });
  });
});
