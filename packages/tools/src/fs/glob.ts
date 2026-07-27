import { z } from "zod";
import { OrbitTool, ToolContext, ToolResult } from "../types.js";
import {
  findWorkspaceFiles,
  isWorkspaceRelativeGlob,
  toRootRelativePath,
} from "./safeGlob.js";

export const GlobInputSchema = z.object({
  pattern: z.string().min(1).max(4096).refine(isWorkspaceRelativeGlob, {
    message: "Glob pattern must stay relative to the workspace.",
  }),
  maxResults: z.number().int().min(1).max(5000).optional(),
});

export type GlobInput = z.infer<typeof GlobInputSchema>;

export class GlobTool implements OrbitTool<GlobInput, string[]> {
  name = "glob";
  description =
    "Find files matching a glob pattern inside the project workspace, with a configurable bounded result count.";
  inputSchema = GlobInputSchema;
  risk = "read" as const;

  async execute(
    input: GlobInput,
    ctx: ToolContext,
  ): Promise<ToolResult<string[]>> {
    try {
      const files = await findWorkspaceFiles(ctx.cwd, input.pattern, {
        dot: true,
      });
      const relativeFiles = files.map((file) =>
        toRootRelativePath(ctx.cwd, file),
      );

      const maxResults = input.maxResults ?? 500;
      const boundedFiles = relativeFiles.slice(0, maxResults);
      return {
        ok: true,
        data: boundedFiles,
        display: `Glob matches for "${input.pattern}": returned ${boundedFiles.length}${relativeFiles.length > boundedFiles.length ? ` of ${relativeFiles.length}` : ""} files`,
      };
    } catch (error: unknown) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
