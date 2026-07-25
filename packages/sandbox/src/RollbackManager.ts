import { existsSync, writeFileSync, unlinkSync } from "fs";
import { resolveSafePath } from "@orbit-build/shared";
import { Checkpoint } from "./types.js";

export class RollbackManager {
  constructor(private cwd: string) {}

  /** Restore a checkpoint without allowing one filesystem failure to crash the caller. */
  public rollback(checkpoint: Checkpoint): {
    success: boolean;
    error?: string;
    restored: string[];
  } {
    const restored: string[] = [];

    for (const backup of checkpoint.backups) {
      try {
        const safePath = resolveSafePath(this.cwd, backup.path);

        if (backup.originalContent === null) {
          // File did not exist before the tool execution, so delete it on rollback
          if (existsSync(safePath)) {
            unlinkSync(safePath);
            restored.push(backup.path);
          }
        } else {
          // Restore previous content
          writeFileSync(safePath, backup.originalContent, "utf8");
          restored.push(backup.path);
        }
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: `Could not restore ${backup.path}: ${detail}`,
          restored,
        };
      }
    }

    return {
      success: true,
      restored,
    };
  }
}
