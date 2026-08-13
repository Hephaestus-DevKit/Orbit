import { z } from "zod";
import { execa } from "execa";
import { OrbitTool, ToolContext, ToolResult } from "../types.js";
import {
  buildSanitizedChildEnvironment,
  HIDDEN_CHILD_PROCESS_OPTIONS,
  redactSecrets,
} from "@orbit-build/shared";

export const GitStatusInputSchema = z.object({});

export type GitStatusInput = z.infer<typeof GitStatusInputSchema>;

export class GitStatusTool implements OrbitTool<GitStatusInput, string> {
  name = "git_status";
  description = "Show working tree status of git files (short format).";
  inputSchema = GitStatusInputSchema;
  risk = "read" as const;

  async execute(
    _input: GitStatusInput,
    ctx: ToolContext,
  ): Promise<ToolResult<string>> {
    try {
      const { stdout } = await execa("git", ["status", "--short"], {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        cwd: ctx.cwd,
        env: buildSanitizedChildEnvironment(),
        signal: ctx.abortSignal,
      });
      return {
        ok: true,
        data: redactSecrets(stdout),
        display: stdout ? redactSecrets(stdout) : "Working tree clean.",
      };
    } catch (error: unknown) {
      return {
        ok: false,
        error: `Git status failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
