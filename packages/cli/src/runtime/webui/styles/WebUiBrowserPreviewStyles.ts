/** A contained desktop workbench: chat and a resizable project-preview dock. */
export const WEB_UI_BROWSER_PREVIEW_STYLES = String.raw`
.browser-preview-divider { position: absolute; top: 0; bottom: 0; left: -7px; width: 12px; z-index: 3; cursor: col-resize; touch-action: none; }
.browser-preview-divider::after { content: ''; position: absolute; top: 44%; height: 42px; width: 3px; left: 4px; border-radius: 4px; background: var(--border-strong); transition: background .15s; }
.browser-preview-divider:hover::after, .browser-preview-divider:focus-visible::after, .is-preview-resizing .browser-preview-divider::after { background: var(--accent); }
.is-preview-resizing { cursor: col-resize; user-select: none; }
.workspace-view.is-preview-focus .browser-preview-divider { display: none; }
.safari-workspace { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; color: var(--ink); }
.browser-navigation { display: flex; flex: none; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--surface); }
.browser-launch { display: flex; flex-wrap: wrap; align-items: center; gap: 3px 10px; padding: 6px 12px; border-bottom: 1px solid var(--border); }
.browser-launch .secondary-button { font-size: 12px; }
.browser-launch small { color: var(--muted); font-size: 12px; line-height: 1.4; }
.browser-history, .browser-address, .browser-footer div { display: flex; align-items: center; }
.browser-history { gap: 2px; }
.browser-tool, .browser-address button, .browser-footer button { display: inline-flex; justify-content: center; align-items: center; gap: 5px; min-height: 32px; border: 0; border-radius: 6px; background: transparent; font: inherit; color: var(--muted); cursor: pointer; }
.browser-tool { width: 32px; padding: 0; }
.browser-tool:disabled { opacity: .35; cursor: default; }
.browser-tool:enabled:hover, .browser-footer button:hover { background: var(--surface-raised); color: var(--ink); }
.browser-address { min-width: 0; flex: 1; gap: 2px; border: 1px solid var(--border-strong); border-radius: 9px; background: var(--surface-raised); }
.browser-address:focus-within { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.browser-address input { flex: 1; min-width: 0; height: 34px; background: transparent; border: 0; padding: 0 9px; font: inherit; font-size: 13px; color: var(--ink); outline: none; }
.browser-address button { padding: 0 9px; color: var(--accent-strong); font-size: 12px; font-weight: 600; }
.browser-address button:hover { background: var(--accent-soft); }
.browser-start { flex: 1; display: grid; padding: 24px; overflow: auto; }
.browser-intro { margin: auto; width: min(100%, 340px); text-align: center; }
.browser-mark { display: inline-grid; place-items: center; color: var(--accent-strong); }
.browser-mark .ui-icon { width: 34px; height: 34px; }
.browser-intro h2 { margin: 10px 0 6px; font-size: 20px; line-height: 1.3; }
.browser-intro p, .browser-error, .browser-footer { font-size: 13px; line-height: 1.5; }
.browser-intro p { margin: 0; color: var(--muted); }
.browser-intro details { margin-top: 18px; font-size: 12px; }
.browser-intro summary { cursor: pointer; color: var(--accent-strong); }
.browser-intro details p { margin: 10px 0; }
.browser-intro code { overflow-wrap: anywhere; }
.browser-error { margin: 0; padding: 7px 14px; color: var(--danger, #a52d31); }
.browser-viewport { position: relative; flex: 1; min-height: 0; }
.browser-viewport[aria-busy="true"]::before { content: ""; position: absolute; inset: 0 0 auto; height: 2px; background: var(--accent); pointer-events: none; }
.browser-viewport iframe { display: block; width: 100%; height: 100%; background: white; border: 0; }
.browser-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 2px 12px; padding: 6px 12px; border-top: 1px solid var(--border); color: var(--muted); font-size: 12px; }
.browser-footer p { margin: 0; }
.browser-footer a { display: inline-flex; align-items: center; gap: 3px; color: var(--accent-strong); text-underline-offset: 2px; }
.browser-footer a .ui-icon { width: 13px; height: 13px; }
.browser-footer button { padding: 0 6px; }
.browser-footer button .ui-icon { width: 14px; height: 14px; }
.is-preview-resizing iframe { pointer-events: none; }
@media (max-width: 540px) {
  .browser-navigation { gap: 4px; padding: 6px; }
  .browser-footer { padding: 4px 8px; }
}
`;
