import { z } from "zod";
import { existsSync } from "fs";
import { join, resolve } from "path";
import { execa } from "execa";
import type { OrbitTool, ToolContext, ToolResult } from "../types.js";
import {
  HIDDEN_CHILD_PROCESS_OPTIONS,
  LogTruncator,
  redactSecrets,
  readBoundedRegularFile,
} from "@orbit-build/shared";
import {
  PROCESS_OUTPUT_MAX_BYTES,
  processOutputLimitExceeded,
  readProcessFailureMessage,
  safeProcessFailureMessage,
} from "./processLimits.js";
import { resolveCommandShellInvocation } from "./commandShell.js";
import {
  buildToolChildEnvironment,
  buildToolProcessSandboxPolicy,
} from "../runtime/toolEnvironment.js";
import { sandboxInvocation } from "@orbit-build/sandbox";

export const RunTestsInputSchema = z.object({
  command: z.string().trim().min(1).max(100_000).optional(),
});

export type RunTestsInput = z.infer<typeof RunTestsInputSchema>;

export type VerificationCommandKind =
  | "test"
  | "build"
  | "lint"
  | "typecheck"
  | "syntax";

export type TerminalSuccessKind = "cumcm-finalizer";

const ORBIT_TERMINAL_SUCCESS_MARKER = "[ORBIT_TERMINAL_SUCCESS]";

/**
 * Classify only standalone, conventional verification commands. Arbitrary
 * successful shell commands remain useful output, but cannot satisfy Orbit's
 * completion verification gate.
 */
export function classifyVerificationCommand(
  command: string,
): VerificationCommandKind | undefined {
  if (
    /[\r\n&]/.test(command) ||
    /(?:--if-present|--passwithnotests|--allow-no-tests)(?:\s|=|$)/i.test(
      command,
    )
  ) {
    return undefined;
  }
  const normalized = command.trim().replace(/\s+/g, " ");
  if (!normalized || /(?:&&|\|\||[;|<>`]|\$\()/.test(normalized)) {
    return undefined;
  }

  const packageScript = normalized.match(
    /^(?:corepack )?(?:pnpm|npm|yarn|bun)(?: run)? (test|build|lint|typecheck|check|verify)(?::[\w.-]+)?(?:\s|$)/i,
  );
  if (packageScript) {
    const script = packageScript[1].toLowerCase();
    if (script === "build") return "build";
    if (script === "lint") return "lint";
    if (script === "typecheck") return "typecheck";
    return script === "test" ? "test" : "typecheck";
  }

  if (/^(?:python(?:\.exe)? -m )?pytest(?:\s|$)/i.test(normalized)) {
    return "test";
  }
  if (
    /^(?:cargo (?:test|check)|go test|dotnet test|mvn(?:w|\.cmd)? (?:test|verify)|\.?[\\/]?gradlew(?:\.bat)? (?:test|check)|make (?:test|check))(?:\s|$)/i.test(
      normalized,
    )
  ) {
    return /(?:check|verify)(?:\s|$)/i.test(normalized) ? "typecheck" : "test";
  }
  if (
    /^(?:(?:pnpm|npm|yarn|bun) exec |npx )?(?:tsc|eslint|biome check|ruff check|mypy|pyright|prettier --check)(?:\s|$)/i.test(
      normalized,
    )
  ) {
    return /eslint|biome|ruff|prettier/i.test(normalized)
      ? "lint"
      : "typecheck";
  }
  if (
    /^(?:(?:pnpm|npm|yarn|bun) exec |npx )?(?:vitest|jest|mocha|ava)(?:\s|$)/i.test(
      normalized,
    )
  ) {
    return "test";
  }
  if (
    /^(?:python(?:\.exe)? -m (?:compileall|py_compile)|(?:"[^"]*[\\/])?node(?:\.exe)?"? --check)(?:\s|$)/i.test(
      normalized,
    )
  ) {
    return "syntax";
  }
  if (
    /^python(?:\.exe)? (?:"[^"]*(?:[\\/](?:code|\.cumcm)[\\/]finalize\.py)"|'[^']*(?:[\\/](?:code|\.cumcm)[\\/]finalize\.py)'|(?:\S*[\\/])?(?:code|\.cumcm)[\\/]finalize\.py)(?:\s|$)/i.test(
      normalized,
    )
  ) {
    return "build";
  }
  if (/^(?:cmake --build|dotnet build)(?:\s|$)/i.test(normalized)) {
    return "build";
  }
  return undefined;
}

/**
 * Recognize a terminal completion contract only for the project-local CUMCM
 * finalizer. Arbitrary commands cannot acquire completion semantics merely by
 * printing the marker.
 */
export function detectTrustedTerminalSuccess(
  command: string,
  cwd: string,
  output: string,
  exitCode: number,
): TerminalSuccessKind | undefined {
  if (
    exitCode !== 0 ||
    classifyVerificationCommand(command) !== "build" ||
    !output.includes(ORBIT_TERMINAL_SUCCESS_MARKER)
  ) {
    return undefined;
  }
  const normalized = command.trim().replace(/\s+/g, " ");
  const match =
    /^python(?:\.exe)?\s+(?:"([^"]+)"|'([^']+)'|(\S+))(?=\s|$)/i.exec(
      normalized,
    );
  const script = match?.[1] || match?.[2] || match?.[3];
  if (!script) return undefined;
  const actual = comparablePath(resolve(cwd, script));
  const expected = [
    resolve(cwd, ".cumcm", "finalize.py"),
    // Read compatibility for projects scaffolded by Orbit <= 0.8.3.
    resolve(cwd, "code", "finalize.py"),
  ].map(comparablePath);
  return expected.includes(actual) ? "cumcm-finalizer" : undefined;
}

function comparablePath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export class RunTestsTool implements OrbitTool<
  RunTestsInput,
  { stdout: string; stderr: string; exitCode: number }
> {
  name = "run_tests";
  description =
    "Run one standalone project verification command in the native OS shell. Recognized test, build, lint, typecheck, or syntax commands (including python -m py_compile) count toward the completion gate; arbitrary or piped shell commands do not. If omitted, Orbit auto-detects the project test runner.";
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
    const verificationKind = classifyVerificationCommand(testCommand);
    const configuredTimeout = ctx.config?.tools?.bash?.timeoutMs;
    const timeout =
      typeof configuredTimeout === "number" &&
      Number.isFinite(configuredTimeout)
        ? Math.max(1000, configuredTimeout)
        : 120000;

    try {
      const invocation = resolveCommandShellInvocation(testCommand);
      const sandboxed = sandboxInvocation(invocation, {
        cwd: ctx.cwd,
        ...buildToolProcessSandboxPolicy(ctx),
        environment: buildToolChildEnvironment(ctx),
      });
      const result = await execa(sandboxed.file, sandboxed.args, {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        cwd: ctx.cwd,
        env: buildToolChildEnvironment(ctx),
        extendEnv: false,
        reject: false,
        signal: ctx.abortSignal,
        timeout,
        maxBuffer: PROCESS_OUTPUT_MAX_BYTES,
      });

      const stdout = result.stdout || "";
      const stderr = result.stderr || "";
      if (result.isCanceled || ctx.abortSignal?.aborted) {
        return {
          ok: false,
          error: "Test execution was interrupted by the user.",
        };
      }
      const failureMessage = readProcessFailureMessage(result, {
        sandboxBackend: sandboxed.backend,
      });
      const outputLimitExceeded =
        result.failed && processOutputLimitExceeded(result);
      const exitCode = result.exitCode ?? (result.failed ? 1 : 0);
      const terminalSuccess = detectTrustedTerminalSuccess(
        testCommand,
        ctx.cwd,
        `${stdout}\n${stderr}`,
        exitCode,
      );

      const displayStdout = redactSecrets(
        LogTruncator.truncate(stdout, 150, 20000),
      );
      const displayStderr = redactSecrets(
        LogTruncator.truncate(stderr, 150, 20000),
      );
      const truncated =
        outputLimitExceeded ||
        displayStdout.length !== stdout.length ||
        displayStderr.length !== stderr.length;

      return {
        ok: !result.failed && exitCode === 0,
        data: { stdout: displayStdout, stderr: displayStderr, exitCode },
        display: `Ran tests using command "${safeProcessFailureMessage(testCommand)}":\n\nStdout:\n${displayStdout}\n\nStderr:\n${displayStderr}\n\nExit code: ${exitCode}`,
        error: result.timedOut
          ? `Test execution timed out after ${timeout}ms.`
          : outputLimitExceeded
            ? `Test output exceeded the ${PROCESS_OUTPUT_MAX_BYTES / (1024 * 1024)} MiB capture limit.`
            : result.exitCode !== undefined && result.exitCode !== 0
              ? `Tests failed with exit code ${result.exitCode}`
              : result.failed
                ? `Test execution failed: ${failureMessage}`
                : undefined,
        metadata: {
          truncated,
          stdoutChars: stdout.length,
          stderrChars: stderr.length,
          outputLimitExceeded,
          verificationEvidence: verificationKind !== undefined,
          ...(verificationKind ? { verificationKind } : {}),
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
          ...(terminalSuccess ? { terminalSuccess } : {}),
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
        error: `Failed to run tests: ${safeProcessFailureMessage(error instanceof Error ? error.message : String(error))}`,
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
        const raw = readBoundedRegularFile(
          join(cwd, "package.json"),
          1024 * 1024,
        );
        if (raw === undefined) return "npm test";
        const pkg = JSON.parse(raw);
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
