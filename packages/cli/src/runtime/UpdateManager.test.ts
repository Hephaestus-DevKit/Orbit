import { describe, expect, it, mockTools as vi } from "../../../../scripts/testing/support.mjs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { UpdateManager } from "./UpdateManager.js";

describe("UpdateManager", () => {
  it("uninstalls only the running npm installation and verifies removal", () => {
    const prefix = mkdtempSync(join(tmpdir(), "orbit-npm-prefix-"));
    try {
      const entry = join(
        prefix,
        process.platform === "win32" ? "" : "lib",
        "node_modules",
        "@orbit-build",
        "cli",
        "dist",
        "index.js",
      );
      mkdirSync(dirname(entry), { recursive: true });
      writeFileSync(entry, "");
      const other = join(prefix, "other.js");
      writeFileSync(other, "");
      const run = vi.fn(() => prefix);
      const manager = new UpdateManager({ run });
      expect(() => manager.prepareUninstall(other)).toThrow("global installation");
      expect(run).toHaveBeenCalledTimes(1);
      expect(() => manager.prepareUninstall(entry).remove()).toThrow("left the Orbit installation");
      expect(run.mock.calls.at(-1)).toEqual([
        expect.any(String),
        expect.arrayContaining(["uninstall", "--global", "--ignore-scripts", "@orbit-build/cli"]),
        expect.objectContaining({ npmPrefix: prefix }),
      ]);
    } finally {
      rmSync(prefix, { recursive: true, force: true });
    }
  });

  it("checks the published latest tag with a bounded npm command", () => {
    const run = vi.fn().mockReturnValue('"0.2.0"');
    const manager = new UpdateManager({
      platform: "win32",
      run,
      timeoutMs: 1234,
      windowsCommandShell: "C:\\Windows\\System32\\cmd.exe",
    });

    expect(manager.check("0.1.6")).toEqual({
      currentVersion: "0.1.6",
      latestVersion: "0.2.0",
      updateAvailable: true,
    });
    expect(run).toHaveBeenCalledWith(
      "C:\\Windows\\System32\\cmd.exe",
      [
        "/d",
        "/s",
        "/c",
        "npm.cmd",
        "view",
        "@orbit-build/cli",
        "dist-tags.latest",
        "--json",
      ],
      { timeoutMs: 1234, inheritOutput: false },
    );
  });

  it("handles stable and prerelease ordering", () => {
    expect(
      new UpdateManager({ run: () => '"0.1.6"' }).check("0.1.6-beta.2"),
    ).toMatchObject({ updateAvailable: true });
    expect(
      new UpdateManager({ run: () => '"0.1.6-beta.1"' }).check("0.1.6"),
    ).toMatchObject({ updateAvailable: false });
  });

  it("supports a non-blocking latest-version check for the TUI", async () => {
    const runAsync = vi.fn().mockResolvedValue('"0.2.0"');
    const manager = new UpdateManager({
      platform: "linux",
      runAsync,
      timeoutMs: 2500,
    });

    await expect(manager.checkAsync("0.1.6")).resolves.toMatchObject({
      latestVersion: "0.2.0",
      updateAvailable: true,
    });
    expect(runAsync).toHaveBeenCalledWith(
      "npm",
      ["view", "@orbit-build/cli", "dist-tags.latest", "--json"],
      2500,
    );
  });

  it("maps the beta channel to npm's next dist-tag", () => {
    const run = vi.fn().mockReturnValue('"0.3.0-beta.1"');
    const manager = new UpdateManager({ platform: "linux", run });

    expect(manager.check("0.2.0", "beta")).toMatchObject({
      latestVersion: "0.3.0-beta.1",
      updateAvailable: true,
    });
    expect(run).toHaveBeenCalledWith(
      "npm",
      ["view", "@orbit-build/cli", "dist-tags.next", "--json"],
      { timeoutMs: 15000, inheritOutput: false },
    );
  });

  it("installs only a validated exact package version", () => {
    const run = vi.fn().mockReturnValue("");
    const manager = new UpdateManager({ platform: "linux", run });

    manager.install("0.2.0", false);

    expect(run).toHaveBeenCalledWith(
      "npm",
      [
        "install",
        "--global",
        "@orbit-build/cli@0.2.0",
        "--no-audit",
        "--no-fund",
      ],
      { timeoutMs: 120000, inheritOutput: false },
    );
    expect(() => manager.install("latest;echo unsafe")).toThrow();
  });

  it("rejects malformed registry output", () => {
    const manager = new UpdateManager({ run: () => "not-json" });
    expect(() => manager.check("0.1.6")).toThrow("invalid latest-version");
  });

  it("reads and validates the installed global version", () => {
    const run = vi.fn().mockReturnValue(
      JSON.stringify({
        dependencies: { "@orbit-build/cli": { version: "0.2.0" } },
      }),
    );
    const manager = new UpdateManager({ platform: "linux", run });

    expect(manager.readInstalledVersion()).toBe("0.2.0");
    expect(run).toHaveBeenCalledWith(
      "npm",
      ["list", "--global", "@orbit-build/cli", "--depth=0", "--json"],
      { timeoutMs: 15000, inheritOutput: false },
    );
  });
});
