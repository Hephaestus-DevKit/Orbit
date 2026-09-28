import { describe, expect, it } from "vitest";
import { shouldHandleOrbitEvent } from "./WebUiClientEventRouting.js";

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
