import { z } from "zod";
import { existsSync, readFileSync } from "fs";
import { resolveSafePath } from "@orbit-build/shared";
import { OrbitTool, ToolContext, ToolResult } from "../types.js";

export const ReadFileInputSchema = z.object({
  path: z.string().min(1).max(4096),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
});

export type ReadFileInput = z.infer<typeof ReadFileInputSchema>;

export class ReadFileTool implements OrbitTool<ReadFileInput, string> {
  name = "read_file";
  description =
    "Read content from a file inside the project. Defaults to at most 400 lines and bounds oversized output for the model context.";
  inputSchema = ReadFileInputSchema;
  risk = "read" as const;

  async execute(
    input: ReadFileInput,
    ctx: ToolContext,
  ): Promise<ToolResult<string>> {
    try {
      const safePath = resolveReadablePath(ctx, input.path);
      const content = readFileSync(safePath, "utf8");

      const lines = content.split("\n");
      const start =
        input.startLine !== undefined ? Math.max(1, input.startLine) : 1;
      const end =
        input.endLine !== undefined
          ? Math.min(lines.length, input.endLine)
          : Math.min(lines.length, start + 399);

      const slicedLines = lines.slice(start - 1, end);
      const rawDisplayContent = slicedLines.join("\n");
      const displayContent =
        rawDisplayContent.length > 120_000
          ? `${rawDisplayContent.slice(0, 119_940)}\n... [truncated by read_file]`
          : rawDisplayContent;

      return {
        ok: true,
        data: displayContent,
        display: `Read lines ${start}-${end} of ${input.path}`,
      };
    } catch (error: unknown) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * Resolve within the workspace first; when that fails — or resolves to a
 * missing file — fall back to the registered read-only roots (skill
 * directories may live under the user home, and skill bodies reference
 * their bundled files relative to the skill root). Every candidate still
 * goes through resolveSafePath, so a path can never escape whichever root
 * admits it.
 */
function resolveReadablePath(ctx: ToolContext, inputPath: string): string {
  const fromRoots = (): string | undefined => {
    for (const root of ctx.readRoots ?? []) {
      try {
        const candidate = resolveSafePath(root, inputPath);
        if (existsSync(candidate)) return candidate;
      } catch {
        // Try the next registered root.
      }
    }
    return undefined;
  };

  try {
    const workspacePath = resolveSafePath(ctx.cwd, inputPath);
    if (existsSync(workspacePath)) return workspacePath;
    return fromRoots() ?? workspacePath;
  } catch (workspaceError) {
    const fallback = fromRoots();
    if (fallback) return fallback;
    throw workspaceError;
  }
}
