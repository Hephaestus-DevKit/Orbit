import { mkdtempSync, writeFileSync, rmSync, renameSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionHistoryCache } from "./SessionHistoryCache.js";
import type { StoredHistoryMessage } from "./types.js";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "orbit-history-cache-"));
  roots.push(root);
  const snapshot = join(root, "history.json");
  const journal = join(root, "history.jsonl");
  writeFileSync(snapshot, "[]");
  const history: StoredHistoryMessage[] = [
    {
      id: "msg",
      role: "user",
      content: [{ type: "text", text: "original" }],
      createdAt: new Date().toISOString(),
    },
  ];
  const load = vi.fn(() => structuredClone(history));
  return { snapshot, journal, history, load };
}
describe("bounded session history cache", () => {
  afterEach(() => {
    for (const root of roots.splice(0))
      rmSync(root, { recursive: true, force: true });
  });
  it("reuses an unchanged disk generation without exposing mutable cache state", () => {
    const { snapshot, journal, load } = fixture();
    const cache = new SessionHistoryCache();
    const first = cache.read(snapshot, journal, load);
    first[0].content = [];
    expect(cache.read(snapshot, journal, load)[0].content).toHaveLength(1);
    expect(load).toHaveBeenCalledOnce();
  });
  it("invalidates on external journal writes and atomic snapshot replacement", () => {
    const { snapshot, journal, load } = fixture();
    const cache = new SessionHistoryCache();
    cache.read(snapshot, journal, load);
    writeFileSync(journal, "new generation");
    cache.read(snapshot, journal, load);
    writeFileSync(`${snapshot}.tmp`, "replacement");
    renameSync(`${snapshot}.tmp`, snapshot);
    cache.read(snapshot, journal, load);
    expect(load).toHaveBeenCalledTimes(3);
  });
  it("does not replay the journal after a successfully committed save", () => {
    const { snapshot, journal, history, load } = fixture();
    const cache = new SessionHistoryCache();
    cache.committed(snapshot, journal, history);
    expect(cache.read(snapshot, journal, load)).toEqual(history);
    expect(load).not.toHaveBeenCalled();
  });
  it("bounds retained history and evicts least-recently-used sessions", () => {
    const first = fixture();
    const second = fixture();
    const cache = new SessionHistoryCache(1024, 1);
    cache.read(first.snapshot, first.journal, first.load);
    cache.read(second.snapshot, second.journal, second.load);
    cache.read(first.snapshot, first.journal, first.load);
    expect(first.load).toHaveBeenCalledTimes(2);
    const tiny = new SessionHistoryCache(1);
    tiny.read(second.snapshot, second.journal, second.load);
    tiny.read(second.snapshot, second.journal, second.load);
    expect(second.load).toHaveBeenCalledTimes(3);
  });
});
