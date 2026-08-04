import { randomUUID } from "crypto";
import type { OrbitContentBlock } from "@orbit-build/model-providers";
import {
  type QueuedAgentInput,
  type SessionManager,
} from "@orbit-build/session";
import { eventBus } from "../events/EventBus.js";

export interface EnqueueAgentInputOptions {
  mode: QueuedAgentInput["mode"];
  source: QueuedAgentInput["source"];
  attachments?: Extract<OrbitContentBlock, { type: "image" }>[];
}

/**
 * Owns the durable, session-authoritative input queue and its event protocol.
 *
 * AgentLoop remains responsible for deciding when a queued instruction is safe
 * to apply; this controller owns queue mutation, ordering, and observability.
 */
export class AgentInputQueueController {
  public constructor(private readonly sessions: SessionManager) {}

  public enqueue(
    text: string,
    options: EnqueueAgentInputOptions,
  ): QueuedAgentInput {
    const queued = this.sessions.enqueueAgentInput({
      id: `input_${randomUUID().replace(/-/g, "")}`,
      mode: options.mode,
      source: options.source,
      text: text.trim(),
      attachments: options.attachments ?? [],
      createdAt: new Date().toISOString(),
    });
    eventBus.emitEvent("agent_input_queued", {
      inputId: queued.id,
      sessionId: queued.sessionId,
      mode: queued.mode,
      source: queued.source,
      remaining: this.list().length,
    });
    return queued;
  }

  public list(): QueuedAgentInput[] {
    return [...(this.sessions.getAgentInputQueue()?.items ?? [])];
  }

  public remove(id: string): boolean {
    const queued = this.list().find((item) => item.id === id);
    if (!queued || !this.sessions.removeAgentInput(id)) return false;
    eventBus.emitEvent("agent_input_removed", {
      inputId: queued.id,
      sessionId: queued.sessionId,
      mode: queued.mode,
      source: queued.source,
      remaining: this.list().length,
    });
    return true;
  }

  public update(
    id: string,
    patch: { text?: string; mode?: QueuedAgentInput["mode"] },
  ): QueuedAgentInput | undefined {
    const updated = this.sessions.updateAgentInput(id, patch);
    if (!updated) return undefined;
    eventBus.emitEvent("agent_input_updated", {
      inputId: updated.id,
      sessionId: updated.sessionId,
      mode: updated.mode,
      source: updated.source,
      remaining: this.list().length,
    });
    return updated;
  }

  public move(id: string, direction: "up" | "down"): boolean {
    const moved = this.sessions.moveAgentInput(id, direction);
    if (!moved) return false;
    eventBus.emitEvent("agent_input_moved", {
      inputId: moved.input.id,
      sessionId: moved.input.sessionId,
      mode: moved.input.mode,
      source: moved.input.source,
      remaining: this.list().length,
      fromIndex: moved.fromIndex,
      toIndex: moved.toIndex,
    });
    return true;
  }

  public clear(): number {
    const sessionId = this.sessions.getActiveSession()?.id;
    const removed = this.sessions.clearAgentInputQueue();
    if (removed > 0 && sessionId) {
      eventBus.emitEvent("agent_input_queue_cleared", { sessionId, removed });
    }
    return removed;
  }

  public takeNext(): QueuedAgentInput | undefined {
    const queued = this.sessions.takeAgentInput();
    if (queued) this.emitConsumed(queued);
    return queued;
  }

  public drainSteering(): QueuedAgentInput[] {
    const inputs: QueuedAgentInput[] = [];
    for (;;) {
      const input = this.sessions.takeAgentInput("steer");
      if (!input) break;
      inputs.push(input);
      this.emitConsumed(input);
    }
    return inputs;
  }

  private emitConsumed(input: QueuedAgentInput): void {
    eventBus.emitEvent("agent_input_consumed", {
      inputId: input.id,
      sessionId: input.sessionId,
      mode: input.mode,
      source: input.source,
      remaining: this.list().length,
    });
  }
}
