/** Shared nonmodal task surfaces. Only settings and explicit confirmations use a scrim. */
export const WEB_UI_WORKBENCH_STYLES = String.raw`
.workspace-view.is-preview-open { grid-template-columns: minmax(420px, 1fr) minmax(0, var(--preview-width, 54%)); }
.workspace-view.is-preview-open > .topbar, .workspace-view.is-preview-open > .connection-help { grid-column: 1 / -1; }
.workspace-view.is-preview-open > .conversation { grid-column: 1; container-type: inline-size; container-name: preview-chat; }
.workspace-view.is-preview-focus { grid-template-columns: minmax(0, 1fr); }
.workspace-view.is-preview-focus > .conversation { display: none; }
.workbench { position: relative; grid-column: 2; grid-row: 3; display: flex; flex-direction: column; min-width: 0; min-height: 0; margin: 0 0 0 6px; border-left: 1px solid var(--border-strong); background: var(--surface); }
.workbench[hidden], .workbench [hidden] { display: none; }
.workspace-view.is-preview-open > .topbar .workspace-tools { display: none; }
.workspace-view.is-preview-focus > .workbench { grid-column: 1; margin-left: 0; border-left: 0; }
.workbench-header { display: flex; align-items: center; gap: 6px; padding: 0 12px; min-height: 44px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.workbench-tabs { display: flex; align-items: center; gap: 22px; flex: 1; min-width: 0; }
.workbench-header .icon-button { width: 28px; height: 28px; min-height: 28px; }
.workbench-header .workbench-focus-button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; width: auto; min-width: 64px; padding: 0 7px; color: var(--muted); font-size: 11px; white-space: nowrap; }
.workbench-header .workbench-focus-button[hidden] { display: none; }
.workbench-header .workbench-focus-button[aria-pressed="true"] { color: var(--accent-strong); background: var(--accent-soft); }
.workbench-header .workbench-focus-button .ui-icon { width: 14px; height: 14px; }
.workbench-header .workbench-hide-button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; color: var(--muted); }
.workbench-hide-back, .workbench-hide-label { display: none; }
.workbench-hide-close { display: inline-flex; }
.workspace-view.is-preview-focus .workbench-header .workbench-hide-button { width: auto; min-width: 96px; padding: 0 8px; font-size: 11px; white-space: nowrap; }
.workspace-view.is-preview-focus .workbench-hide-close { display: none; }
.workspace-view.is-preview-focus .workbench-hide-back, .workspace-view.is-preview-focus .workbench-hide-label { display: inline-flex; }
.workbench-hide-back .ui-icon { width: 14px; height: 14px; }
.workbench-run { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0; flex: 1; }
.workbench-run > .inspector-tabs { padding-inline: 20px; gap: 20px; }
.workbench-run > .inspector-tabs .inspector-tab { height: 38px; font-size: 12px; }
.workbench > .inspector-content { flex: 1; }
.workbench .inspector-content { padding-inline: 20px; padding-top: 12px; }
.workbench .task-overview-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.workspace-view.is-preview-open:not(.is-preview-focus) .empty-state { width: calc(100% - 40px); max-width: none; padding-top: 20px; }
.workspace-view.is-preview-open:not(.is-preview-focus) .empty-state .eyebrow { display: none; }
.workspace-view.is-preview-open:not(.is-preview-focus) .empty-state h1 { font-size: 20px; letter-spacing: -0.025em; line-height: 1.25; }
.workspace-view.is-preview-open:not(.is-preview-focus) .empty-description { margin-top: 4px; font-size: 12px; line-height: 1.45; }
.workspace-view.is-preview-open:not(.is-preview-focus) .empty-composer-slot { margin-top: 14px; }
.workspace-view.is-preview-open:not(.is-preview-focus) .suggestion-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 8px; margin-top: 10px; }
.workspace-view.is-preview-open:not(.is-preview-focus) .suggestion-card { min-height: 34px; gap: 6px; padding: 5px 7px; border-color: transparent; border-radius: 8px; box-shadow: none; background: transparent; }
.workspace-view.is-preview-open:not(.is-preview-focus) .suggestion-card:hover { transform: none; box-shadow: none; background: var(--surface-raised); border-color: var(--border); }
.workspace-view.is-preview-open:not(.is-preview-focus) .suggestion-icon { width: 20px; height: 20px; border: 0; border-radius: 6px; background: transparent; }
.workspace-view.is-preview-open:not(.is-preview-focus) .suggestion-icon .ui-icon { width: 15px; height: 15px; }
.workspace-view.is-preview-open:not(.is-preview-focus) .suggestion-copy strong { font-size: 12px; }
.workspace-view.is-preview-open:not(.is-preview-focus) .suggestion-copy small { display: none; }
.workspace-view.is-preview-open:not(.is-preview-focus) .composer-dock { width: 100%; padding-left: 12px; padding-right: 12px; }
.workspace-view.is-preview-open:not(.is-preview-focus) .message-column { width: calc(100% - 32px); }
@container preview-chat (max-width: 540px) {
  .composer-models { flex-wrap: wrap; }
  .composer-tools { flex-wrap: wrap; gap: 3px; }
  .composer-chip { padding-inline: 6px; gap: 4px; }
  .composer-toolbar { align-items: flex-end; }
  .composer-hint { text-wrap: balance; }
}
`;
