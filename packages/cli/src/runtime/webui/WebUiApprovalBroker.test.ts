import { describe, expect, it, vi } from "vitest";
import { WebUiApprovalBroker } from "./WebUiApprovalBroker.js";

describe("WebUiApprovalBroker", () => {
  it("holds one sanitized approval and resolves the matching decision", async () => {
    const broker = new WebUiApprovalBroker();
    const result = broker.request({
      kind: "tool",
      title: "Run bash",
      reason: "Bearer private-token-value",
      preview: "+ safe\n- secret=private-value",
      toolCallId: "tool-1",
      agentId: "agent_reviewer-1",
      agentRole: "reviewer:security",
    });
    const pending = broker.getPending();

    expect(pending).toMatchObject({
      kind: "tool",
      title: "Run bash",
      reason: "Bearer ***REDACTED***",
      toolCallId: "tool-1",
      agentId: "agent_reviewer-1",
      agentRole: "reviewer:security",
    });
    expect(broker.respond({ id: "stale-id", approved: true }).ok).toBe(false);
    expect(broker.respond({ id: pending!.id, approved: true }).ok).toBe(true);
    await expect(result).resolves.toBe(true);
    expect(broker.getPending()).toBeUndefined();
  });

  it("denies a pending request when the Web turn is cancelled", async () => {
    const broker = new WebUiApprovalBroker();
    const result = broker.request({
      kind: "change",
      title: "Review change",
      reason: "Review the diff",
    });
    broker.cancel();
    await expect(result).resolves.toBe(false);
  });

  it("serializes concurrent approvals and preserves their agent ownership", async () => {
    const broker = new WebUiApprovalBroker();
    const first = broker.request({
      kind: "tool",
      title: "Run tests",
      reason: "Correctness review",
      agentId: "agent_correctness",
      agentRole: "reviewer:correctness",
    });
    const second = broker.request({
      kind: "tool",
      title: "Inspect dependencies",
      reason: "Security review",
      agentId: "agent_security",
      agentRole: "reviewer:security",
    });

    const firstPending = broker.getPending();
    expect(firstPending?.agentId).toBe("agent_correctness");
    expect(broker.respond({ id: firstPending!.id, approved: true }).ok).toBe(
      true,
    );
    await expect(first).resolves.toBe(true);
    const secondPending = broker.getPending();
    expect(secondPending).toMatchObject({
      agentId: "agent_security",
      agentRole: "reviewer:security",
    });
    expect(broker.respond({ id: secondPending!.id, approved: false }).ok).toBe(
      true,
    );
    await expect(second).resolves.toBe(false);
  });

  it("denies active and queued approvals together on cancellation", async () => {
    const broker = new WebUiApprovalBroker();
    const first = broker.request({
      kind: "action",
      title: "First",
      reason: "First reason",
    });
    const second = broker.request({
      kind: "action",
      title: "Second",
      reason: "Second reason",
    });

    broker.cancel();

    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
    expect(broker.getPending()).toBeUndefined();
  });

  it("starts an approval timeout only after that request becomes active", async () => {
    vi.useFakeTimers();
    try {
      const broker = new WebUiApprovalBroker();
      const first = broker.request({
        kind: "action",
        title: "First",
        reason: "First reason",
      });
      const second = broker.request({
        kind: "action",
        title: "Second",
        reason: "Second reason",
      });

      await vi.advanceTimersByTimeAsync(10 * 60 * 1_000);
      await expect(first).resolves.toBe(false);
      expect(broker.getPending()?.title).toBe("Second");

      await vi.advanceTimersByTimeAsync(9 * 60 * 1_000);
      expect(broker.getPending()?.title).toBe("Second");
      await vi.advanceTimersByTimeAsync(60 * 1_000);
      await expect(second).resolves.toBe(false);
      expect(broker.getPending()).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects excess concurrent approvals without displacing active work", async () => {
    const broker = new WebUiApprovalBroker();
    const requests = Array.from({ length: 17 }, (_, index) =>
      broker.request({
        kind: "action",
        title: `Approval ${index + 1}`,
        reason: "Bounded concurrent request",
      }),
    );

    expect(() =>
      broker.request({
        kind: "action",
        title: "Overflow",
        reason: "Must not enter the queue",
      }),
    ).toThrow("approval queue capacity");
    expect(broker.getPending()?.title).toBe("Approval 1");
    broker.cancel();
    await expect(Promise.all(requests)).resolves.toEqual(
      Array.from({ length: 17 }, () => false),
    );
  });
});
