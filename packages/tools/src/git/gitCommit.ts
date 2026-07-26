import { z } from "zod";
import { execa } from "execa";
import { OrbitTool, ToolContext, ToolResult } from "../types.js";
import { HIDDEN_CHILD_PROCESS_OPTIONS } from "@orbit-build/shared";

export const GitCommitInputSchema = z.object({
  message: z.string().trim().min(1).max(1000).optional(),
});

export type GitCommitInput = z.infer<typeof GitCommitInputSchema>;

export class GitCommitTool implements OrbitTool<GitCommitInput, string> {
  name = "git_commit";
  description = "Commit current staged changes in the git repository.";
  inputSchema = GitCommitInputSchema;
  risk = "execute" as const;

  async execute(
    input: GitCommitInput,
    ctx: ToolContext,
  ): Promise<ToolResult<string>> {
    try {
      const commitMessage = input.message || "chore: update workspace";
      const { stdout } = await execa("git", ["commit", "-m", commitMessage], {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        cwd: ctx.cwd,
        signal: ctx.abortSignal,
      });
      return {
        ok: true,
        data: stdout,
        display: `Staged changes committed:\n${stdout}`,
      };
    } catch (error: unknown) {
      return {
        ok: false,
        error: `Git commit failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
