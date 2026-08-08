import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from "fs";
import { join, resolve } from "path";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { z } from "zod";
import {
  ensurePrivateDirectory,
  generateId,
  readBoundedRegularFile,
  readBoundedRegularFileBuffer,
  resolveSafePath,
  writePrivateFile,
} from "@orbit-build/shared";
import { FileBackup, Checkpoint } from "./types.js";

const SafePathSegmentSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const CheckpointIdSchema = z.string().regex(/^cp_[a-f0-9]{32}$/);
const PersistedCheckpointMetadataSchema = z
  .object({
    id: CheckpointIdSchema,
    timestamp: z.string().datetime(),
    toolCallId: z.string().min(1).max(256),
    filePath: z.string().min(1).max(4096),
    exists: z.boolean(),
  })
  .strict();

/** `backup_content.enc` layout: 12-byte IV ‖ 16-byte GCM tag ‖ ciphertext. */
const ENCRYPTED_BACKUP_IV_BYTES = 12;
const ENCRYPTED_BACKUP_TAG_BYTES = 16;
const CHECKPOINT_METADATA_MAX_BYTES = 64 * 1024;
const CHECKPOINT_CONTENT_MAX_BYTES = 16 * 1024 * 1024;

export interface CheckpointManagerOptions {
  /** Encrypt backup contents at rest when a key is available. */
  encrypt?: boolean;
  /** Supplies the 32-byte key; null disables encryption for this session. */
  keyProvider?: () => Buffer | null;
}

export class CheckpointManager {
  private checkpoints: Checkpoint[] = [];
  private checkpointRoot: string | undefined;
  private initialized = false;
  private encryptionKey: Buffer | null | undefined;

  constructor(
    private cwd: string,
    private sessionId: string,
    private readonly options: CheckpointManagerOptions = {},
  ) {
    if (!SafePathSegmentSchema.safeParse(sessionId).success) {
      throw new Error(`Invalid checkpoint session id: ${sessionId}`);
    }
    this.checkpointRoot = resolve(cwd, ".orbit", "checkpoints", sessionId);
  }

  /** Validate and load durable state explicitly, keeping construction I/O-free. */
  public initialize(): this {
    if (this.initialized) return this;
    this.checkpointRoot = resolveSafePath(
      this.cwd,
      join(".orbit", "checkpoints", this.sessionId),
    );
    this.initialized = true;
    try {
      this.loadPersistedCheckpoints();
    } catch (error) {
      this.initialized = false;
      throw error;
    }
    return this;
  }

  private resolveEncryptionKey(): Buffer | null {
    if (this.encryptionKey !== undefined) return this.encryptionKey;
    this.encryptionKey =
      this.options.encrypt && this.options.keyProvider
        ? this.options.keyProvider()
        : null;
    if (this.encryptionKey && this.encryptionKey.length !== 32) {
      this.encryptionKey = null;
    }
    return this.encryptionKey;
  }

  private encryptBackup(content: string, key: Buffer): Buffer {
    const iv = randomBytes(ENCRYPTED_BACKUP_IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(content, "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  private decryptBackup(payload: Buffer, key: Buffer): string {
    const iv = payload.subarray(0, ENCRYPTED_BACKUP_IV_BYTES);
    const tag = payload.subarray(
      ENCRYPTED_BACKUP_IV_BYTES,
      ENCRYPTED_BACKUP_IV_BYTES + ENCRYPTED_BACKUP_TAG_BYTES,
    );
    const ciphertext = payload.subarray(
      ENCRYPTED_BACKUP_IV_BYTES + ENCRYPTED_BACKUP_TAG_BYTES,
    );
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  }

  private getSessionCheckpointDir(): string {
    if (!this.initialized) this.initialize();
    if (!this.checkpointRoot)
      throw new Error("Checkpoint root is unavailable.");
    return this.checkpointRoot;
  }

  private loadPersistedCheckpoints(): void {
    const sessionDir = this.getSessionCheckpointDir();
    if (!existsSync(sessionDir)) return;

    const loaded: Checkpoint[] = [];
    for (const entry of readdirSync(sessionDir, { withFileTypes: true })) {
      if (
        !entry.isDirectory() ||
        !CheckpointIdSchema.safeParse(entry.name).success
      ) {
        continue;
      }
      const checkpointDir = resolveSafePath(sessionDir, entry.name);
      const metaPath = resolveSafePath(checkpointDir, "meta.json");
      if (!existsSync(metaPath)) continue;
      try {
        const parsed = PersistedCheckpointMetadataSchema.safeParse(
          JSON.parse(
            readBoundedRegularFile(metaPath, CHECKPOINT_METADATA_MAX_BYTES) ??
              "",
          ) as unknown,
        );
        if (!parsed.success || parsed.data.id !== entry.name) {
          continue;
        }
        const meta = parsed.data;
        resolveSafePath(this.cwd, meta.filePath);
        const originalContent = meta.exists
          ? this.readPersistedBackup(checkpointDir)
          : null;
        if (meta.exists && originalContent === null) continue;
        loaded.push({
          id: meta.id,
          sessionId: this.sessionId,
          timestamp: meta.timestamp,
          toolCallId: meta.toolCallId,
          backups: [
            {
              path: meta.filePath,
              originalContent,
            },
          ],
        });
      } catch {
        // Ignore incomplete checkpoints instead of blocking session recovery.
      }
    }
    loaded.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    this.checkpoints = loaded;
  }

  /**
   * Read one persisted backup, whichever representation exists. Encrypted
   * backups that no longer authenticate (tampering, key rotation) are treated
   * as missing so session recovery continues without them.
   */
  private readPersistedBackup(checkpointDir: string): string | null {
    const encryptedPath = resolveSafePath(checkpointDir, "backup_content.enc");
    if (existsSync(encryptedPath)) {
      const key = this.resolveEncryptionKey();
      if (!key) return null;
      try {
        const payload = readBoundedRegularFileBuffer(
          encryptedPath,
          CHECKPOINT_CONTENT_MAX_BYTES +
            ENCRYPTED_BACKUP_IV_BYTES +
            ENCRYPTED_BACKUP_TAG_BYTES,
        );
        return payload ? this.decryptBackup(payload, key) : null;
      } catch {
        return null;
      }
    }
    const plaintextPath = resolveSafePath(checkpointDir, "backup_content.txt");
    if (!existsSync(plaintextPath)) return null;
    return (
      readBoundedRegularFile(plaintextPath, CHECKPOINT_CONTENT_MAX_BYTES) ??
      null
    );
  }

  public async captureBeforeState(
    toolCallId: string,
    filePath: string,
  ): Promise<Checkpoint> {
    const validToolCallId = z.string().min(1).max(256).parse(toolCallId);
    const validFilePath = z.string().min(1).max(4096).parse(filePath);
    const safePath = resolveSafePath(this.cwd, validFilePath);
    let originalContent: string | null = null;
    if (existsSync(safePath)) {
      const stats = lstatSync(safePath);
      if (!stats.isFile() && !stats.isSymbolicLink()) {
        throw new Error(`Checkpoint target must be a file: ${validFilePath}`);
      }
      originalContent =
        readBoundedRegularFile(safePath, CHECKPOINT_CONTENT_MAX_BYTES) ?? null;
      if (originalContent === null) {
        throw new Error(`Checkpoint target disappeared: ${validFilePath}`);
      }
    }

    const backup: FileBackup = {
      path: validFilePath,
      originalContent,
    };

    const checkpoint: Checkpoint = {
      id: generateId("cp"),
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      toolCallId: validToolCallId,
      backups: [backup],
    };

    const sessionDir = this.getSessionCheckpointDir();
    ensurePrivateDirectory(sessionDir);
    const checkpointDir = resolveSafePath(sessionDir, checkpoint.id);
    const stagingDir = resolveSafePath(
      sessionDir,
      `.pending-${checkpoint.id}-${randomBytes(8).toString("hex")}`,
    );
    mkdirSync(stagingDir, { recursive: false, mode: 0o700 });
    try {
      if (originalContent !== null) {
        const key = this.resolveEncryptionKey();
        if (key) {
          writePrivateFile(
            join(stagingDir, "backup_content.enc"),
            this.encryptBackup(originalContent, key),
          );
        } else {
          writePrivateFile(
            join(stagingDir, "backup_content.txt"),
            originalContent,
          );
        }
      }
      writePrivateFile(
        join(stagingDir, "meta.json"),
        JSON.stringify({
          id: checkpoint.id,
          timestamp: checkpoint.timestamp,
          toolCallId: validToolCallId,
          filePath: validFilePath,
          exists: originalContent !== null,
        }),
      );
      renameSync(stagingDir, checkpointDir);
    } catch (error) {
      rmSync(stagingDir, { recursive: true, force: true });
      throw error;
    }

    // Only expose a checkpoint after its complete on-disk representation has
    // been committed. Interrupted writes therefore cannot create false rewind
    // targets in the live session.
    this.checkpoints.push(checkpoint);

    return checkpoint;
  }

  public getCheckpoints(): Checkpoint[] {
    if (!this.initialized) this.initialize();
    return [...this.checkpoints];
  }

  public removeCheckpoint(checkpointId: string): void {
    if (!CheckpointIdSchema.safeParse(checkpointId).success) {
      throw new Error(`Invalid checkpoint id: ${checkpointId}`);
    }
    this.checkpoints = this.checkpoints.filter(
      (checkpoint) => checkpoint.id !== checkpointId,
    );
    const checkpointDir = resolveSafePath(
      this.getSessionCheckpointDir(),
      checkpointId,
    );
    if (existsSync(checkpointDir)) {
      rmSync(checkpointDir, { recursive: true, force: true });
    }
  }
}
