import { z } from "zod";
import { execa } from "execa";
import type { OrbitTool, ToolContext, ToolResult } from "../types.js";
import {
  HIDDEN_CHILD_PROCESS_OPTIONS,
  LogTruncator,
  redactSecrets,
} from "@orbit-build/shared";
import {
  PROCESS_OUTPUT_MAX_BYTES,
  readProcessFailureMessage,
  safeProcessFailureMessage,
} from "./processLimits.js";
import { resolveCommandShellInvocation } from "./commandShell.js";
import { buildToolChildEnvironment } from "../runtime/toolEnvironment.js";
import { sandboxInvocation } from "@orbit-build/sandbox";

export const BashInputSchema = z.object({
  command: z.string().min(1).max(100_000),
  timeoutMs: z.number().int().positive().optional(),
  background: z.boolean().optional(),
});

export type BashInput = z.infer<typeof BashInputSchema>;

export interface BashOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  taskId?: string;
  status?: "running";
}

export class BashTool implements OrbitTool<BashInput, BashOutput> {
  name = "bash";
  description =
    process.platform === "win32"
      ? "Run a command in native Windows PowerShell. The working directory is already the project root: use PowerShell cmdlets and do not prepend cd or use POSIX grep/sed/head/tail/heredoc syntax. A failed result already includes captured stdout/stderr, so diagnose that output instead of rerunning the same command through redirection. Set background=true only for dev servers, watchers, or long builds."
      : "Run a command in non-interactive Bash/POSIX sh. The working directory is already the project root; do not prepend cd. A failed result already includes captured stdout/stderr, so diagnose that output instead of rerunning the same command through redirection. Set background=true only for dev servers, watchers, or long builds.";
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
    if (input.background) {
      const runtime = ctx.services?.backgroundTasks;
      if (!runtime) {
        return {
          ok: false,
          error:
            "Background task runtime is unavailable in this execution mode.",
        };
      }
      try {
        const task = await runtime.startCommand({
          command: input.command,
          cwd: ctx.cwd,
          sessionId: ctx.sessionId,
          environment: buildToolChildEnvironment(ctx),
          sandbox: {
            mode: ctx.config?.tools.bash.sandbox ?? "auto",
            network: ctx.config?.tools.bash.network ?? "inherit",
            trustRoots: ctx.config?.security.windowsSandboxTrustRoots,
          },
          ...(input.timeoutMs !== undefined ? { timeoutMs: timeout } : {}),
        });
        return {
          ok: true,
          data: {
            stdout: "",
            stderr: "",
            exitCode: null,
            taskId: task.id,
            status: "running",
          },
          display: `Background task started: ${task.id}`,
          metadata: {
            background: true,
            taskId: task.id,
          },
        };
      } catch (error: unknown) {
        return {
          ok: false,
          error: `Background command failed to start: ${safeProcessFailureMessage(error instanceof Error ? error.message : String(error))}`,
        };
      }
    }
    try {
      const invocation = resolveCommandShellInvocation(input.command);
      const sandboxed = sandboxInvocation(invocation, {
        cwd: ctx.cwd,
        mode: ctx.config?.tools.bash.sandbox ?? "auto",
        network: ctx.config?.tools.bash.network ?? "inherit",
        environment: buildToolChildEnvironment(ctx),
        trustRoots: ctx.config?.security.windowsSandboxTrustRoots,
      });
      const result = await execa(sandboxed.file, sandboxed.args, {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        cwd: ctx.cwd,
        env: buildToolChildEnvironment(ctx),
        extendEnv: false,
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

      const displayStdout = redactSecrets(
        LogTruncator.truncate(stdout, 150, 20000),
      );
      const displayStderr = redactSecrets(
        LogTruncator.truncate(stderr, 150, 20000),
      );
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
          sandboxBackend: sandboxed.backend,
          sandboxDegraded: sandboxed.degraded,
          sandboxNetworkIsolation: sandboxed.networkIsolation,
          ...(sandboxed.helperDigest
            ? { sandboxHelperDigest: sandboxed.helperDigest }
            : {}),
          ...(sandboxed.helperKeyId
            ? { sandboxHelperKeyId: sandboxed.helperKeyId }
            : {}),
          ...(sandboxed.reason ? { sandboxReason: sandboxed.reason } : {}),
          stdoutChars: stdout.length,
          stderrChars: stderr.length,
          outputLimitExceeded,
          shellDialect: invocation.dialect,
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
