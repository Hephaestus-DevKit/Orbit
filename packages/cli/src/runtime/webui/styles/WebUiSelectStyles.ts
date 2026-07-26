/** Consistent, borderless-arrow select controls and rounded floating menus. */
export const WEB_UI_SELECT_STYLES = String.raw`
.select-control {
  position: relative;
  min-width: 0;
}

.native-select-proxy {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  border: 0;
  white-space: nowrap;
}

.select-trigger {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 10px 0 11px;
  color: var(--muted);
  background: color-mix(in srgb, var(--surface-subtle) 74%, transparent);
  border: 1px solid var(--border);
  border-radius: 10px;
  text-align: left;
  box-shadow: none;
  transition: color 140ms ease, background 140ms ease, border-color 140ms ease;
}

.select-trigger:hover,
.select-control.is-open .select-trigger {
  color: var(--ink-strong);
  background: var(--surface-hover);
  border-color: var(--border-strong);
}

.select-trigger:focus-visible {
  outline: 0;
  border-color: color-mix(in srgb, var(--accent) 58%, var(--border-strong));
  box-shadow: none;
}

.select-control.is-open .select-trigger {
  box-shadow: none;
}

.select-trigger .select-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.select-trigger .ui-icon {
  width: 14px;
  height: 14px;
  color: var(--faint);
  stroke-width: 1.8;
  transition: transform 150ms ease, color 150ms ease;
}

.select-control.is-open .select-trigger .ui-icon {
  color: var(--accent-strong);
  transform: rotate(180deg);
}

.select-menu {
  position: fixed;
  z-index: 180;
  max-height: min(320px, calc(100vh - 24px));
  display: grid;
  gap: 2px;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 3px;
  background: var(--surface-raised);
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  box-shadow: var(--shadow-md);
  filter: none;
  font-size: 12px;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
  animation: select-menu-in 130ms ease-out both;
}

@keyframes select-menu-in {
  from { opacity: 0; transform: scale(0.98); }
  to { opacity: 1; transform: scale(1); }
}

.select-menu[hidden] {
  display: none;
}

.select-search-wrap {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 3px;
  background: var(--surface-raised);
}

.select-search {
  width: 100%;
  height: 30px;
  padding: 0 9px;
  color: var(--ink-strong);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 7px;
  outline: 0;
  font: inherit;
}

.select-search:focus {
  border-color: color-mix(in srgb, var(--accent) 58%, var(--border-strong));
}

.select-empty {
  padding: 12px 9px;
  color: var(--faint);
  font-size: 11px;
  text-align: center;
}

.select-empty[hidden],
.select-option[hidden] {
  display: none;
}

.select-option {
  width: 100%;
  min-height: 28px;
  display: flex;
  align-items: center;
  padding: 3px 28px 3px 9px;
  position: relative;
  overflow: hidden;
  color: var(--muted);
  background: transparent;
  border: 0;
  border-radius: 7px;
  line-height: 1.25;
  text-align: left;
}

.select-option span {
  min-width: 0;
  display: block;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.select-option:hover,
.select-option:focus-visible {
  color: var(--ink-strong);
  background: var(--surface-hover);
  outline: 0;
}

.select-option[aria-selected="true"] {
  color: var(--accent-strong);
  background: var(--accent-soft);
  font-weight: 620;
}

.select-option[aria-selected="true"]::after {
  content: "";
  position: absolute;
  right: 12px;
  width: 8px;
  height: 4px;
  border-left: 1.6px solid currentColor;
  border-bottom: 1.6px solid currentColor;
  transform: translateY(-1px) rotate(-45deg);
}

.model-select-trigger {
  width: min(218px, 23vw);
  height: 36px;
  font-size: 12px;
}

.provider-select-trigger {
  width: min(152px, 16vw);
  height: 36px;
  font-size: 12px;
}

.provider-select-menu {
  min-width: 210px;
}

.composer-select-trigger {
  height: 29px;
  border-color: transparent;
  border-radius: 9px;
  font-size: 11px;
}

.field-select-trigger {
  width: 100%;
  height: 38px;
  font-size: 12px;
}

`;
