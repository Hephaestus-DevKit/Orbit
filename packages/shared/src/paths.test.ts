import { afterEach, describe, expect, it } from "../../../scripts/testing/support.mjs";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  checkWorkspaceBoundary,
  resolveSafePath,
  normalizePath,
  getGitBranch,
} from "./paths.js";

describe("paths boundary and safety checks", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("should normalize paths with forward slashes", () => {
    expect(normalizePath("foo\\bar\\baz")).toBe("foo/bar/baz");
  });

  it("should detect paths inside boundaries", () => {
    const root = "C:/workspace";
    expect(checkWorkspaceBoundary(root, "C:/workspace/foo/bar.txt")).toBe(true);
    expect(checkWorkspaceBoundary(root, "C:/workspace/")).toBe(true);
    expect(checkWorkspaceBoundary(root, "C:/workspace")).toBe(true);
  });

  it("should detect paths outside boundaries", () => {
    const root = "C:/workspace";
    expect(checkWorkspaceBoundary(root, "C:/workspace-other/foo")).toBe(false);
    expect(checkWorkspaceBoundary(root, "C:/other/bar")).toBe(false);
  });

  it("should throw on resolveSafePath if outside boundary", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-path-boundary-"));
    temporaryDirectories.push(root);
    expect(() => resolveSafePath(root, "../other/file.txt")).toThrow();
    expect(resolveSafePath(root, "src/main.ts")).toBe(
      normalizePath(join(root, "src", "main.ts")),
    );
  });

  it("should get git branch name or return default/fallback", () => {
    const branch = getGitBranch(".");
    expect(branch).toBeDefined();
    expect(typeof branch).toBe("string");
  });

  it("rejects a symbolic link that escapes the workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-path-root-"));
    const outside = mkdtempSync(join(tmpdir(), "orbit-path-outside-"));
    temporaryDirectories.push(root, outside);
    writeFileSync(join(outside, "secret.txt"), "secret", "utf8");
    const link = join(root, "outside-link");

    try {
      symlinkSync(
        outside,
        link,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch {
      return;
    }

    expect(() => resolveSafePath(root, "outside-link/secret.txt")).toThrow(
      /symbolic link|outside workspace/i,
    );
  });

  it("allows a new file beneath an existing in-workspace directory", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-path-new-file-"));
    temporaryDirectories.push(root);
    mkdirSync(join(root, "src"));

    expect(resolveSafePath(root, "src/new.ts")).toBe(
      normalizePath(join(root, "src", "new.ts")),
    );
  });

  it("allows a nested path whose parent directories do not exist yet", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-path-nested-"));
    temporaryDirectories.push(root);

    expect(resolveSafePath(root, ".orbit/branches/main/cache.json")).toBe(
      normalizePath(join(root, ".orbit", "branches", "main", "cache.json")),
    );
  });
});
