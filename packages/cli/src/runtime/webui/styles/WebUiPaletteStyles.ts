/** Searchable command palette and keyboard-first action navigation. */
export const WEB_UI_PALETTE_STYLES = String.raw`
.command-trigger {
  height: 34px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 9px;
  color: var(--muted);
  background: color-mix(in srgb, var(--surface-raised) 64%, transparent);
  border: 1px solid var(--border);
  border-radius: 9px;
}

.command-trigger:hover {
  color: var(--ink-strong);
  border-color: var(--border-strong);
  background: var(--surface-raised);
}

.command-trigger .ui-icon {
  width: 14px;
  height: 14px;
}

.command-trigger kbd,
.command-search kbd {
  padding: 2px 5px;
  color: var(--faint);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 5px;
  font: 9px/1.3 var(--font-mono);
}

.command-palette {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: start center;
  padding: max(72px, 11vh) 20px 20px;
}

.command-palette[hidden] {
  display: none;
}

.command-palette-backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  background: var(--scrim);
  backdrop-filter: blur(7px) saturate(85%);
  cursor: default;
}

.command-palette-dialog {
  position: relative;
  width: min(640px, 100%);
  overflow: hidden;
  color: var(--ink);
  background: color-mix(in srgb, var(--surface-raised) 96%, var(--canvas));
  border: 1px solid var(--border-strong);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  animation: palette-in 150ms cubic-bezier(0.2, 0.75, 0.3, 1) both;
}

.command-search {
  min-height: 58px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  padding: 0 15px;
  color: var(--accent-strong);
  border-bottom: 1px solid var(--border);
}

.command-search > span {
  width: 27px;
  height: 27px;
  display: grid;
  place-items: center;
  background: var(--accent-soft);
  border-radius: 8px;
  font: 700 11px/1 var(--font-mono);
}

.command-search input {
  width: 100%;
  height: 56px;
  padding: 0;
  color: var(--ink-strong);
  background: transparent;
  border: 0;
  outline: 0;
  font-size: 15px;
}

.command-search input::placeholder {
  color: var(--faint);
}

.command-results {
  max-height: min(480px, 58vh);
  display: grid;
  gap: 2px;
  overflow-y: auto;
  padding: 7px;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}

.command-results::-webkit-scrollbar {
  width: 6px;
}

.command-results::-webkit-scrollbar-thumb {
  background: var(--border-strong);
  border-radius: 999px;
}

.command-result {
  min-width: 0;
  min-height: 48px;
  display: grid;
  grid-template-columns: 31px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  color: var(--muted);
  background: transparent;
  border: 0;
  border-radius: 10px;
  text-align: left;
}

.command-result[aria-selected="true"] {
  color: var(--ink-strong);
  background: var(--accent-soft);
}

.command-result-icon {
  width: 29px;
  height: 29px;
  display: grid;
  place-items: center;
  color: var(--accent-strong);
  background: color-mix(in srgb, var(--surface-raised) 72%, var(--accent-soft));
  border: 1px solid color-mix(in srgb, var(--accent) 19%, var(--border));
  border-radius: 8px;
  font: 650 11px/1 var(--font-mono);
}

.command-result-copy {
  min-width: 0;
  display: grid;
  gap: 1px;
}

.command-result-copy strong,
.command-result-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.command-result-copy strong {
  color: inherit;
  font-size: 12px;
  font-weight: 620;
}

.command-result-copy small {
  color: var(--faint);
  font-size: 9px;
}

.command-empty {
  margin: 0;
  padding: 32px 18px;
  color: var(--faint);
  text-align: center;
}

.command-palette-footer {
  min-height: 32px;
  display: flex;
  align-items: center;
  padding: 0 15px;
  color: var(--faint);
  background: color-mix(in srgb, var(--surface-subtle) 62%, transparent);
  border-top: 1px solid var(--border);
  font: 9px/1.4 var(--font-mono);
}

@keyframes palette-in {
  from { opacity: 0; transform: translateY(-8px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
`;
