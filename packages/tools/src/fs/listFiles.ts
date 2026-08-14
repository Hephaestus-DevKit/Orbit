import { z } from "zod";
import { OrbitTool, ToolContext, ToolResult } from "../types.js";
import { findWorkspaceFiles, toRootRelativePath } from "./safeGlob.js";
import {
  parseSkillUri,
  resolveSkillResource,
  skillResourceUri,
} from "./skillPaths.js";
import { resolveToolPath } from "./toolPaths.js";

export const ListFilesInputSchema = z.object({
  path: z.string().max(4096).optional(),
  depth: z.number().int().min(1).max(100).optional(),
  maxResults: z.number().int().min(1).max(5000).optional(),
});

export type ListFilesInput = z.infer<typeof ListFilesInputSchema>;

export class ListFilesTool implements OrbitTool<ListFilesInput, string[]> {
  name = "list_files";
  description =
    "List files recursively in the project, any host directory when unrestricted Full Access is active, or an active skill:// resource with bounded depth/results, ignoring dependencies and build output folders.";
  inputSchema = ListFilesInputSchema;
  risk = "read" as const;

  async execute(
    input: ListFilesInput,
    ctx: ToolContext,
  ): Promise<ToolResult<string[]>> {
    try {
      const skillUri = input.path ? parseSkillUri(input.path) : undefined;
      const skillResource = skillUri
        ? resolveSkillResource(ctx, skillUri)
        : undefined;
      const targetDir = skillResource
        ? skillResource.path
        : input.path
          ? resolveToolPath(ctx, input.path)
          : ctx.cwd;

      const files = await findWorkspaceFiles(targetDir, "**/*", {
        deep: input.depth || 3,
        dot: true,
      });
      const relativeFiles = files.map((file) => {
        if (!skillResource) return toRootRelativePath(targetDir, file);
        return skillResourceUri(
          skillResource.root.name,
          toRootRelativePath(skillResource.root.path, file),
        );
      });

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
