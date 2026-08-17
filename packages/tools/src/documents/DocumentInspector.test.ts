import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentInspectorTool } from "./DocumentInspector.js";

describe("DocumentInspectorTool", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0))
      rmSync(root, { recursive: true, force: true });
  });

  it("reads bounded text documents without invoking a subprocess", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-document-tool-"));
    roots.push(cwd);
    writeFileSync(join(cwd, "说明.md"), "# 结果\n\n这是中文证据。\n");
    const result = await new DocumentInspectorTool().execute(
      { path: "说明.md" },
      { cwd, sessionId: "test", abortSignal: new AbortController().signal },
    );
    expect(result).toMatchObject({ ok: true });
    expect(result.data).toMatchObject({
      format: "md",
      extractor: "direct-text",
      truncated: false,
    });
    expect(result.data?.text).toContain("中文证据");
  });

  it("bounds extracted text and reports unsupported binary formats clearly", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-document-bound-"));
    roots.push(cwd);
    writeFileSync(join(cwd, "notes.txt"), "0123456789".repeat(200));
    const bounded = await new DocumentInspectorTool().execute(
      { path: "notes.txt", maxChars: 1_000 },
      { cwd, sessionId: "test" },
    );
    expect(bounded.data?.truncated).toBe(true);
    expect(bounded.data?.text.length).toBeLessThanOrEqual(1_000);

    writeFileSync(join(cwd, "binary.bin"), Buffer.from([0, 1, 2, 3]));
    const unsupported = await new DocumentInspectorTool().execute(
      { path: "binary.bin" },
      { cwd, sessionId: "test" },
    );
    expect(unsupported.ok).toBe(false);
    expect(unsupported.error).toContain("Unsupported document format");
  });

  it("requires explicit OCR and reports a missing OCR dependency", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-document-ocr-"));
    roots.push(cwd);
    writeFileSync(join(cwd, "scan.png"), Buffer.from("not-a-real-image"));
    const tool = new DocumentInspectorTool();
    const withoutConsent = await tool.execute(
      { path: "scan.png" },
      { cwd, sessionId: "test" },
    );
    expect(withoutConsent.ok).toBe(false);
    expect(withoutConsent.error).toContain("ocr: true");
    const missing = await tool.execute(
      { path: "scan.png", ocr: true },
      { cwd, sessionId: "test" },
    );
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain("tesseract");
  });
});
