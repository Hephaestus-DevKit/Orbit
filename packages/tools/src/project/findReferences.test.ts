import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "../../../../scripts/testing/support.mjs";
import { writeFileSync, rmSync, mkdirSync } from "fs";
import { basename, join } from "path";
import { tmpdir } from "os";
import { FindSymbolReferencesInputSchema, FindSymbolReferencesTool } from "./findReferences.js";

describe("FindSymbolReferencesTool tests", () => {
  let tempDir: string;
  let outsideFiles: string[];

  beforeEach(() => {
    tempDir = join(tmpdir(), `orbit-find-references-tool-test-${Date.now()}`);
    outsideFiles = [];
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    for (const outsideFile of outsideFiles) {
      rmSync(outsideFile, { force: true });
    }
  });

  it("should find symbol references in actual workspace files", async () => {
    const orbitDir = join(tempDir, ".orbit");
    mkdirSync(orbitDir, { recursive: true });

    const indexContent = {
      files: {
        "src/utils.ts": {
          mtime: 1,
          symbols: [{ name: "formatDate", type: "function", line: 12 }],
        },
        "src/main.ts": {
          mtime: 2,
          symbols: [],
        },
      },
      indexedAt: "2026-07-13T00:00:00.000Z",
    };
    writeFileSync(
      join(orbitDir, "symbols.json"),
      JSON.stringify(indexContent, null, 2),
      "utf8",
    );

    mkdirSync(join(tempDir, "src"), { recursive: true });
    writeFileSync(
      join(tempDir, "src/utils.ts"),
      'export function formatDate() {\n  return "date";\n}',
      "utf8",
    );
    writeFileSync(
      join(tempDir, "src/main.ts"),
      'import { formatDate } from "./utils.js";\n\nconst formatted = formatDate();\n// formatDate comment should be skipped\nconsole.log(formatted);',
      "utf8",
    );

    const tool = new FindSymbolReferencesTool();
    const result = await tool.execute(
      { symbol: "formatDate" },
      { cwd: tempDir, sessionId: "test" },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    // It should find references in src/main.ts (import line and call line)
    expect(result.data!.length).toBe(2);

    const files = result.data!.map((r) => r.file);
    expect(files).toContain("src/main.ts");
  });

  it("treats regex metacharacters in symbol names literally", async () => {
    const orbitDir = join(tempDir, ".orbit");
    const srcDir = join(tempDir, "src");
    mkdirSync(orbitDir, { recursive: true });
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(orbitDir, "symbols.json"),
      JSON.stringify({
        files: {
          "src/special.ts": {
            mtime: 1,
            symbols: [{ name: "foo.bar", type: "function", line: 1 }],
          },
        },
        indexedAt: "2026-07-13T00:00:00.000Z",
      }),
      "utf8",
    );
    writeFileSync(
      join(srcDir, "special.ts"),
      ["const exact = foo.bar();", "const decoy = fooXbar();"].join("\n"),
      "utf8",
    );

    const result = await new FindSymbolReferencesTool().execute(
      { symbol: "foo.bar" },
      { cwd: tempDir, sessionId: "test" },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]).toMatchObject({
      file: "src/special.ts",
      line: 1,
      content: "const exact = foo.bar();",
    });
  });

  it("does not read indexed paths that traverse outside the workspace", async () => {
    const orbitDir = join(tempDir, ".orbit");
    const srcDir = join(tempDir, "src");
    mkdirSync(orbitDir, { recursive: true });
    mkdirSync(srcDir, { recursive: true });
    const outsideFile = join(tempDir, "..", `${basename(tempDir)}-outside.ts`);
    outsideFiles.push(outsideFile);
    writeFileSync(outsideFile, "dangerousSymbol();", "utf8");
    writeFileSync(join(srcDir, "main.ts"), "dangerousSymbol();", "utf8");
    writeFileSync(
      join(orbitDir, "symbols.json"),
      JSON.stringify({
        files: {
          [`../${basename(outsideFile)}`]: {
            mtime: 1,
            symbols: [],
          },
          "src/main.ts": {
            mtime: 2,
            symbols: [],
          },
        },
        indexedAt: "2026-07-13T00:00:00.000Z",
      }),
      "utf8",
    );

    const result = await new FindSymbolReferencesTool().execute(
      { symbol: "dangerousSymbol" },
      { cwd: tempDir, sessionId: "test" },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([
      {
        file: "src/main.ts",
        line: 1,
        content: "dangerousSymbol();",
      },
    ]);
  });

  it("uses JavaScript identifier boundaries for Unicode combining marks", async () => {
    const orbitDir = join(tempDir, ".orbit");
    const srcDir = join(tempDir, "src");
    mkdirSync(orbitDir, { recursive: true });
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(orbitDir, "symbols.json"),
      JSON.stringify({
        files: {
          "src/unicode.ts": { mtime: 1, symbols: [] },
        },
        indexedAt: "2026-07-13T00:00:00.000Z",
      }),
      "utf8",
    );
    writeFileSync(
      join(srcDir, "unicode.ts"),
      ["const e = source;", "const e\u0301 = source;"].join("\n"),
      "utf8",
    );

    const result = await new FindSymbolReferencesTool().execute(
      { symbol: "e" },
      { cwd: tempDir, sessionId: "test" },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([
      { file: "src/unicode.ts", line: 1, content: "const e = source;" },
    ]);
  });

  it("skips indexed directories and degrades gracefully for invalid JSON", async () => {
    const orbitDir = join(tempDir, ".orbit");
    const srcDir = join(tempDir, "src");
    mkdirSync(orbitDir, { recursive: true });
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(orbitDir, "symbols.json"),
      JSON.stringify({
        files: { src: { mtime: 1, symbols: [] } },
        indexedAt: "2026-07-13T00:00:00.000Z",
      }),
      "utf8",
    );

    const tool = new FindSymbolReferencesTool();
    const directoryResult = await tool.execute(
      { symbol: "anything" },
      { cwd: tempDir, sessionId: "test" },
    );
    expect(directoryResult.ok).toBe(true);
    expect(directoryResult.data).toEqual([]);

    writeFileSync(join(orbitDir, "symbols.json"), "{not-json", "utf8");
    const corruptResult = await tool.execute(
      { symbol: "anything" },
      { cwd: tempDir, sessionId: "test" },
    );
    expect(corruptResult.ok).toBe(true);
    expect(corruptResult.data).toEqual([]);
    expect(corruptResult.display).toContain("format is invalid");
  });

  it("rejects empty or unreasonably large symbol names", () => {
    expect(
      FindSymbolReferencesInputSchema.safeParse({ symbol: "   " }).success,
    ).toBe(false);
    expect(
      FindSymbolReferencesInputSchema.safeParse({ symbol: "x".repeat(513) })
        .success,
    ).toBe(false);
  });
});
