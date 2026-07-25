import {
  AgentRunStore,
  type AgentRun,
  type DurableAgentState,
} from "@orbit-build/session";
import type { AgentLoopRunOutcome } from "./AgentLoop.js";

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
        access: { mode: input.mode, scopes: input.scopes },
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
    }
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
