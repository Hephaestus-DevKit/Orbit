import { z } from "zod";
import { execa } from "execa";
import { OrbitTool, ToolContext, ToolResult } from "../types.js";
import {
  HIDDEN_CHILD_PROCESS_OPTIONS,
  redactSecrets,
} from "@orbit-build/shared";
import { buildToolChildEnvironment } from "../runtime/toolEnvironment.js";

export const GitStatusInputSchema = z.object({});

export type GitStatusInput = z.infer<typeof GitStatusInputSchema>;

export class GitStatusTool implements OrbitTool<GitStatusInput, string> {
  name = "git_status";
  description = "Show working tree status of git files (short format).";
  inputSchema = GitStatusInputSchema;
  risk = "read" as const;
  execution = {
    version: 2,
    readOnly: true,
    idempotent: true,
    concurrency: "parallel",
    cancellation: "cooperative",
    timeoutMs: 120_000,
    outputSchema: z.string(),
  } as const;

  async execute(
    _input: GitStatusInput,
    ctx: ToolContext,
  ): Promise<ToolResult<string>> {
    try {
      const args = [
        "--no-optional-locks",
        "-c",
        "core.fsmonitor=false",
        "status",
        "--short",
      ];
      const { stdout } = await execa("git", args, {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        cwd: ctx.cwd,
        env: buildToolChildEnvironment(ctx),
        extendEnv: false,
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
