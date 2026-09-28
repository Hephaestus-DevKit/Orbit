/** A contained desktop workbench: chat and a resizable project-preview dock. */
export const WEB_UI_BROWSER_PREVIEW_STYLES = String.raw`
.browser-preview-panel { position: relative; display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; background: var(--surface); color: var(--ink); }
.browser-preview-panel[hidden], .browser-preview-panel [hidden] { display: none; }
.browser-preview-divider { position: absolute; top: 0; bottom: 0; left: -7px; width: 12px; z-index: 3; cursor: col-resize; touch-action: none; }
.browser-preview-divider::after { content: ''; position: absolute; top: 44%; height: 42px; width: 3px; left: 4px; border-radius: 4px; background: var(--border-strong); transition: background .15s; }
.browser-preview-divider:hover::after, .browser-preview-divider:focus-visible::after, .is-preview-resizing .browser-preview-divider::after { background: var(--accent); }
.is-preview-resizing { cursor: col-resize; user-select: none; }
.workspace-view.is-preview-focus .browser-preview-divider { display: none; }
.browser-preview-header { display: flex; align-items: center; gap: 6px; padding: 9px 10px 7px 14px; flex: 0 0 auto; }
.browser-preview-heading { display: flex; gap: 7px; align-items: center; min-width: 0; margin-right: auto; }
.browser-preview-heading > .ui-icon { color: var(--accent-strong); width: 16px; height: 16px; flex: 0 0 auto; }
.browser-preview-header h2 { margin: 0; font-size: 12px; font-weight: 650; white-space: nowrap; }
.browser-preview-header .icon-button { width: 28px; height: 28px; min-height: 28px; border-radius: 6px; }
.browser-preview-header .icon-button[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent-strong); }
.browser-preview-status { display: flex; gap: 5px; align-items: center; color: var(--ink); font-size: 12px; white-space: nowrap; }
.browser-preview-status::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: var(--faint); }
.browser-preview-panel[data-status="ready"] .browser-preview-status::before { background: var(--success); }
.browser-preview-panel[data-status="error"] .browser-preview-status::before { background: var(--warning); }
.browser-preview-panel[data-status="working"] .browser-preview-status::before { background: var(--accent); }
.browser-preview-connect { display: flex; align-items: center; gap: 7px; padding: 0 12px 8px; }
.browser-preview-address { display: flex; align-items: center; flex: 1; min-width: 0; height: 34px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-subtle); }
.browser-preview-address:focus-within { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-glow); }
.browser-preview-local { padding: 0 9px; font: 600 9px var(--font-mono); letter-spacing: .6px; color: var(--accent-strong); border-right: 1px solid var(--border); }
.browser-preview-address input { min-width: 0; width: 100%; padding: 7px 9px; border: 0; outline: 0; box-shadow: none; background: transparent; color: var(--ink); font: 12px var(--font-mono); }
.browser-search-destination { flex: 0 0 auto; margin-right: 5px; padding: 4px 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--muted); font: 11px var(--font-sans); white-space: nowrap; }
.browser-preview-panel .secondary-button { min-height: 32px; padding: 6px 11px; font-size: 11px; white-space: nowrap; }
.browser-preview-toolbar { display: flex; align-items: center; gap: 3px; padding: 0 10px 9px; border-bottom: 1px solid var(--border); flex: 0 0 auto; }
.browser-preview-toolbar select { min-width: 0; max-width: 155px; padding: 5px 4px; color: var(--muted); font: 11px var(--font-sans); border: 1px solid transparent; background: var(--surface); border-radius: 5px; }
.browser-preview-toolbar select:hover { border-color: var(--border); }
.browser-preview-panel .text-button { min-height: 28px; padding: 5px 7px; border-radius: 5px; font-size: 11px; white-space: nowrap; }
.browser-preview-panel .text-button:hover:not(:disabled) { background: var(--surface-hover); }
.browser-preview-toolbar .browser-preview-zoom { margin-left: auto; font-variant-numeric: tabular-nums; }
.browser-preview-notice { display: flex; align-items: flex-start; gap: 8px; margin: 8px 12px 0; padding: 9px 10px; border-radius: var(--radius-sm); background: var(--warning-soft); color: var(--warning); font-size: 11px; flex: 0 0 auto; }
.browser-preview-notice > div { flex: 1; min-width: 0; }
.browser-preview-notice .browser-preview-notice-actions { display: flex; flex: 0 0 auto; flex-direction: column; align-items: flex-end; gap: 2px; }
.browser-preview-notice strong { display: block; font-size: 12px; font-weight: 600; line-height: 1.5; }
.browser-preview-notice p { margin: 4px 0 0; max-height: 52px; overflow: auto; overflow-wrap: anywhere; color: var(--ink); line-height: 1.5; }
.browser-preview-canvas { flex: 1 1 0; min-height: 80px; position: relative; margin: 10px 10px 0; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; background: var(--canvas-deep); }
.browser-preview-stage { display: flex; height: 100%; width: 100%; padding: 16px; overflow: auto; overscroll-behavior: contain; }
.browser-preview-stage:focus-visible { outline-offset: -3px; }
.browser-preview-stage img { display: block; flex: 0 0 auto; margin: auto; max-width: none; object-fit: contain; border-radius: 3px; box-shadow: var(--shadow-sm); }
.browser-preview-panel[aria-busy="true"] .browser-preview-stage img { opacity: .55; }
.browser-preview-empty { max-width: 290px; margin: auto; padding: 14px 0; text-align: center; color: var(--muted); }
.browser-preview-empty-icon { width: 52px; height: 44px; display: grid; place-items: center; margin: 0 auto 20px; border: 1px solid var(--border-strong); border-radius: 9px; background: var(--surface); box-shadow: var(--shadow-sm); color: var(--accent-strong); }
.browser-preview-empty-icon .ui-icon { width: 25px; height: 25px; }
.browser-preview-empty[data-state="opening"] .browser-preview-empty-icon, .browser-preview-empty[data-state="closing"] .browser-preview-empty-icon { color: var(--accent-strong); background: var(--accent-soft); border-color: var(--accent); }
.browser-preview-empty[data-state="disconnected"] .browser-preview-empty-icon, .browser-preview-empty[data-state="error"] .browser-preview-empty-icon { color: var(--warning); background: var(--warning-soft); }
.browser-preview-empty h3 { color: var(--ink); font-size: 15px; font-weight: 600; margin: 0 0 10px; line-height: 1.5; }
.browser-preview-empty p { margin: 0; font-size: 12px; line-height: 1.8; }
.browser-preview-empty-note { display: block; margin-top: 24px; font-size: 10px; color: var(--faint); }
.browser-preview-working { position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%); padding: 7px 12px; border: 1px solid var(--border); border-radius: 20px; background: var(--surface); color: var(--ink); box-shadow: var(--shadow-sm); white-space: nowrap; font-size: 11px; pointer-events: none; }
.browser-preview-caption { display: flex; gap: 10px; justify-content: space-between; padding: 8px 13px; color: var(--faint); font-size: 10px; flex: 0 0 auto; }
.browser-preview-caption > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.browser-preview-caption > span:last-child { flex-shrink: 0; font-variant-numeric: tabular-nums; }
.browser-preview-evidence { margin: 0 12px; border-top: 1px solid var(--border); color: var(--muted); font-size: 11px; flex: 0 0 auto; }
.browser-preview-evidence summary { padding: 10px 0; cursor: pointer; }
#browserPreviewEvidenceCount { float: right; font-size: 10px; color: var(--muted); }
#browserPreviewEvidenceCount.has-issues { color: var(--warning); }
.browser-preview-evidence-body { max-height: min(170px, 22dvh); overflow: auto; overscroll-behavior: contain; padding: 0 4px 10px; }
.browser-preview-evidence h3 { margin: 8px 0; font-size: 10px; font-weight: 600; }
.browser-preview-evidence pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; padding: 10px; background: var(--surface-subtle); border-radius: 6px; color: var(--muted); font: 10px/1.7 var(--font-mono); }
.browser-preview-footer { position: relative; display: flex; align-items: center; gap: 8px 10px; padding: 8px 12px; border-top: 1px solid var(--border); flex: 0 0 auto; flex-wrap: wrap; }
.browser-preview-footer .secondary-button { min-height: 34px; padding: 6px 10px; font-size: 12px; }
#browserPreviewStop { margin-left: auto; min-height: 34px; font-size: 12px; }
.browser-preview-help { color: var(--muted); font-size: 12px; flex: 0 0 auto; }
.browser-preview-help summary { cursor: pointer; width: fit-content; padding: 7px 0; }
.browser-preview-help summary:hover { color: var(--ink); }
.browser-preview-help summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.browser-settings-popover { position: absolute; bottom: calc(100% + 8px); left: 10px; right: 10px; z-index: 4; margin: 0; padding: 14px; max-height: min(360px, 55dvh); overflow: auto; overscroll-behavior: contain; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); box-shadow: var(--shadow-md); color: var(--muted); font-size: 12px; line-height: 1.8; }
.browser-settings-popover p { margin: 0; }
.browser-live-tabs { display: flex; align-items: center; gap: 4px; padding: 7px 10px 5px; min-width: 0; flex: 0 0 auto; }
#browserTabs { display: flex; gap: 3px; min-width: 0; flex: 1; overflow: auto; scrollbar-width: thin; }
.browser-live-tab { display: flex; flex: 1 1 150px; min-width: 75px; max-width: 220px; border-radius: 6px; border: 1px solid transparent; background: var(--surface-subtle); }
.browser-live-tab:has([aria-selected="true"]) { border-color: var(--border-strong); background: var(--surface); }
.browser-live-tab button { border: 0; background: transparent; color: var(--muted); font: 11px var(--font-sans); min-width: 0; cursor: pointer; }
.browser-live-tab [role="tab"] { flex: 1; padding: 8px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.browser-live-tab [aria-selected="true"] { color: var(--ink); font-weight: 600; }
.browser-live-tab-close { flex: 0 0 26px; border-radius: 4px; font-size: 16px !important; }
.browser-live-tab button:hover { background: var(--surface-hover); }
.browser-live-tab button[aria-disabled="true"] { cursor: default; }
.browser-live-tab button[aria-disabled="true"]:hover { background: transparent; }
.browser-live-tab-close[aria-disabled="true"] { opacity: .45; }
.browser-live-panel .browser-preview-connect { gap: 4px; padding: 0 10px 10px; border-bottom: 1px solid var(--border); }
.browser-live-panel .browser-preview-connect .icon-button, .browser-live-tabs > .icon-button { width: 28px; min-width: 28px; height: 30px; min-height: 30px; font-size: 16px; border-radius: 5px; }
.browser-find-bar { position: absolute; top: 10px; right: 10px; z-index: 3; display: flex; align-items: center; gap: 5px; width: min(420px, calc(100% - 20px)); padding: 6px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); box-shadow: var(--shadow-md); }
.browser-find-bar input { flex: 0 1 240px; min-width: 80px; margin-left: auto; padding: 6px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); outline: 0; background: var(--surface-subtle); color: var(--ink); font: 12px var(--font-sans); }
.browser-find-bar input:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-glow); }
.browser-find-bar [role="status"] { min-width: 65px; color: var(--muted); font-size: 11px; text-align: center; white-space: nowrap; }
.browser-find-bar .icon-button { flex: 0 0 27px; width: 27px; min-width: 27px; height: 27px; min-height: 27px; border-radius: 5px; }
.browser-idle-notice { position: absolute; bottom: 12px; left: 12px; right: 12px; z-index: 3; display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface-raised); box-shadow: var(--shadow-md); color: var(--ink); }
.browser-idle-notice > div { flex: 1; min-width: 0; }
.browser-idle-notice strong { font-size: 13px; font-weight: 600; }
.browser-idle-notice p { margin: 3px 0 0; font-size: 12px; line-height: 1.6; color: var(--muted); }
.browser-idle-notice .secondary-button { flex-shrink: 0; min-height: 34px; font-size: 12px; }
.browser-live-panel #browserPageActions { font-size: 20px; line-height: 1; }
.browser-live-panel #browserPageActions[aria-expanded="true"] { background: var(--accent-soft); color: var(--accent-strong); }
.browser-page-context-menu { position: absolute; z-index: 12; display: grid; gap: 2px; min-width: 166px; padding: 4px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); box-shadow: var(--shadow-md); }
.browser-page-context-menu button { width: 100%; padding: 8px 10px; border: 0; border-radius: 5px; background: transparent; color: var(--ink); font: 12px var(--font-sans); text-align: left; cursor: pointer; }
.browser-page-context-menu button:hover, .browser-page-context-menu button:focus-visible { background: var(--surface-hover); }
.browser-page-context-menu button[aria-disabled="true"] { color: var(--faint); cursor: default; }
.browser-page-context-menu button[aria-disabled="true"]:hover { background: transparent; }
.browser-select-popup { position: absolute; z-index: 13; display: flex; flex-direction: column; width: min(320px, calc(100% - 20px)); max-height: min(360px, 60%); overflow: hidden; padding: 7px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface-raised); color: var(--ink); box-shadow: var(--shadow-md); }
.browser-select-popup header { display: flex; align-items: center; gap: 8px; padding: 2px 3px 7px 7px; }
.browser-select-popup h3 { flex: 1; min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 650; }
.browser-select-popup header .icon-button { flex: 0 0 26px; width: 26px; min-height: 26px; height: 26px; }
#browserSelectSearch { flex: 0 0 auto; width: 100%; min-height: 32px; padding: 5px 8px; border: 1px solid var(--border); border-radius: 5px; outline: 0; background: var(--surface-subtle); color: var(--ink); font: 12px var(--font-sans); }
#browserSelectSearch:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-glow); }
.browser-select-options { min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 4px 0; }
.browser-select-option { display: flex; width: 100%; min-height: 32px; align-items: center; gap: 7px; padding: 6px 9px; border: 0; border-radius: 5px; background: transparent; color: var(--ink); text-align: left; font: 12px var(--font-sans); cursor: pointer; }
.browser-select-option:hover:not(:disabled), .browser-select-option:focus-visible { outline: 0; background: var(--surface-hover); }
.browser-select-option[aria-selected="true"] { color: var(--accent-strong); font-weight: 600; background: var(--accent-soft); }
.browser-select-option:disabled { opacity: .45; cursor: not-allowed; }
.browser-select-option-group { color: var(--muted); font-size: 10px; }
.browser-select-empty { margin: 5px 8px; padding: 10px 2px; color: var(--muted); font-size: 12px; }
.browser-select-popup footer { display: flex; flex: 0 0 auto; justify-content: space-between; align-items: center; gap: 8px; padding: 5px 2px 0; border-top: 1px solid var(--border); color: var(--muted); font-size: 10px; }
.browser-select-popup footer > div { display: flex; gap: 3px; }
.browser-select-popup footer .text-button { min-height: 25px; }
.browser-select-popup footer .text-button:disabled { opacity: .4; }
.browser-native-picker { gap: 2px; }
#browserPickerValue { width: 100%; min-height: 36px; padding: 5px 8px; border: 1px solid var(--border-strong); border-radius: 5px; background: var(--surface-subtle); color: var(--ink); font: 13px var(--font-sans); }
#browserPickerValue:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
#browserPickerValue[type="color"] { padding: 3px; cursor: pointer; }
#browserPickerHelp { margin: 7px 3px 9px; color: var(--muted); font-size: 12px; line-height: 1.45; }
#browserPickerStatus { margin: 0 3px 8px; color: var(--danger); font-size: 11px; line-height: 1.4; }
#browserPickerStatus:empty { display: none; }
.browser-native-picker footer { padding-top: 7px; }
.browser-native-picker footer > div { margin-left: auto; }
.browser-native-picker footer .text-button, .browser-native-picker footer .secondary-button { min-height: 30px; padding: 5px 10px; font-size: 12px; }
.browser-native-picker footer button:disabled { opacity: .45; }
.browser-upload-popup, .browser-download-popup { top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(380px, calc(100% - 24px)); max-height: min(340px, 75%); padding: 12px; }
.browser-upload-popup header { padding-left: 2px; }
.browser-upload-popup > p { margin: 5px 2px 12px; color: var(--muted); font-size: 12px; line-height: 1.55; overflow-wrap: anywhere; }
.browser-upload-popup > label { margin: 0 2px 6px; color: var(--ink); font-size: 12px; font-weight: 600; }
#browserUploadFiles { width: 100%; min-height: 36px; padding: 6px; border: 1px solid var(--border-strong); border-radius: 5px; color: var(--ink); background: var(--surface-subtle); font: 12px var(--font-sans); }
#browserUploadFiles:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
#browserUploadStatus { min-height: 18px; }
.browser-upload-popup footer { justify-content: flex-end; padding-top: 9px; }
.browser-upload-popup footer .secondary-button { min-height: 30px; font-size: 12px; }
.browser-upload-popup footer button:disabled { opacity: .45; }
.browser-download-popup > p { margin: 5px 2px 10px; color: var(--muted); font-size: 12px; line-height: 1.55; overflow-wrap: anywhere; }
#browserDownloadName { color: var(--ink); font-size: 13px; font-weight: 600; }
#browserDownloadStatus { min-height: 18px; }
.browser-download-popup footer { justify-content: flex-end; padding-top: 9px; }
.browser-download-popup footer .secondary-button { min-height: 30px; font-size: 12px; }
.browser-download-popup footer button:disabled { opacity: .45; }
.browser-live-panel .browser-preview-address input { font-family: var(--font-sans); }
.browser-live-canvas { margin: 0; border: 0; border-radius: 0; background: var(--surface-subtle); container-type: inline-size; }
.browser-live-canvas .browser-preview-stage { position: relative; padding: 0; overflow: hidden; }
.browser-live-canvas img { border-radius: 0; box-shadow: none; touch-action: none; cursor: default; }
.browser-live-canvas .browser-preview-empty { padding: 20px; max-width: 340px; }
.browser-live-canvas .is-input-blocked img { cursor: progress; }
.browser-live-canvas .is-disconnected img { opacity: .45; cursor: not-allowed; }
#browserPageInput { position: absolute; width: 1px; height: 1px; min-height: 0; padding: 0; border: 0; resize: none; opacity: .01; left: 8px; bottom: 8px; pointer-events: none; }
.browser-live-canvas .browser-preview-stage:focus-within { box-shadow: inset 0 0 0 2px var(--accent); }
.browser-live-canvas.is-reading-page { background: var(--surface-raised); }
.browser-live-canvas.is-reading-page .browser-preview-stage { visibility: hidden; }
.browser-page-reader { position: absolute; inset: 10px; z-index: 4; display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 14px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface-raised); box-shadow: var(--shadow-md); }
.browser-page-reader > .browser-idle-notice { position: static; flex: 0 0 auto; flex-wrap: wrap; gap: 8px; margin: 0 0 10px; padding: 10px 12px; box-shadow: none; }
.browser-page-reader > .browser-idle-notice > div { flex-basis: 180px; }
.browser-page-reader header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.browser-page-reader h3 { margin: 0; color: var(--ink-strong); font-size: 14px; font-weight: 650; }
.browser-page-reader-pan-hint { display: none; margin-left: auto; color: var(--muted); font-size: 10px; white-space: nowrap; }
.browser-page-reader header .icon-button { width: 28px; height: 28px; min-height: 28px; }
#browserPageReaderStatus { min-height: 20px; margin: 5px 0 9px; color: var(--muted); font-size: 12px; }
#browserPageReaderText { flex: 1; min-height: 0; padding: 12px; overflow: auto; overscroll-behavior: contain; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-subtle); color: var(--ink); font: 13px/1.7 var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; }
#browserPageReaderText:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.browser-page-reader-controls { display: flex; flex-direction: column; min-height: 0; max-height: 46%; margin-top: 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-subtle); }
.browser-page-reader-controls h4 { flex: 0 0 auto; margin: 0; padding: 9px 11px 7px; color: var(--ink-strong); font-size: 12px; font-weight: 650; }
#browserPageReaderControlList { min-height: 0; padding: 0 5px 5px; overflow: auto; overscroll-behavior: contain; }
.browser-page-reader-control { display: flex; align-items: center; gap: 10px; border-top: 1px solid var(--border); }
.browser-page-reader-control .text-button { flex: 1; justify-content: flex-start; min-width: 0; min-height: 34px; padding: 5px 7px; text-align: left; white-space: normal; overflow-wrap: anywhere; font-size: 12px; }
.browser-page-reader button[aria-disabled="true"] { opacity: .5; cursor: default; }
.browser-page-reader button[aria-disabled="true"]:hover { background: transparent; }
.browser-page-reader-control > span { flex: 0 0 auto; padding-right: 7px; color: var(--muted); font-size: 11px; }
.browser-page-reader footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 9px; color: var(--faint); font-size: 11px; }
.browser-page-reader footer .text-button { flex: 0 0 auto; min-height: 30px; font-size: 12px; }
@container (min-width: 1100px) {
  .browser-live-canvas.is-reading-page .browser-preview-stage { visibility: visible; width: calc(100% - min(34%, 400px) - 20px); overflow: auto; }
  .browser-live-canvas.is-reading-page .browser-preview-stage img { margin: 10px 0 auto; }
  .browser-live-canvas.is-reading-page .browser-page-reader { inset: 10px 10px 10px auto; width: min(34%, 400px); }
  .browser-live-canvas.is-reading-page .browser-page-reader-pan-hint { display: inline; }
}
#browserPreviewPageTitle { display: none; }
.browser-live-panel .browser-preview-caption { border-top: 1px solid var(--border); gap: 8px; }
.browser-live-panel .browser-preview-caption > span:last-child { flex-shrink: 1; text-align: right; }
.browser-live-dialog-backdrop { position: absolute; inset: 0; z-index: 4; background: color-mix(in srgb, var(--scrim) 62%, transparent); backdrop-filter: blur(1px); }
.browser-live-dialog { position: absolute; top: 50%; left: 50%; z-index: 5; width: min(460px, calc(100% - 32px)); max-height: min(70%, 420px); overflow: auto; transform: translate(-50%, -50%); padding: 18px; border: 1px solid var(--border-strong); border-radius: var(--radius-md); box-shadow: var(--shadow-md); background: var(--surface); }
.browser-live-dialog h3 { margin: 0 0 12px; color: var(--muted); font-size: 11px; font-weight: 650; letter-spacing: .02em; }
.browser-live-dialog p { margin: 0 0 14px; font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.browser-live-dialog > div { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.browser-live-dialog input { width: 100%; }
.browser-search-preference { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-bottom: 10px; margin-bottom: 10px; border-bottom: 1px solid var(--border); color: var(--ink); font-size: 12px; }
.browser-search-preference select { width: auto; max-width: 130px; min-height: 28px; padding: 3px 22px 3px 7px; border: 1px solid var(--border); border-radius: 5px; background-color: var(--surface); color: var(--ink); font: 11px var(--font-sans); }
@media (min-width: 561px) {
  body:has(#browserPreviewPanel:not([hidden])) .toast-region { bottom: calc(78px + var(--browser-settings-toast-lift, 0px) + env(safe-area-inset-bottom)); }
}
`;
