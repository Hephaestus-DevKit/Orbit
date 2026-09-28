/** Skill catalog, review states, and workflow authoring surfaces. */
export const WEB_UI_CAPABILITIES_STYLES = String.raw`
.skill-controls {
  display: grid;
  gap: 14px;
  margin-top: 13px;
}

.skill-controls.is-disabled {
  --skill-disabled-opacity: 0.52;
}

.skill-controls.is-disabled #skillActivationSegments,
.skill-controls.is-disabled .skill-limit-row label,
.skill-controls.is-disabled .skill-limit-row input,
.skill-controls.is-disabled .skill-list {
  opacity: var(--skill-disabled-opacity);
}

.capability-toolbar,
.capability-subheading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.capability-toolbar > div {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.capability-toolbar strong,
.capability-subheading strong {
  color: var(--ink-strong);
  font-size: 13px;
}

.capability-toolbar span {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
}

.capability-add-button {
  height: 36px;
  flex: 0 0 auto;
}

.capability-creator {
  display: grid;
  gap: 10px;
  padding: 16px 0;
  border-block: 1px solid var(--border);
}

.capability-creator[hidden],
.capability-skill-fields[hidden],
.capability-workflow-fields[hidden] {
  display: none;
}

.capability-kind {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.capability-instructions {
  min-height: 88px;
  height: auto;
  padding-block: 8px;
  resize: vertical;
  line-height: 1.45;
}

.capability-skill-fields,
.capability-workflow-fields {
  display: grid;
  gap: 10px;
}

.capability-stage-editor {
  margin-top: 2px;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 9px;
}

.capability-stage-editor summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 0 10px;
  color: var(--ink-strong);
  cursor: pointer;
  list-style: none;
  font-size: 12px;
  font-weight: 650;
}

.capability-stage-editor summary::-webkit-details-marker {
  display: none;
}

.capability-stage-editor summary::after {
  content: "›";
  color: var(--faint);
  font-size: 16px;
  line-height: 1;
  transform: rotate(0deg);
  transition: transform 140ms ease;
}

.capability-stage-editor[open] summary {
  border-bottom: 1px solid var(--border);
}

.capability-stage-editor[open] summary::after {
  transform: rotate(90deg);
}

.capability-stage-editor summary small {
  padding: 2px 5px;
  color: var(--faint);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 5px;
  font: 10px/1.4 var(--font-mono);
}

.capability-stage-editor summary:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 72%, transparent);
  outline-offset: -2px;
}

.capability-stage-editor-body {
  display: grid;
  gap: 8px;
  padding: 9px;
}

.capability-stage-editor-body > p {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
}

textarea.field-control.capability-stages {
  min-height: 148px;
  height: auto;
  padding: 8px 10px;
  resize: vertical;
  font: 12px/1.6 var(--font-mono);
  tab-size: 2;
  white-space: pre;
  overflow: auto;
}

.capability-stage-editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 24px;
}

.capability-stage-editor-footer > span {
  min-width: 0;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.capability-stage-editor-footer > span.is-valid {
  color: var(--success);
}

.capability-stage-editor-footer > span.is-invalid {
  color: var(--danger);
}

.capability-stage-editor-footer .text-button {
  flex: 0 0 auto;
}

.capability-creator-actions {
  display: flex;
  justify-content: flex-end;
  gap: 7px;
  margin-top: 3px;
}

.capability-template {
  min-height: 34px;
}

.capability-preview {
  display: grid;
  gap: 5px;
}

.capability-preview code {
  min-height: 34px;
  padding: 8px 10px;
  overflow: hidden;
  color: var(--accent-strong);
  background: color-mix(in srgb, var(--accent-soft) 44%, var(--surface-subtle));
  border: 1px solid transparent;
  border-radius: 8px;
  font: 12px/1.5 var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.capability-form-error {
  margin: 1px 0 0;
  padding: 8px 9px;
  color: var(--danger);
  background: color-mix(in srgb, var(--danger-soft) 72%, var(--surface-subtle));
  border: 1px solid color-mix(in srgb, var(--danger) 20%, var(--border));
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.45;
}

.capability-form-error[hidden] {
  display: none;
}

.capability-subheading {
  margin-top: 4px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.capability-subheading span {
  color: var(--faint);
  font: 11px/1.4 var(--font-mono);
}

.workflow-list {
  display: grid;
  gap: 6px;
}

.workflow-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.skill-limit-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 66px auto;
  align-items: center;
  gap: 8px;
}

.skill-limit-row .field-control {
  min-width: 0;
  text-align: center;
}

.skill-summary {
  color: var(--accent-strong);
  font: 12px/1.5 var(--font-sans);
}

#refreshSkills[aria-busy="true"] {
  cursor: progress;
  opacity: 0.66;
}

.skill-list,
.skill-diagnostics {
  display: grid;
  gap: 6px;
}

.skill-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.skill-row:hover {
  border-color: var(--border-strong);
  background: var(--surface-hover);
}

.skill-row.is-review-pending,
.workflow-row.is-blocked {
  background: color-mix(in srgb, var(--warning-soft) 48%, var(--surface-subtle));
  border-color: color-mix(in srgb, var(--warning) 28%, var(--border));
}

.skill-row.is-disabled .skill-row-copy {
  opacity: 0.55;
}

.skill-row-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.skill-use {
  min-height: 34px;
  padding: 0 9px;
  color: var(--accent-strong);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 7px;
  font-size: 12px;
  font-weight: 650;
}

.skill-use:hover:not(:disabled) {
  background: var(--surface-hover);
  border-color: var(--border-strong);
}

.skill-use:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.skill-row-copy {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.skill-row-copy strong {
  overflow: hidden;
  color: var(--ink-strong);
  font: 600 13px/1.5 var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-row-copy > span {
  display: -webkit-box;
  overflow: hidden;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.skill-row-copy small {
  overflow: hidden;
  color: var(--muted);
  font: 11px/1.5 var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-row-copy > .skill-row-heading {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  -webkit-line-clamp: unset;
}

.skill-row-heading strong {
  min-width: 0;
}

.skill-row-heading .skill-review-badge {
  flex: 0 0 auto;
  padding: 1px 5px;
  color: var(--warning);
  background: var(--warning-soft);
  border: 1px solid color-mix(in srgb, var(--warning) 24%, var(--border));
  border-radius: 999px;
  font: 10px/1.5 var(--font-sans);
  font-weight: 700;
  letter-spacing: 0.02em;
}

.skill-row.is-review-pending .skill-row-heading {
  flex-wrap: wrap;
  overflow: visible;
}

.skill-review-note,
.workflow-dependency-note {
  grid-column: 1 / -1;
  margin: 0;
  padding-top: 8px;
  border-top: 1px solid color-mix(in srgb, var(--warning) 20%, var(--border));
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.skill-diagnostic {
  padding: 7px 8px;
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 8%, transparent);
  border-left: 2px solid var(--warning);
  border-radius: 5px;
  font-size: 12px;
  line-height: 1.45;
}

.skill-diagnostic.is-error {
  color: var(--danger);
  background: var(--danger-soft);
  border-color: var(--danger);
}

`;
