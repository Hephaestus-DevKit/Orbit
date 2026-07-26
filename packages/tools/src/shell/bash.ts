import { z } from "zod";
import { execa } from "execa";
import type { OrbitTool, ToolContext, ToolResult } from "../types.js";
import {
  HIDDEN_CHILD_PROCESS_OPTIONS,
  LogTruncator,
} from "@orbit-build/shared";

export const BashInputSchema = z.object({
  command: z.string().min(1).max(100_000),
  timeoutMs: z.number().int().positive().optional(),
});

export type BashInput = z.infer<typeof BashInputSchema>;

interface BashOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class BashTool implements OrbitTool<BashInput, BashOutput> {
  name = "bash";
  description =
    "Run a command in the local shell environment. Captures outputs and exit code.";
  inputSchema = BashInputSchema;
  risk = "execute" as const;

  async execute(
    input: BashInput,
    ctx: ToolContext,
  ): Promise<ToolResult<BashOutput>> {
    const configuredTimeout = ctx.config?.tools?.bash?.timeoutMs;
    const timeoutCap =
      typeof configuredTimeout === "number" &&
      Number.isFinite(configuredTimeout)
        ? Math.max(1000, configuredTimeout)
        : 120000;
    const timeout =
      typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs)
        ? Math.max(1000, Math.min(input.timeoutMs, timeoutCap))
        : timeoutCap;
    try {
      const result = await execa(input.command, {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        shell: true,
        cwd: ctx.cwd,
        timeout,
        reject: false,
        signal: ctx.abortSignal,
      });

      const stdout = result.stdout || "";
      const stderr = result.stderr || "";
      const exitCode = result.exitCode ?? 0;

      const displayStdout = LogTruncator.truncate(stdout, 150, 20000);
      const displayStderr = LogTruncator.truncate(stderr, 150, 20000);
      const truncated =
        stdout.length !== displayStdout.length ||
        stderr.length !== displayStderr.length;

      const display = [
        displayStdout ? `Stdout:\n${displayStdout}` : "",
        displayStderr ? `Stderr:\n${displayStderr}` : "",
        `Exit code: ${exitCode}`,
      ]
        .filter(Boolean)
        .join("\n\n");

      return {
        ok: exitCode === 0,
        data: {
          stdout: displayStdout,
          stderr: displayStderr,
          exitCode,
        },
        display,
        error:
          exitCode === 0
            ? undefined
            : `Command exited with non-zero status ${exitCode}.`,
        metadata: {
          truncated,
          stdoutChars: stdout.length,
          stderrChars: stderr.length,
        },
      };
    } catch (error: unknown) {
      if (
        (error instanceof Error && error.name === "AbortError") ||
        ctx.abortSignal?.aborted
      ) {
        return {
          ok: false,
          error: `Command execution was interrupted by the user.`,
        };
      }
      return {
        ok: false,
        error: `Command failed to execute or timed out: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
