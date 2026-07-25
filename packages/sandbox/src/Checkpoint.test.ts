import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { CheckpointManager } from "./CheckpointManager.js";
import { RollbackManager } from "./RollbackManager.js";

describe("Sandbox Checkpoints and Rollbacks", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `orbit-sandbox-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should capture JIT snapshot before edit and rollback successfully", async () => {
    const filePath = "test.txt";
    const absPath = join(tempDir, filePath);

    writeFileSync(absPath, "initial-content", "utf8");

    const cpManager = new CheckpointManager(tempDir, "session-123");
    const rbManager = new RollbackManager(tempDir);

    const checkpoint = await cpManager.captureBeforeState("call-1", filePath);

    writeFileSync(absPath, "modified-content", "utf8");
    expect(readFileSync(absPath, "utf8")).toBe("modified-content");

    rbManager.rollback(checkpoint);
    expect(readFileSync(absPath, "utf8")).toBe("initial-content");
  });

  it("should delete newly created files on rollback", async () => {
    const filePath = "new-file.txt";
    const absPath = join(tempDir, filePath);

    const cpManager = new CheckpointManager(tempDir, "session-123");
    const rbManager = new RollbackManager(tempDir);

    const checkpoint = await cpManager.captureBeforeState("call-1", filePath);

    writeFileSync(absPath, "brand-new-file", "utf8");
    expect(existsSync(absPath)).toBe(true);

    rbManager.rollback(checkpoint);
    expect(existsSync(absPath)).toBe(false);
  });

  it("reports an unsafe rollback path without throwing", () => {
    const result = new RollbackManager(tempDir).rollback({
      id: "cp_22222222222222222222222222222222",
      sessionId: "session-safe-rollback",
      timestamp: new Date().toISOString(),
      toolCallId: "call-unsafe-rollback",
      backups: [{ path: "../outside.txt", originalContent: "before" }],
    });

    expect(result.success).toBe(false);
    expect(result.restored).toEqual([]);
    expect(result.error).toContain("outside workspace boundary");
  });

  it("should reload persisted checkpoints after process restart", async () => {
    const filePath = "persistent.txt";
    const absPath = join(tempDir, filePath);
    writeFileSync(absPath, "before", "utf8");

    const firstManager = new CheckpointManager(tempDir, "session-persisted");
    const checkpoint = await firstManager.captureBeforeState(
      "call-persisted",
      filePath,
    );
    writeFileSync(absPath, "after", "utf8");

    const reloadedManager = new CheckpointManager(tempDir, "session-persisted");
    const reloaded = reloadedManager.getCheckpoints();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].id).toBe(checkpoint.id);

    new RollbackManager(tempDir).rollback(reloaded[0]);
    expect(readFileSync(absPath, "utf8")).toBe("before");
  });

  it("should remove consumed checkpoints from memory and disk", async () => {
    const manager = new CheckpointManager(tempDir, "session-remove");
    const checkpoint = await manager.captureBeforeState("call-remove", "x.ts");
    manager.removeCheckpoint(checkpoint.id);

    expect(manager.getCheckpoints()).toHaveLength(0);
    const reloaded = new CheckpointManager(tempDir, "session-remove");
    expect(reloaded.getCheckpoints()).toHaveLength(0);
  });

  it("rejects paths outside the workspace instead of recording a false missing-file snapshot", async () => {
    const manager = new CheckpointManager(tempDir, "session-safe-path");

    await expect(
      manager.captureBeforeState("call-unsafe", "../outside.txt"),
    ).rejects.toThrow("outside workspace boundary");
    expect(manager.getCheckpoints()).toHaveLength(0);
  });

  it("ignores tampered checkpoint metadata and cannot delete outside its checkpoint root", () => {
    const sessionId = "session-tampered";
    const checkpointRoot = join(tempDir, ".orbit", "checkpoints", sessionId);
    const forgedDirectory = join(
      checkpointRoot,
      "cp_00000000000000000000000000000000",
    );
    const protectedDirectory = join(
      tempDir,
      ".orbit",
      "checkpoints",
      "protected",
    );
    mkdirSync(forgedDirectory, { recursive: true });
    mkdirSync(protectedDirectory, { recursive: true });
    writeFileSync(join(protectedDirectory, "keep.txt"), "keep", "utf8");
    writeFileSync(
      join(forgedDirectory, "meta.json"),
      JSON.stringify({
        id: "../../protected",
        timestamp: new Date().toISOString(),
        toolCallId: "call-forged",
        filePath: "target.ts",
        exists: false,
      }),
      "utf8",
    );

    const manager = new CheckpointManager(tempDir, sessionId);
    expect(manager.getCheckpoints()).toHaveLength(0);
    expect(() => manager.removeCheckpoint("../../protected")).toThrow(
      "Invalid checkpoint id",
    );
    expect(readFileSync(join(protectedDirectory, "keep.txt"), "utf8")).toBe(
      "keep",
    );
  });

  it("ignores incomplete snapshots instead of treating an existing file as newly created", () => {
    const sessionId = "session-incomplete";
    const checkpointId = "cp_11111111111111111111111111111111";
    const checkpointDirectory = join(
      tempDir,
      ".orbit",
      "checkpoints",
      sessionId,
      checkpointId,
    );
    mkdirSync(checkpointDirectory, { recursive: true });
    writeFileSync(
      join(checkpointDirectory, "meta.json"),
      JSON.stringify({
        id: checkpointId,
        timestamp: new Date().toISOString(),
        toolCallId: "call-incomplete",
        filePath: "existing.ts",
        exists: true,
      }),
      "utf8",
    );

    const manager = new CheckpointManager(tempDir, sessionId);
    expect(manager.getCheckpoints()).toHaveLength(0);
  });

  it("rejects session ids that can escape the checkpoint directory", () => {
    expect(() => new CheckpointManager(tempDir, "../../outside")).toThrowError(
      "Invalid checkpoint session id",
    );
  });
});
