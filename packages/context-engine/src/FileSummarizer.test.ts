import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSummarizer } from "./FileSummarizer.js";

describe("FileSummarizer", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-file-summary-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("summarizes bounded regular files", async () => {
    writeFileSync(join(cwd, "example.ts"), "one\ntwo\nthree\n");

    const result = await new FileSummarizer(cwd).summarize("example.ts", 2);

    expect(result.summary).toContain("total lines: 4");
    expect(result.excerpt).toBe("one\ntwo\n... [TRUNCATED] ...");
  });

  it("rejects oversized files without materializing them", async () => {
    const filePath = join(cwd, "oversized.txt");
    writeFileSync(filePath, "");
    truncateSync(filePath, 2 * 1024 * 1024 + 1);

    const result = await new FileSummarizer(cwd).summarize("oversized.txt");

    expect(result.excerpt).toBe("");
    expect(result.summary).toContain("limit");
  });
});
