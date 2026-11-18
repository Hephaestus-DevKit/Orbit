import { describe, expect, it } from "../../../../../scripts/testing/support.mjs";
import { shouldHandleOrbitEvent, parseWebUiStreamEvent } from "./WebUiClientEventRouting.js";

describe("browser event ownership", () => {
  const active = { sessionId: "session-a", turnId: "turn-a" };
  it("rejects another session even when it claims the currently displayed turn", () => {
    expect(
      shouldHandleOrbitEvent(
        {
          type: "model_delta",
          sessionId: "session-b",
          turnId: "turn-a",
          payload: { text: "other" },
        },
        active,
      ),
    ).toBe(false);
  });
  it("rejects stale stream chunks and preserves matching streams", () => {
    expect(
      shouldHandleOrbitEvent(
        {
          type: "model_delta",
          sessionId: "session-a",
          turnId: "old",
          payload: { text: "old" },
        },
        active,
      ),
    ).toBe(false);
    expect(
      shouldHandleOrbitEvent(
        { type: "model_delta", ...active, payload: { text: "current" } },
        active,
      ),
    ).toBe(true);
  });
  it("retains legacy events while validating explicit queue and background ownership", () => {
    expect(
      shouldHandleOrbitEvent(
        { type: "info", payload: { message: "legacy" } },
        active,
      ),
    ).toBe(true);
    expect(
      shouldHandleOrbitEvent(
        { type: "agent_input_queued", payload: { sessionId: "session-b" } },
        active,
      ),
    ).toBe(false);
    expect(shouldHandleOrbitEvent(null, active)).toBe(false);
  });
});

describe("browser SSE boundary", () => {
  it.each([
    "not json",
    "null",
    "[]",
    '{"kind":{"toString":3}}',
    '{"kind":"turn_started","turnId":7}',
    '{"kind":"turn_done","turnId":"a","status":"running"}',
    '{"kind":"orbit_event","type":"model_delta","payload":{"text":7}}',
  ])("rejects malformed frames without throwing: %s", (frame) => {
    expect(parseWebUiStreamEvent(frame)).toBeNull();
  });
  it("preserves heartbeat, reconnect, completion and scoped event frames", () => {
    for (const event of [
      { kind: "heartbeat" },
      { kind: "replay_gap" },
      { kind: "turn_done", turnId: "a", status: "completed" },
      {
        kind: "orbit_event",
        type: "model_delta",
        sessionId: "session-a",
        turnId: "turn-a",
        payload: { text: "hello" },
      },
    ]) {
      expect(parseWebUiStreamEvent(JSON.stringify(event))).toEqual(event);
    }
  });
  it("rejects oversized frames before parsing", () => {
    expect(parseWebUiStreamEvent("x".repeat(8 * 1024 * 1024 + 1))).toBeNull();
  });
});
