/** Workspace file context picker and composer context indicators. */
export const WEB_UI_CONTEXT_STYLES = String.raw`
.context-shelf {
  display: grid;
  gap: 7px;
  margin: 0 1px 9px;
  padding: 8px 9px;
  background: color-mix(in srgb, var(--surface-subtle) 68%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
  border-radius: 11px;
}

.context-shelf[hidden] {
  display: none;
}

.context-shelf-header,
.context-shelf-header > span {
  display: flex;
  align-items: center;
}

.context-shelf-header {
  min-width: 0;
  justify-content: space-between;
  gap: 10px;
}

.context-shelf-header > span {
  gap: 6px;
  color: var(--muted);
}

.context-shelf-header .ui-icon {
  width: 13px;
  height: 13px;
  color: var(--accent-strong);
}

.context-shelf-header strong {
  font: 650 9px/1 var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.context-shelf-header button {
  padding: 2px 4px;
  color: var(--faint);
  background: transparent;
  border: 0;
  font-size: 9px;
}

.context-shelf-header button:hover {
  color: var(--danger);
}

.context-file-list {
  min-width: 0;
  max-height: 68px;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.context-file-chip,
.context-file-overflow {
  min-width: 0;
  height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 5px 0 7px;
  color: var(--muted);
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 1px 2px color-mix(in srgb, var(--ink) 5%, transparent);
}

.context-file-chip {
  max-width: min(245px, 100%);
}

.context-file-chip-icon {
  color: var(--accent-strong);
  font: 700 11px/1 var(--font-mono);
}

.context-file-chip strong {
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font-size: 10px;
  font-weight: 610;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-file-chip small {
  flex: 0 0 auto;
  padding: 2px 5px;
  color: var(--accent-strong);
  background: var(--accent-soft);
  border-radius: 4px;
  font: 650 8.5px/1 var(--font-mono);
  letter-spacing: 0.02em;
}

.context-file-remove {
  width: 19px;
  height: 19px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  padding: 0;
  color: var(--faint);
  background: transparent;
  border: 0;
  border-radius: 5px;
  font: 13px/1 sans-serif;
}

.context-file-remove:hover {
  color: var(--danger);
  background: var(--danger-soft);
}

.context-file-overflow {
  color: var(--faint);
  background: transparent;
  box-shadow: none;
  font: 600 8.5px/1 var(--font-mono);
}

.context-chip-count {
  min-width: 17px;
  height: 17px;
  display: inline-grid;
  place-items: center;
  margin-left: 1px;
  padding: 0 4px;
  color: var(--accent-strong);
  background: color-mix(in srgb, var(--surface-raised) 72%, var(--accent-soft));
  border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--border));
  border-radius: 999px;
  font: 650 8.5px/1 var(--font-mono);
}

.context-chip-count[hidden] {
  display: none;
}

.context-picker {
  position: absolute;
  z-index: 36;
  left: 12px;
  bottom: calc(100% + 9px);
  width: min(560px, calc(100% - 24px));
  max-height: min(440px, 58vh);
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 8px;
  padding: 10px;
  overflow: hidden;
  color: var(--ink);
  background: color-mix(in srgb, var(--surface-raised) 96%, var(--surface-subtle));
  border: 1px solid var(--border-strong);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(24px) saturate(112%);
  transform-origin: 20% 100%;
  animation: context-picker-in 150ms ease-out both;
}

.context-picker[hidden] {
  display: none;
}

.empty-composer-slot .context-picker {
  top: calc(100% + 9px);
  bottom: auto;
  max-height: min(310px, 40vh);
  transform-origin: 20% 0;
}

.context-picker-header {
  min-width: 0;
  min-height: 30px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  padding: 0 3px 1px;
}

.context-picker-header strong {
  color: var(--ink-strong);
  font-size: 12px;
  font-weight: 680;
}

.context-picker-icon,
.context-picker-close {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  padding: 0;
  border-radius: 8px;
}

.context-picker-icon {
  color: var(--accent-strong);
  background: var(--accent-soft);
  border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border));
}

.context-picker-icon .ui-icon,
.context-picker-close .ui-icon {
  width: 14px;
  height: 14px;
}

.context-picker-close {
  color: var(--faint);
  background: transparent;
  border: 0;
}

.context-picker-close:hover {
  color: var(--ink-strong);
  background: var(--surface-hover);
}

.context-picker-search {
  height: 38px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  color: var(--faint);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 10px;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}

.context-picker-search:focus-within {
  border-color: color-mix(in srgb, var(--accent) 48%, var(--border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 9%, transparent);
}

.context-picker-search input {
  min-width: 0;
  width: 100%;
  padding: 0;
  color: var(--ink-strong);
  background: transparent;
  border: 0;
  outline: 0;
  font-size: 12px;
}

.context-picker-search input::-webkit-search-cancel-button {
  display: none;
}

.context-picker-search kbd {
  padding: 2px 5px;
  color: var(--faint);
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: 5px;
  font: 9px/1.35 var(--font-mono);
}

.context-results {
  min-height: 0;
  max-height: 300px;
  display: grid;
  gap: 2px;
  overflow-y: auto;
  padding: 1px;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--faint) 34%, transparent) transparent;
}

.context-result {
  min-width: 0;
  min-height: 46px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 6px 9px;
  color: var(--muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 9px;
  text-align: left;
}

.context-result:hover,
.context-result[aria-selected="true"] {
  color: var(--ink-strong);
  background: var(--surface-subtle);
  border-color: var(--border);
}

.context-result.is-added {
  color: var(--faint);
  cursor: default;
  opacity: 0.72;
}

.context-result.is-added .context-result-action {
  color: var(--success);
  opacity: 1;
}

.context-result-icon {
  width: 25px;
  height: 25px;
  display: grid;
  place-items: center;
  color: var(--accent-strong);
  background: var(--accent-soft);
  border-radius: 7px;
  font: 650 10px/1 var(--font-mono);
}

.context-result-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.context-result-copy strong,
.context-result-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-result-copy strong {
  color: inherit;
  font-size: 11.5px;
  font-weight: 640;
}

.context-result-copy small {
  color: var(--faint);
  font: 9px/1.35 var(--font-mono);
}

.context-result-action {
  color: var(--faint);
  font-size: 9px;
  font-weight: 650;
  opacity: 0;
}

.context-result:hover .context-result-action,
.context-result[aria-selected="true"] .context-result-action {
  color: var(--accent-strong);
  opacity: 1;
}

.context-empty {
  min-height: 84px;
  display: grid;
  place-items: center;
  margin: 0;
  padding: 18px;
  color: var(--faint);
  font-size: 11px;
  text-align: center;
}

.context-empty[hidden] {
  display: none;
}

.context-picker-hint {
  margin: 0;
  padding: 2px 3px 0;
  color: var(--faint);
  border-top: 1px solid var(--border);
  font: 9px/1.7 var(--font-mono);
}

.context-picker.is-loading .context-results {
  opacity: 0.45;
}

@keyframes context-picker-in {
  from { opacity: 0; transform: translateY(5px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
`;
