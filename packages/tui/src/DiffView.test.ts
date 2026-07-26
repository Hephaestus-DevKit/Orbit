import { describe, it, expect } from "vitest";
import { DiffView } from "./DiffView.js";

describe("DiffView unified diff and hunk merging tests", () => {
  it("should render only additions if before is null", () => {
    const output = DiffView.render("test.txt", null, "line1\nline2");
    expect(output).toContain("+ line1");
    expect(output).toContain("+ line2");
  });

  it("should report no changes if content is identical", () => {
    const output = DiffView.render("test.txt", "line1\nline2", "line1\nline2");
    expect(output).toContain("No changes.");
  });

  it("should render distinct hunks if gap is large", () => {
    const before = [
      "line1",
      "line2",
      "line3",
      "line4",
      "line5",
      "line6",
      "line7",
      "line8",
      "line9",
      "line10",
      "line11",
      "line12",
      "line13",
      "line14",
      "line15",
    ].join("\n");

    const after = [
      "line1",
      "line2",
      "lineX",
      "line4",
      "line5",
      "line6",
      "line7",
      "line8",
      "line9",
      "line10",
      "line11",
      "line12",
      "lineY",
      "line14",
      "line15",
    ].join("\n");

    const output = DiffView.render("test.txt", before, after);
    // Gap between index 2 (lineX) and index 12 (lineY) is 12 - 2 - 1 = 9 lines.
    // 9 > 6, so they should remain as two separate hunks with their own headers.
    const headers = output.split("\n").filter((l) => l.includes("@@"));
    expect(headers.length).toBe(2);
    expect(output).toContain("lineX");
    expect(output).toContain("lineY");
  });

  it("should merge hunks if gap is 6 lines or less", () => {
    const before = [
      "line1",
      "line2",
      "line3",
      "line4",
      "line5",
      "line6",
      "line7",
      "line8",
      "line9",
      "line10",
    ].join("\n");

    const after = [
      "line1",
      "line2",
      "lineX",
      "line4",
      "line5",
      "line6",
      "lineY",
      "line8",
      "line9",
      "line10",
    ].join("\n");

    const output = DiffView.render("test.txt", before, after);
    // Gap between index 2 (lineX) and index 6 (lineY) is 6 - 2 - 1 = 3 lines.
    // 3 <= 6, so they should be merged into a single hunk.
    const headers = output.split("\n").filter((l) => l.includes("@@"));
    expect(headers.length).toBe(1);
    expect(output).toContain("lineX");
    expect(output).toContain("lineY");

    // Unchanged lines within the merge gap should be rendered as unchanged (preceded by spaces, not +/-)
    expect(output).toContain("  line4");
    expect(output).toContain("  line5");
    expect(output).toContain("  line6");
    expect(output).not.toContain("- line4");
    expect(output).not.toContain("+ line4");
  });
});

describe("DiffView.renderPlain column-zero unified diff", () => {
  it("emits +/-/@@ markers at column zero without ANSI escapes", () => {
    const output = DiffView.renderPlain(
      "src/app.ts",
      "line1\nline2\nline3",
      "line1\nlineX\nline3",
    );
    const lines = output.split("\n");
    expect(lines[0]).toBe("--- a/src/app.ts");
    expect(lines[1]).toBe("+++ b/src/app.ts");
    expect(lines).toContain("-line2");
    expect(lines).toContain("+lineX");
    expect(lines).toContain(" line1");
    expect(output).not.toContain("[");
  });

  it("renders new files as pure additions with a zero-based old range", () => {
    const output = DiffView.renderPlain("new.txt", null, "a\nb");
    const lines = output.split("\n");
    expect(lines[0]).toBe("--- /dev/null");
    expect(lines[1]).toBe("+++ b/new.txt");
    expect(lines[2]).toBe("@@ -0,0 +1,2 @@");
    expect(lines[3]).toBe("+a");
    expect(lines[4]).toBe("+b");
  });

  it("computes hunk headers that account for context lines", () => {
    const before = ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8"].join("\n");
    const after = ["l1", "l2", "l3", "lX", "l5", "l6", "l7", "l8"].join("\n");
    const output = DiffView.renderPlain("f.txt", before, after);
    // Change at old line 4 with 3 context lines each side: lines 1-7, same size after.
    expect(output).toContain("@@ -1,7 +1,7 @@");
    expect(output.split("\n").filter((l) => l.startsWith("@@")).length).toBe(1);
  });

  it("reports identical content as a context-only note", () => {
    const output = DiffView.renderPlain("same.txt", "a\nb", "a\nb");
    expect(output).toContain(" No changes.");
    expect(output).not.toContain("+a");
    expect(output).not.toContain("-a");
  });
});
