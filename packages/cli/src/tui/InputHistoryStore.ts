import { join } from "path";
import { homedir } from "os";
import { z } from "zod";
import {
  readBoundedRegularFile,
  replacePrivateFileAtomically,
} from "@orbit-build/shared";

const INPUT_HISTORY_MAX_BYTES = 1_048_576;
const INPUT_HISTORY_MAX_ENTRIES = 500;
const INPUT_HISTORY_ENTRY_MAX_CHARS = 20_000;
const inputHistorySchema = z
  .array(z.string().max(INPUT_HISTORY_ENTRY_MAX_CHARS))
  .max(INPUT_HISTORY_MAX_ENTRIES);

/** Persists submitted TUI inputs independently from terminal lifecycle state. */
export class InputHistoryStore {
  public constructor(
    private readonly filePath = join(homedir(), ".orbit", "input_history.json"),
  ) {}

  /** Loads validated history, degrading to an empty list for missing/corrupt data. */
  public load(): string[] {
    try {
      const raw = readBoundedRegularFile(
        this.filePath,
        INPUT_HISTORY_MAX_BYTES,
      );
      if (raw === undefined) return [];
      const parsed: unknown = JSON.parse(raw);
      const result = inputHistorySchema.safeParse(parsed);
      return result.success ? result.data : [];
    } catch {
      return [];
    }
  }

  /** Saves history atomically enough for this single-process local cache. */
  public save(history: readonly string[]): void {
    try {
      const bounded = history
        .slice(-INPUT_HISTORY_MAX_ENTRIES)
        .map((entry) => entry.slice(0, INPUT_HISTORY_ENTRY_MAX_CHARS));
      replacePrivateFileAtomically(
        this.filePath,
        `${JSON.stringify(bounded, null, 2)}\n`,
      );
    } catch {
      // Input history is a convenience cache; terminal input must remain usable.
    }
  }
}
