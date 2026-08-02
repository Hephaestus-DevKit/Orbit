import {
  toolRegistry,
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
    const tool = toolRegistry.get(toolCall.name);
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

    const timeoutController = new AbortController();

    // Wire up parent abort signal if it exists
    const onAbort = () => {
      timeoutController.abort();
    };
    if (abortSignal) {
      abortSignal.addEventListener("abort", onAbort);
    }

    const timeoutId = setTimeout(() => {
      timeoutController.abort();
    }, timeoutMs);

    try {
      const result = await tool.execute(validated.data, {
        cwd: this.cwd,
        sessionId: this.sessionId,
        config: this.config,
        abortSignal: timeoutController.signal,
        services: this.services,
        ...(this.readRoots.length > 0 && tool.risk === "read"
          ? { readRoots: this.readRoots }
          : {}),
      });

      return result;
    } catch (error: unknown) {
      if (
        timeoutController.signal.aborted &&
        (!abortSignal || !abortSignal.aborted)
      ) {
        return {
          ok: false,
          error: `Tool execution timed out after ${timeoutMs}ms. Command tree was terminated.`,
        };
      }
      if (abortSignal?.aborted) {
        return {
          ok: false,
          error: "Tool execution was cancelled by the user.",
        };
      }
      return {
        ok: false,
        error: `Tool execution threw exception: ${getErrorMessage(error)}`,
      };
    } finally {
      clearTimeout(timeoutId);
      if (abortSignal) {
        abortSignal.removeEventListener("abort", onAbort);
      }
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
