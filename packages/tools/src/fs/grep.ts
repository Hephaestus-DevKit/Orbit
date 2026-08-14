import { z } from "zod";
import { execa } from "execa";
import {
  checkWorkspaceBoundary,
  HIDDEN_CHILD_PROCESS_OPTIONS,
  readBoundedRegularFile,
} from "@orbit-build/shared";
import { OrbitTool, ToolContext, ToolResult } from "../types.js";
import { findWorkspaceFiles, isWorkspaceRelativeGlob } from "./safeGlob.js";
import { MAX_GREP_FALLBACK_FILE_BYTES } from "./fileLimits.js";
import {
  parseSkillUri,
  resolveSkillResource,
  skillResourceUri,
} from "./skillPaths.js";
import { resolveToolPath } from "./toolPaths.js";
import { buildToolChildEnvironment } from "../runtime/toolEnvironment.js";

export const GrepInputSchema = z.object({
  pattern: z.string().min(1).max(4096),
  path: z.string().max(4096).optional(),
  include: z
    .string()
    .max(4096)
    .refine(isWorkspaceRelativeGlob, {
      message: "Include glob must stay relative to the search directory.",
    })
    .optional(),
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
    "Search for string patterns across project files, any host directory when unrestricted Full Access is active, or an active skill:// resource. Uses ripgrep if available, falling back to a Node-based search.";
  inputSchema = GrepInputSchema;
  risk = "read" as const;

  async execute(
    input: GrepInput,
    ctx: ToolContext,
  ): Promise<ToolResult<GrepMatch[]>> {
    const max = input.maxResults ?? 100;
    let skillName: string | undefined;
    let resultRoot = ctx.cwd;
    let searchDir: string;
    try {
      const skillUri = input.path ? parseSkillUri(input.path) : undefined;
      if (skillUri) {
        const resource = resolveSkillResource(ctx, skillUri);
        skillName = resource.root.name;
        resultRoot = resource.root.path;
        searchDir = resource.path;
      } else {
        searchDir = input.path ? resolveToolPath(ctx, input.path) : ctx.cwd;
        if (!checkWorkspaceBoundary(ctx.cwd, searchDir)) {
          resultRoot = searchDir;
        }
      }
    } catch (error: unknown) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    // execute() can be called directly without first passing through inputSchema.
    if (input.include && !isWorkspaceRelativeGlob(input.include)) {
      return {
        ok: false,
        error: "Grep include pattern must stay inside the search directory.",
      };
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
        env: buildToolChildEnvironment(ctx),
        extendEnv: false,
        reject: false,
        signal: ctx.abortSignal,
        maxBuffer: 2 * 1024 * 1024,
      });
      const isCleanNoMatch =
        result.exitCode === 1 && result.stderr.trim().length === 0;
      if (result.exitCode !== 0 && !isCleanNoMatch) {
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
          file: formatResultPath(parsed.file, resultRoot, skillName),
          line: parsed.line,
          content: parsed.content,
        });
      }

      // A zero-match exit is a valid ripgrep result. Only retry when ripgrep
      // produced rows that this version of the parser could not understand.
      if (matches.length === 0 && stdout.trim().length > 0) {
        return this.jsFallback(
          input,
          searchDir,
          resultRoot,
          max,
          ctx.abortSignal,
          skillName,
        );
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
      return this.jsFallback(
        input,
        searchDir,
        resultRoot,
        max,
        ctx.abortSignal,
        skillName,
      );
    }
  }

  private async jsFallback(
    input: GrepInput,
    searchDir: string,
    resultRoot: string,
    max: number,
    abortSignal?: AbortSignal,
    skillName?: string,
  ): Promise<ToolResult<GrepMatch[]>> {
    try {
      const globPattern = input.include || "**/*";
      const files = await findWorkspaceFiles(searchDir, globPattern);

      const matches: GrepMatch[] = [];
      const matchesLine = buildLineMatcher(input.pattern);

      for (const file of files) {
        if (abortSignal?.aborted) {
          return { ok: false, error: "Grep was cancelled by the user." };
        }
        if (matches.length >= max) break;
        let content: string;
        try {
          const raw = readBoundedRegularFile(
            file,
            MAX_GREP_FALLBACK_FILE_BYTES,
          );
          if (raw === undefined) continue;
          content = raw;
        } catch {
          // Skip binary, oversized, unsafe, or concurrently removed files.
          continue;
        }

        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].endsWith("\r")
            ? lines[i].slice(0, -1)
            : lines[i];
          if (matchesLine(line)) {
            matches.push({
              file: formatResultPath(file, resultRoot, skillName),
              line: i + 1,
              content: line,
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

function formatResultPath(
  file: string,
  root: string,
  skillName?: string,
): string {
  const relativePath = toWorkspaceRelativePath(file, root);
  return skillName ? skillResourceUri(skillName, relativePath) : relativePath;
}
