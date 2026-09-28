import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  promises as fsPromises,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { BM25Store } from "./BM25.js";
import { HybridSearch } from "./HybridSearch.js";
import { JSVectorStore, type Document } from "./VectorStore.js";
import { SymbolIndexer } from "./SymbolIndexer.js";
import { getOrbitCachePath } from "./cachePaths.js";

function document(id: string, text: string): Document {
  return {
    id,
    text,
    vector: [1, 0, 0],
    metadata: { filePath: `${id}.ts`, startLine: 1, endLine: 1 },
  };
}

const lexicalOnly = async (): Promise<number[][]> => [];

describe("Retrieval cache recovery", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "orbit-retrieval-recovery-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(workspace, { recursive: true, force: true });
  });

  it("keeps lexical fallback and persisted documents after an incompatible query vector", async () => {
    const search = new HybridSearch(workspace);
    await search.addDocuments([document("buffer", "buffer initialization")]);
    const cachePath = getOrbitCachePath(workspace, "vector_store.json");
    const previousCache = readFileSync(cachePath, "utf8");

    const results = await search.search("buffer", async () => [[1, 0]]);

    expect(results.map((result) => result.id)).toEqual(["buffer"]);
    expect(readFileSync(cachePath, "utf8")).toBe(previousCache);
    expect(await search.search("buffer", lexicalOnly)).toHaveLength(1);
    expect(
      await new JSVectorStore(workspace).search([1, 0, 0], 5),
    ).toHaveLength(1);
  });

  it("removes old lexical terms when an upsert contains only ignored tokens", async () => {
    const store = new BM25Store(workspace);
    const original = document("buffer", "buffer initialization");
    await store.addDocuments([original]);
    await store.addDocuments([{ ...original, text: "const return true" }]);

    expect(await store.search("buffer", 5)).toEqual([]);
    expect(await new BM25Store(workspace).search("buffer", 5)).toEqual([]);

    await store.addDocuments([original]);
    const freshWorkspace = join(workspace, "fresh");
    const { mkdirSync } = await import("fs");
    mkdirSync(freshWorkspace, { recursive: true });
    const fresh = new BM25Store(freshWorkspace);
    await fresh.addDocuments([original]);
    expect(await store.search("buffer", 5)).toEqual(
      await fresh.search("buffer", 5),
    );
  });

  it("invalidates and reports a failed lexical save while preserving the previous disk cache", async () => {
    const store = new BM25Store(workspace);
    await store.addDocuments([document("original", "original landmark")]);
    const cachePath = getOrbitCachePath(workspace, "bm25_store.json");
    const previousCache = readFileSync(cachePath, "utf8");
    const rename = vi
      .spyOn(fsPromises, "rename")
      .mockRejectedValueOnce(new Error("simulated disk failure"));

    await expect(
      store.addDocuments([document("updated", "updated landmark")]),
    ).rejects.toThrow("Failed to persist the Orbit BM25 cache");
    expect(store.hasValidCache()).toBe(false);
    expect(readFileSync(cachePath, "utf8")).toBe(previousCache);

    rename.mockRestore();
    await store.save();
    expect(store.hasValidCache()).toBe(true);
    expect(await new BM25Store(workspace).search("updated", 5)).toHaveLength(1);
  });

  it("allows retrying a failed batch without opening a new batch", async () => {
    const search = new HybridSearch(workspace);
    await search.load();
    search.beginBatch();
    await search.addDocuments([document("retry", "retry landmark")]);
    const save = vi
      .spyOn(BM25Store.prototype, "save")
      .mockRejectedValueOnce(new Error("simulated lexical save failure"));

    await expect(search.commitBatch()).rejects.toThrow("lexical save failure");
    await search.commitBatch();

    expect(save).toHaveBeenCalledTimes(2);
    expect(
      await new HybridSearch(workspace).search("retry", lexicalOnly),
    ).toHaveLength(1);
  });

  it("waits for both cache writers before exposing a failed batch", async () => {
    let finishVectorSave!: () => void;
    const pendingVectorSave = new Promise<void>((resolve) => {
      finishVectorSave = resolve;
    });
    const search = new HybridSearch(workspace);
    await search.load();
    search.beginBatch();
    await search.addDocuments([document("pending", "pending landmark")]);
    vi.spyOn(JSVectorStore.prototype, "save").mockReturnValue(
      pendingVectorSave,
    );
    vi.spyOn(BM25Store.prototype, "save").mockRejectedValue(
      new Error("simulated lexical save failure"),
    );
    let settled = false;
    const completion = search.commitBatch().then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
    } finally {
      finishVectorSave();
      await completion;
    }
    expect(settled).toBe(true);
  });

  it.each(["vector_store.json", "bm25_store.json"])(
    "does not advance file freshness when %s cannot be committed",
    async (failedCache) => {
      writeFileSync(
        join(workspace, "orbit.config.yaml"),
        "provider:\n  embedding: unavailable-test-provider\n",
        "utf8",
      );
      const sourcePath = join(workspace, "landmark.ts");
      writeFileSync(sourcePath, "export class OriginalAnchor {}", "utf8");
      const indexer = new SymbolIndexer(workspace);
      await indexer.index();
      const symbolsPath = getOrbitCachePath(workspace, "symbols.json");
      const previousSymbols = readFileSync(symbolsPath, "utf8");
      writeFileSync(
        sourcePath,
        "export class RecoveredSearchLandmark {}",
        "utf8",
      );
      const originalRename = fsPromises.rename;
      const rename = vi
        .spyOn(fsPromises, "rename")
        .mockImplementation(async (from, to) => {
          if (String(to).endsWith(failedCache)) {
            throw new Error("simulated cache rename failure");
          }
          await originalRename(from, to);
        });

      await indexer.index();
      const failedSymbols = readFileSync(symbolsPath, "utf8");
      rename.mockRestore();
      await indexer.index();

      const results = await new HybridSearch(workspace).search(
        "RecoveredSearchLandmark",
        lexicalOnly,
      );
      expect(failedSymbols).toBe(previousSymbols);
      expect(results).toHaveLength(1);
      expect(results[0].text).toContain("RecoveredSearchLandmark");
    },
  );
});
