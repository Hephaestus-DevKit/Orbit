import { spawn, type ChildProcess } from "child_process";
import { existsSync, lstatSync } from "fs";
import { resolve } from "path";
import { z } from "zod";
import {
  buildSanitizedChildEnvironment,
  HIDDEN_CHILD_PROCESS_OPTIONS,
  redactSecrets,
  resolveSafePath,
} from "@orbit-build/shared";
import {
  createExtensionToolInputSchema,
  type InstalledExtensionToolContribution,
} from "@orbit-build/config";
import {
  sandboxInvocation,
  type ProcessSandboxNetwork,
} from "@orbit-build/sandbox";
import { signalProcessTree } from "../runtime/BackgroundTaskRuntime.js";
import type { OrbitTool, ToolContext, ToolResult } from "../types.js";

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_STDERR_BYTES = 16 * 1024;
const TERMINATION_GRACE_MS = 750;
const HARD_TERMINATION_LIMIT_MS = 5_000;

const ExtensionToolResultSchema = z
  .object({
    protocol: z.literal("orbit-extension-tool-result-v1"),
    ok: z.boolean(),
    data: z.unknown().optional(),
    display: z
      .string()
      .max(1024 * 1024)
      .optional(),
    error: z.string().max(20_000).optional(),
  })
  .strict();

/** Run one trusted extension entrypoint through Orbit's required process sandbox. */
export class ExtensionProcessTool implements OrbitTool<
  Record<string, unknown>,
  unknown
> {
  public readonly name: string;
  public readonly description: string;
  public readonly inputSchema: z.ZodType<Record<string, unknown>>;
  public readonly inputJsonSchema: Record<string, unknown>;
  public readonly risk: InstalledExtensionToolContribution["risk"];

  public constructor(
    private readonly contribution: InstalledExtensionToolContribution,
  ) {
    this.name = contribution.runtimeName;
    this.description =
      `[Extension Tool: ${contribution.extensionId}/${contribution.contributionName}] ` +
      contribution.definition.description;
    this.risk = contribution.risk;
    this.inputSchema = createExtensionToolInputSchema(
      contribution.definition.inputSchema,
    );
    this.inputJsonSchema = contribution.definition
      .inputSchema as unknown as Record<string, unknown>;
  }

  public async execute(
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult<unknown>> {
    const entrypoint = resolveSafePath(
      this.contribution.extensionRoot,
      this.contribution.definition.entrypoint,
    );
    if (
      !existsSync(entrypoint) ||
      lstatSync(entrypoint).isSymbolicLink() ||
      !lstatSync(entrypoint).isFile()
    ) {
      return {
        ok: false,
        error: "Extension tool entrypoint is missing or unsafe.",
      };
    }

    const inputText = JSON.stringify({
      protocol: "orbit-extension-tool-input-v1",
      tool: {
        id: this.contribution.extensionId,
        name: this.contribution.contributionName,
      },
      input,
      context: {
        cwd: context.cwd,
        sessionId: context.sessionId,
      },
    });
    if (Buffer.byteLength(inputText, "utf8") > MAX_INPUT_BYTES) {
      return {
        ok: false,
        error: `Extension tool input exceeds the ${MAX_INPUT_BYTES} byte limit.`,
      };
    }

    const roots = this.resolveRoots(context.cwd);
    const environment = buildSanitizedChildEnvironment({
      mode: "minimal",
      extra: {
        ORBIT_EXTENSION_ID: this.contribution.extensionId,
        ORBIT_EXTENSION_ROOT: this.contribution.extensionRoot,
        ORBIT_WORKSPACE_ROOT: context.cwd,
      },
    });
    const invocation = sandboxInvocation(
      {
        file: process.execPath,
        args: [entrypoint, ...this.contribution.definition.args],
      },
      {
        cwd: this.contribution.extensionRoot,
        mode: "required",
        network: "deny" satisfies ProcessSandboxNetwork,
        environment,
        trustRoots: context.config?.security.windowsSandboxTrustRoots,
        boundaryRoots: [this.contribution.extensionRoot, context.cwd],
        readOnlyRoots: roots.readOnly,
        writableRoots: roots.writable,
      },
    );

    return this.runProcess(
      invocation.file,
      invocation.args,
      inputText,
      environment,
      this.contribution.definition.timeoutMs,
      this.contribution.definition.maxOutputBytes,
      context.abortSignal,
      this.contribution.extensionId,
    );
  }

  private resolveRoots(cwd: string): {
    readOnly: string[];
    writable: string[];
  } {
    const readOnly = [this.contribution.extensionRoot];
    const writable: string[] = [];
    for (const permission of this.contribution.filesystem) {
      const root =
        permission.scope === "*"
          ? resolveSafePath(cwd, ".")
          : resolveSafePath(cwd, permission.scope);
      if (permission.mode === "write") writable.push(root);
      else readOnly.push(root);
    }
    return {
      writable: uniqueRoots(writable),
      readOnly: uniqueRoots(
        readOnly.filter(
          (readRoot) =>
            !writable.some((writeRoot) => pathsOverlap(readRoot, writeRoot)),
        ),
      ),
    };
  }

  private runProcess(
    file: string,
    args: string[],
    input: string,
    environment: NodeJS.ProcessEnv,
    timeoutMs: number,
    maxOutputBytes: number,
    abortSignal: AbortSignal | undefined,
    extensionId: string,
  ): Promise<ToolResult<unknown>> {
    return new Promise((resolveResult) => {
      let child: ChildProcess;
      try {
        child = spawn(file, args, {
          ...HIDDEN_CHILD_PROCESS_OPTIONS,
          cwd: this.contribution.extensionRoot,
          env: environment,
          detached: process.platform !== "win32",
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error: unknown) {
        resolveResult({
          ok: false,
          error: `Extension tool ${extensionId} could not start: ${safeMessage(error)}`,
        });
        return;
      }

      let settled = false;
      let terminationStarted = false;
      let stopReason: string | undefined;
      let output = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let hardLimit: NodeJS.Timeout | undefined;
      let removeAbortListener: (() => void) | undefined;

      const finish = (result: ToolResult<unknown>): void => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        if (hardLimit) clearTimeout(hardLimit);
        removeAbortListener?.();
        child.stdout?.removeAllListeners();
        child.stderr?.removeAllListeners();
        child.removeAllListeners("error");
        child.removeAllListeners("close");
        resolveResult(result);
      };

      const terminate = (reason: string): void => {
        if (terminationStarted || settled) return;
        terminationStarted = true;
        stopReason = reason;
        void (async () => {
          await signalProcessTree(child, false);
          await new Promise((resolve) =>
            setTimeout(resolve, TERMINATION_GRACE_MS),
          );
          if (!settled) await signalProcessTree(child, true);
        })().catch(() => undefined);
        hardLimit = setTimeout(() => {
          finish({
            ok: false,
            error: stopReason || "Extension tool was terminated.",
          });
        }, HARD_TERMINATION_LIMIT_MS);
        hardLimit.unref?.();
      };

      child.stdout?.on("data", (chunk: Buffer | string) => {
        const next = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk, "utf8");
        if (output.length + next.length > maxOutputBytes) {
          terminate(
            `Extension tool output exceeded the ${maxOutputBytes} byte limit.`,
          );
          return;
        }
        output = Buffer.concat([output, next]);
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        const next = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk, "utf8");
        stderr = Buffer.concat([stderr, next]).subarray(-MAX_STDERR_BYTES);
      });
      child.once("error", (error) => {
        finish({
          ok: false,
          error: `Extension tool ${extensionId} failed to start or communicate: ${safeMessage(error)}`,
        });
      });
      child.once("close", (code, signal) => {
        if (settled) return;
        if (stopReason) {
          finish({ ok: false, error: stopReason });
          return;
        }
        if (code !== 0) {
          const detail = sanitize(stderr.toString("utf8"));
          finish({
            ok: false,
            error: `Extension tool exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.${detail ? ` ${detail}` : ""}`,
          });
          return;
        }
        const parsed = parseResult(output.toString("utf8"));
        finish(parsed);
      });

      const timeout = setTimeout(
        () => terminate(`Extension tool timed out after ${timeoutMs}ms.`),
        timeoutMs,
      );
      timeout.unref?.();
      if (abortSignal) {
        const onAbort = () =>
          terminate("Extension tool execution was cancelled by the user.");
        abortSignal.addEventListener("abort", onAbort, { once: true });
        removeAbortListener = () =>
          abortSignal.removeEventListener("abort", onAbort);
        if (abortSignal.aborted) onAbort();
      }
      child.stdin?.once("error", (error) => {
        if (!settled)
          terminate(`Extension tool input failed: ${safeMessage(error)}`);
      });
      child.stdin?.end(input, "utf8");
    });
  }
}

function parseResult(raw: string): ToolResult<unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw.trim());
  } catch {
    return { ok: false, error: "Extension tool returned invalid JSON." };
  }
  const parsed = ExtensionToolResultSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Extension tool returned an invalid result contract.",
    };
  }
  if (!parsed.data.ok) {
    return {
      ok: false,
      error: sanitize(
        parsed.data.error ||
          parsed.data.display ||
          "Extension tool reported failure.",
      ),
    };
  }
  const data = redactJson(parsed.data.data);
  const display = parsed.data.display
    ? sanitize(parsed.data.display)
    : data === undefined
      ? undefined
      : sanitize(JSON.stringify(data));
  return { ok: true, data, ...(display ? { display } : {}) };
}

function redactJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(redactSecrets(JSON.stringify(value)));
  } catch {
    return undefined;
  }
}

function sanitize(value: string): string {
  return redactSecrets(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20_000);
}

function safeMessage(error: unknown): string {
  return sanitize(error instanceof Error ? error.message : String(error));
}

function uniqueRoots(roots: string[]): string[] {
  return [...new Set(roots.map((root) => resolve(root)))];
}

function pathsOverlap(left: string, right: string): boolean {
  const a = resolve(left)
    .replaceAll("\\", "/")
    .replace(/\/+$/, "")
    .toLowerCase();
  const b = resolve(right)
    .replaceAll("\\", "/")
    .replace(/\/+$/, "")
    .toLowerCase();
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}
