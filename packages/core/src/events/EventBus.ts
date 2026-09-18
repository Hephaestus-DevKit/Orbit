import { EventEmitter } from "events";
import { AsyncLocalStorage } from "async_hooks";
import {
  ORBIT_EVENT_SCHEMA_VERSION,
  type OrbitEvent,
  OrbitEventEnvelopeSchema,
  OrbitEventSchema,
  OrbitEventContextSchema,
  type OrbitEventContext,
  type OrbitEventEnvelope,
} from "./EventSchema.js";

type EventPayloads = {
  [Event in OrbitEvent as Event["type"]]: Event["payload"];
};

export class EventBus extends EventEmitter {
  private sequence = 0;
  private readonly context = new AsyncLocalStorage<{
    identity: Readonly<OrbitEventContext>;
    isActive: () => boolean;
  }>();

  /** Scope every asynchronous producer without sharing mutable current-session state. */
  public runWithContext<T>(context: OrbitEventContext, run: () => T): T {
    return this.context.run(
      {
        identity: Object.freeze(OrbitEventContextSchema.parse(context)),
        isActive: () => true,
      },
      run,
    );
  }

  /** Close run-owned event delivery even when detached callbacks outlive the run. */
  public async runWithRunContext<T>(
    context: OrbitEventContext,
    run: () => Promise<T>,
  ): Promise<T> {
    let active = true;
    try {
      return await this.context.run(
        {
          identity: Object.freeze(OrbitEventContextSchema.parse(context)),
          isActive: () => active,
        },
        run,
      );
    } finally {
      active = false;
    }
  }

  /** Subscribe a presentation surface to its current session; return an idempotent cleanup. */
  public subscribeSession<T extends OrbitEvent["type"]>(
    type: T,
    getSessionId: () => string,
    listener: (payload: EventPayloads[T]) => void,
  ): () => void {
    const receive = (event: OrbitEventEnvelope) => {
      if (event.type !== type) return;
      const payload = event.payload as Record<string, unknown>;
      const sessionId = event.context?.sessionId ?? payload.sessionId;
      if (sessionId && sessionId !== getSessionId()) return;
      listener(event.payload as EventPayloads[T]);
    };
    this.on("*", receive);
    return () => {
      this.off("*", receive);
    };
  }

  public emitEvent<T extends OrbitEvent["type"]>(
    type: T,
    payload: Extract<OrbitEvent, { type: T }>["payload"],
  ): boolean {
    const scope = this.context.getStore();
    // Managed background processes have a session-owned lifetime, not a turn-owned one.
    if (
      scope &&
      !scope.isActive() &&
      type !== "background_task_started" &&
      type !== "background_task_completed"
    )
      return false;
    // Validate structure at runtime
    const validation = OrbitEventSchema.safeParse({ type, payload });
    if (!validation.success) {
      return false;
    }
    const envelope = OrbitEventEnvelopeSchema.parse({
      ...validation.data,
      schemaVersion: ORBIT_EVENT_SCHEMA_VERSION,
      eventId: `${process.pid}:${Date.now()}:${++this.sequence}`,
      timestamp: new Date().toISOString(),
      ...(scope ? { context: scope.identity } : {}),
    });
    if (envelope.type !== "error" || this.listenerCount("error") > 0) {
      this.emit(envelope.type, envelope.payload);
    }
    this.emit("*", envelope);
    return true;
  }
}

export const eventBus = new EventBus();
