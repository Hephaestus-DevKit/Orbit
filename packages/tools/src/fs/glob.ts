import { z } from "zod";
import { OrbitTool, ToolContext, ToolResult } from "../types.js";
import {
  findWorkspaceFiles,
  isWorkspaceRelativeGlob,
  toRootRelativePath,
} from "./safeGlob.js";
import {
  parseSkillUri,
  resolveSkillRoot,
  skillResourceUri,
} from "./skillPaths.js";

export const GlobInputSchema = z.object({
  pattern: z.string().min(1).max(4096).refine(isReadableGlob, {
    message:
      "Glob pattern must stay relative to the workspace or use skill://<skill-name>/<pattern>.",
  }),
  maxResults: z.number().int().min(1).max(5000).optional(),
});

export type GlobInput = z.infer<typeof GlobInputSchema>;

export class GlobTool implements OrbitTool<GlobInput, string[]> {
  name = "glob";
  description =
    "Find files matching a project-relative or active skill:// glob pattern, with a configurable bounded result count.";
  inputSchema = GlobInputSchema;
  risk = "read" as const;

  async execute(
    input: GlobInput,
    ctx: ToolContext,
  ): Promise<ToolResult<string[]>> {
    try {
      const skillUri = parseSkillUri(input.pattern);
      const skillRoot = skillUri
        ? resolveSkillRoot(ctx, skillUri.name)
        : undefined;
      const root = skillRoot?.path ?? ctx.cwd;
      const pattern = skillUri?.relativePath ?? input.pattern;
      const files = await findWorkspaceFiles(root, pattern, {
        dot: true,
      });
      const relativeFiles = files.map((file) => {
        const relativePath = toRootRelativePath(root, file);
        return skillRoot
          ? skillResourceUri(skillRoot.name, relativePath)
          : relativePath;
      });

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

function isReadableGlob(pattern: string): boolean {
  try {
    const skillUri = parseSkillUri(pattern);
    return isWorkspaceRelativeGlob(skillUri?.relativePath ?? pattern);
  } catch {
    return false;
  }
}
