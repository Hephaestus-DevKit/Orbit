import { z } from "zod";
import { execa } from "execa";
import {
  HIDDEN_CHILD_PROCESS_OPTIONS,
  LogTruncator,
} from "@orbit-build/shared";
import { OrbitTool, ToolContext, ToolResult } from "../types.js";

export const GitDiffInputSchema = z.object({
  staged: z.boolean().optional(),
});

export type GitDiffInput = z.infer<typeof GitDiffInputSchema>;

export class GitDiffTool implements OrbitTool<GitDiffInput, string> {
  name = "git_diff";
  description = "Show working tree diff or staged diff in the git repository.";
  inputSchema = GitDiffInputSchema;
  risk = "read" as const;

  async execute(
    input: GitDiffInput,
    ctx: ToolContext,
  ): Promise<ToolResult<string>> {
    try {
      const args = ["diff"];
      if (input.staged) {
        args.push("--staged");
      }

      const { stdout } = await execa("git", args, {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        cwd: ctx.cwd,
        signal: ctx.abortSignal,
      });
      const bounded = LogTruncator.truncate(stdout, 300, 40000);
      return {
        ok: true,
        data: bounded,
        display: bounded || "No changes detected in git workspace.",
        metadata: {
          truncated: bounded.length !== stdout.length,
          outputChars: stdout.length,
        },
      };
    } catch (error: unknown) {
      return {
        ok: false,
        error: `Git diff failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
