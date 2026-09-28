import { describe, expect, it, vi } from "vitest";
import { createApprovalController } from "./WebUiClientApproval.js";
import type { WebUiApprovalSnapshot } from "./WebUiContracts.js";

function harness() {
  const element = () =>
    ({
      hidden: true,
      textContent: "",
      disabled: false,
      replaceChildren: vi.fn(),
    }) as unknown as HTMLElement;
  const elements = {
    approvalPanel: element(),
    approvalTitle: element(),
    approvalReason: element(),
    approvalPreview: element(),
    denyApprovalButton: element() as HTMLButtonElement,
    approveApprovalButton: element() as HTMLButtonElement,
  };
  const state = {
    pendingApproval: null as WebUiApprovalSnapshot | null,
    approvalSubmitting: false,
  };
  const api = vi.fn().mockResolvedValue({ ok: true });
  const revealApproval = vi.fn();
  const reconcileStatus = vi.fn().mockResolvedValue(undefined);
  const showToast = vi.fn();
  const controller = createApprovalController({
    elements,
    state,
    api,
    revealApproval,
    reconcileStatus,
    showToast,
    copy: {
      approvalRequired: "Review needed",
      approvalOwner: "Requested by",
      approvalApproved: "Approved",
      approvalDenied: "Denied",
    },
  });
  return {
    ...controller,
    elements,
    state,
    api,
    revealApproval,
    reconcileStatus,
    showToast,
  };
}

const approval: WebUiApprovalSnapshot = {
  id: "b2a4c5ce-0000-4000-8000-000000000072",
  kind: "tool",
  title: "Review command",
  reason: "Approval needed",
  preview: "",
  requestedAt: "2026-09-22T00:00:00Z",
};

describe("approval visibility", () => {
  it("reveals a new request without making a decision or repeatedly moving focus on refresh", () => {
    const ui = harness();
    ui.renderPendingApproval(approval);
    ui.renderPendingApproval(approval);
    expect(ui.revealApproval).toHaveBeenCalledOnce();
    expect(ui.elements.approvalPanel.hidden).toBe(false);
    expect(ui.api).not.toHaveBeenCalled();
    ui.renderPendingApproval({
      ...approval,
      id: "b2a4c5ce-0000-4000-8000-000000000073",
    });
    expect(ui.revealApproval).toHaveBeenCalledTimes(2);
  });
  it("does not reveal cleared state and sends only the explicit user's decision", async () => {
    const ui = harness();
    ui.renderPendingApproval(undefined);
    expect(ui.revealApproval).not.toHaveBeenCalled();
    ui.renderPendingApproval(approval);
    await ui.respondToApproval(false);
    expect(JSON.parse(ui.api.mock.calls[0][1].body)).toEqual({
      id: approval.id,
      approved: false,
    });
    expect(ui.elements.approvalPanel.hidden).toBe(true);
    expect(ui.reconcileStatus).toHaveBeenCalledOnce();
  });
  it("preserves the request and retry controls on a failed decision without revealing again", async () => {
    const ui = harness();
    ui.api.mockRejectedValueOnce(new Error("Connection lost"));
    ui.renderPendingApproval(approval);
    await ui.respondToApproval(true);
    expect(ui.state.pendingApproval).toEqual(approval);
    expect(ui.elements.approveApprovalButton.disabled).toBe(false);
    expect(ui.showToast).toHaveBeenCalledWith("Connection lost", "error");
    expect(ui.revealApproval).toHaveBeenCalledOnce();
  });
});
