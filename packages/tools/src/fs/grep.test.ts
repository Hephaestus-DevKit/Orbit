import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import { join } from "path";
import { tmpdir } from "os";
import { GrepInputSchema, GrepTool, parseRipgrepLine } from "./grep.js";

const ripgrepAvailable =
  spawnSync("rg", ["--version"], { stdio: "ignore" }).status === 0;

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
  let tempRoot: string;
  let cwd: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "orbit-grep-"));
    cwd = join(tempRoot, "workspace");
    mkdirSync(cwd);
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
    rmSync(tempRoot, { recursive: true, force: true });
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

  it("uses the JS fallback when ripgrep is unavailable", async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = "";

    try {
      const result = await new GrepTool().execute(
        { pattern: "findAlpha" },
        { cwd, sessionId: "test" },
      );

      expect(result.ok).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0]?.file).toBe("alpha.ts");
      expect(result.display).toContain("using JS fallback");
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it.runIf(ripgrepAvailable)(
    "passes ripgrep-specific regular expressions to ripgrep",
    async () => {
      const result = await new GrepTool().execute(
        { pattern: "(?i)FINDALPHA", include: "*.ts" },
        { cwd, sessionId: "test" },
      );

      expect(result.ok).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0]?.file).toBe("alpha.ts");
      expect(result.display).toContain("using ripgrep");
    },
  );

  it("rejects include globs that can leave the search directory", async () => {
    const outsideFile = join(tempRoot, "outside.txt");
    writeFileSync(outsideFile, "outside secret\n", "utf8");

    expect(
      GrepInputSchema.safeParse({
        pattern: "outside secret",
        include: "../*.txt",
      }).success,
    ).toBe(false);

    const result = await new GrepTool().execute(
      { pattern: "outside secret", include: "../*.txt" },
      { cwd, sessionId: "test" },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("inside the search directory");
  });

  it("searches active Skill resources and returns stable Skill URIs", async () => {
    const skillRoot = join(tempRoot, "paper-skill");
    mkdirSync(join(skillRoot, "references"), { recursive: true });
    writeFileSync(
      join(skillRoot, "references", "structure.md"),
      "Write a quantified abstract.\n",
      "utf8",
    );

    const result = await new GrepTool().execute(
      {
        pattern: "quantified abstract",
        path: "skill://paper-draft/references",
        include: "*.md",
      },
      {
        cwd,
        sessionId: "test",
        readRoots: [{ name: "paper-draft", path: skillRoot }],
      },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([
      {
        file: "skill://paper-draft/references/structure.md",
        line: 1,
        content: "Write a quantified abstract.",
      },
    ]);
  });
});
