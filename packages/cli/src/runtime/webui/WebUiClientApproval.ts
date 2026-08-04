/** Inline approval rendering and authenticated decision handling. */
export const WEB_UI_CLIENT_APPROVAL_SCRIPT = String.raw`  function renderPendingApproval(approval) {
    state.pendingApproval = approval && approval.id ? approval : null;
    const visible = Boolean(state.pendingApproval);
    elements.approvalPanel.hidden = !visible;
    if (!visible) {
      elements.approvalTitle.textContent = '';
      elements.approvalReason.textContent = '';
      elements.approvalPreview.textContent = '';
      elements.approvalPreview.hidden = true;
      state.approvalSubmitting = false;
      return;
    }
    elements.approvalTitle.textContent = state.pendingApproval.title || copy.approvalRequired;
    const approvalOwner = state.pendingApproval.agentRole || state.pendingApproval.agentId || '';
    elements.approvalReason.textContent = [
      approvalOwner ? copy.approvalOwner + ' ' + approvalOwner : '',
      state.pendingApproval.reason || '',
    ].filter(Boolean).join(' · ');
    const preview = String(state.pendingApproval.preview || '');
    elements.approvalPreview.replaceChildren();
    if (preview) {
      for (const line of preview.split('\n')) {
        const row = document.createElement('span');
        row.className = 'approval-preview-line';
        if (line.startsWith('+') && !line.startsWith('+++')) row.classList.add('is-added');
        else if (line.startsWith('-') && !line.startsWith('---')) row.classList.add('is-deleted');
        else if (line.startsWith('@@')) row.classList.add('is-hunk');
        row.textContent = line || ' ';
        elements.approvalPreview.append(row);
      }
    }
    elements.approvalPreview.hidden = !preview;
    elements.denyApprovalButton.disabled = state.approvalSubmitting;
    elements.approveApprovalButton.disabled = state.approvalSubmitting;
  }

  async function respondToApproval(approved) {
    const approval = state.pendingApproval;
    if (!approval || state.approvalSubmitting) return;
    state.approvalSubmitting = true;
    renderPendingApproval(approval);
    try {
      await api('/api/approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: approval.id, approved: Boolean(approved) }),
      });
      showToast(approved ? copy.approvalApproved : copy.approvalDenied, approved ? 'success' : 'warning');
      renderPendingApproval(null);
      void reconcileStatus();
    } catch (error) {
      state.approvalSubmitting = false;
      renderPendingApproval(approval);
      showToast(error.message || String(error), 'error');
    }
  }

`;
