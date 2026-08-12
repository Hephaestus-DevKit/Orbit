import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  existsSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  mkdirSync,
  truncateSync,
} from "fs";
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

  it("preflights a multi-file rewind before changing any file", () => {
    writeFileSync(join(tempDir, "safe.txt"), "after", "utf8");
    mkdirSync(join(tempDir, "not-a-file"));
    const result = new RollbackManager(tempDir).rollback({
      id: "cp_33333333333333333333333333333333",
      sessionId: "session-preflight",
      timestamp: new Date().toISOString(),
      toolCallId: "call-preflight",
      backups: [
        { path: "safe.txt", originalContent: "before" },
        { path: "not-a-file", originalContent: "before" },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.restored).toEqual([]);
    expect(result.error).toContain("preflight");
    expect(readFileSync(join(tempDir, "safe.txt"), "utf8")).toBe("after");
  });

  it("rewinds multiple checkpoints as one ordered operation", () => {
    writeFileSync(join(tempDir, "sequence.txt"), "latest", "utf8");
    const manager = new RollbackManager(tempDir);
    const result = manager.rollbackMany([
      {
        id: "cp_44444444444444444444444444444444",
        sessionId: "session-sequence",
        timestamp: new Date().toISOString(),
        toolCallId: "call-later",
        backups: [{ path: "sequence.txt", originalContent: "middle" }],
      },
      {
        id: "cp_55555555555555555555555555555555",
        sessionId: "session-sequence",
        timestamp: new Date().toISOString(),
        toolCallId: "call-earlier",
        backups: [{ path: "sequence.txt", originalContent: "initial" }],
      },
    ]);

    expect(result.success).toBe(true);
    expect(readFileSync(join(tempDir, "sequence.txt"), "utf8")).toBe("initial");
    expect(
      readdirSync(tempDir).filter((name) => name.includes(".orbit-rollback-")),
    ).toEqual([]);
  });

  it("publishes restored content without leaving rollback temporary files", () => {
    const filePath = join(tempDir, "atomic.txt");
    writeFileSync(filePath, "after", "utf8");

    const result = new RollbackManager(tempDir).rollback({
      id: "cp_66666666666666666666666666666666",
      sessionId: "session-atomic-restore",
      timestamp: new Date().toISOString(),
      toolCallId: "call-atomic-restore",
      backups: [{ path: "atomic.txt", originalContent: "before" }],
    });

    expect(result.success).toBe(true);
    expect(readFileSync(filePath, "utf8")).toBe("before");
    expect(
      readdirSync(tempDir).filter((name) => name.includes(".orbit-rollback-")),
    ).toEqual([]);
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

  it("publishes only complete checkpoint directories", async () => {
    const manager = new CheckpointManager(tempDir, "session-atomic");
    const checkpoint = await manager.captureBeforeState(
      "call-atomic",
      "new-file.txt",
    );
    const checkpointRoot = join(
      tempDir,
      ".orbit",
      "checkpoints",
      "session-atomic",
    );

    expect(existsSync(join(checkpointRoot, checkpoint.id, "meta.json"))).toBe(
      true,
    );
    expect(
      readdirSync(checkpointRoot).filter((name) =>
        name.startsWith(".pending-"),
      ),
    ).toEqual([]);
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

  it("rejects checkpoint targets too large to retain safely in memory", async () => {
    const filePath = join(tempDir, "oversized.txt");
    writeFileSync(filePath, "");
    truncateSync(filePath, 16 * 1024 * 1024 + 1);
    const manager = new CheckpointManager(tempDir, "session-size-bound");

    await expect(
      manager.captureBeforeState("call-oversized", "oversized.txt"),
    ).rejects.toThrow("byte limit");
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

  it("keeps construction side-effect free and initializes idempotently", () => {
    const keyProvider = vi.fn(() => Buffer.alloc(32, 1));
    const manager = new CheckpointManager(tempDir, "session-lifecycle", {
      encrypt: true,
      keyProvider,
    });

    expect(existsSync(join(tempDir, ".orbit"))).toBe(false);
    expect(keyProvider).not.toHaveBeenCalled();
    expect(manager.initialize()).toBe(manager);
    expect(manager.initialize()).toBe(manager);
    expect(manager.getCheckpoints()).toEqual([]);
    expect(keyProvider).not.toHaveBeenCalled();
    expect(existsSync(join(tempDir, ".orbit"))).toBe(false);
  });

  describe("encrypted checkpoint backups", () => {
    const key = Buffer.alloc(32, 7);
    const encryptedOptions = { encrypt: true, keyProvider: () => key };

    it("stores ciphertext on disk and round-trips through a reload", async () => {
      const filePath = "secret.txt";
      writeFileSync(join(tempDir, filePath), "API_KEY=plain-secret", "utf8");

      const manager = new CheckpointManager(
        tempDir,
        "session-enc",
        encryptedOptions,
      );
      const checkpoint = await manager.captureBeforeState("call-enc", filePath);

      const checkpointDir = join(
        tempDir,
        ".orbit",
        "checkpoints",
        "session-enc",
        checkpoint.id,
      );
      expect(existsSync(join(checkpointDir, "backup_content.enc"))).toBe(true);
      expect(existsSync(join(checkpointDir, "backup_content.txt"))).toBe(false);
      expect(
        readFileSync(join(checkpointDir, "backup_content.enc")).includes(
          "plain-secret",
        ),
      ).toBe(false);

      const reloaded = new CheckpointManager(
        tempDir,
        "session-enc",
        encryptedOptions,
      );
      expect(reloaded.getCheckpoints()[0]?.backups[0]?.originalContent).toBe(
        "API_KEY=plain-secret",
      );
    });

    it("skips tampered ciphertext instead of restoring corrupted data", async () => {
      const filePath = "tamper.txt";
      writeFileSync(join(tempDir, filePath), "before", "utf8");
      const manager = new CheckpointManager(
        tempDir,
        "session-tamper-enc",
        encryptedOptions,
      );
      const checkpoint = await manager.captureBeforeState("call-t", filePath);
      const backupPath = join(
        tempDir,
        ".orbit",
        "checkpoints",
        "session-tamper-enc",
        checkpoint.id,
        "backup_content.enc",
      );
      const payload = readFileSync(backupPath);
      payload[payload.length - 1] ^= 0xff;
      writeFileSync(backupPath, payload);

      const reloaded = new CheckpointManager(
        tempDir,
        "session-tamper-enc",
        encryptedOptions,
      );
      expect(reloaded.getCheckpoints()).toHaveLength(0);
    });

    it("still reads legacy plaintext backups and falls back without a key", async () => {
      const filePath = "legacy.txt";
      writeFileSync(join(tempDir, filePath), "legacy-content", "utf8");
      const plaintextManager = new CheckpointManager(tempDir, "session-legacy");
      const checkpoint = await plaintextManager.captureBeforeState(
        "call-l",
        filePath,
      );
      expect(
        existsSync(
          join(
            tempDir,
            ".orbit",
            "checkpoints",
            "session-legacy",
            checkpoint.id,
            "backup_content.txt",
          ),
        ),
      ).toBe(true);

      const encryptedReader = new CheckpointManager(
        tempDir,
        "session-legacy",
        encryptedOptions,
      );
      expect(
        encryptedReader.getCheckpoints()[0]?.backups[0]?.originalContent,
      ).toBe("legacy-content");

      const keylessWriter = new CheckpointManager(tempDir, "session-keyless", {
        encrypt: true,
        keyProvider: () => null,
      });
      const keylessCheckpoint = await keylessWriter.captureBeforeState(
        "call-k",
        filePath,
      );
      expect(
        existsSync(
          join(
            tempDir,
            ".orbit",
            "checkpoints",
            "session-keyless",
            keylessCheckpoint.id,
            "backup_content.txt",
          ),
        ),
      ).toBe(true);
    });
  });
});
