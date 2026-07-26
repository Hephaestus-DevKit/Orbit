import { z } from "zod";
import { execa } from "execa";
import { OrbitTool, ToolContext, ToolResult } from "../types.js";
import { HIDDEN_CHILD_PROCESS_OPTIONS } from "@orbit-build/shared";

export const GitRestoreInputSchema = z.object({
  paths: z.array(z.string().trim().min(1).max(4096)).min(1).max(200),
});

export type GitRestoreInput = z.infer<typeof GitRestoreInputSchema>;

export class GitRestoreTool implements OrbitTool<GitRestoreInput, string> {
  name = "git_restore";
  description =
    "Discard unstaged changes in specific file paths in the git repository. Reverts working modifications.";
  inputSchema = GitRestoreInputSchema;
  risk = "dangerous" as const;

  async execute(
    input: GitRestoreInput,
    ctx: ToolContext,
  ): Promise<ToolResult<string>> {
    try {
      const { stdout } = await execa("git", ["restore", ...input.paths], {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        cwd: ctx.cwd,
        signal: ctx.abortSignal,
      });
      return {
        ok: true,
        data: stdout,
        display: `Restored files: ${input.paths.join(", ")}`,
      };
    } catch (error: unknown) {
      return {
        ok: false,
        error: `Git restore failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
