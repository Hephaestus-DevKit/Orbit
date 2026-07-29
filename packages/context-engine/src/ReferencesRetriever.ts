import { existsSync } from "fs";
import { pathToFileURL } from "url";
import { z } from "zod";
import {
  readBoundedRegularFileAsync,
  resolveSafePath,
} from "@orbit-build/shared";
import { getOrbitCachePath } from "./cachePaths.js";

const ReferenceIndexSchema = z.object({
  files: z.record(z.unknown()),
});

const RequestedSymbolsSchema = z.array(z.string().trim().min(1).max(512));
const MAX_REFERENCE_FILE_BYTES = 2_000_000;
const MAX_REFERENCE_INDEX_BYTES = 256 * 1024 * 1024;

function normalizeLimit(
  value: number,
  fallback: number,
  maximum: number,
): number {
  return Number.isFinite(value)
    ? Math.max(1, Math.min(maximum, Math.trunc(value)))
    : fallback;
}

export interface ReferenceContext {
  filePath: string;
  line: number;
  excerpt: string;
}

export class ReferencesRetriever {
  constructor(private cwd: string) {}

  /**
   * Scans the codebase index to find occurrences of the specified symbols,
   * extracting call sites with surrounding code context.
   */
  public async getReferencesContext(
    symbols: string[],
    maxReferencesPerSymbol = 3,
    maxTotalReferences = 10,
  ): Promise<string> {
    const indexPath = getOrbitCachePath(this.cwd, "symbols.json");
    if (!existsSync(indexPath)) {
      return "";
    }

    let index: z.infer<typeof ReferenceIndexSchema>;
    try {
      const raw = await readBoundedRegularFileAsync(
        indexPath,
        MAX_REFERENCE_INDEX_BYTES,
      );
      if (raw === undefined) return "";
      const parsed = ReferenceIndexSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return "";
      index = parsed.data;
    } catch {
      return "";
    }

    const parsedSymbols = RequestedSymbolsSchema.safeParse(symbols);
    if (!parsedSymbols.success) return "";
    const uniqueSymbols = Array.from(new Set(parsedSymbols.data));
    const perSymbolLimit = normalizeLimit(maxReferencesPerSymbol, 3, 100);
    const totalLimit = normalizeLimit(maxTotalReferences, 10, 1000);
    const results: Array<{ symbol: string; references: ReferenceContext[] }> =
      [];
    let totalCollected = 0;

    for (const symbol of uniqueSymbols) {
      if (totalCollected >= totalLimit) break;

      let symbolRegex: RegExp;
      try {
        const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const startBoundary = /^\w/.test(symbol) ? "\\b" : "";
        const endBoundary = /\w$/.test(symbol) ? "\\b" : "";
        symbolRegex = new RegExp(
          `${startBoundary}${escapedSymbol}${endBoundary}`,
        );
      } catch {
        continue;
      }
      const symbolRefs: ReferenceContext[] = [];

      for (const relPath of Object.keys(index.files)) {
        if (
          symbolRefs.length >= perSymbolLimit ||
          totalCollected >= totalLimit
        ) {
          break;
        }

        try {
          const absPath = resolveSafePath(this.cwd, relPath);
          const content = await readBoundedRegularFileAsync(
            absPath,
            MAX_REFERENCE_FILE_BYTES,
          );
          if (content === undefined) continue;
          const lines = content.split(/\r?\n/);

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Skip comments and declarations of the symbol itself to only get references/calls
            if (
              trimmed.startsWith("//") ||
              trimmed.startsWith("*") ||
              trimmed.startsWith("/*") ||
              line.includes("export ") ||
              line.includes("class ") ||
              line.includes("function ") ||
              line.includes("interface ") ||
              line.includes("type ")
            ) {
              continue;
            }

            if (symbolRegex.test(line)) {
              // Extract context: 3 lines before, 3 lines after
              const startIdx = Math.max(0, i - 3);
              const endIdx = Math.min(lines.length - 1, i + 3);
              const excerptLines = lines
                .slice(startIdx, endIdx + 1)
                .map((l, offset) => {
                  const lineNum = startIdx + offset + 1;
                  const prefix = lineNum === i + 1 ? "> " : "  ";
                  return `${prefix}${lineNum}: ${l}`;
                });

              symbolRefs.push({
                filePath: relPath,
                line: i + 1,
                excerpt: excerptLines.join("\n"),
              });

              totalCollected++;
              if (
                symbolRefs.length >= perSymbolLimit ||
                totalCollected >= totalLimit
              ) {
                break;
              }
            }
          }
        } catch {
          // Ignore read errors
        }
      }

      if (symbolRefs.length > 0) {
        results.push({ symbol, references: symbolRefs });
      }
    }

    if (results.length === 0) {
      return "";
    }

    // Format output as clean Markdown
    let output = "\n### Symbol Call References (Cross-File Context)\n";
    output +=
      "The following are call sites and usage examples of symbols referenced in this task:\n\n";

    for (const item of results) {
      output += `#### References for symbol: \`${item.symbol.replace(/`/g, "\\`")}\`\n`;
      for (const ref of item.references) {
        const absolutePath = resolveSafePath(this.cwd, ref.filePath);
        const label = ref.filePath.replace(/([\\[\]])/g, "\\$1");
        output += `- **File**: [${label}](${pathToFileURL(absolutePath).href}) (Line ${ref.line})\n`;
        output += `\`\`\`typescript\n${ref.excerpt}\n\`\`\`\n\n`;
      }
    }

    return output;
  }
}
