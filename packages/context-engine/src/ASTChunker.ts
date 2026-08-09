import { extname } from "path";
import { SymbolEntry } from "./SymbolIndexer.js";
import { Document } from "./VectorStore.js";

export class ASTChunker {
  /**
   * Chunks a single file based on its AST symbol locations.
   */
  public static chunkFile(
    content: string,
    relativePath: string,
    symbols: SymbolEntry[],
  ): Document[] {
    const lines = content.split(/\r?\n/);
    const totalLines = lines.length;

    // Handle files with no symbols
    if (symbols.length === 0) {
      return this.chunkFlatFile(lines, relativePath);
    }

    // Sort symbols by line number ascending (1-indexed from TS parser)
    const sortedSymbols = [...symbols].sort((a, b) => a.line - b.line);
    const documents: Document[] = [];

    // 1. Process file header (lines before the first symbol)
    const firstSymbolLine = sortedSymbols[0].line; // 1-indexed
    if (firstSymbolLine > 1) {
      const headerLines = lines.slice(0, firstSymbolLine - 1);
      const headerText = headerLines.join("\n");
      if (headerText.trim()) {
        documents.push(
          this.createDocument(
            headerText,
            relativePath,
            1,
            firstSymbolLine - 1,
            "file_header",
          ),
        );
      }
    }

    // 2. Process symbol-level chunks
    for (let i = 0; i < sortedSymbols.length; i++) {
      const currentSym = sortedSymbols[i];
      const startIdx = currentSym.line - 1; // 0-indexed

      // End index is the line before the next symbol, or the end of file
      const nextSym = sortedSymbols[i + 1];
      const endIdx = nextSym ? nextSym.line - 2 : totalLines - 1; // 0-indexed

      // Ensure valid range
      const chunkStartIdx = Math.max(0, startIdx);
      const chunkEndIdx = Math.max(chunkStartIdx, endIdx);

      const chunkLines = lines.slice(chunkStartIdx, chunkEndIdx + 1);
      const chunkText = chunkLines.join("\n");

      documents.push(
        this.createDocument(
          chunkText,
          relativePath,
          chunkStartIdx + 1, // 1-indexed
          chunkEndIdx + 1, // 1-indexed
          currentSym.type,
          currentSym.name,
        ),
      );
    }

    return documents;
  }

  /**
   * Fallback chunker for files without symbols or non-code files.
   * Splits the file into contiguous chunks of 80 lines with 10 lines overlap.
   */
  private static chunkFlatFile(
    lines: string[],
    relativePath: string,
  ): Document[] {
    const documents: Document[] = [];
    const chunkSize = 80;
    const overlap = 10;
    const totalLines = lines.length;

    if (totalLines === 0) {
      return [];
    }

    let start = 0;
    while (start < totalLines) {
      const end = Math.min(start + chunkSize - 1, totalLines - 1);
      const chunkLines = lines.slice(start, end + 1);
      const chunkText = chunkLines.join("\n");

      if (chunkText.trim()) {
        documents.push(
          this.createDocument(
            chunkText,
            relativePath,
            start + 1,
            end + 1,
            "flat_chunk",
          ),
        );
      }

      start += chunkSize - overlap;
      if (end === totalLines - 1) {
        break;
      }
    }

    return documents;
  }

  /**
   * Helper to construct a Document object with formatted text.
   */
  private static createDocument(
    codeText: string,
    relativePath: string,
    startLine: number,
    endLine: number,
    symbolType: string,
    symbolName?: string,
  ): Document {
    // Generate a stable base64 ID to prevent collision
    const rawId = `${relativePath}#${symbolName || symbolType}_${startLine}_${endLine}`;
    const id = Buffer.from(rawId).toString("base64");

    // Prepend location context to the chunk text to give LLM/Embedding maximum semantic signals
    const comment = [".py", ".pyw"].includes(
      extname(relativePath).toLowerCase(),
    )
      ? "#"
      : "//";
    const contextHeader = symbolName
      ? `${comment} File: ${relativePath}\n${comment} Symbol: ${symbolType} ${symbolName} (lines ${startLine}-${endLine})\n`
      : `${comment} File: ${relativePath} (lines ${startLine}-${endLine})\n`;

    return {
      id,
      text: contextHeader + codeText,
      metadata: {
        filePath: relativePath,
        symbolName,
        symbolType,
        startLine,
        endLine,
      },
    };
  }
}
