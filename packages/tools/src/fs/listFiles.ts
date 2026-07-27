import { z } from "zod";
import { resolveSafePath } from "@orbit-build/shared";
import { OrbitTool, ToolContext, ToolResult } from "../types.js";
import { findWorkspaceFiles, toRootRelativePath } from "./safeGlob.js";

export const ListFilesInputSchema = z.object({
  path: z.string().max(4096).optional(),
  depth: z.number().int().min(1).max(100).optional(),
  maxResults: z.number().int().min(1).max(5000).optional(),
});

export type ListFilesInput = z.infer<typeof ListFilesInputSchema>;

export class ListFilesTool implements OrbitTool<ListFilesInput, string[]> {
  name = "list_files";
  description =
    "List files recursively in the project directory with bounded depth/results, ignoring dependencies and build output folders.";
  inputSchema = ListFilesInputSchema;
  risk = "read" as const;

  async execute(
    input: ListFilesInput,
    ctx: ToolContext,
  ): Promise<ToolResult<string[]>> {
    try {
      const targetDir = input.path
        ? resolveSafePath(ctx.cwd, input.path)
        : ctx.cwd;

      const files = await findWorkspaceFiles(targetDir, "**/*", {
        deep: input.depth || 3,
        dot: true,
      });
      const relativeFiles = files.map((file) =>
        toRootRelativePath(targetDir, file),
      );

      const maxResults = input.maxResults ?? 1000;
      const boundedFiles = relativeFiles.slice(0, maxResults);
      return {
        ok: true,
        data: boundedFiles,
        display: `Listed ${boundedFiles.length}${relativeFiles.length > boundedFiles.length ? ` of ${relativeFiles.length}` : ""} files in ${input.path || "project root"}`,
      };
    } catch (error: unknown) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
