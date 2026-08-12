import type { WebUiApprovalSnapshot } from "./WebUiContracts.js";

interface ApprovalCopy {
  approvalRequired: string;
  approvalOwner: string;
  approvalApproved: string;
  approvalDenied: string;
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
  approvalSubmitting: boolean;
}

interface ApprovalRuntime {
  copy: ApprovalCopy;
  elements: ApprovalElements;
  state: ApprovalState;
  api: (path: string, init?: RequestInit) => Promise<unknown>;
  showToast: (message: string, tone?: string) => void;
  reconcileStatus: () => Promise<void>;
}

/** Typed browser factory for approval rendering and decisions. */
function createApprovalController(runtime: ApprovalRuntime) {
  const { copy, elements, state, api, showToast, reconcileStatus } = runtime;

  function renderPendingApproval(
    approval: WebUiApprovalSnapshot | null | undefined,
  ): void {
    state.pendingApproval = approval?.id ? approval : null;
    const visible = Boolean(state.pendingApproval);
    elements.approvalPanel.hidden = !visible;
    if (!state.pendingApproval) {
      elements.approvalTitle.textContent = "";
      elements.approvalReason.textContent = "";
      elements.approvalPreview.textContent = "";
      elements.approvalPreview.hidden = true;
      state.approvalSubmitting = false;
      return;
    }
    elements.approvalTitle.textContent =
      state.pendingApproval.title || copy.approvalRequired;
    const approvalOwner =
      state.pendingApproval.agentRole || state.pendingApproval.agentId || "";
    elements.approvalReason.textContent = [
      approvalOwner ? `${copy.approvalOwner} ${approvalOwner}` : "",
      state.pendingApproval.reason || "",
    ]
      .filter(Boolean)
      .join(" · ");
    const preview = String(state.pendingApproval.preview || "");
    elements.approvalPreview.replaceChildren();
    if (preview) {
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
    elements.denyApprovalButton.disabled = state.approvalSubmitting;
    elements.approveApprovalButton.disabled = state.approvalSubmitting;
  }

  async function respondToApproval(approved: boolean): Promise<void> {
    const approval = state.pendingApproval;
    if (!approval || state.approvalSubmitting) return;
    state.approvalSubmitting = true;
    renderPendingApproval(approval);
    try {
      await api("/api/approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: approval.id, approved: Boolean(approved) }),
      });
      showToast(
        approved ? copy.approvalApproved : copy.approvalDenied,
        approved ? "success" : "warning",
      );
      renderPendingApproval(null);
      void reconcileStatus();
    } catch (error: unknown) {
      state.approvalSubmitting = false;
      renderPendingApproval(approval);
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
  `  const { renderPendingApproval, respondToApproval } = ` +
  `(${createApprovalController.toString()})({ copy, elements, state, api, showToast, reconcileStatus });\n\n`;
