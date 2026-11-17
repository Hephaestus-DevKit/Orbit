import {
  contractFailure,
  resolveToolExecutionContract,
  toolRegistry,
  validateToolResult,
  type ToolRegistry,
  type ToolReadRoot,
  type ToolResult,
  type ToolRuntimeServices,
  type OrbitTool,
} from "@orbit-build/tools";
import { OrbitToolCall } from "@orbit-build/model-providers";
import type { OrbitConfig } from "@orbit-build/config";

export class StepRunner {
  private readRoots: ToolReadRoot[] = [];
  private readonly executions = new Map<
    symbol,
    { name: string; parallel: boolean }
  >();

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

  /** Guard workspace transitions while cancelled in-process tools still own work. */
  public assertIdle(): void {
    if (this.hasPendingExecutions())
      throw new Error(
        "A previous tool is still executing or stopping. Wait for it to settle before starting another run, changing sessions, or rolling back files.",
      );
  }

  public hasPendingExecutions(): boolean {
    return this.executions.size > 0;
  }

  public async run(
    toolCall: OrbitToolCall,
    abortSignal?: AbortSignal,
    admittedTool?: OrbitTool,
  ): Promise<ToolResult<unknown>> {
    if (abortSignal?.aborted) {
      return contractFailure(
        "cancelled",
        "Tool execution was cancelled before it started.",
      );
    }
    const tool = this.registry.get(toolCall.name);
    if (admittedTool && tool !== admittedTool) {
      return contractFailure(
        "unavailable",
        `Tool "${toolCall.name}" changed after approval. Request its current definition before retrying.`,
      );
    }
    if (!tool) {
      return contractFailure(
        "unavailable",
        `Tool "${toolCall.name}" not found in registry.`,
      );
    }

    let parsedArgs: unknown;
    let validated: ReturnType<typeof tool.inputSchema.safeParse>;
    try {
      parsedArgs = JSON.parse(toolCall.arguments);
      validated = tool.inputSchema.safeParse(parsedArgs);
    } catch (error: unknown) {
      return contractFailure(
        "invalid_input",
        `Tool input JSON parse failed: ${getErrorMessage(error)}`,
      );
    }

    if (!validated.success) {
      return contractFailure(
        "invalid_input",
        `Tool input validation failed: ${validated.error.message}`,
      );
    }

    const contract = resolveToolExecutionContract(tool);
    const parallel =
      contract.readOnly &&
      contract.idempotent &&
      contract.concurrency === "parallel";
    const blocking = [...this.executions.values()].find(
      (active) => !parallel || !active.parallel,
    );
    if (blocking)
      return contractFailure(
        "unavailable",
        `Tool "${blocking.name}" is still executing or stopping. Orbit cannot start a conflicting tool until that execution settles.`,
      );
    const lease = Symbol(toolCall.id);
    this.executions.set(lease, { name: toolCall.name, parallel });
    const timeoutMs = this.getExecutionTimeoutMs(
      toolCall.name,
      validated.data,
      contract.timeoutMs,
    );

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
    if (abortSignal?.aborted) onAbort();
    const timeoutId = setTimeout(() => cancelExecution?.("timeout"), timeoutMs);
    let usageMetadata: Record<string, unknown> | undefined;
    let executionStarted = false;
    let executionSettled = false;
    const preserveUsage = (result: ToolResult): ToolResult =>
      usageMetadata
        ? { ...result, metadata: { ...result.metadata, ...usageMetadata } }
        : result;

    try {
      const execution = Promise.resolve()
        .then(() => {
          // Abort can arrive after run() returns its promise but before this microtask.
          if (executionController.signal.aborted)
            return contractFailure(
              "cancelled",
              "Tool execution was cancelled before it started.",
            );
          executionStarted = true;
          return tool.execute(validated.data, {
            cwd: this.cwd,
            sessionId: this.sessionId,
            config: this.config,
            abortSignal: executionController.signal,
            services: this.services,
            reportUsage: (metadata) => {
              usageMetadata = metadata;
            },
            ...(this.readRoots.length > 0 && tool.risk === "read"
              ? { readRoots: this.readRoots }
              : {}),
          });
        })
        .then(
          (result) => ({ kind: "result" as const, result }),
          (error: unknown) => ({ kind: "error" as const, error }),
        )
        .finally(() => {
          // A timeout ends waiting, not execution. Keep ownership until the
          // actual promise settles so late writes cannot overlap the next tool.
          executionSettled = true;
          this.executions.delete(lease);
        });
      const settled = await Promise.race([execution, cancellation]);

      if (settled.kind === "timeout" || cancellationCause === "timeout") {
        return preserveUsage(
          contractFailure(
            "timeout",
            `Tool execution timed out after ${timeoutMs}ms. Orbit requested cancellation and stopped waiting. Inspect current state before retrying a tool with side effects.`,
            !executionStarted || (executionSettled && contract.idempotent),
            { timeoutMs },
          ),
        );
      }
      if (settled.kind === "user" || cancellationCause === "user") {
        return preserveUsage(
          contractFailure(
            "cancelled",
            "Tool execution was cancelled by the user.",
          ),
        );
      }
      if (settled.kind === "result") {
        return preserveUsage(validateToolResult(tool, settled.result));
      }
      return preserveUsage(
        contractFailure(
          "execution_error",
          `Tool execution threw exception: ${getErrorMessage(settled.error)}`,
        ),
      );
    } finally {
      clearTimeout(timeoutId);
      abortSignal?.removeEventListener("abort", onAbort);
    }
  }

  private getExecutionTimeoutMs(
    toolName: string,
    validatedArgs: unknown,
    declaredTimeoutMs?: number,
  ): number {
    const configured = this.config?.tools?.bash?.timeoutMs;
    const isExecutionCommand = toolName === "bash" || toolName === "run_tests";
    const policyTimeout =
      isExecutionCommand &&
      typeof configured === "number" &&
      Number.isFinite(configured)
        ? Math.max(1000, configured)
        : 120000;
    const declaredTimeout =
      typeof declaredTimeoutMs === "number" &&
      Number.isFinite(declaredTimeoutMs)
        ? Math.max(1000, declaredTimeoutMs)
        : policyTimeout;
    const executionLimit = Math.min(policyTimeout, declaredTimeout);
    const requested =
      isExecutionCommand &&
      typeof validatedArgs === "object" &&
      validatedArgs !== null
        ? (validatedArgs as Record<string, unknown>).timeoutMs
        : undefined;
    if (typeof requested === "number" && Number.isFinite(requested)) {
      return Math.max(1000, Math.min(requested, executionLimit));
    }
    return executionLimit;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
