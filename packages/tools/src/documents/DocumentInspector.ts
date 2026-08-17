import { execa } from "execa";
import { lstatSync, mkdtempSync, readdirSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { basename, extname, join } from "path";
import { z } from "zod";
import {
  HIDDEN_CHILD_PROCESS_OPTIONS,
  redactSecrets,
  readBoundedRegularFile,
} from "@orbit-build/shared";
import type { OrbitTool, ToolContext, ToolResult } from "../types.js";
import { resolveReadableFile } from "../fs/skillPaths.js";
import { hasFullHostAccess } from "../fs/toolPaths.js";

const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_CHARS = 160_000;
const DOCUMENT_TIMEOUT_MS = 120_000;

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".tsv",
  ".json",
  ".jsonl",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".html",
  ".htm",
  ".tex",
  ".py",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".java",
  ".go",
  ".rs",
  ".cs",
  ".cpp",
  ".c",
  ".h",
  ".sql",
]);
const PDF_EXTENSIONS = new Set([".pdf"]);
const PANDOC_EXTENSIONS = new Set([".docx", ".doc", ".pptx", ".odt"]);
const LIBREOFFICE_EXTENSIONS = new Set([
  ".docx",
  ".doc",
  ".pptx",
  ".xlsx",
  ".xls",
  ".ods",
]);
const OCR_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".tif",
  ".tiff",
  ".bmp",
]);

export const DocumentInspectorInputSchema = z
  .object({
    path: z.string().trim().min(1).max(4_096),
    maxChars: z.number().int().min(1_000).max(MAX_DOCUMENT_CHARS).optional(),
    /** OCR is explicit because it may send private pixels to a local binary. */
    ocr: z.boolean().optional(),
    ocrLanguage: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{1,32}$/)
      .optional(),
    ocrMaxPages: z.number().int().min(1).max(20).optional(),
  })
  .strict();

export type DocumentInspectorInput = z.input<
  typeof DocumentInspectorInputSchema
>;

export interface DocumentInspection {
  path: string;
  format: string;
  extractor:
    | "direct-text"
    | "pdftotext"
    | "pandoc"
    | "libreoffice"
    | "tesseract";
  text: string;
  truncated: boolean;
  layoutPreserved?: boolean;
  ocr?: boolean;
}

export class DocumentInspectorTool implements OrbitTool<
  DocumentInspectorInput,
  DocumentInspection
> {
  name = "inspect_document";
  description =
    "Extract bounded text from a project document. Text/CSV/code files are read directly; PDF uses pdftotext; DOCX/PPTX/Office formats use pandoc or LibreOffice when installed. No shell command is interpreted, binary bytes are never sent as text, and missing extractors return an actionable dependency error.";
  inputSchema = DocumentInspectorInputSchema;
  risk = "read" as const;

  async execute(
    input: DocumentInspectorInput,
    ctx: ToolContext,
  ): Promise<ToolResult<DocumentInspection>> {
    const maxChars = input.maxChars ?? MAX_DOCUMENT_CHARS;
    try {
      const filePath = resolveReadableFile(ctx, input.path);
      const stat = lstatSync(filePath);
      if (stat.isSymbolicLink() && !hasFullHostAccess(ctx)) {
        throw new Error(
          "Document inspection rejects symbolic links in normal mode.",
        );
      }
      if (!stat.isFile())
        throw new Error(`Document is not a regular file: ${input.path}`);
      const extension = extname(filePath).toLowerCase();
      if (TEXT_EXTENSIONS.has(extension)) {
        const raw = readBoundedRegularFile(filePath, MAX_DOCUMENT_BYTES, {
          allowSymbolicLink: hasFullHostAccess(ctx),
        });
        if (raw === undefined)
          throw new Error(`Document was not found: ${input.path}`);
        return success(
          input.path,
          extension.slice(1) || "text",
          "direct-text",
          raw,
          maxChars,
        );
      }

      if (PDF_EXTENSIONS.has(extension)) {
        const extracted = await runExtractor(
          ctx,
          process.env.ORBIT_PDFTOTEXT_PATH ?? "pdftotext",
          ["-layout", filePath, "-"],
        );
        if (!extracted.ok)
          return dependencyResult("pdftotext", extracted.error);
        if (input.ocr && extracted.stdout.trim().length === 0) {
          const ocr = await extractPdfWithOcr(filePath, input, ctx);
          if (!ocr.ok) return dependencyResult("tesseract/pdftoppm", ocr.error);
          return success(input.path, "pdf", "tesseract", ocr.stdout, maxChars, {
            ocr: true,
            layoutPreserved: false,
          });
        }
        return success(
          input.path,
          "pdf",
          "pdftotext",
          extracted.stdout,
          maxChars,
          { layoutPreserved: true, ocr: false },
        );
      }

      if (OCR_EXTENSIONS.has(extension)) {
        if (!input.ocr) {
          throw new Error(
            `Image document ${input.path} requires explicit ocr: true; this prevents accidental pixel processing.`,
          );
        }
        const stats = statSync(filePath);
        if (!stats.isFile() || stats.size > MAX_DOCUMENT_BYTES) {
          throw new Error("Image exceeds the bounded document size limit.");
        }
        const extracted = await runExtractor(
          ctx,
          process.env.ORBIT_TESSERACT_PATH ?? "tesseract",
          [filePath, "stdout", "--psm", "3", "-l", input.ocrLanguage ?? "eng"],
        );
        if (!extracted.ok)
          return dependencyResult("tesseract", extracted.error);
        return success(
          input.path,
          extension.slice(1),
          "tesseract",
          extracted.stdout,
          maxChars,
          { ocr: true, layoutPreserved: false },
        );
      }

      if (PANDOC_EXTENSIONS.has(extension)) {
        const pandoc = await runExtractor(
          ctx,
          process.env.ORBIT_PANDOC_PATH ?? "pandoc",
          [
            filePath,
            "--from",
            extension.slice(1),
            "--to",
            "plain",
            "--output",
            "-",
          ],
        );
        if (pandoc.ok) {
          return success(
            input.path,
            extension.slice(1),
            "pandoc",
            pandoc.stdout,
            maxChars,
          );
        }
      }

      if (LIBREOFFICE_EXTENSIONS.has(extension)) {
        const extracted = await extractWithLibreOffice(
          filePath,
          extension,
          ctx,
        );
        if (!extracted.ok)
          return dependencyResult("LibreOffice", extracted.error);
        return success(
          input.path,
          extension.slice(1),
          "libreoffice",
          extracted.stdout,
          maxChars,
        );
      }

      throw new Error(
        `Unsupported document format ${extension || "(no extension)"}. Supported text, PDF, DOCX/PPTX, and common Office formats are bounded explicitly.`,
      );
    } catch (error: unknown) {
      return {
        ok: false,
        error: redactSecrets(
          error instanceof Error ? error.message : String(error),
        ),
      };
    }
  }
}

function success(
  requestedPath: string,
  format: string,
  extractor: DocumentInspection["extractor"],
  text: string,
  maxChars: number,
  details: Pick<DocumentInspection, "ocr" | "layoutPreserved"> = {},
): ToolResult<DocumentInspection> {
  const normalized = text.replaceAll("\u0000", "");
  const truncated = normalized.length > maxChars;
  const bounded = truncated
    ? `${normalized.slice(0, maxChars - 40)}\n… [document text truncated]`
    : normalized;
  const data: DocumentInspection = {
    path: requestedPath,
    format,
    extractor,
    text: bounded,
    truncated,
    ...details,
  };
  return {
    ok: true,
    data,
    display: `Inspected ${basename(requestedPath)} as ${format} (${extractor})${truncated ? "; output truncated" : ""}.`,
    metadata: { format, extractor, truncated, chars: bounded.length },
  };
}

async function extractPdfWithOcr(
  filePath: string,
  input: DocumentInspectorInput,
  ctx: ToolContext,
): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  const directory = mkdtempSync(join(tmpdir(), "orbit-pdf-ocr-"));
  try {
    const prefix = join(directory, "page");
    const rendered = await runExtractor(
      ctx,
      process.env.ORBIT_PDFTOPPM_PATH ?? "pdftoppm",
      [
        "-png",
        "-r",
        "150",
        "-f",
        "1",
        "-l",
        String(input.ocrMaxPages ?? 5),
        filePath,
        prefix,
      ],
    );
    if (!rendered.ok) return rendered;
    const pages = readdirSync(directory)
      .filter((name) => /^page-\d+\.png$/i.test(name))
      .sort()
      .slice(0, input.ocrMaxPages ?? 5);
    if (pages.length === 0)
      return { ok: false, error: "pdftoppm produced no bounded page images." };
    const chunks: string[] = [];
    for (const page of pages) {
      const extracted = await runExtractor(
        ctx,
        process.env.ORBIT_TESSERACT_PATH ?? "tesseract",
        [
          join(directory, page),
          "stdout",
          "--psm",
          "3",
          "-l",
          input.ocrLanguage ?? "eng",
        ],
      );
      if (!extracted.ok) return extracted;
      chunks.push(extracted.stdout);
    }
    return { ok: true, stdout: chunks.join("\n\n") };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function dependencyResult(
  dependency: string,
  detail: string,
): ToolResult<DocumentInspection> {
  return {
    ok: false,
    error: `Document extractor dependency_missing: ${dependency} is unavailable or failed. ${detail} Install it or set the corresponding ORBIT_*_PATH environment variable.`,
    metadata: { dependencyMissing: dependency },
  };
}

async function runExtractor(
  ctx: ToolContext,
  file: string,
  args: string[],
): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  const timeout = Math.min(
    ctx.config?.tools.bash.timeoutMs ?? DOCUMENT_TIMEOUT_MS,
    DOCUMENT_TIMEOUT_MS,
  );
  try {
    const result = await execa(file, args, {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      cwd: ctx.cwd,
      env: sanitizedDocumentEnvironment(),
      extendEnv: false,
      timeout,
      signal: ctx.abortSignal,
      reject: false,
      maxBuffer: MAX_DOCUMENT_BYTES,
    });
    if (result.isCanceled || ctx.abortSignal?.aborted) {
      return { ok: false, error: "Document extraction was canceled." };
    }
    if (result.failed || result.exitCode !== 0) {
      return {
        ok: false,
        error: redactSecrets(
          (result.stderr || "extractor exited unsuccessfully").slice(0, 2_000),
        ),
      };
    }
    return { ok: true, stdout: result.stdout || "" };
  } catch (error: unknown) {
    return {
      ok: false,
      error: redactSecrets(
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
}

async function extractWithLibreOffice(
  filePath: string,
  extension: string,
  ctx: ToolContext,
): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  const directory = mkdtempSync(join(tmpdir(), "orbit-document-"));
  try {
    const target =
      extension === ".xlsx" || extension === ".xls" || extension === ".ods"
        ? "csv"
        : "txt";
    const result = await runExtractor(
      ctx,
      process.env.ORBIT_LIBREOFFICE_PATH ??
        (process.platform === "win32" ? "soffice.exe" : "soffice"),
      ["--headless", "--convert-to", target, "--outdir", directory, filePath],
    );
    if (!result.ok) return result;
    const output = readdirSync(directory).find((entry) =>
      entry.endsWith(`.${target}`),
    );
    if (!output)
      return {
        ok: false,
        error: "LibreOffice produced no bounded text output.",
      };
    const text = readBoundedRegularFile(
      join(directory, output),
      MAX_DOCUMENT_BYTES,
    );
    if (text === undefined)
      return { ok: false, error: "LibreOffice output was not a regular file." };
    return { ok: true, stdout: text };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function sanitizedDocumentEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    PATHEXT: process.env.PATHEXT,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    ORBIT_CHILD_PROCESS: "1",
  };
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}
