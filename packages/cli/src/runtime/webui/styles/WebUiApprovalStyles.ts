/** Inline tool and file-change approval surface. */
export const WEB_UI_APPROVAL_STYLES = String.raw`
.approval-panel {
  position: relative;
  width: min(calc(100% - 32px), var(--content-width));
  margin: 0 auto 14px;
  padding: 16px;
  overflow: hidden;
  color: var(--ink);
  background: color-mix(in srgb, var(--surface-raised) 94%, var(--warning-soft));
  border: 1px solid color-mix(in srgb, var(--warning) 32%, var(--border));
  border-radius: 16px;
  box-shadow: none;
}

.approval-jump {
  display: block;
  margin: 0;
  padding: 6px 9px;
  border: 0;
  background: var(--warning-soft);
  color: var(--ink);
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: 12px;
}
.review-results:not([hidden]) {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  width: min(calc(100% - 32px), var(--content-width));
  margin: 0 auto 14px;
}
.approval-jump[hidden], #approvalDiffButton[hidden] { display: none; }
.approval-panel::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--warning);
}

.approval-panel-head {
  display: flex;
  align-items: flex-start;
  gap: 11px;
}

.approval-panel-head > div {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.diff-link {
  flex: 0 0 auto;
  align-self: center;
  margin-left: auto;
  padding: 7px 5px;
  color: var(--accent-strong);
  background: transparent;
  border: 0;
  border-radius: 5px;
  font: 600 12px/1.4 var(--font-sans);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.approval-mark {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  color: color-mix(in srgb, var(--warning) 78%, var(--ink));
  background: var(--warning-soft);
  border-radius: 9px;
  font: 700 13px/1 var(--font-mono);
}

.approval-eyebrow {
  color: var(--muted);
  font: 650 9px/1.35 var(--font-mono);
  letter-spacing: 0.11em;
}

#approvalTitle {
  overflow-wrap: anywhere;
  font-size: 13.5px;
  line-height: 1.35;
}

.approval-reason {
  margin: 12px 0 0 39px;
  overflow-wrap: anywhere;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
}

.approval-preview {
  max-height: 220px;
  margin: 12px 0 0;
  padding: 10px 0;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--faint) 45%, transparent) transparent;
  color: var(--ink);
  background: color-mix(in srgb, var(--canvas) 76%, var(--surface));
  border: 1px solid var(--border);
  border-radius: 11px;
  font: 11.5px/1.6 var(--font-mono);
  white-space: pre;
}

/* The review pane has room to read the diff. Inline tool previews stay compact. */
#approvalDiffDetail:not([hidden]) {
  display: grid;
  gap: 12px;
  padding-block: 8px 18px;
}
#approvalDiffTitle {
  width: fit-content;
  max-width: 100%;
  margin: 0;
  border-radius: 3px;
  overflow-wrap: anywhere;
  color: var(--ink-strong);
  font: 650 15px/1.4 var(--font-sans);
}
#approvalDiffTitle:focus-visible {
  outline: none;
  padding-inline-start: 9px;
  border-inline-start: 3px solid var(--accent);
}
#approvalDiffSlot { min-width: 0; container: review-diff / inline-size; }
#approvalDiffSlot .approval-preview {
  margin: 0;
  max-height: min(56dvh, 36rem);
  font-size: 12px;
}
@container review-diff (max-width: 32rem) {
  #approvalDiffSlot .approval-preview-line {
    width: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
}

#returnToApproval {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
#returnToApproval .ui-icon { width: 15px; height: 15px; }

.approval-preview-line {
  display: block;
  min-width: 100%;
  width: max-content;
  min-height: 1.6em;
  padding: 0 11px;
}

.approval-preview-line.is-added {
  color: color-mix(in srgb, var(--success) 62%, var(--ink-strong));
  background: var(--success-soft);
}

.approval-preview-line.is-deleted {
  color: color-mix(in srgb, var(--danger) 62%, var(--ink-strong));
  background: var(--danger-soft);
}

.approval-preview-line.is-hunk {
  color: var(--accent-strong);
  background: var(--accent-soft);
}

.approval-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}

.approval-button {
  min-width: 76px;
  height: 34px;
  padding: 0 13px;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  font-size: 11.5px;
  font-weight: 650;
  transition:
    transform 140ms ease,
    box-shadow 140ms ease,
    background 140ms ease,
    border-color 140ms ease;
}

.approval-button.is-deny {
  color: var(--ink);
  background: var(--surface-raised);
}

.approval-button.is-approve {
  color: var(--surface);
  background: var(--accent-strong);
  border-color: transparent;
}

.approval-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}

.approval-button:disabled {
  opacity: 0.52;
  cursor: wait;
}

@media (max-width: 560px) {
  .approval-panel {
    margin-bottom: 8px;
    padding: 12px;
    border-radius: 14px;
  }

  .approval-panel-head {
    gap: 9px;
  }

  .approval-reason {
    margin: 8px 0 0;
    font-size: 11.5px;
  }

  .approval-preview {
    max-height: min(128px, 20dvh);
    margin-top: 9px;
    padding-block: 7px;
    font-size: 10.75px;
  }

  .approval-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    margin-top: 10px;
  }

  .approval-button {
    width: 100%;
    height: 40px;
  }
}
`;
