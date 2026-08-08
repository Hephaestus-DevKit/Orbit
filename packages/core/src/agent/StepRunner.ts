import {
  toolRegistry,
  type ToolRegistry,
  type ToolReadRoot,
  type ToolResult,
  type ToolRuntimeServices,
} from "@orbit-build/tools";
import { OrbitToolCall } from "@orbit-build/model-providers";
import type { OrbitConfig } from "@orbit-build/config";

export class StepRunner {
  private readRoots: ToolReadRoot[] = [];

  constructor(
    private cwd: string,
    private sessionId: string,
    private config?: OrbitConfig,
    private services?: ToolRuntimeServices,
    private registry: ToolRegistry = toolRegistry,
  ) {}

  /**
   * Register extra read-only roots (active skill directories) so read tools
   * can open bundled skill resources that live outside the workspace.
   */
  public setReadRoots(roots: ToolReadRoot[]): void {
    this.readRoots = roots;
  }

  public async run(
    toolCall: OrbitToolCall,
    abortSignal?: AbortSignal,
  ): Promise<ToolResult<unknown>> {
    if (abortSignal?.aborted) {
      return {
        ok: false,
        error: "Tool execution was cancelled before it started.",
      };
    }
    const tool = this.registry.get(toolCall.name);
    if (!tool) {
      return {
        ok: false,
        error: `Tool "${toolCall.name}" not found in registry.`,
      };
    }

    let parsedArgs: unknown;
    let validated: ReturnType<typeof tool.inputSchema.safeParse>;
    try {
      parsedArgs = JSON.parse(toolCall.arguments);
      validated = tool.inputSchema.safeParse(parsedArgs);
    } catch (error: unknown) {
      return {
        ok: false,
        error: `Tool input JSON parse failed: ${getErrorMessage(error)}`,
      };
    }

    if (!validated.success) {
      return {
        ok: false,
        error: `Tool input validation failed: ${validated.error.message}`,
      };
    }

    // Use configured command timeout as the execution upper bound.
    const isExecutionCommand =
      toolCall.name === "bash" || toolCall.name === "run_tests";
    const timeoutMs = isExecutionCommand
      ? this.getExecutionTimeoutMs(validated.data)
      : 120000;

    const executionController = new AbortController();
    let cancellationCause: "timeout" | "user" | undefined;
    let cancelExecution: ((cause: "timeout" | "user") => void) | undefined;
    const cancellation = new Promise<{ kind: "timeout" } | { kind: "user" }>(
      (resolve) => {
        cancelExecution = (cause) => {
          if (cancellationCause) return;
          cancellationCause = cause;
          if (!executionController.signal.aborted) {
            executionController.abort(cause);
          }
          resolve({ kind: cause });
        };
      },
    );
    const onAbort = () => cancelExecution?.("user");
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    const timeoutId = setTimeout(() => cancelExecution?.("timeout"), timeoutMs);

    try {
      const execution = Promise.resolve()
        .then(() =>
          tool.execute(validated.data, {
            cwd: this.cwd,
            sessionId: this.sessionId,
            config: this.config,
            abortSignal: executionController.signal,
            services: this.services,
            ...(this.readRoots.length > 0 && tool.risk === "read"
              ? { readRoots: this.readRoots }
              : {}),
          }),
        )
        .then(
          (result) => ({ kind: "result" as const, result }),
          (error: unknown) => ({ kind: "error" as const, error }),
        );
      const settled = await Promise.race([execution, cancellation]);

      if (settled.kind === "timeout" || cancellationCause === "timeout") {
        return {
          ok: false,
          error: `Tool execution timed out after ${timeoutMs}ms. Cancellation was enforced at the Orbit boundary.`,
        };
      }
      if (settled.kind === "user" || cancellationCause === "user") {
        return {
          ok: false,
          error: "Tool execution was cancelled by the user.",
        };
      }
      if (settled.kind === "result") return settled.result;
      return {
        ok: false,
        error: `Tool execution threw exception: ${getErrorMessage(settled.error)}`,
      };
    } finally {
      clearTimeout(timeoutId);
      abortSignal?.removeEventListener("abort", onAbort);
    }
  }

  private getExecutionTimeoutMs(validatedArgs: unknown): number {
    const configured = this.config?.tools?.bash?.timeoutMs;
    const configuredTimeout =
      typeof configured === "number" && Number.isFinite(configured)
        ? Math.max(1000, configured)
        : 120000;
    const requested =
      typeof validatedArgs === "object" && validatedArgs !== null
        ? (validatedArgs as Record<string, unknown>).timeoutMs
        : undefined;
    if (typeof requested === "number" && Number.isFinite(requested)) {
      return Math.max(1000, Math.min(requested, configuredTimeout));
    }
    return configuredTimeout;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
