import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  ensurePrivateDirectory,
  readBoundedRegularFileAsync,
  readBoundedRegularFile,
  replacePrivateFileAtomically,
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

  it("reads bounded regular files and rejects unsafe or oversized entries", () => {
    const filePath = join(tempDir, "bounded.json");
    writeFileSync(filePath, '{"ok":true}');
    expect(readBoundedRegularFile(filePath, 32)).toBe('{"ok":true}');
    expect(() => readBoundedRegularFile(filePath, 4)).toThrow("byte limit");

    const directoryPath = join(tempDir, "not-a-file");
    mkdirSync(directoryPath);
    expect(() => readBoundedRegularFile(directoryPath)).toThrow("regular file");
    expect(readBoundedRegularFile(join(tempDir, "missing"))).toBeUndefined();
  });

  it("reads bounded regular files asynchronously with the same safety rules", async () => {
    const filePath = join(tempDir, "bounded-async.json");
    writeFileSync(filePath, '{"ok":true}');
    await expect(readBoundedRegularFileAsync(filePath, 32)).resolves.toBe(
      '{"ok":true}',
    );
    await expect(readBoundedRegularFileAsync(filePath, 4)).rejects.toThrow(
      "byte limit",
    );
    await expect(
      readBoundedRegularFileAsync(join(tempDir, "missing-async")),
    ).resolves.toBeUndefined();

    const directoryPath = join(tempDir, "not-an-async-file");
    mkdirSync(directoryPath);
    await expect(readBoundedRegularFileAsync(directoryPath)).rejects.toThrow(
      "regular file",
    );
  });

  it.skipIf(process.platform === "win32")(
    "only follows a symbolic-link leaf when explicitly allowed",
    () => {
      const target = join(tempDir, "target.json");
      const link = join(tempDir, "linked.json");
      writeFileSync(target, '{"safe":true}');
      symlinkSync(target, link, "file");

      expect(() => readBoundedRegularFile(link)).toThrow("regular file");
      expect(
        readBoundedRegularFile(link, 64, { allowSymbolicLink: true }),
      ).toBe('{"safe":true}');
    },
  );

  it("atomically creates and replaces private files", () => {
    const filePath = join(tempDir, "nested", "private.json");
    replacePrivateFileAtomically(filePath, '{"version":1}');
    replacePrivateFileAtomically(filePath, '{"version":2}');

    expect(readFileSync(filePath, "utf8")).toBe('{"version":2}');
    if (process.platform !== "win32") {
      expect(statSync(filePath).mode & 0o777).toBe(0o600);
    }
  });

  it("refuses to replace a non-regular destination", () => {
    const filePath = join(tempDir, "private.json");
    mkdirSync(filePath);
    expect(() => replacePrivateFileAtomically(filePath, "{}")).toThrow(
      "regular file",
    );
  });

  it.skipIf(process.platform === "win32")(
    "refuses to write through a symbolic-link storage directory",
    () => {
      const target = join(tempDir, "external");
      const linkedDirectory = join(tempDir, "linked");
      mkdirSync(target);
      symlinkSync(target, linkedDirectory, "dir");

      expect(() =>
        replacePrivateFileAtomically(
          join(linkedDirectory, "private.json"),
          "{}",
        ),
      ).toThrow("real directory");
      expect(existsSync(join(target, "private.json"))).toBe(false);
    },
  );
});
