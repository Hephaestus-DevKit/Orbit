import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { GrepTool, parseRipgrepLine } from "./grep.js";

describe("parseRipgrepLine", () => {
  it("keeps Windows drive-letter paths intact", () => {
    const parsed = parseRipgrepLine(
      "C:\\WJH\\project\\src\\index.ts:42:const value = 1;",
    );

    expect(parsed).toEqual({
      file: "C:\\WJH\\project\\src\\index.ts",
      line: 42,
      content: "const value = 1;",
    });
  });

  it("parses POSIX paths and preserves colons inside content", () => {
    const parsed = parseRipgrepLine(
      "/home/user/project/app.ts:7:const url = 'http://localhost:3000';",
    );

    expect(parsed).toEqual({
      file: "/home/user/project/app.ts",
      line: 7,
      content: "const url = 'http://localhost:3000';",
    });
  });

  it("accepts rows terminated with a Windows carriage return", () => {
    const parsed = parseRipgrepLine(
      "C:\\WJH\\project\\src\\index.ts:42:const value = 1;\r",
    );

    expect(parsed).toEqual({
      file: "C:\\WJH\\project\\src\\index.ts",
      line: 42,
      content: "const value = 1;",
    });
  });

  it("rejects lines that are not path:line:content rows", () => {
    expect(parseRipgrepLine("")).toBeNull();
    expect(parseRipgrepLine("no separators here")).toBeNull();
    expect(parseRipgrepLine("path/only.ts:not-a-number:content")).toBeNull();
  });
});

describe("GrepTool", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-grep-"));
    writeFileSync(
      join(cwd, "alpha.ts"),
      "const alpha = 1;\nfunction findAlpha() {}\n",
      "utf8",
    );
    writeFileSync(
      join(cwd, "beta.ts"),
      "const beta = 2;\nconst weird = call(foo(bar);\n",
      "utf8",
    );
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("returns workspace-relative files and finite line numbers", async () => {
    const result = await new GrepTool().execute(
      { pattern: "findAlpha" },
      { cwd, sessionId: "test" },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
    const match = result.data?.[0];
    expect(match?.file).toBe("alpha.ts");
    expect(Number.isFinite(match?.line)).toBe(true);
    expect(match?.line).toBe(2);
    expect(match?.content).toContain("function findAlpha()");
  });

  it("treats the pattern as a regular expression", async () => {
    const result = await new GrepTool().execute(
      { pattern: "find[A-Z]lpha\\(", include: "*.ts" },
      { cwd, sessionId: "test" },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.file).toBe("alpha.ts");
  });

  it("still finds literal text when the pattern is not a valid regex", async () => {
    const result = await new GrepTool().execute(
      { pattern: "foo(bar" },
      { cwd, sessionId: "test" },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.file).toBe("beta.ts");
    expect(result.data?.[0]?.line).toBe(2);
  });
});
