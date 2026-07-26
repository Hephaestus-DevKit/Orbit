/** Toast notifications and shared motion definitions. */
export const WEB_UI_FEEDBACK_STYLES = String.raw`
.project-dialog {
  position: fixed;
  inset: 0;
  z-index: 215;
  display: grid;
  place-items: center;
  padding: 20px;
}

.project-dialog[hidden] {
  display: none;
}

.project-dialog-backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  background: var(--scrim);
  border: 0;
  backdrop-filter: blur(2px);
}

.project-dialog-card {
  position: relative;
  width: min(520px, calc(100vw - 32px));
  display: grid;
  gap: 16px;
  padding: 20px;
  color: var(--ink);
  background: var(--surface-raised);
  border: 1px solid var(--border-strong);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
}

.project-dialog-heading {
  min-width: 0;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  align-items: start;
  gap: 12px;
}

.project-dialog-mark {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  color: var(--accent-strong);
  background: var(--accent-soft);
  border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border));
  border-radius: 10px;
}

.project-dialog-mark .ui-icon {
  width: 17px;
  height: 17px;
}

.project-dialog-heading h2,
.project-dialog-heading p {
  margin: 0;
}

.project-dialog-heading h2 {
  color: var(--ink-strong);
  font-size: 17px;
}

.project-dialog-heading p {
  margin-top: 5px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
}

.project-path-field {
  min-width: 0;
  display: grid;
  gap: 7px;
}

.project-path-field span {
  color: var(--muted);
  font-size: 11px;
  font-weight: 650;
}

.project-path-field input {
  width: 100%;
  min-width: 0;
  height: 42px;
  padding: 0 12px;
  color: var(--ink);
  background: var(--surface-subtle);
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  outline: 0;
  font: 12px/1 var(--font-mono);
}

.project-path-field input:focus {
  background: var(--surface-raised);
  border-color: color-mix(in srgb, var(--accent) 48%, var(--border));
}

.project-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.project-dialog-actions button {
  min-height: 35px;
  padding: 0 13px;
  border-radius: 9px;
  font-size: 12px;
  font-weight: 620;
}

.project-dialog-cancel,
.project-dialog-open {
  color: var(--muted);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
}

.project-dialog-create {
  color: var(--surface-raised);
  background: var(--accent-strong);
  border: 1px solid var(--accent-strong);
}

.project-dialog-actions button:disabled {
  cursor: wait;
  opacity: 0.55;
}

.session-delete-dialog {
  position: fixed;
  inset: 0;
  z-index: 210;
  display: grid;
  place-items: center;
  padding: 20px;
}

.session-delete-dialog[hidden] {
  display: none;
}

.session-delete-backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  background: var(--scrim);
  border: 0;
  backdrop-filter: blur(2px);
}

.session-delete-card {
  position: relative;
  width: min(410px, calc(100vw - 32px));
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 12px;
  padding: 18px;
  color: var(--ink);
  background: var(--surface-raised);
  border: 1px solid var(--border-strong);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
}

.session-delete-mark {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  color: var(--danger);
  background: var(--danger-soft);
  border-radius: 10px;
  font-weight: 700;
}

.session-delete-copy {
  min-width: 0;
}

.session-delete-copy h2,
.session-delete-copy p {
  margin: 0;
}

.session-delete-copy h2 {
  color: var(--ink-strong);
  font-size: 16px;
}

.session-delete-copy p {
  margin-top: 5px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
}

.session-delete-copy strong {
  display: block;
  margin-top: 10px;
  overflow: hidden;
  color: var(--ink);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-delete-actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 3px;
}

.session-delete-actions button {
  height: 34px;
  padding: 0 13px;
  border-radius: 9px;
  font-size: 12px;
  font-weight: 620;
}

.session-delete-cancel {
  color: var(--muted);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
}

.session-delete-confirm {
  color: var(--surface);
  background: var(--danger);
  border: 1px solid var(--danger);
}

.session-delete-actions button:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 62%, transparent);
  outline-offset: 2px;
}

.toast-region {
  position: fixed;
  z-index: 100;
  right: 18px;
  bottom: calc(18px + env(safe-area-inset-bottom));
  width: min(420px, calc(100vw - 36px));
  display: grid;
  justify-items: end;
  gap: 8px;
  pointer-events: none;
}

.toast {
  display: inline-grid;
  grid-template-columns: 7px minmax(0, auto) 24px;
  align-items: center;
  width: fit-content;
  min-width: 0;
  max-width: 100%;
  gap: 9px;
  padding: 9px 9px 9px 12px;
  color: var(--ink);
  background: var(--surface-raised);
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  pointer-events: auto;
  animation: toast-in 180ms ease-out both;
}

.toast::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
}

.toast > div {
  min-width: 0;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.toast.is-error::before {
  background: var(--danger);
}

.toast.is-success::before {
  background: var(--success);
}

.toast button {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--faint);
  background: transparent;
  border: 0;
  border-radius: 7px;
  font-size: 16px;
  line-height: 1;
}

.toast button:hover {
  color: var(--ink);
  background: var(--surface-hover);
}

.toast button:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 62%, transparent);
  outline-offset: 1px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes caret {
  0%, 48% { opacity: 1; }
  49%, 100% { opacity: 0; }
}

@keyframes breathe {
  0%, 100% { opacity: 0.45; transform: scale(0.88); }
  50% { opacity: 1; transform: scale(1); }
}

@keyframes message-in {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes toast-in {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

`;
