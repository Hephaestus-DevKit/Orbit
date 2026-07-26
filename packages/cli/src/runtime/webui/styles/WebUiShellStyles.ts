/** Application shell, navigation, and workspace header styles. */
export const WEB_UI_SHELL_STYLES = String.raw`
.app-shell {
  height: 100vh;
  height: 100dvh;
  display: grid;
  grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
  gap: 10px;
  padding: 10px 10px 10px 0;
  background:
    radial-gradient(circle at 6% 2%, var(--accent-glow), transparent 26%),
    linear-gradient(135deg, color-mix(in srgb, var(--canvas-deep) 92%, white), var(--canvas-deep)),
    var(--canvas-deep);
  transition: grid-template-columns 210ms cubic-bezier(0.2, 0.75, 0.3, 1), gap 210ms ease, padding 210ms ease;
}

.sidebar {
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  color: var(--sidebar-ink);
  background: transparent;
  border-right: 0;
  z-index: 30;
  transition: opacity 150ms ease, transform 210ms cubic-bezier(0.2, 0.75, 0.3, 1);
}

.sidebar-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 25;
  border: 0;
  background: rgba(15, 14, 12, 0.36);
  backdrop-filter: blur(2px);
}

.brand-row {
  height: 46px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 6px;
}

.orbit-mark {
  display: block;
  flex: 0 0 auto;
  color: var(--accent);
  overflow: visible;
}

.brand-mark {
  width: 32px;
  height: 32px;
  padding: 3px;
  color: var(--accent-strong);
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}

.orbit-cat-head,
.orbit-cat-face {
  vector-effect: non-scaling-stroke;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.orbit-cat-head {
  fill: none;
  stroke-width: 1.9;
}

.orbit-cat-face {
  stroke-width: 1.45;
}

.orbit-cat-eye {
  fill: currentColor;
}

.orbit-cat-satellite {
  fill: var(--brand-coral);
  filter: none;
}

.brand-name {
  color: var(--sidebar-ink);
  font-size: 17px;
  font-weight: 680;
  letter-spacing: -0.025em;
  white-space: nowrap;
}

.brand-version {
  margin-left: auto;
  padding: 3px 5px;
  color: var(--sidebar-faint);
  background: var(--sidebar-surface);
  border: 1px solid var(--sidebar-border);
  border-radius: 5px;
  font-family: var(--font-mono);
  font-size: 9px;
}

.sidebar-collapse-button {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  padding: 0;
  color: var(--sidebar-faint);
  background: transparent;
  border: 0;
  border-radius: 8px;
}

.sidebar-collapse-button:hover {
  color: var(--sidebar-ink);
  background: var(--sidebar-surface);
}

.sidebar-collapse-button .ui-icon {
  width: 15px;
  height: 15px;
}

.new-task-button {
  height: 44px;
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 0 12px;
  color: var(--sidebar-ink);
  background: color-mix(in srgb, var(--sidebar-active) 86%, var(--accent-soft));
  border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--sidebar-border));
  border-radius: 12px;
  box-shadow: var(--shadow-sm);
  font-weight: 620;
  text-align: left;
  transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
}

.new-task-button:hover {
  background: var(--sidebar-active);
  border-color: color-mix(in srgb, var(--accent) 34%, var(--sidebar-border));
  box-shadow: 0 8px 22px rgba(35, 61, 57, 0.07);
  transform: translateY(-1px);
}

.new-task-button kbd {
  margin-left: auto;
  padding: 2px 5px;
  color: var(--sidebar-faint);
  background: color-mix(in srgb, var(--sidebar-surface) 74%, var(--canvas));
  border: 1px solid var(--sidebar-border);
  border-radius: 5px;
  font: 9px/1.3 var(--font-mono);
}

.new-task-icon {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  color: var(--surface-raised);
  background: var(--accent-strong);
  border-radius: 6px;
}

.new-task-icon .ui-icon {
  width: 14px;
  height: 14px;
}

.nav-section-heading {
  height: 25px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 10px 2px;
  color: var(--sidebar-faint);
  font: 700 9.5px/1 var(--font-mono);
  letter-spacing: 0.11em;
  text-transform: uppercase;
}

.nav-section-heading i {
  height: 1px;
  flex: 1;
  background: var(--sidebar-border);
}

.project-heading {
  padding-right: 3px;
}

.new-project-button {
  width: 23px;
  height: 23px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  padding: 0;
  color: var(--sidebar-faint);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 7px;
}

.new-project-button:hover,
.new-project-button:focus-visible {
  color: var(--sidebar-ink);
  background: var(--sidebar-surface);
  border-color: var(--sidebar-border);
}

.new-project-button .ui-icon {
  width: 14px;
  height: 14px;
}

.primary-nav {
  min-width: 0;
  display: grid;
  gap: 4px;
  padding: 0 2px;
}

.nav-button {
  min-width: 0;
  width: 100%;
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  color: var(--sidebar-muted);
  background: transparent;
  border: 0;
  border-radius: 10px;
  font-size: 13px;
  text-align: left;
  transition: color 140ms ease, background 140ms ease;
}

.nav-button span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-button:hover,
.nav-button.is-active {
  color: var(--sidebar-ink);
  background: var(--sidebar-active);
}

.nav-button.is-active {
  position: relative;
  font-weight: 620;
  border: 1px solid var(--sidebar-border);
  box-shadow: var(--shadow-sm);
}

.nav-button.is-active::after {
  content: "";
  position: absolute;
  left: -1px;
  width: 2px;
  height: 15px;
  background: var(--accent);
  border-radius: 0 2px 2px 0;
  box-shadow: none;
}

.project-section {
  min-width: 0;
  display: grid;
  overflow: hidden;
  background: color-mix(in srgb, var(--sidebar-surface) 44%, transparent);
  border: 1px solid var(--sidebar-border);
  border-radius: 12px;
}

.recent-projects-shell {
  min-width: 0;
  display: grid;
  gap: 3px;
  margin: 12px 4px 0;
  padding-top: 10px;
  border-top: 1px solid var(--sidebar-border);
}

.recent-projects-shell[hidden] {
  display: none;
}

.project-list-label {
  padding: 0 6px 3px;
  color: var(--sidebar-faint);
  font: 650 9.5px/1.4 var(--font-mono);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.project-list {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.registered-project {
  position: relative;
  min-width: 0;
  width: 100%;
  min-height: 52px;
  display: block;
  padding: 0;
  color: var(--sidebar-muted);
  background: color-mix(in srgb, var(--sidebar-surface) 44%, transparent);
  border: 1px solid var(--sidebar-border);
  border-radius: 12px;
  text-align: left;
  transition: color 140ms ease, background 140ms ease, border-color 140ms ease;
}

.registered-project:focus-within,
.registered-project:hover {
  color: var(--sidebar-ink);
  background: color-mix(in srgb, var(--sidebar-active) 72%, var(--sidebar-surface));
  border-color: color-mix(in srgb, var(--accent) 24%, var(--sidebar-border));
}

.registered-project:focus-within {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 34%, transparent);
}

.registered-project-open {
  min-width: 0;
  width: 100%;
  min-height: 52px;
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  padding: 7px 38px 7px 9px;
  color: inherit;
  background: transparent;
  border: 0;
  border-radius: inherit;
  text-align: left;
}

.registered-project-open:focus-visible {
  outline: none;
}

.registered-project-open.is-switching {
  cursor: progress;
  opacity: 0.58;
}

.registered-project-icon.project-folder-icon { width: 30px; height: 30px; }
.registered-project-icon .ui-icon { width: 16px; height: 16px; }

.registered-project-remove {
  position: absolute;
  top: 50%;
  right: 8px;
  width: 23px;
  height: 23px;
  display: grid;
  place-items: center;
  color: var(--sidebar-faint);
  background: transparent;
  border: 0;
  border-radius: 6px;
  opacity: 0;
  transform: translateY(-50%);
  transition: opacity 120ms ease, color 120ms ease, background 120ms ease;
}

.registered-project:focus-within .registered-project-remove,
.registered-project:hover .registered-project-remove,
.registered-project-remove[data-confirm-remove="true"] { opacity: 1; }

.registered-project-remove:hover,
.registered-project-remove[data-confirm-remove="true"] {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 9%, transparent);
}

.registered-project-remove:focus-visible {
  outline: none;
  opacity: 1;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 48%, transparent);
}

.project-toggle {
  min-width: 0;
  width: 100%;
  min-height: 48px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 9px;
  padding: 7px 9px;
  color: var(--sidebar-ink);
  background: transparent;
  border: 0;
  text-align: left;
  transition: background 140ms ease;
}

.project-toggle:hover {
  background: color-mix(in srgb, var(--sidebar-active) 76%, transparent);
}

.project-folder-icon {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  color: var(--accent-strong);
  background: color-mix(in srgb, var(--accent-soft) 62%, var(--sidebar-surface));
  border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--sidebar-border));
  border-radius: 8px;
}

.project-folder-icon .ui-icon {
  width: 16px;
  height: 16px;
}

.project-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.project-copy strong,
.project-copy small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-copy strong {
  font-size: 12.5px;
  font-weight: 650;
}

.project-copy small {
  color: var(--sidebar-faint);
  font: 10.5px/1.35 var(--font-mono);
}

.project-chat-count {
  min-width: 20px;
  height: 19px;
  display: grid;
  place-items: center;
  padding: 0 5px;
  color: var(--sidebar-faint);
  background: var(--sidebar-surface);
  border: 1px solid var(--sidebar-border);
  border-radius: 7px;
  font: 600 9px/1 var(--font-mono);
}

.project-toggle-chevron {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  color: var(--sidebar-faint);
  transition: transform 150ms ease;
}

.project-toggle-chevron .ui-icon {
  width: 13px;
  height: 13px;
}

.project-toggle[aria-expanded="false"] .project-toggle-chevron {
  transform: rotate(-90deg);
}

.project-chat-body {
  min-width: 0;
  padding: 0 5px 5px;
  border-top: 1px solid color-mix(in srgb, var(--sidebar-border) 70%, transparent);
}

.project-chat-body[hidden] {
  display: none;
}

.recent-section {
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, auto) auto auto auto;
  margin-top: 2px;
}

.session-search {
  min-width: 0;
  height: 30px;
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 2px 3px 3px;
  padding: 0 9px;
  color: var(--sidebar-faint);
  background: color-mix(in srgb, var(--sidebar-surface) 75%, transparent);
  border: 1px solid var(--sidebar-border);
  border-radius: 8px;
}

.session-search[hidden] {
  display: none;
}

.session-search .ui-icon {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
}

.session-search input {
  min-width: 0;
  width: 100%;
  padding: 0;
  color: var(--sidebar-ink);
  background: transparent;
  border: 0;
  outline: 0;
  font: 500 12px/1 var(--font-sans);
}

.session-search input::placeholder {
  color: var(--sidebar-faint);
}

.session-search:focus-within {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--sidebar-border));
}

.session-show-more {
  justify-self: center;
  margin: 3px 0 1px;
  padding: 4px 9px;
  color: var(--sidebar-muted);
  background: transparent;
  border: 0;
  border-radius: 7px;
  font: 600 11px/1.2 var(--font-sans);
}

.session-show-more:hover {
  color: var(--sidebar-ink);
  background: var(--sidebar-surface);
}

.session-show-more[hidden] {
  display: none;
}

.recent-section[hidden] {
  display: none;
}

.session-section-heading {
  padding-right: 2px;
}

.archive-toggle {
  min-width: 30px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 0 5px;
  color: var(--sidebar-faint);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 7px;
  font: 600 10px/1 var(--font-mono);
}

.archive-toggle:hover,
.archive-toggle[aria-expanded="true"] {
  color: var(--sidebar-ink);
  background: var(--sidebar-surface);
  border-color: var(--sidebar-border);
}

.archive-toggle b {
  min-width: 8px;
  font: inherit;
}

.archive-toggle .ui-icon {
  width: 13px;
  height: 13px;
}

.archive-toggle:not(.has-items) b {
  color: var(--sidebar-faint);
}

.recent-sessions,
.archived-sessions {
  min-height: 0;
  max-height: min(230px, 27vh);
  display: grid;
  gap: 2px;
  overflow-y: auto;
  padding: 2px;
  scrollbar-width: thin;
  scrollbar-color: var(--sidebar-border) transparent;
}

.recent-sessions::-webkit-scrollbar,
.archived-sessions::-webkit-scrollbar {
  width: 6px;
}

.recent-sessions::-webkit-scrollbar-thumb,
.archived-sessions::-webkit-scrollbar-thumb {
  background: transparent;
  border-radius: 6px;
}

.recent-sessions:hover::-webkit-scrollbar-thumb,
.archived-sessions:hover::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--sidebar-faint) 35%, transparent);
}

.session-row {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  border: 1px solid transparent;
  border-radius: 9px;
  transition: background 140ms ease, border-color 140ms ease;
}

.session-row:hover,
.session-row:focus-within {
  background: color-mix(in srgb, var(--sidebar-surface) 78%, transparent);
  border-color: var(--sidebar-border);
}

.session-row.is-active {
  background: color-mix(in srgb, var(--accent-soft) 54%, var(--sidebar-surface));
  border-color: color-mix(in srgb, var(--accent) 20%, var(--sidebar-border));
}

.session-row.is-active .recent-session {
  color: var(--sidebar-ink);
  cursor: default;
}

.session-row.is-active .recent-session::before {
  width: 6px;
  height: 6px;
  background: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 13%, transparent);
}

.recent-session {
  position: relative;
  min-width: 0;
  display: grid;
  gap: 4px;
  padding: 8px 4px 7px 30px;
  color: var(--sidebar-muted);
  background: transparent;
  border: 0;
  border-radius: 9px;
  text-align: left;
  transition: color 140ms ease, background 140ms ease, border-color 140ms ease;
}

.recent-session::before {
  content: "";
  position: absolute;
  width: 5px;
  height: 5px;
  margin: 6px 0 0 -18px;
  background: var(--sidebar-faint);
  border-radius: 50%;
}

.recent-session:hover {
  color: var(--sidebar-ink);
}

.session-actions {
  display: flex;
  align-items: center;
  gap: 1px;
  padding-right: 4px;
  opacity: 0;
  transition: opacity 120ms ease;
}

.session-row:hover .session-actions,
.session-row:focus-within .session-actions {
  opacity: 1;
}

.session-action {
  width: 25px;
  height: 25px;
  display: grid;
  place-items: center;
  padding: 0;
  color: var(--sidebar-faint);
  background: transparent;
  border: 0;
  border-radius: 7px;
}

.session-action .ui-icon {
  width: 14px;
  height: 14px;
  stroke-width: 1.7;
}

.session-action:hover {
  color: var(--sidebar-ink);
  background: var(--sidebar-active);
}

.session-action.is-danger:hover {
  color: var(--danger);
  background: var(--danger-soft);
}

.session-row.is-archived .recent-session {
  cursor: default;
  opacity: 0.72;
}

.archived-panel {
  min-height: 0;
  display: grid;
  gap: 4px;
  margin: 5px 2px 0;
  padding-top: 7px;
  border-top: 1px solid var(--sidebar-border);
}

.archived-panel[hidden] {
  display: none;
}

.archived-panel-title {
  padding: 0 8px 2px;
  color: var(--sidebar-faint);
  font: 700 9px/1.2 var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.archived-sessions {
  max-height: min(150px, 18vh);
}

.session-list-empty {
  margin: 0;
  padding: 9px 11px;
  color: var(--sidebar-faint);
  font-size: 10px;
}

.session-list-empty[hidden] {
  display: none;
}

.recent-session-title,
.recent-session-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-session-title {
  color: inherit;
  font-size: 12px;
  font-weight: 590;
}

.recent-session-meta {
  color: var(--sidebar-faint);
  font: 9px/1.35 var(--font-mono);
}

.recent-session:disabled,
.new-task-button:disabled {
  cursor: wait;
  opacity: 0.55;
}

.ui-icon {
  width: 17px;
  height: 17px;
  flex: 0 0 auto;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.sidebar-spacer {
  min-height: 16px;
  flex: 1 1 auto;
}

.workspace-view {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: 62px auto minmax(0, 1fr);
  overflow: hidden;
  background: var(--canvas);
  border: 1px solid color-mix(in srgb, var(--border-strong) 82%, transparent);
  border-radius: 20px;
  box-shadow: 0 22px 62px rgba(25, 43, 39, 0.09), 0 2px 8px rgba(25, 43, 39, 0.04);
}

.topbar {
  grid-row: 1;
  min-width: 0;
  height: 62px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 clamp(16px, 2vw, 28px);
  border-bottom: 1px solid color-mix(in srgb, var(--border-strong) 72%, transparent);
  background: color-mix(in srgb, var(--surface-glass) 96%, var(--canvas));
  backdrop-filter: blur(22px) saturate(130%);
  z-index: 15;
}

.topbar-start,
.topbar-actions {
  min-width: 0;
  display: flex;
  align-items: center;
}

.topbar-start {
  gap: 10px;
}

.topbar-actions {
  gap: 8px;
}

.context-meter {
  --context-pct: 0%;
  height: 34px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 9px;
  color: var(--muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 9px;
}

.context-meter:hover {
  color: var(--ink-strong);
  background: color-mix(in srgb, var(--surface-raised) 64%, transparent);
  border-color: var(--border);
}

.context-ring {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  background: conic-gradient(var(--accent) var(--context-pct), var(--surface-hover) 0);
  border-radius: 50%;
}

.context-ring i {
  width: 12px;
  height: 12px;
  background: var(--surface-glass);
  border-radius: 50%;
}

.context-meter.is-warm .context-ring {
  background: conic-gradient(var(--warning) var(--context-pct), var(--surface-hover) 0);
}

.context-meter.is-hot .context-ring {
  background: conic-gradient(var(--danger) var(--context-pct), var(--surface-hover) 0);
}

.context-meter-copy {
  display: grid;
  line-height: 1.05;
  text-align: left;
}

.context-meter-copy small {
  color: var(--faint);
  font-size: 8.5px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.context-meter-copy strong {
  color: inherit;
  font: 600 10px/1.2 var(--font-mono);
}

.workspace-heading {
  min-width: 0;
  display: grid;
  line-height: 1.22;
}

.workspace-heading strong,
.workspace-heading span {
  max-width: min(32vw, 430px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-heading strong {
  color: var(--ink-strong);
  font-size: 14.5px;
  font-weight: 700;
}

.workspace-heading span {
  color: var(--faint);
  font: 10px/1.3 var(--font-mono);
}

.icon-button,
.details-button,
.text-button,
.secondary-button {
  border: 0;
}

.icon-button {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  padding: 0;
  color: var(--muted);
  background: transparent;
  border-radius: 9px;
  font-size: 19px;
}

.icon-button:hover {
  color: var(--ink-strong);
  background: var(--surface-hover);
}

.mobile-menu {
  display: none;
}

.mobile-menu .ui-icon,
.details-button .ui-icon {
  width: 16px;
  height: 16px;
}

.model-control {
  position: relative;
  display: block;
}

.connection-state {
  height: 34px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 9px;
  color: var(--faint);
  background: color-mix(in srgb, var(--surface-raised) 58%, transparent);
  border: 1px solid var(--border);
  border-radius: 9px;
  font-size: 11px;
  white-space: nowrap;
}

.connection-state:hover {
  color: var(--ink);
  background: var(--surface-hover);
}

.connection-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--warning);
  box-shadow: 0 0 0 3px var(--warning-soft);
}

.connection-state.is-connected .connection-dot {
  background: var(--success);
  box-shadow: 0 0 0 3px var(--success-soft);
}

.connection-state.is-disconnected .connection-dot {
  background: var(--danger);
  box-shadow: 0 0 0 3px var(--danger-soft);
}

.details-button {
  height: 36px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  color: var(--muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 10px;
  font-size: 12px;
}

.details-button:hover,
.details-button[aria-expanded="true"] {
  color: var(--ink-strong);
  background: var(--surface-hover);
  border-color: var(--border);
}

.workspace-view > .connection-help {
  grid-row: 2;
}

.workspace-view > .conversation {
  grid-row: 3;
}

`;
