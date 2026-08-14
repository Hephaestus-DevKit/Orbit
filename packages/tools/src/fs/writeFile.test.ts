import { createHash } from "crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyPermissionModePreset, ConfigSchema } from "@orbit-build/config";
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

  it("writes outside the workspace only with unrestricted Full Access", async () => {
    const hostDirectory = mkdtempSync(join(tmpdir(), "orbit-host-write-"));
    const target = join(hostDirectory, "outside.txt");
    try {
      await expect(
        tool.execute(
          { path: target, content: "blocked" },
          { cwd, sessionId: "normal" },
        ),
      ).resolves.toMatchObject({ ok: false });

      const config = ConfigSchema.parse({});
      applyPermissionModePreset(config, "auto");
      await expect(
        tool.execute(
          { path: target, content: "full-access", intent: "create" },
          { cwd, sessionId: "full", config },
        ),
      ).resolves.toMatchObject({ ok: true });
      expect(readFileSync(target, "utf8")).toBe("full-access");
    } finally {
      rmSync(hostDirectory, { recursive: true, force: true });
    }
  });

  it("allows Full Access to replace a file too large for content preconditions", async () => {
    const target = join(cwd, "oversized.txt");
    writeFileSync(target, "");
    truncateSync(target, 16 * 1024 * 1024 + 1);

    await expect(
      tool.execute(
        { path: target, content: "normal" },
        { cwd, sessionId: "normal" },
      ),
    ).resolves.toMatchObject({ ok: false });

    const config = ConfigSchema.parse({});
    applyPermissionModePreset(config, "auto");
    await expect(
      tool.execute(
        { path: target, content: "full-access", intent: "overwrite" },
        { cwd, sessionId: "full", config },
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(readFileSync(target, "utf8")).toBe("full-access");
  });
});
