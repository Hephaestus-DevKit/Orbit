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

/**
 * One `path:line:content` row from `rg --no-heading --line-number`.
 * The optional drive-letter prefix keeps Windows absolute paths intact
 * instead of splitting on the drive colon.
 */
const RIPGREP_LINE_PATTERN = /^((?:[A-Za-z]:)?[^:\r\n]+):(\d+):(.*)$/;

export function parseRipgrepLine(
  line: string,
): { file: string; line: number; content: string } | null {
  const normalizedLine = line.endsWith("\r") ? line.slice(0, -1) : line;
  const parsed = RIPGREP_LINE_PATTERN.exec(normalizedLine);
  if (!parsed) return null;
  return {
    file: parsed[1],
    line: Number.parseInt(parsed[2], 10),
    content: parsed[3],
  };
}

/**
 * Normalize separators before trimming the workspace prefix so ripgrep's
 * backslash output and fast-glob's forward-slash output both come back
 * workspace-relative on Windows.
 */
function toWorkspaceRelativePath(file: string, cwd: string): string {
  const normalizedFile = file.replace(/\\/g, "/");
  const normalizedCwd = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalizedFile.startsWith(normalizedCwd + "/")
    ? normalizedFile.substring(normalizedCwd.length + 1)
    : normalizedFile;
}

/**
 * Match lines the way the ripgrep path does: treat the pattern as a regular
 * expression, and only fall back to a literal substring when it cannot
 * compile as one.
 */
function buildLineMatcher(pattern: string): (line: string) => boolean {
  try {
    const regex = new RegExp(pattern);
    return (line) => regex.test(line);
  } catch {
    return (line) => line.includes(pattern);
  }
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
      new RegExp(input.pattern);
    } catch {
      return this.jsFallback(input, searchDir, ctx.cwd, max, ctx.abortSignal);
    }

    try {
      const args = [
        "--line-number",
        "--with-filename",
        "--path-separator=/",
        "--color=never",
        "--no-heading",
        "--regexp",
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

        const parsed = parseRipgrepLine(line);
        if (!parsed) continue;

        matches.push({
          file: toWorkspaceRelativePath(parsed.file, ctx.cwd),
          line: parsed.line,
          content: parsed.content,
        });
      }

      if (matches.length === 0) {
        return this.jsFallback(input, searchDir, ctx.cwd, max, ctx.abortSignal);
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
      const matchesLine = buildLineMatcher(input.pattern);

      for (const file of files) {
        if (abortSignal?.aborted) {
          return { ok: false, error: "Grep was cancelled by the user." };
        }
        if (matches.length >= max) break;
        const content = readFileSync(file, "utf8");

        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (matchesLine(lines[i])) {
            matches.push({
              file: toWorkspaceRelativePath(file, cwd),
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
