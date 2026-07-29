import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { GlobInputSchema, GlobTool } from "./glob.js";
import { ListFilesTool } from "./listFiles.js";
import { ReadFileTool } from "./readFile.js";

describe("filesystem tool output bounds", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-tool-bounds-"));
    for (let index = 0; index < 4; index += 1) {
      writeFileSync(join(cwd, `file-${index}.txt`), `file ${index}`, "utf8");
    }
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("bounds glob and recursive listing results", async () => {
    const context = { cwd, sessionId: "test" };
    const globResult = await new GlobTool().execute(
      { pattern: "*.txt", maxResults: 2 },
      context,
    );
    const listResult = await new ListFilesTool().execute(
      { maxResults: 3 },
      context,
    );

    expect(globResult.data).toHaveLength(2);
    expect(globResult.display).toContain("2 of 4");
    expect(listResult.data).toHaveLength(3);
    expect(listResult.display).toContain("3 of 4");
  });

  it("bounds a single extremely long line read from a file", async () => {
    writeFileSync(join(cwd, "large.txt"), "x".repeat(130_000), "utf8");

    const result = await new ReadFileTool().execute(
      { path: "large.txt" },
      { cwd, sessionId: "test" },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.length).toBeLessThanOrEqual(120_000);
    expect(result.data).toContain("[truncated by read_file]");
  });

  it("rejects files too large to load safely as one source document", async () => {
    const filePath = join(cwd, "oversized.txt");
    writeFileSync(filePath, "");
    truncateSync(filePath, 16 * 1024 * 1024 + 1);

    const result = await new ReadFileTool().execute(
      { path: "oversized.txt" },
      { cwd, sessionId: "test" },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("byte limit");
  });

  it("rejects glob patterns that can leave the workspace", async () => {
    expect(GlobInputSchema.safeParse({ pattern: "../*.txt" }).success).toBe(
      false,
    );

    const result = await new GlobTool().execute(
      { pattern: "../*.txt" },
      { cwd, sessionId: "test" },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("inside the search directory");
  });
});
