import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  ensurePrivateDirectory,
  resetPrivateStorageCacheForTests,
  writePrivateFile,
} from "./privateStorage.js";

describe("privateStorage", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "orbit-private-"));
    resetPrivateStorageCacheForTests();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    resetPrivateStorageCacheForTests();
  });

  it("creates missing directories with owner-only POSIX modes", () => {
    const target = join(tempDir, "nested", "state");
    ensurePrivateDirectory(target, { platform: "linux" });
    expect(existsSync(target)).toBe(true);
    if (process.platform !== "win32") {
      expect(statSync(target).mode & 0o777).toBe(0o700);
    }
  });

  it("locks Windows directories to the current user's SID via icacls", () => {
    const target = join(tempDir, "windows-state");
    const runCommand = vi.fn((command: string) => {
      if (command === "whoami") return '"host\\user","S-1-5-21-1-2-3-1001"';
      return "";
    });

    ensurePrivateDirectory(target, { platform: "win32", runCommand });

    expect(runCommand).toHaveBeenCalledWith("whoami", [
      "/user",
      "/fo",
      "csv",
      "/nh",
    ]);
    expect(runCommand).toHaveBeenCalledWith("icacls", [
      target,
      "/inheritance:r",
      "/grant:r",
      "*S-1-5-21-1-2-3-1001:(OI)(CI)F",
    ]);

    // A second call is memoized: no further icacls invocations.
    const callsAfterFirst = runCommand.mock.calls.length;
    ensurePrivateDirectory(target, { platform: "win32", runCommand });
    expect(runCommand.mock.calls.length).toBe(callsAfterFirst);
  });

  it("never fails the caller when ACL tooling is unavailable", () => {
    const target = join(tempDir, "no-acl");
    const runCommand = vi.fn(() => {
      throw new Error("icacls unsupported");
    });
    expect(() =>
      ensurePrivateDirectory(target, { platform: "win32", runCommand }),
    ).not.toThrow();
    expect(existsSync(target)).toBe(true);
  });

  it("writes private files readable by the owner only", () => {
    const filePath = join(tempDir, "private.json");
    writePrivateFile(filePath, "{}");
    expect(existsSync(filePath)).toBe(true);
    if (process.platform !== "win32") {
      expect(statSync(filePath).mode & 0o777).toBe(0o600);
    }
  });
});
