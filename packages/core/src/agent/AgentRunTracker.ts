import {
  AgentRunStore,
  type AgentRun,
  type DurableAgentState,
} from "@orbit-build/session";
import type { AgentLoopRunOutcome } from "./AgentLoop.js";
import { normalizeAgentOwnershipScope } from "./AgentOwnership.js";

export interface TrackedAgentInput {
  role: string;
  task: string;
  model: string;
  budgetFraction: number;
  mode: "read" | "write";
  scopes: string[];
}

/**
 * Keeps durable multi-agent observability separate from orchestration logic.
 * Persistence failures degrade to warnings and never interrupt agent work.
 */
export class AgentRunTracker {
  private store: AgentRunStore | undefined;
  private run: AgentRun | undefined;
  private stopLeaseHeartbeat: (() => void) | undefined;

  public constructor(
    private readonly cwd: string,
    private readonly task: string,
    private readonly budgetUsd: number,
    private readonly warn: (message: string) => void,
  ) {}

  public initialize(): void {
    try {
      const store = new AgentRunStore(this.cwd);
      store.initialize();
      this.store = store;
      this.run = store.createRun({
        task: this.task,
        budgetUsd: this.budgetUsd,
      });
      this.stopLeaseHeartbeat = store.startLeaseHeartbeat(this.run.id, {
        onLeaseLost: (error) =>
          this.warn(
            `Agent run lease was lost; durable state is no longer being renewed: ${errorMessage(error)}`,
          ),
      });
    } catch (error: unknown) {
      this.warn(`Agent run state will be memory-only: ${errorMessage(error)}`);
    }
  }

  public add(input: TrackedAgentInput): DurableAgentState | undefined {
    if (!this.store || !this.run) return undefined;
    try {
      return this.store.addAgent(this.run.id, {
        role: input.role,
        task: input.task,
        model: input.model,
        budgetUsd: this.budgetUsd * input.budgetFraction,
        access: {
          mode: input.mode,
          scopes: input.scopes.map(normalizeAgentOwnershipScope),
        },
      });
    } catch (error: unknown) {
      this.warn(
        `Failed to persist ${input.role} state: ${errorMessage(error)}`,
      );
      return undefined;
    }
  }

  public markRunning(agent: DurableAgentState | undefined): void {
    this.update(agent, {
      status: "running",
      startedAt: new Date().toISOString(),
    });
  }

  /** Link durable agent state to its independently persisted child Session. */
  public attachSession(
    agent: DurableAgentState | undefined,
    sessionId: string,
  ): void {
    this.update(agent, { sessionId });
  }

  public markFinished(
    agent: DurableAgentState | undefined,
    costUsd: number,
    outcome: AgentLoopRunOutcome,
  ): void {
    this.update(agent, {
      status:
        outcome.status === "completed"
          ? "completed"
          : outcome.status === "aborted"
            ? "aborted"
            : "failed",
      costUsd,
      endedAt: new Date().toISOString(),
      error:
        outcome.status === "failed"
          ? outcome.error.message
          : outcome.status === "aborted"
            ? outcome.message
            : undefined,
    });
  }

  public markFailed(
    agent: DurableAgentState | undefined,
    costUsd: number,
    error: unknown,
  ): void {
    this.update(agent, {
      status: "failed",
      costUsd,
      endedAt: new Date().toISOString(),
      error: errorMessage(error),
    });
  }

  public recordSteering(agentId: string): void {
    if (!this.store || !this.run) return;
    try {
      this.store.recordAgentSteering(this.run.id, agentId);
    } catch {
      // Steering delivery is authoritative; telemetry remains best-effort.
    }
  }

  public finish(outcome: AgentLoopRunOutcome): void {
    if (!this.store || !this.run) return;
    const status =
      outcome.status === "completed"
        ? "completed"
        : outcome.status === "aborted"
          ? "aborted"
          : "failed";
    try {
      this.run = this.store.finishRun(this.run.id, status);
    } catch {
      // Durable state is observability only; execution remains functional.
    } finally {
      this.dispose();
    }
  }

  public dispose(): void {
    this.stopLeaseHeartbeat?.();
    this.stopLeaseHeartbeat = undefined;
  }

  private update(
    agent: DurableAgentState | undefined,
    patch: Parameters<AgentRunStore["updateAgent"]>[2],
  ): void {
    if (!agent || !this.store || !this.run) return;
    try {
      this.store.updateAgent(this.run.id, agent.id, patch);
    } catch {
      // Durable state is observability only; execution remains functional.
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
