import { z } from "zod";
import { existsSync } from "fs";
import {
  readBoundedRegularFileAsync,
  resolveSafePath,
} from "@orbit-build/shared";
import type { OrbitTool, ToolContext, ToolResult } from "../types.js";

const IndexedSymbolSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["class", "interface", "function", "constant", "type"]),
  line: z.number().int().positive(),
});

const IndexedFileSchema = z.object({
  mtime: z.number().finite(),
  symbols: z.array(IndexedSymbolSchema).max(50_000),
  imports: z.array(z.string().max(4096)).max(20_000).optional(),
});

/** Validates the persisted workspace symbol index before tools consume it. */
export const SymbolIndexSchema = z.object({
  files: z
    .record(IndexedFileSchema)
    .refine((files) => Object.keys(files).length <= 10_000, {
      message: "Symbol index contains too many files.",
    }),
  indexedAt: z.string().min(1),
});

export type SymbolIndex = z.infer<typeof SymbolIndexSchema>;
export const MAX_SYMBOL_INDEX_BYTES = 256 * 1024 * 1024;
export const MAX_SYMBOL_SOURCE_BYTES = 2 * 1024 * 1024;

/** Parses a persisted symbol index without allowing corrupt cache data to fail a tool call. */
export function parseSymbolIndex(raw: string): SymbolIndex | null {
  try {
    const parsed = SymbolIndexSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const SearchSymbolsInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .describe("The symbol name or part of the name to search for."),
});

export type SearchSymbolsInput = z.infer<typeof SearchSymbolsInputSchema>;

export interface SymbolSearchResult {
  name: string;
  type: "class" | "interface" | "function" | "constant" | "type";
  filePath: string;
  line: number;
}

export class SearchSymbolsTool implements OrbitTool<
  SearchSymbolsInput,
  SymbolSearchResult[]
> {
  name = "search_symbols";
  description =
    "Search for symbol declarations (classes, functions, interfaces, constants) in the workspace symbol index.";
  inputSchema = SearchSymbolsInputSchema;
  risk = "read" as const;

  async execute(
    input: SearchSymbolsInput,
    ctx: ToolContext,
  ): Promise<ToolResult<SymbolSearchResult[]>> {
    try {
      const indexPath = resolveSafePath(ctx.cwd, ".orbit/symbols.json");
      if (!existsSync(indexPath)) {
        return {
          ok: true,
          data: [],
          display:
            "Symbol index is not yet built. Please try again in a few moments.",
        };
      }

      const raw = await readBoundedRegularFileAsync(
        indexPath,
        MAX_SYMBOL_INDEX_BYTES,
      );
      const index = raw === undefined ? null : parseSymbolIndex(raw);
      if (!index) {
        return {
          ok: true,
          data: [],
          display: "Symbol index format is invalid.",
        };
      }

      const results: SymbolSearchResult[] = [];
      const queryLower = input.query.toLowerCase();

      for (const [filePath, fileData] of Object.entries(index.files)) {
        try {
          resolveSafePath(ctx.cwd, filePath);
        } catch {
          continue;
        }
        for (const symbol of fileData.symbols) {
          if (symbol.name.toLowerCase().includes(queryLower)) {
            results.push({
              name: symbol.name,
              type: symbol.type,
              filePath,
              line: symbol.line,
            });
          }
        }
      }

      // Bound provider-facing results so a broad query cannot flood context.
      results.sort((a, b) => a.name.localeCompare(b.name));
      const totalMatches = results.length;
      const boundedResults = results.slice(0, 200);

      const display =
        boundedResults.length > 0
          ? `Found ${totalMatches} matching symbol(s), returning ${boundedResults.length}:\n` +
            boundedResults
              .map((r) => `- [${r.type}] ${r.name} in ${r.filePath}:${r.line}`)
              .join("\n")
          : `No symbols matching "${input.query}" found.`;

      return {
        ok: true,
        data: boundedResults,
        display,
        metadata: { truncated: totalMatches > boundedResults.length },
      };
    } catch (error: unknown) {
      return {
        ok: false,
        error: `Failed to search symbols: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
