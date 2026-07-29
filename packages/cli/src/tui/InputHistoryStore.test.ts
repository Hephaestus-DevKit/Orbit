import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { InputHistoryStore } from "./InputHistoryStore.js";

const temporaryDirectories: string[] = [];

function historyPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "orbit-history-"));
  temporaryDirectories.push(directory);
  return join(directory, "nested", "history.json");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("InputHistoryStore", () => {
  it("round-trips validated history and creates its parent directory", () => {
    const filePath = historyPath();
    const store = new InputHistoryStore(filePath);
    store.save(["first", "second"]);
    expect(store.load()).toEqual(["first", "second"]);
  });

  it("degrades missing or malformed history to an empty list", () => {
    const filePath = historyPath();
    const store = new InputHistoryStore(filePath);
    expect(store.load()).toEqual([]);
    store.save(["valid"]);
    writeFileSync(filePath, JSON.stringify(["valid", 42]), "utf8");
    expect(store.load()).toEqual([]);
  });

  it("bounds persisted entries and rejects oversized history files", () => {
    const filePath = historyPath();
    const store = new InputHistoryStore(filePath);
    store.save([
      ...Array.from({ length: 510 }, (_, index) => `entry-${index}`),
      "x".repeat(20_100),
    ]);

    const loaded = store.load();
    expect(loaded).toHaveLength(500);
    expect(loaded[0]).toBe("entry-11");
    expect(loaded.at(-1)).toHaveLength(20_000);

    writeFileSync(filePath, "x".repeat(1_048_577), "utf8");
    expect(store.load()).toEqual([]);
  });
});
