/** Inspector panels, runtime diagnostics, and settings controls. */
export const WEB_UI_INSPECTOR_STYLES = String.raw`
.inspector-backdrop {
  position: fixed;
  inset: 0;
  z-index: 49;
  width: 100%;
  height: 100%;
  padding: 0;
  background: color-mix(in srgb, var(--canvas-deep) 18%, transparent);
  border: 0;
  backdrop-filter: blur(2px) saturate(92%);
  cursor: default;
  opacity: 0;
  transition: opacity 180ms ease;
}

.inspector-backdrop[hidden] {
  display: none;
}

.inspector-backdrop.is-open {
  opacity: 1;
}

.inspector {
  position: fixed;
  z-index: 50;
  top: 12px;
  right: 12px;
  bottom: 12px;
  width: min(390px, calc(100vw - 32px));
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  background: var(--surface-raised);
  border: 1px solid var(--border-strong);
  border-radius: 17px;
  box-shadow: var(--shadow-lg);
  opacity: 0;
  pointer-events: none;
  transform: translateX(calc(100% + 28px));
  transition: opacity 180ms ease, transform 220ms cubic-bezier(0.2, 0.75, 0.3, 1);
}

.inspector.is-open {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(0);
}

.inspector-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 17px 17px 10px;
}

.inspector-header h2 {
  margin: 1px 0 0;
  color: var(--ink-strong);
  font-size: 15px;
  letter-spacing: -0.02em;
}

.inspector-kicker {
  color: var(--accent-strong);
  font-size: 9px;
  font-weight: 750;
  letter-spacing: 0.15em;
}

.inspector-tabs {
  display: flex;
  gap: 18px;
  padding: 0 17px;
  border-bottom: 1px solid var(--border);
}

.inspector-tab {
  position: relative;
  height: 38px;
  padding: 0;
  color: var(--faint);
  background: transparent;
  border: 0;
  font-size: 12px;
  font-weight: 600;
}

.inspector-tab::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  background: var(--accent);
  opacity: 0;
  transform: scaleX(0.5);
  transition: opacity 140ms ease, transform 140ms ease;
}

.inspector-tab.is-active {
  color: var(--ink-strong);
}

.inspector-tab.is-active::after {
  opacity: 1;
  transform: scaleX(1);
}

.inspector-content {
  min-height: 0;
  overflow-y: auto;
  padding: 4px 17px 18px;
}

.tab-panel[hidden] {
  display: none;
}

.detail-section,
.settings-group {
  margin: 0;
  padding: 17px 0;
  border-bottom: 1px solid var(--border);
}

.detail-section:last-child,
.settings-group:last-child {
  border-bottom: 0;
}

.section-heading,
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.section-heading {
  margin-bottom: 12px;
}

.section-heading h3,
.settings-group h3 {
  margin: 0;
  color: var(--ink-strong);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.section-heading > span {
  color: var(--faint);
  font-size: 9px;
}

.runtime-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
  margin: 0;
}

.runtime-item {
  min-width: 0;
  padding: 10px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 9px;
}

.runtime-item dt {
  margin-bottom: 2px;
  color: var(--faint);
  font-size: 9px;
  text-transform: uppercase;
}

.runtime-item dd {
  margin: 0;
  overflow: hidden;
  color: var(--ink-strong);
  font: 11px/1.4 var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.review-list {
  display: grid;
  gap: 5px;
}

.review-empty {
  margin: 2px 0;
  color: var(--faint);
  font-size: 11px;
}

.review-row {
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  min-height: 30px;
  padding: 5px 7px;
  color: var(--muted);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 11px;
}

.review-row.is-in_progress {
  color: var(--ink-strong);
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
}

.review-row.is-completed .review-text {
  color: var(--faint);
  text-decoration: line-through;
}

.review-marker {
  color: var(--accent-strong);
  text-align: center;
}

.review-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.review-action {
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--faint);
  background: transparent;
  border: 0;
  border-radius: 6px;
  font-size: 15px;
}

.review-action:hover {
  color: var(--danger);
  background: var(--danger-soft);
}

.review-launcher > p {
  margin: -4px 0 11px;
  color: var(--muted);
  font-size: 10px;
  line-height: 1.5;
}

.review-preset-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.review-preset-grid button {
  min-height: 34px;
  padding: 7px 9px;
  color: var(--ink-strong);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 10px;
  font-weight: 650;
  text-align: left;
}

.review-preset-grid button:first-child {
  grid-column: 1 / -1;
  color: var(--accent-strong);
  border-color: color-mix(in srgb, var(--accent) 38%, var(--border));
}

.review-preset-grid button:hover {
  background: var(--surface-hover);
  border-color: var(--border-strong);
}

.agent-run-list {
  display: grid;
  gap: 7px;
}

.agent-card {
  display: grid;
  gap: 5px;
  padding: 9px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 9px;
}

.agent-card.is-running {
  border-color: color-mix(in srgb, var(--accent) 42%, var(--border));
}

.agent-card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.agent-card-heading strong {
  overflow: hidden;
  color: var(--ink-strong);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-status {
  color: var(--faint);
  font: 8px/1.4 var(--font-mono);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.agent-card.is-running .agent-status {
  color: var(--accent-strong);
}

.agent-card.is-failed .agent-status,
.agent-card.is-aborted .agent-status {
  color: var(--danger);
}

.agent-card p {
  margin: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: 10px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-meta {
  overflow: hidden;
  color: var(--faint);
  font: 8px/1.45 var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-abort {
  justify-self: start;
  padding: 4px 7px;
  color: var(--danger);
  background: var(--danger-soft);
  border: 0;
  border-radius: 6px;
  font-size: 9px;
}

.agent-abort:disabled {
  opacity: 0.45;
}

.text-button {
  padding: 3px 0;
  color: var(--faint);
  background: transparent;
  font-size: 10px;
}

.text-button:hover {
  color: var(--accent-strong);
}

.activity-list {
  display: grid;
  gap: 5px;
}

.activity-empty {
  margin: 3px 0;
  color: var(--faint);
  font-size: 11px;
  line-height: 1.5;
}

.activity-row {
  position: relative;
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr) auto;
  align-items: start;
  gap: 8px;
  min-height: 28px;
  padding: 5px 0;
  color: var(--muted);
  font-size: 11px;
}

.activity-row::before {
  content: "";
  width: 6px;
  height: 6px;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--faint);
}

.activity-row.is-success::before {
  background: var(--success);
}

.activity-row.is-warning::before {
  background: var(--warning);
}

.activity-row.is-error::before {
  background: var(--danger);
}

.activity-row span:first-of-type {
  overflow-wrap: anywhere;
}

.activity-time {
  color: var(--faint);
  font: 9px/1.6 var(--font-mono);
}

.cache-section {
  cursor: default;
}

.cache-section summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--ink-strong);
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.03em;
  list-style: none;
  text-transform: uppercase;
}

.cache-section summary::-webkit-details-marker {
  display: none;
}

.cache-section summary span {
  color: var(--faint);
  font: 9px/1.4 var(--font-mono);
  letter-spacing: 0;
  text-transform: none;
}

.cache-section pre {
  margin: 13px 0 0;
  padding: 11px;
  overflow: auto;
  color: var(--muted);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 9px;
  font: 10px/1.55 var(--font-mono);
  white-space: pre-wrap;
}

.settings-group {
  display: grid;
  gap: 10px;
}

.settings-group > h3 {
  margin-bottom: 2px;
}

.setting-row h3 {
  margin-bottom: 2px;
}

.setting-row p {
  margin: 0;
  color: var(--faint);
  font-size: 10px;
}

.field-label {
  margin-top: 3px;
  color: var(--muted);
  font-size: 10px;
}

.field-control,
.inline-field input {
  width: 100%;
  height: 36px;
  padding: 0 10px;
  color: var(--ink-strong);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 9px;
  outline: 0;
  font-size: 11px;
}

.inline-field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 7px;
}

.secondary-button {
  height: 36px;
  padding: 0 12px;
  color: var(--ink-strong);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 9px;
  font-size: 11px;
  font-weight: 600;
}

.secondary-button:hover {
  border-color: var(--border-strong);
  background: var(--surface-hover);
}

.segmented,
.theme-options {
  display: grid;
  gap: 5px;
  padding: 4px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.segmented {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.theme-options {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.segmented button,
.theme-options button {
  min-width: 0;
  height: 29px;
  padding: 0 5px;
  color: var(--muted);
  background: transparent;
  border: 0;
  border-radius: 7px;
  font-size: 10px;
}

.segmented button:hover,
.theme-options button:hover {
  color: var(--ink-strong);
}

.segmented button.is-active,
.theme-options button.is-active {
  color: var(--ink-strong);
  background: var(--surface-raised);
  box-shadow: var(--shadow-sm);
  font-weight: 650;
}

.switch {
  position: relative;
  width: 34px;
  height: 20px;
  flex: 0 0 auto;
}

.switch input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.switch-track {
  position: absolute;
  inset: 0;
  background: var(--surface-hover);
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  transition: background 150ms ease;
}

.switch-track::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  background: var(--surface-raised);
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: transform 150ms ease;
}

.switch input:checked + .switch-track {
  background: var(--accent);
  border-color: var(--accent);
}

.switch input:checked + .switch-track::after {
  transform: translateX(14px);
}

.switch input:focus-visible + .switch-track {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.search-dependencies {
  display: grid;
  gap: 8px;
  transition: opacity 150ms ease;
}

.search-dependencies.is-disabled {
  opacity: 0.48;
}

.changes-list,
.checkpoint-list,
.tool-history-list,
.verification-list {
  display: grid;
  gap: 7px;
}

.tool-history-row {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--surface-raised);
}

.tool-history-row > span:nth-child(2) { min-width: 0; }
.tool-history-row strong,
.tool-history-row small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool-history-row small,
.tool-history-row time { color: var(--muted); font-size: 11px; }
.tool-history-mark { color: var(--accent); font-weight: 700; }
.tool-history-row.is-failed .tool-history-mark { color: var(--danger); }
.tool-history-row.is-denied .tool-history-mark { color: var(--warning); }

.change-card {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-raised);
}

.change-card summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 38px;
  padding: 0 10px;
  cursor: pointer;
  list-style: none;
}

.change-card summary::-webkit-details-marker { display: none; }
.change-card summary::after { content: "›"; color: var(--muted); }
.change-card[open] summary::after { transform: rotate(90deg); }

.change-card summary strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 600 11px/1.3 var(--font-mono);
}

.change-card summary span {
  margin-left: auto;
  color: var(--muted);
  font-size: 9px;
}

.change-diff {
  max-height: 320px;
  margin: 0;
  padding: 10px;
  overflow: auto;
  color: var(--ink);
  background: var(--code-bg, var(--surface-subtle));
  border-block: 1px solid var(--border);
  font: 10px/1.55 var(--font-mono);
  white-space: pre;
}

.change-actions {
  display: flex;
  justify-content: flex-end;
  padding: 7px;
}

.change-restore,
.checkpoint-rewind {
  height: 29px;
  font-size: 10px;
}

.checkpoint-row,
.verification-row {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  padding: 8px 9px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface-raised);
}

.checkpoint-row > span,
.verification-row > span:last-child {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.checkpoint-row strong,
.verification-row strong,
.checkpoint-row small,
.verification-row small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.checkpoint-row strong,
.verification-row strong { font-size: 10px; }
.checkpoint-row small,
.verification-row small { color: var(--muted); font-size: 9px; }
.checkpoint-row button { margin-left: auto; flex: 0 0 auto; }
.verification-row > span:first-child { color: var(--danger); font-weight: 700; }
.verification-row.is-success > span:first-child { color: var(--success); }

.export-trace-button {
  width: 100%;
  margin-top: 2px;
}

`;
