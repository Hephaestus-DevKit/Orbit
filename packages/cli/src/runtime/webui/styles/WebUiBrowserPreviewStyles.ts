/** A contained desktop workbench: chat and a resizable project-preview dock. */
export const WEB_UI_BROWSER_PREVIEW_STYLES = String.raw`
.browser-preview-divider { position: absolute; top: 0; bottom: 0; left: -7px; width: 12px; z-index: 3; cursor: col-resize; touch-action: none; }
.browser-preview-divider::after { content: ''; position: absolute; top: 44%; height: 42px; width: 3px; left: 4px; border-radius: 4px; background: var(--border-strong); transition: background .15s; }
.browser-preview-divider:hover::after, .browser-preview-divider:focus-visible::after, .is-preview-resizing .browser-preview-divider::after { background: var(--accent); }
.is-preview-resizing { cursor: col-resize; user-select: none; }
.workspace-view.is-preview-focus .browser-preview-divider { display: none; }
.safari-workspace { padding: 16px 20px; overflow: auto; line-height: 1.6; color: var(--ink); }
.safari-workspace h2 { font-size: 16px; }
.safari-workspace details { margin-block: 1em; }
.safari-workspace summary { cursor: pointer; }
.safari-workspace code { overflow-wrap: anywhere; }
`;
