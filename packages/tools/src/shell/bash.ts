import { z } from "zod";
import { execa } from "execa";
import type { OrbitTool, ToolContext, ToolResult } from "../types.js";
import {
  HIDDEN_CHILD_PROCESS_OPTIONS,
  LogTruncator,
} from "@orbit-build/shared";
import {
  PROCESS_OUTPUT_MAX_BYTES,
  readProcessFailureMessage,
  safeProcessFailureMessage,
} from "./processLimits.js";

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
        maxBuffer: PROCESS_OUTPUT_MAX_BYTES,
      });

      const stdout = result.stdout || "";
      const stderr = result.stderr || "";
      if (result.isCanceled || ctx.abortSignal?.aborted) {
        return {
          ok: false,
          error: "Command execution was interrupted by the user.",
        };
      }
      const failureMessage = readProcessFailureMessage(result);
      const outputLimitExceeded =
        result.failed && /maxBuffer exceeded/i.test(failureMessage);
      const exitCode = result.exitCode ?? (result.failed ? 1 : 0);

      const displayStdout = LogTruncator.truncate(stdout, 150, 20000);
      const displayStderr = LogTruncator.truncate(stderr, 150, 20000);
      const truncated =
        outputLimitExceeded ||
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
        ok: !result.failed && exitCode === 0,
        data: {
          stdout: displayStdout,
          stderr: displayStderr,
          exitCode,
        },
        display,
        error: result.timedOut
          ? `Command timed out after ${timeout}ms.`
          : outputLimitExceeded
            ? `Command output exceeded the ${PROCESS_OUTPUT_MAX_BYTES / (1024 * 1024)} MiB capture limit.`
            : result.exitCode !== undefined && result.exitCode !== 0
              ? `Command exited with non-zero status ${result.exitCode}.`
              : result.failed
                ? `Command failed: ${failureMessage}`
                : undefined,
        metadata: {
          truncated,
          stdoutChars: stdout.length,
          stderrChars: stderr.length,
          outputLimitExceeded,
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
        error: `Command failed to execute or timed out: ${safeProcessFailureMessage(error instanceof Error ? error.message : String(error))}`,
      };
    }
  }
}
