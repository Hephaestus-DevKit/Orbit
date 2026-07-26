import { z } from "zod";
import { readFileSync } from "fs";
import { execa } from "execa";
import glob from "fast-glob";
import {
  HIDDEN_CHILD_PROCESS_OPTIONS,
  resolveSafePath,
} from "@orbit-build/shared";
import { OrbitTool, ToolContext, ToolResult } from "../types.js";

export const GrepInputSchema = z.object({
  pattern: z.string().min(1).max(4096),
  path: z.string().max(4096).optional(),
  include: z.string().max(4096).optional(),
  maxResults: z.number().int().min(1).max(1000).optional(),
});

export type GrepInput = z.infer<typeof GrepInputSchema>;

interface GrepMatch {
  file: string;
  line: number;
  content: string;
}

export class GrepTool implements OrbitTool<GrepInput, GrepMatch[]> {
  name = "grep";
  description =
    "Search for string patterns across project files. Uses ripgrep if available, falling back to a Node-based search.";
  inputSchema = GrepInputSchema;
  risk = "read" as const;

  async execute(
    input: GrepInput,
    ctx: ToolContext,
  ): Promise<ToolResult<GrepMatch[]>> {
    const max = input.maxResults ?? 100;
    const searchDir = input.path
      ? resolveSafePath(ctx.cwd, input.path)
      : ctx.cwd;

    try {
      const args = [
        "--line-number",
        "--color=never",
        "--no-heading",
        input.pattern,
      ];
      if (input.include) {
        args.push("--glob", input.include);
      }
      args.push(searchDir);

      const result = await execa("rg", args, {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        reject: false,
        signal: ctx.abortSignal,
        maxBuffer: 2 * 1024 * 1024,
      });
      if (result.exitCode !== 0 && result.exitCode !== 1) {
        throw new Error(result.stderr || `ripgrep exited ${result.exitCode}`);
      }
      const stdout = result.stdout;
      const matches: GrepMatch[] = [];
      const lines = stdout.split("\n");

      for (const line of lines) {
        if (matches.length >= max) break;
        if (!line.trim()) continue;

        const parts = line.split(":");
        if (parts.length >= 3) {
          const filePath = parts[0];
          const lineNum = parseInt(parts[1], 10);
          const content = parts.slice(2).join(":");

          const relativePath = filePath.startsWith(ctx.cwd)
            ? filePath.substring(ctx.cwd.length + 1)
            : filePath;

          matches.push({
            file: relativePath.replace(/\\/g, "/"),
            line: lineNum,
            content,
          });
        }
      }

      return {
        ok: true,
        data: matches,
        display: `Grep for "${input.pattern}" using ripgrep: found ${matches.length} matches`,
      };
    } catch {
      if (ctx.abortSignal?.aborted) {
        return { ok: false, error: "Grep was cancelled by the user." };
      }
      return this.jsFallback(input, searchDir, ctx.cwd, max, ctx.abortSignal);
    }
  }

  private async jsFallback(
    input: GrepInput,
    searchDir: string,
    cwd: string,
    max: number,
    abortSignal?: AbortSignal,
  ): Promise<ToolResult<GrepMatch[]>> {
    try {
      const globPattern = input.include || "**/*";
      const files = await glob(globPattern, {
        cwd: searchDir,
        ignore: [
          "**/node_modules/**",
          "**/.git/**",
          "**/dist/**",
          "**/build/**",
        ],
        onlyFiles: true,
        absolute: true,
        suppressErrors: true,
      });

      const matches: GrepMatch[] = [];

      for (const file of files) {
        if (abortSignal?.aborted) {
          return { ok: false, error: "Grep was cancelled by the user." };
        }
        if (matches.length >= max) break;
        const content = readFileSync(file, "utf8");

        if (!content.includes(input.pattern)) continue;

        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(input.pattern)) {
            const relPath = file.startsWith(cwd)
              ? file.substring(cwd.length + 1)
              : file;
            matches.push({
              file: relPath.replace(/\\/g, "/"),
              line: i + 1,
              content: lines[i],
            });
            if (matches.length >= max) break;
          }
        }
      }

      return {
        ok: true,
        data: matches,
        display: `Grep for "${input.pattern}" using JS fallback: found ${matches.length} matches`,
      };
    } catch (error: unknown) {
      return {
        ok: false,
        error: `Grep failed: Ripgrep was unavailable and fallback search failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
