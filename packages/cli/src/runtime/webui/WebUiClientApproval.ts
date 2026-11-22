import type { WebUiApprovalSnapshot } from "./WebUiContracts.js";

interface ApprovalCopy {
  approvalRequired: string;
  approvalOwner: string;
  approvalApproved: string;
  approvalDenied: string;
  keepChange: string;
  revertChange: string;
  reviewSent: string;
  allowOnce: string;
  denyOnce: string;
}

interface ApprovalElements {
  approvalPanel: HTMLElement;
  approvalTitle: HTMLElement;
  approvalReason: HTMLElement;
  approvalPreview: HTMLElement;
  denyApprovalButton: HTMLButtonElement;
  approveApprovalButton: HTMLButtonElement;
}

interface ApprovalState {
  pendingApproval: WebUiApprovalSnapshot | null;
  approvalSubmitting: string | null;
  sessionChanging?: boolean;
  ready: boolean;
}

interface ApprovalRuntime {
  copy: ApprovalCopy;
  elements: ApprovalElements;
  state: ApprovalState;
  api: (path: string, init?: RequestInit) => Promise<unknown>;
  showToast: (message: string, tone?: string) => void;
  reconcileStatus: () => Promise<void>;
  revealApproval: () => void;
  placePreview: (approval: WebUiApprovalSnapshot | null) => void;
}

/** Typed browser factory for approval rendering and decisions. */
export function createApprovalController(runtime: ApprovalRuntime) {
  const {
    copy,
    elements,
    state,
    api,
    showToast,
    reconcileStatus,
    revealApproval,
    placePreview,
  } = runtime;

  function renderPendingApproval(
    approval: WebUiApprovalSnapshot | null | undefined,
  ): void {
    const newRequest = Boolean(
      approval?.id && approval.id !== state.pendingApproval?.id,
    );
    const changedPreview = newRequest || state.pendingApproval?.preview !== approval?.preview;
    state.pendingApproval = approval?.id ? approval : null;
    placePreview(state.pendingApproval);
    const visible = Boolean(state.pendingApproval);
    elements.approvalPanel.hidden = !visible;
    if (!state.pendingApproval) {
      elements.approvalTitle.textContent = "";
      elements.approvalReason.textContent = "";
      elements.approvalPreview.textContent = "";
      elements.approvalPreview.hidden = true;
      state.approvalSubmitting = null;
      return;
    }
    if (newRequest) state.approvalSubmitting = null;
    const change = state.pendingApproval.kind === "change";
    elements.approveApprovalButton.textContent = change ? copy.keepChange : copy.allowOnce;
    elements.denyApprovalButton.textContent = change ? copy.revertChange : copy.denyOnce;
    elements.approvalTitle.textContent = state.pendingApproval.title || copy.approvalRequired;
    const approvalOwner = state.pendingApproval.agentRole || state.pendingApproval.agentId || "";
    elements.approvalReason.textContent = [
      approvalOwner ? `${copy.approvalOwner} ${approvalOwner}` : "",
      state.pendingApproval.reason || "",
    ]
      .filter(Boolean)
      .join(" · ");
    const preview = String(state.pendingApproval.preview || "");
    if (changedPreview) elements.approvalPreview.replaceChildren();
    if (changedPreview && preview) {
      for (const line of preview.split("\n")) {
        const row = document.createElement("span");
        row.className = "approval-preview-line";
        if (line.startsWith("+") && !line.startsWith("+++")) {
          row.classList.add("is-added");
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          row.classList.add("is-deleted");
        } else if (line.startsWith("@@")) {
          row.classList.add("is-hunk");
        }
        row.textContent = line || " ";
        elements.approvalPreview.append(row);
      }
    }
    elements.approvalPreview.hidden = !preview;
    elements.denyApprovalButton.disabled = !state.ready
      || Boolean(state.sessionChanging || state.approvalSubmitting);
    elements.approveApprovalButton.disabled = !state.ready
      || Boolean(state.sessionChanging || state.approvalSubmitting);
    if (newRequest) revealApproval();
  }

  async function respondToApproval(approved: boolean): Promise<void> {
    const approval = state.pendingApproval;
    if (!approval || !state.ready || state.sessionChanging || state.approvalSubmitting) return;
    state.approvalSubmitting = approval.id;
    renderPendingApproval(approval);
    try {
      await api("/api/approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: approval.id, approved: Boolean(approved) }),
      });
      showToast(
        approval.kind === "change"
          ? copy.reviewSent
          : approved
          ? copy.approvalApproved
          : copy.approvalDenied,
        approved ? "success" : "warning",
      );
      if (state.pendingApproval?.id === approval.id) renderPendingApproval(null);
      void reconcileStatus();
    } catch (error: unknown) {
      if (state.pendingApproval?.id === approval.id) {
        state.approvalSubmitting = null;
        renderPendingApproval(approval);
      }
      showToast(
        error instanceof Error ? error.message : String(error),
        "error",
      );
    }
  }

  return { renderPendingApproval, respondToApproval };
}

/** Inline approval rendering and authenticated decision handling. */
export const WEB_UI_CLIENT_APPROVAL_SCRIPT =
  `  const { renderPendingApproval, respondToApproval } = `
  + `(${createApprovalController.toString()})({ copy, elements, state, api, showToast, reconcileStatus, revealApproval: () => {
    if (state.stickToBottom && !elements.conversation.inert) scrollToBottom(false);
  }, placePreview: (approval) => {
    const isChange = approval?.kind === 'change';
    const hasDiff = Boolean(isChange && approval.preview);
    const slot = hasDiff ? byId('approvalDiffSlot') : byId('approvalInlinePreview');
    if (elements.approvalPreview.parentNode !== slot) slot.append(elements.approvalPreview);
    elements.approvalPreview.setAttribute('aria-labelledby', hasDiff ? 'approvalDiffTitle' : 'approvalTitle');
    elements.approvalDiffButton.hidden = !hasDiff;
    byId('approvalDiffDetail').hidden = !hasDiff;
    byId('approvalDiffTitle').textContent = hasDiff ? approval.title : '';
    const label = isChange ? copy.fileReview : copy.approvalRequired;
    if (elements.approvalEyebrow.textContent !== label) elements.approvalEyebrow.textContent = label;
    elements.jumpApproval.hidden = !approval;
  } });\n\n`;
