import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { randomUUID } from "crypto";
import { dirname } from "path";
import {
  readBoundedRegularFileBuffer,
  resolveSafePath,
} from "@orbit-build/shared";
import { Checkpoint, FileBackup } from "./types.js";

const ROLLBACK_FILE_MAX_BYTES = 16 * 1024 * 1024;

export interface RollbackResult {
  success: boolean;
  error?: string;
  restored: string[];
}

interface CurrentFileState {
  path: string;
  content: Buffer | null;
}

export class RollbackManager {
  constructor(private cwd: string) {}

  /** Restore a checkpoint without allowing one filesystem failure to crash the caller. */
  public rollback(checkpoint: Checkpoint): RollbackResult {
    return this.rollbackMany([checkpoint]);
  }

  /**
   * Restore an ordered checkpoint sequence as one transaction. Every target
   * is validated and snapshotted before writes begin; an unexpected write
   * failure triggers best-effort compensation to the pre-rewind state.
   */
  public rollbackMany(checkpoints: Checkpoint[]): RollbackResult {
    const restored: string[] = [];
    const currentStates = new Map<string, CurrentFileState>();

    try {
      for (const checkpoint of checkpoints) {
        for (const backup of checkpoint.backups) {
          const safePath = resolveSafePath(this.cwd, backup.path);
          if (!currentStates.has(safePath)) {
            currentStates.set(safePath, {
              path: backup.path,
              content: this.readCurrentContent(safePath, backup.path),
            });
          }
        }
      }
    } catch (error: unknown) {
      return {
        success: false,
        error: `Rollback preflight failed: ${toErrorMessage(error)}`,
        restored,
      };
    }

    try {
      for (const checkpoint of checkpoints) {
        for (const backup of checkpoint.backups) {
          this.restoreBackup(backup);
          restored.push(backup.path);
        }
      }
    } catch (error: unknown) {
      const compensationErrors: string[] = [];
      for (const state of [...currentStates.values()].reverse()) {
        try {
          this.restoreContent(state.path, state.content);
        } catch (compensationError: unknown) {
          compensationErrors.push(
            `${state.path}: ${toErrorMessage(compensationError)}`,
          );
        }
      }
      const compensationDetail =
        compensationErrors.length === 0
          ? " Previous workspace state was restored."
          : ` Compensation was incomplete (${compensationErrors.join("; ")}).`;
      return {
        success: false,
        error: `Could not complete rewind: ${toErrorMessage(error)}.${compensationDetail}`,
        restored,
      };
    }

    return {
      success: true,
      restored,
    };
  }

  private readCurrentContent(
    safePath: string,
    displayPath: string,
  ): Buffer | null {
    try {
      const stats = lstatSync(safePath);
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new Error(
          `Rollback target must be a regular file: ${displayPath}`,
        );
      }
      const content = readBoundedRegularFileBuffer(
        safePath,
        ROLLBACK_FILE_MAX_BYTES,
      );
      if (content === undefined) {
        throw new Error(`Rollback target disappeared: ${displayPath}`);
      }
      return content;
    } catch (error: unknown) {
      if (isFileSystemError(error, "ENOENT")) return null;
      throw error;
    }
  }

  private restoreBackup(backup: FileBackup): void {
    this.restoreContent(backup.path, backup.originalContent);
  }

  private restoreContent(path: string, content: string | Buffer | null): void {
    let safePath = resolveSafePath(this.cwd, path);
    try {
      const stats = lstatSync(safePath);
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new Error(`Rollback target must be a regular file: ${path}`);
      }
    } catch (error: unknown) {
      if (!isFileSystemError(error, "ENOENT")) throw error;
    }

    if (content === null) {
      // File did not exist before execution, so delete it on rollback.
      if (existsSync(safePath)) unlinkSync(safePath);
      return;
    }

    mkdirSync(dirname(safePath), { recursive: true });
    safePath = resolveSafePath(this.cwd, path);
    this.replaceFileAtomically(safePath, content);
  }

  /**
   * Publish each restored file with a same-directory atomic rename. A crash
   * while the temporary file is being written therefore leaves the original
   * target intact instead of exposing a truncated source file.
   */
  private replaceFileAtomically(path: string, content: string | Buffer): void {
    const temporaryPath = `${path}.orbit-rollback-${process.pid}-${randomUUID()}.tmp`;
    const existingMode = existsSync(path) ? statSync(path).mode : undefined;
    let descriptor: number | undefined;
    try {
      descriptor = openSync(
        temporaryPath,
        "wx",
        existingMode === undefined ? 0o666 : existingMode,
      );
      writeFileSync(descriptor, content);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporaryPath, path);
      this.fsyncParentDirectory(dirname(path));
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      rmSync(temporaryPath, { force: true });
    }
  }

  private fsyncParentDirectory(directory: string): void {
    let descriptor: number | undefined;
    try {
      descriptor = openSync(directory, "r");
      fsyncSync(descriptor);
    } catch {
      // Some Windows filesystems do not allow directory handles to be fsynced.
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
