import { describe, expect, it } from "vitest";
import { createAgentRunReceipt } from "./AgentRunEvidence.js";
import type { SessionEvent } from "@orbit-build/session";
describe("Agent run evidence", () => {
  it("deduplicates successful changed paths and leaves unknown cost explicit", () => {
    const events: SessionEvent[] = ["first", "second"].map((id) => ({
      id,
      sessionId: "sess_kind-otter-001",
      type: "file_modified",
      payload: { path: "src/main.ts" },
      createdAt: "2026-10-10T00:00:00.000Z",
    }));
    events.push({
      ...events[0]!,
      id: "irrelevant",
      type: "model_delta",
      payload: { path: "ignored.ts" },
    });
    const receipt = createAgentRunReceipt({
      events,
      verification: "not_run",
      inputTokens: 10,
      outputTokens: 2,
      cacheReadTokens: 3,
      costKnown: false,
      costUsd: 1,
    });
    expect(receipt.modifiedFiles).toEqual(["src/main.ts"]);
    expect(receipt.cost).toEqual({ known: false, usd: null });
    expect(receipt.verification).toBe("not_run");
    expect(events).toHaveLength(3);
  });
});
