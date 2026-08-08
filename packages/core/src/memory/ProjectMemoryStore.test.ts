import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ProjectMemoryStore } from "./ProjectMemoryStore.js";

describe("ProjectMemoryStore", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-memory-"));
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it("does not write during construction and persists explicit memories", () => {
    const store = new ProjectMemoryStore(cwd);
    expect(existsSync(join(cwd, ".orbit"))).toBe(false);
    const entry = store.add("Use pnpm for this project");
    expect(store.read().entries).toEqual([entry]);
  });

  it("defers canonical filesystem access until explicit initialization", () => {
    const missingRoot = join(cwd, "missing-root");
    const store = new ProjectMemoryStore(missingRoot);

    expect(() => store.initialize()).toThrow("Unable to resolve safe path");
    expect(existsSync(missingRoot)).toBe(false);
  });

  it("redacts credentials before persistence and supports review deletion", () => {
    const store = new ProjectMemoryStore(cwd);
    const entry = store.add("API_KEY=sk-12345678901234567890 use staging");
    const raw = readFileSync(join(cwd, ".orbit", "memory.json"), "utf8");
    expect(raw).not.toContain("sk-12345678901234567890");
    expect(store.remove(entry.id)).toBe(true);
    expect(store.read().entries).toHaveLength(0);
  });

  it("preserves the last known-good backup when the primary is corrupt", () => {
    const store = new ProjectMemoryStore(cwd);
    const first = store.add("first preference");
    store.add("second preference");
    const memoryPath = join(cwd, ".orbit", "memory.json");
    const backupPath = `${memoryPath}.bak`;
    expect(JSON.parse(readFileSync(backupPath, "utf8")).entries).toEqual([
      first,
    ]);

    writeFileSync(memoryPath, "{corrupt", "utf8");
    expect(store.read().entries).toEqual([first]);
    expect(() => store.add("recovered preference")).not.toThrow();
    expect(JSON.parse(readFileSync(backupPath, "utf8")).entries).toEqual([
      first,
    ]);
  });
});
