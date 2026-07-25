import {
  existsSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "fs";
import { join } from "path";
import { z } from "zod";
import { generateId, resolveSafePath } from "@orbit-build/shared";
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

export class CheckpointManager {
  private checkpoints: Checkpoint[] = [];
  private readonly checkpointRoot: string;

  constructor(
    private cwd: string,
    private sessionId: string,
  ) {
    if (!SafePathSegmentSchema.safeParse(sessionId).success) {
      throw new Error(`Invalid checkpoint session id: ${sessionId}`);
    }
    this.checkpointRoot = resolveSafePath(
      cwd,
      join(".orbit", "checkpoints", sessionId),
    );
    this.loadPersistedCheckpoints();
  }

  private getSessionCheckpointDir(): string {
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
          JSON.parse(readFileSync(metaPath, "utf8")) as unknown,
        );
        if (!parsed.success || parsed.data.id !== entry.name) {
          continue;
        }
        const meta = parsed.data;
        resolveSafePath(this.cwd, meta.filePath);
        const backupPath = resolveSafePath(checkpointDir, "backup_content.txt");
        if (meta.exists && !existsSync(backupPath)) continue;
        const originalContent = meta.exists
          ? readFileSync(backupPath, "utf8")
          : null;
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
      originalContent = readFileSync(safePath, "utf8");
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

    this.checkpoints.push(checkpoint);

    const checkpointDir = join(this.getSessionCheckpointDir(), checkpoint.id);
    mkdirSync(checkpointDir, { recursive: true });

    if (originalContent !== null) {
      writeFileSync(
        join(checkpointDir, "backup_content.txt"),
        originalContent,
        "utf8",
      );
    }
    writeFileSync(
      join(checkpointDir, "meta.json"),
      JSON.stringify({
        id: checkpoint.id,
        timestamp: checkpoint.timestamp,
        toolCallId: validToolCallId,
        filePath: validFilePath,
        exists: originalContent !== null,
      }),
      "utf8",
    );

    return checkpoint;
  }

  public getCheckpoints(): Checkpoint[] {
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
