import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { execa } from "execa";
import type { OrbitTool, ToolContext, ToolResult } from "../types.js";
import {
  HIDDEN_CHILD_PROCESS_OPTIONS,
  LogTruncator,
} from "@orbit-build/shared";

export const RunTestsInputSchema = z.object({
  command: z.string().trim().min(1).max(100_000).optional(),
});

export type RunTestsInput = z.infer<typeof RunTestsInputSchema>;

export class RunTestsTool implements OrbitTool<
  RunTestsInput,
  { stdout: string; stderr: string; exitCode: number }
> {
  name = "run_tests";
  description =
    "Run project tests. If no command is provided, it auto-detects and triggers the appropriate runner (e.g. npm test, cargo test, pytest, go test).";
  inputSchema = RunTestsInputSchema;
  risk = "execute" as const;

  async execute(
    input: RunTestsInput,
    ctx: ToolContext,
  ): Promise<ToolResult<{ stdout: string; stderr: string; exitCode: number }>> {
    let testCommand = input.command;

    if (!testCommand) {
      testCommand = this.inferTestCommand(ctx.cwd);
    }
    const configuredTimeout = ctx.config?.tools?.bash?.timeoutMs;
    const timeout =
      typeof configuredTimeout === "number" &&
      Number.isFinite(configuredTimeout)
        ? Math.max(1000, configuredTimeout)
        : 120000;

    try {
      const result = await execa(testCommand, {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        shell: true,
        cwd: ctx.cwd,
        reject: false,
        signal: ctx.abortSignal,
        timeout,
      });

      const stdout = result.stdout || "";
      const stderr = result.stderr || "";
      const exitCode = result.exitCode ?? 0;

      const displayStdout = LogTruncator.truncate(stdout, 150, 20000);
      const displayStderr = LogTruncator.truncate(stderr, 150, 20000);
      const truncated =
        displayStdout.length !== stdout.length ||
        displayStderr.length !== stderr.length;

      return {
        ok: exitCode === 0,
        data: { stdout: displayStdout, stderr: displayStderr, exitCode },
        display: `Ran tests using command "${testCommand}":\n\nStdout:\n${displayStdout}\n\nStderr:\n${displayStderr}\n\nExit code: ${exitCode}`,
        error:
          exitCode !== 0
            ? `Tests failed with exit code ${exitCode}`
            : undefined,
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
          error: `Test execution was interrupted by the user.`,
        };
      }
      return {
        ok: false,
        error: `Failed to run tests: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private inferTestCommand(cwd: string): string {
    if (existsSync(join(cwd, "Cargo.toml"))) {
      return "cargo test";
    }
    if (existsSync(join(cwd, "go.mod"))) {
      return "go test ./...";
    }
    if (existsSync(join(cwd, "pom.xml"))) {
      return "mvn test";
    }
    if (existsSync(join(cwd, "build.gradle"))) {
      return "./gradlew test";
    }
    if (existsSync(join(cwd, "package.json"))) {
      try {
        const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
        if (pkg.scripts?.test) {
          if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm test";
          if (existsSync(join(cwd, "yarn.lock"))) return "yarn test";
          return "npm test";
        }
      } catch {
        // Fallback
      }
      return "npm test";
    }
    if (
      existsSync(join(cwd, "pytest.ini")) ||
      existsSync(join(cwd, "pyproject.toml"))
    ) {
      return "pytest";
    }
    return "npm test";
  }
}
