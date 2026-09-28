import { lstatSync } from "fs";
import type { StoredHistoryMessage } from "./types.js";

interface Entry {
  fingerprint: string;
  history: StoredHistoryMessage[];
  bytes: number;
}

/** Bounded read-through cache; external writes, replacements and failed writes invalidate it. */
export class SessionHistoryCache {
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;

  constructor(
    private readonly maxBytes = 8 * 1024 * 1024,
    private readonly maxEntries = 4,
  ) {}

  public read(
    snapshot: string,
    journal: string,
    load: () => StoredHistoryMessage[],
  ): StoredHistoryMessage[] {
    const fingerprint = this.fingerprint(snapshot, journal);
    const entry = this.entries.get(snapshot);
    if (fingerprint !== undefined && entry?.fingerprint === fingerprint) {
      this.entries.delete(snapshot);
      this.entries.set(snapshot, entry);
      return structuredClone(entry.history);
    }
    this.invalidate(snapshot);
    const history = load();
    // Cache only a stable generation observed before and after the read.
    if (
      fingerprint !== undefined &&
      this.fingerprint(snapshot, journal) === fingerprint
    ) {
      this.remember(snapshot, fingerprint, history);
    }
    return history;
  }

  public invalidate(snapshot: string): void {
    const entry = this.entries.get(snapshot);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(snapshot);
  }

  /** Called only after the store has flushed and committed every file in the generation. */
  public committed(
    snapshot: string,
    journal: string,
    history: StoredHistoryMessage[],
  ): void {
    this.invalidate(snapshot);
    const fingerprint = this.fingerprint(snapshot, journal);
    if (fingerprint !== undefined)
      this.remember(snapshot, fingerprint, history);
  }

  private remember(
    snapshot: string,
    fingerprint: string,
    history: StoredHistoryMessage[],
  ): void {
    const bytes = Buffer.byteLength(JSON.stringify(history), "utf8");
    if (bytes > this.maxBytes) return;
    this.entries.set(snapshot, {
      fingerprint,
      history: structuredClone(history),
      bytes,
    });
    this.bytes += bytes;
    while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.invalidate(oldest);
    }
  }

  private fingerprint(snapshot: string, journal: string): string | undefined {
    const parts: string[] = [];
    for (const file of [snapshot, `${snapshot}.bak`, journal]) {
      try {
        const stat = lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink()) return undefined;
        parts.push(
          `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`,
        );
      } catch (error: unknown) {
        if (
          typeof error !== "object" ||
          error === null ||
          !("code" in error) ||
          error.code !== "ENOENT"
        )
          return undefined;
        parts.push("missing");
      }
    }
    return parts.join("|");
  }
}
