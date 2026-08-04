import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { EventBus } from "./EventBus.js";
import { OrbitEventEnvelopeSchema } from "./EventSchema.js";

describe("EventBus", () => {
  it("keeps the checked-in v1 transport fixture compatible", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("./fixtures/event-envelope-v1.json", import.meta.url),
        "utf8",
      ),
    ) as unknown;

    expect(OrbitEventEnvelopeSchema.parse(fixture)).toMatchObject({
      schemaVersion: 1,
      eventId: "fixture:1",
      type: "info",
    });
  });

  it("does not publish payloads that fail runtime validation", () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on("*", listener);

    const emitted = bus.emitEvent("info", { message: 42 } as never);

    expect(emitted).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it("publishes the validated event envelope", () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on("*", listener);

    expect(bus.emitEvent("info", { message: "ready" })).toBe(true);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaVersion: 1,
        eventId: expect.any(String),
        timestamp: expect.any(String),
        type: "info",
        payload: { message: "ready" },
      }),
    );
  });

  it("assigns ordered unique identifiers to transport envelopes", () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on("*", listener);

    bus.emitEvent("info", { message: "first" });
    bus.emitEvent("info", { message: "second" });

    const [first, second] = listener.mock.calls.map(([event]) => event);
    expect(first.eventId).not.toBe(second.eventId);
    expect(Date.parse(first.timestamp)).not.toBeNaN();
    expect(Date.parse(second.timestamp)).not.toBeNaN();
  });

  it("publishes error envelopes without triggering EventEmitter's unhandled error", () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on("*", listener);

    expect(bus.emitEvent("error", { message: "failed" })).toBe(true);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaVersion: 1,
        type: "error",
        payload: { message: "failed" },
      }),
    );
  });

  it("publishes outer UI turns independently of internal agent events", () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on("ui_turn_started", listener);

    expect(
      bus.emitEvent("ui_turn_started", {
        turnId: "terminal-1",
        source: "terminal",
        prompt: "inspect the project",
      }),
    ).toBe(true);
    expect(listener).toHaveBeenCalledWith({
      turnId: "terminal-1",
      source: "terminal",
      prompt: "inspect the project",
    });
  });

  it("publishes prompt queue changes without exposing prompt content", () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on("agent_input_queued", listener);

    expect(
      bus.emitEvent("agent_input_queued", {
        inputId: "input_follow_up_1",
        sessionId: "sess_kind-otter-001",
        mode: "follow_up",
        source: "web",
        remaining: 2,
      }),
    ).toBe(true);
    expect(listener).toHaveBeenCalledWith({
      inputId: "input_follow_up_1",
      sessionId: "sess_kind-otter-001",
      mode: "follow_up",
      source: "web",
      remaining: 2,
    });

    const moved = vi.fn();
    bus.on("agent_input_moved", moved);
    expect(
      bus.emitEvent("agent_input_moved", {
        inputId: "input_follow_up_1",
        sessionId: "sess_kind-otter-001",
        mode: "follow_up",
        source: "web",
        remaining: 2,
        fromIndex: 1,
        toIndex: 0,
      }),
    ).toBe(true);
    expect(moved).toHaveBeenCalledWith(
      expect.objectContaining({ fromIndex: 1, toIndex: 0 }),
    );
  });

  it("publishes bounded background-task lifecycle metadata", () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on("background_task_completed", listener);

    expect(
      bus.emitEvent("background_task_completed", {
        taskId: "bg_0123456789abcdef",
        sessionId: "session-a",
        command: "pnpm test",
        cwd: process.cwd(),
        status: "completed",
        startedAt: "2026-08-03T00:00:00.000Z",
        endedAt: "2026-08-03T00:00:01.000Z",
        durationMs: 1_000,
        exitCode: 0,
        outputTruncated: false,
      }),
    ).toBe(true);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "bg_0123456789abcdef",
        status: "completed",
        exitCode: 0,
      }),
    );
  });
});
