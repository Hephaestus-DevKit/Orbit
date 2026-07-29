import { z } from "zod";
import { existsSync } from "fs";
import {
  readBoundedRegularFileAsync,
  resolveSafePath,
} from "@orbit-build/shared";
import type { OrbitTool, ToolContext, ToolResult } from "../types.js";
import {
  MAX_SYMBOL_INDEX_BYTES,
  MAX_SYMBOL_SOURCE_BYTES,
  parseSymbolIndex,
} from "./searchSymbols.js";

export const FindSymbolReferencesInputSchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .describe("The symbol name to search references for."),
});

export type FindSymbolReferencesInput = z.infer<
  typeof FindSymbolReferencesInputSchema
>;

export interface SymbolReferenceEntry {
  file: string;
  line: number;
  content: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class FindSymbolReferencesTool implements OrbitTool<
  FindSymbolReferencesInput,
  SymbolReferenceEntry[]
> {
  name = "find_symbol_references";
  description =
    "Find all references, call sites, and usages of a specific symbol in the workspace files.";
  inputSchema = FindSymbolReferencesInputSchema;
  risk = "read" as const;

  async execute(
    input: FindSymbolReferencesInput,
    ctx: ToolContext,
  ): Promise<ToolResult<SymbolReferenceEntry[]>> {
    try {
      const indexPath = resolveSafePath(ctx.cwd, ".orbit/symbols.json");
      if (!existsSync(indexPath)) {
        return {
          ok: true,
          data: [],
          display:
            "Symbol index is not yet built. Please run a task first to generate the symbol map.",
        };
      }

      const rawIndex = await readBoundedRegularFileAsync(
        indexPath,
        MAX_SYMBOL_INDEX_BYTES,
      );
      const index = rawIndex === undefined ? null : parseSymbolIndex(rawIndex);
      if (!index) {
        return {
          ok: true,
          data: [],
          display: "Symbol index format is invalid.",
        };
      }

      const results: SymbolReferenceEntry[] = [];
      let truncated = false;
      const escapedSymbol = escapeRegExp(input.symbol);
      const symbolRegex = new RegExp(
        `(?<![\\p{ID_Continue}$\\u200C\\u200D])${escapedSymbol}(?![\\p{ID_Continue}$\\u200C\\u200D])`,
        "u",
      );

      for (const file of Object.keys(index.files)) {
        let absPath: string;
        try {
          absPath = resolveSafePath(ctx.cwd, file);
        } catch {
          continue;
        }
        if (existsSync(absPath)) {
          let lines: string[];
          try {
            const content = await readBoundedRegularFileAsync(
              absPath,
              MAX_SYMBOL_SOURCE_BYTES,
            );
            if (content === undefined) continue;
            lines = content.split("\n");
          } catch {
            continue;
          }
          for (let idx = 0; idx < lines.length; idx++) {
            const line = lines[idx];
            const trimmed = line.trim();

            // Skip comments to avoid false positives
            if (
              trimmed.startsWith("//") ||
              trimmed.startsWith("*") ||
              trimmed.startsWith("/*")
            ) {
              continue;
            }

            if (
              symbolRegex.test(line) &&
              !line.includes("export ") &&
              !line.includes("symbols.some")
            ) {
              results.push({
                file,
                line: idx + 1,
                content: trimmed.slice(0, 500),
              });
              if (results.length >= 300) {
                truncated = true;
                break;
              }
            }
          }
        }
        if (truncated) break;
      }

      const display =
        results.length > 0
          ? `Found ${results.length} references for symbol "${input.symbol}":\n` +
            results
              .map(
                (r) =>
                  `- ${r.file}:${r.line} -> ${r.content.substring(0, 100)}`,
              )
              .join("\n")
          : `No references found for symbol "${input.symbol}".`;

      return {
        ok: true,
        data: results,
        display,
        metadata: { truncated },
      };
    } catch (error: unknown) {
      return {
        ok: false,
        error: `Failed to find references: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
