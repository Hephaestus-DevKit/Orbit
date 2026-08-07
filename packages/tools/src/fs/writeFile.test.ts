import { createHash } from "crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WriteFileTool } from "./writeFile.js";

describe("WriteFileTool", () => {
  let cwd: string;
  const tool = new WriteFileTool();

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-write-file-"));
  });

  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it("supports explicit create and overwrite intents", async () => {
    const context = { cwd, sessionId: "test" };
    expect(
      await tool.execute(
        { path: "nested/file.txt", content: "created", intent: "create" },
        context,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await tool.execute(
        { path: "nested/file.txt", content: "duplicate", intent: "create" },
        context,
      ),
    ).toMatchObject({ ok: false });
    expect(
      await tool.execute(
        { path: "missing.txt", content: "missing", intent: "overwrite" },
        context,
      ),
    ).toMatchObject({ ok: false });
  });

  it("rejects a stale expected hash without changing the file", async () => {
    const target = join(cwd, "guarded.txt");
    writeFileSync(target, "current", "utf8");
    const staleHash = createHash("sha256").update("old").digest("hex");

    const result = await tool.execute(
      {
        path: "guarded.txt",
        content: "replacement",
        intent: "overwrite",
        expectedHash: staleHash,
      },
      { cwd, sessionId: "test" },
    );

    expect(result).toMatchObject({ ok: false });
    expect(readFileSync(target, "utf8")).toBe("current");
  });

  it("atomically replaces a file when the expected hash matches", async () => {
    const target = join(cwd, "guarded.txt");
    writeFileSync(target, "current", "utf8");
    const expectedHash = createHash("sha256").update("current").digest("hex");

    const result = await tool.execute(
      {
        path: "guarded.txt",
        content: "replacement",
        intent: "overwrite",
        expectedHash,
      },
      { cwd, sessionId: "test" },
    );

    expect(result).toMatchObject({ ok: true });
    expect(readFileSync(target, "utf8")).toBe("replacement");
  });
});
