import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  parseSymbolIndex,
  SearchSymbolsInputSchema,
  SearchSymbolsTool,
} from "./searchSymbols.js";

describe("SearchSymbolsTool tests", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `orbit-search-symbols-tool-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should search matching symbols from the index file", async () => {
    const orbitDir = join(tempDir, ".orbit");
    mkdirSync(orbitDir, { recursive: true });

    const indexContent = {
      files: {
        "src/utils.ts": {
          mtime: 123456,
          symbols: [
            { name: "formatDate", type: "function", line: 12 },
            { name: "parseDate", type: "function", line: 20 },
          ],
        },
        "src/User.ts": {
          mtime: 789012,
          symbols: [{ name: "User", type: "class", line: 5 }],
        },
      },
      indexedAt: "2026-06-18T23:51:14Z",
    };

    writeFileSync(
      join(orbitDir, "symbols.json"),
      JSON.stringify(indexContent, null, 2),
      "utf8",
    );

    const tool = new SearchSymbolsTool();
    const result = await tool.execute(
      { query: "date" },
      { cwd: tempDir, sessionId: "test" },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.length).toBe(2);

    const names = result.data!.map((s) => s.name);
    expect(names).toContain("formatDate");
    expect(names).toContain("parseDate");

    // Test query with no match
    const noMatchResult = await tool.execute(
      { query: "unknown" },
      { cwd: tempDir, sessionId: "test" },
    );
    expect(noMatchResult.ok).toBe(true);
    expect(noMatchResult.data!.length).toBe(0);
    expect(noMatchResult.display).toContain(
      'No symbols matching "unknown" found',
    );
  });

  it("should handle missing index file gracefully", async () => {
    const tool = new SearchSymbolsTool();
    const result = await tool.execute(
      { query: "User" },
      { cwd: tempDir, sessionId: "test" },
    );
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(0);
    expect(result.display).toContain("Symbol index is not yet built");
  });

  it("validates index entries and skips paths outside the workspace", async () => {
    const orbitDir = join(tempDir, ".orbit");
    mkdirSync(orbitDir, { recursive: true });
    writeFileSync(
      join(orbitDir, "symbols.json"),
      JSON.stringify({
        files: {
          "../outside.ts": {
            mtime: 1,
            symbols: [{ name: "EvilSymbol", type: "function", line: 1 }],
          },
          "src/safe.ts": {
            mtime: 2,
            symbols: [{ name: "SafeSymbol", type: "function", line: 2 }],
          },
        },
        indexedAt: "2026-07-13T00:00:00.000Z",
      }),
      "utf8",
    );

    const result = await new SearchSymbolsTool().execute(
      { query: "Symbol" },
      { cwd: tempDir, sessionId: "test" },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([
      {
        name: "SafeSymbol",
        type: "function",
        filePath: "src/safe.ts",
        line: 2,
      },
    ]);
  });

  it("rejects malformed symbol index payloads", async () => {
    const orbitDir = join(tempDir, ".orbit");
    mkdirSync(orbitDir, { recursive: true });
    writeFileSync(
      join(orbitDir, "symbols.json"),
      JSON.stringify({
        files: {
          "src/invalid.ts": {
            mtime: 1,
            symbols: [{ name: "Invalid", type: "namespace", line: "one" }],
          },
        },
        indexedAt: "2026-07-13T00:00:00.000Z",
      }),
      "utf8",
    );

    const result = await new SearchSymbolsTool().execute(
      { query: "Invalid" },
      { cwd: tempDir, sessionId: "test" },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
    expect(result.display).toContain("format is invalid");
  });

  it("degrades gracefully when the symbol index is not valid JSON", async () => {
    const orbitDir = join(tempDir, ".orbit");
    mkdirSync(orbitDir, { recursive: true });
    writeFileSync(join(orbitDir, "symbols.json"), "{not-json", "utf8");

    const result = await new SearchSymbolsTool().execute(
      { query: "Anything" },
      { cwd: tempDir, sessionId: "test" },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
    expect(result.display).toContain("format is invalid");
  });

  it("rejects empty or unreasonably large search queries", () => {
    expect(SearchSymbolsInputSchema.safeParse({ query: "   " }).success).toBe(
      false,
    );
    expect(
      SearchSymbolsInputSchema.safeParse({ query: "x".repeat(513) }).success,
    ).toBe(false);
  });

  it("rejects symbol indexes with an excessive number of files", () => {
    const files = Object.fromEntries(
      Array.from({ length: 10_001 }, (_, index) => [
        `src/file-${index}.ts`,
        { mtime: index, symbols: [] },
      ]),
    );

    expect(
      parseSymbolIndex(
        JSON.stringify({
          files,
          indexedAt: "2026-07-28T00:00:00.000Z",
        }),
      ),
    ).toBeNull();
  });
});
