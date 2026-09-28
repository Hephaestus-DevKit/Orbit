import { eventBus } from "../events/EventBus.js";
import { randomUUID } from "crypto";

/** Own whole-run cancellation and reject overlapping mutations of one loop. */
export class AgentRunLifecycle {
  private controller?: AbortController;

  public abort(): void {
    this.controller?.abort();
  }

  public signalFor(step?: AbortSignal): AbortSignal | undefined {
    const run = this.controller?.signal;
    return run && step ? AbortSignal.any([run, step]) : (run ?? step);
  }

  public async run<T>(
    sessionId: string,
    execute: () => Promise<T>,
    agent?: { id?: string; role?: string },
  ): Promise<T> {
    if (this.controller)
      throw new Error("Agent loop already has an active run.");
    this.controller = new AbortController();
    try {
      return await eventBus.runWithRunContext(
        {
          sessionId,
          runId: randomUUID(),
          agentId: agent?.id,
          agentRole: agent?.role,
        },
        execute,
      );
    } finally {
      this.controller = undefined;
    }
  }
}
