/** Prompt composer, run state, and conversation navigation controls. */
export const WEB_UI_COMPOSER_STYLES = String.raw`
.composer-dock {
  position: relative;
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  width: min(var(--composer-width), calc(100% - 32px));
  margin: 0 auto;
  padding: 0 16px calc(12px + env(safe-area-inset-bottom));
  z-index: 10;
}

.composer-anchor {
  display: contents;
}

.empty-composer-slot {
  width: 100%;
  margin-top: 24px;
}

.empty-composer-slot .composer-dock {
  width: 100%;
  padding: 0;
}

.empty-composer-slot .composer {
  border-radius: 18px;
  box-shadow: var(--shadow-md);
}

.empty-composer-slot .composer-dock::before {
  display: none;
}

.empty-composer-slot .turn-status {
  justify-content: flex-start;
}

.composer-dock::before {
  content: "";
  position: absolute;
  z-index: -1;
  left: 0;
  right: 0;
  bottom: 0;
  height: 148px;
  background: linear-gradient(to bottom, transparent, var(--canvas) 38%);
  pointer-events: none;
}

.turn-status {
  min-height: 23px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 16px;
  color: var(--muted);
  font-size: 11px;
}

.turn-status:empty {
  display: none;
}

.turn-status.is-working::before {
  content: "";
  width: 7px;
  height: 7px;
  border: 2px solid color-mix(in srgb, var(--accent) 28%, transparent);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 720ms linear infinite;
}

.composer {
  position: relative;
  padding: 14px 14px 10px;
  background: color-mix(in srgb, var(--surface-raised) 97%, transparent);
  border: 1px solid var(--border-strong);
  border-radius: 17px;
  box-shadow: 0 8px 28px rgba(21, 45, 38, 0.09), 0 1px 3px rgba(21, 45, 38, 0.08);
  backdrop-filter: blur(18px) saturate(118%);
  transition: border-color 160ms ease, background 160ms ease, box-shadow 160ms ease, transform 160ms ease;
}

.composer:focus-within {
  border-color: color-mix(in srgb, var(--accent) 58%, var(--border));
  background: var(--surface-raised);
  box-shadow: 0 16px 42px rgba(21, 45, 38, 0.13), 0 0 0 3px color-mix(in srgb, var(--accent) 11%, transparent);
}

.slash-command-menu {
  position: absolute;
  z-index: 24;
  left: 10px;
  right: 10px;
  bottom: calc(100% + 8px);
  overflow: hidden;
  color: var(--ink);
  background: var(--surface-raised);
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  box-shadow: var(--shadow-md);
}

/* The landing composer has ample space below; opening downward keeps the
   command heading visible instead of letting the application topbar clip it. */
.empty-composer-slot .slash-command-menu {
  top: calc(100% + 8px);
  bottom: auto;
}

.empty-composer-slot .slash-command-results {
  max-height: min(230px, 32vh);
}

.slash-command-heading,
.slash-command-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0;
  color: var(--faint);
  font-size: 10px;
}

.slash-command-heading {
  padding: 9px 11px 7px;
  border-bottom: 1px solid var(--border);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.slash-command-heading span {
  font-family: var(--font-mono);
  font-size: 13px;
}

.slash-command-results {
  max-height: min(318px, 46vh);
  overflow-y: auto;
  padding: 5px;
}

.slash-command-option {
  width: 100%;
  min-height: 45px;
  display: grid;
  grid-template-columns: minmax(145px, 0.38fr) minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 6px 9px;
  color: var(--ink);
  background: transparent;
  border: 0;
  border-radius: 9px;
  text-align: left;
}

.slash-command-option[aria-selected="true"],
.slash-command-option:hover {
  background: var(--accent-soft);
}

.slash-command-invocation {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-family: var(--font-mono);
  white-space: nowrap;
}

.slash-command-invocation strong {
  color: var(--accent-strong);
  font-size: 12px;
}

.slash-command-invocation small,
.slash-command-description {
  overflow: hidden;
  color: var(--muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.slash-command-empty {
  margin: 0;
  padding: 18px 12px;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
}

.slash-command-hint {
  justify-content: flex-start;
  padding: 7px 11px 8px;
  border-top: 1px solid var(--border);
}

#prompt {
  display: block;
  width: 100%;
  min-height: 34px;
  max-height: 210px;
  resize: none;
  overflow-y: auto;
  padding: 3px 4px 10px;
  color: var(--ink-strong);
  background: transparent;
  border: 0;
  outline: 0;
  font-size: 15px;
  line-height: 1.55;
}

@media (max-width: 620px) {
  .slash-command-option {
    grid-template-columns: 1fr;
    gap: 2px;
  }
}

.empty-composer-slot #prompt {
  min-height: clamp(46px, 5vh, 58px);
  font-size: 15px;
}

#prompt::placeholder {
  color: color-mix(in srgb, var(--muted) 72%, transparent);
}

.composer-toolbar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  padding-top: 2px;
}

.composer-tools {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  overflow-x: auto;
  scrollbar-width: none;
}

.composer-tools::-webkit-scrollbar {
  display: none;
}

@media (max-width: 420px) {
  .composer-chip {
    gap: 4px;
    padding-inline: 7px;
  }

  .composer-chip > span:not(.context-chip-count):not(.web-status-dot) {
    display: none;
  }

  .composer-select-trigger {
    gap: 4px;
    padding-inline: 7px;
  }
}

.composer-chip,
.composer-select-trigger {
  height: 29px;
  flex: 0 0 auto;
  color: var(--muted);
  background: color-mix(in srgb, var(--surface-subtle) 38%, transparent);
  border: 1px solid transparent;
  border-radius: 9px;
  font-size: 11px;
}

.composer-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 9px;
}

.composer-chip .ui-icon {
  width: 14px;
  height: 14px;
}

.web-status-dot {
  width: 6px;
  height: 6px;
  background: var(--faint);
  border-radius: 50%;
}

.composer-chip[aria-pressed="true"] .web-status-dot {
  background: var(--accent-strong);
  box-shadow: 0 0 0 3px var(--accent-glow);
}

.composer-chip:hover,
.composer-chip[aria-pressed="true"],
.composer-select-trigger:hover,
.composer-select-control.is-open .composer-select-trigger {
  color: var(--ink-strong);
  background: var(--surface-subtle);
  border-color: var(--border);
}

.composer-chip[aria-pressed="true"] {
  color: var(--accent-strong);
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 20%, var(--border));
}

.composer-select-control {
  flex: 0 0 auto;
}

.composer-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.queue-button {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  padding: 0;
  color: var(--accent-strong);
  background: var(--accent-soft);
  border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--border));
  border-radius: 11px;
  font-size: 18px;
}

.queue-button:hover {
  background: color-mix(in srgb, var(--accent-soft) 78%, var(--accent));
}
.queue-button:disabled { opacity: 0.42; cursor: not-allowed; }

.prompt-queue {
  display: grid;
  gap: 6px;
  margin: 0 13px 8px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-subtle);
}

.prompt-queue[hidden] { display: none; }

.prompt-queue-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--muted);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.prompt-queue-header button {
  padding: 0;
  color: var(--muted);
  background: transparent;
  border: 0;
  font-size: 9px;
  text-transform: none;
  letter-spacing: 0;
}

.prompt-queue-list {
  display: grid;
  gap: 4px;
  max-height: 168px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.prompt-queue-row {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  padding: 3px 4px;
  color: var(--ink);
  background: var(--surface-raised);
  border-radius: 7px;
  font-size: 10px;
}

.prompt-queue-number { color: var(--faint); text-align: center; }
.prompt-queue-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.prompt-queue-actions {
  display: flex;
  align-items: center;
  gap: 1px;
}

.prompt-queue-actions button {
  width: 22px;
  height: 22px;
  padding: 0;
  color: var(--muted);
  background: transparent;
  border: 0;
  border-radius: 5px;
  font-size: 12px;
}

.prompt-queue-actions button:hover:not(:disabled),
.prompt-queue-actions button:focus-visible {
  color: var(--ink);
  background: var(--surface-hover);
}

.prompt-queue-actions button:disabled { opacity: 0.28; cursor: not-allowed; }
.prompt-queue-actions button:last-child:hover:not(:disabled) { color: var(--danger); }

.prompt-queue-row.is-editing {
  align-items: start;
  padding-block: 6px;
}

.prompt-queue-editor {
  width: 100%;
  min-height: 48px;
  max-height: 112px;
  resize: vertical;
  padding: 7px 8px;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--accent);
  border-radius: 7px;
  font: inherit;
  line-height: 1.45;
}

.prompt-queue-edit-actions {
  display: grid;
  gap: 4px;
}

.prompt-queue-edit-actions button {
  min-height: 22px;
  padding: 2px 7px;
  color: var(--muted);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 9px;
  white-space: nowrap;
}

.prompt-queue-edit-actions button:first-child {
  color: var(--accent-strong);
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
}

.attachment-shelf {
  margin: 0 13px 8px;
}

.attachment-shelf[hidden] { display: none; }

.attachment-list {
  display: flex;
  gap: 7px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.attachment-card {
  position: relative;
  width: 126px;
  min-width: 126px;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 20px;
  align-items: center;
  gap: 6px;
  padding: 5px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 9px;
}

.attachment-card img {
  width: 34px;
  height: 34px;
  object-fit: cover;
  border-radius: 6px;
}

.attachment-card > span { display: grid; min-width: 0; gap: 2px; }
.attachment-card strong,
.attachment-card small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.attachment-card strong { color: var(--ink); font-size: 9px; }
.attachment-card small { color: var(--muted); font-size: 8px; }
.attachment-card button { padding: 0; color: var(--muted); background: transparent; border: 0; }

.composer.is-dragging {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent-soft) 55%, var(--surface-raised));
}

.send-button {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  padding: 0;
  color: var(--surface);
  background: var(--accent-strong);
  border: 0;
  border-radius: 11px;
  font-size: 17px;
  box-shadow: var(--shadow-sm);
  transition: background 140ms ease, transform 140ms ease;
}

.send-button:hover {
  background: color-mix(in srgb, var(--accent-strong) 82%, var(--ink-strong));
  transform: translateY(-1px);
}

.send-button:disabled {
  color: var(--faint);
  background: var(--surface-subtle);
  box-shadow: none;
  cursor: not-allowed;
  transform: none;
}

.send-button.is-stop {
  color: var(--danger);
  background: var(--danger-soft);
  border: 1px solid color-mix(in srgb, var(--danger) 24%, transparent);
  font-size: 11px;
}

.composer-hint {
  margin: 7px 4px 0 0;
  color: color-mix(in srgb, var(--muted) 84%, transparent);
  font-size: 10px;
  text-align: right;
}

.empty-composer-slot .composer-hint {
  text-align: right;
}

.app-shell.is-disconnected .composer {
  border-color: color-mix(in srgb, var(--danger) 22%, var(--border));
  box-shadow: var(--shadow-sm);
}

.jump-bottom {
  position: absolute;
  left: 50%;
  bottom: 132px;
  z-index: 12;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  padding: 0;
  color: var(--muted);
  background: var(--surface-raised);
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  box-shadow: var(--shadow-md);
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 8px);
  transition: opacity 140ms ease, transform 140ms ease;
}

.jump-bottom.is-visible {
  opacity: 1;
  pointer-events: auto;
  transform: translate(-50%, 0);
}

.jump-bottom .ui-icon {
  width: 15px;
  height: 15px;
}

.jump-earlier {
  position: absolute;
  top: 14px;
  left: 50%;
  z-index: 12;
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 11px;
  color: var(--muted);
  background: color-mix(in srgb, var(--surface-raised) 88%, transparent);
  -webkit-backdrop-filter: blur(10px) saturate(1.4);
  backdrop-filter: blur(10px) saturate(1.4);
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  box-shadow: var(--shadow-md, var(--shadow-sm));
  font-size: 11px;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, -8px);
  transition:
    opacity 140ms ease,
    transform 140ms ease,
    color 140ms ease,
    border-color 140ms ease;
}

.jump-earlier.is-visible {
  opacity: 1;
  pointer-events: auto;
  transform: translate(-50%, 0);
}

.jump-earlier:hover {
  color: var(--ink);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border-strong));
}

.jump-earlier .ui-icon {
  width: 14px;
  height: 14px;
}

`;
