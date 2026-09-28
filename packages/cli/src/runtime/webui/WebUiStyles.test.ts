import { describe, expect, it } from "vitest";

import { WEB_UI_STYLES } from "./WebUiStyles.js";

describe("WEB_UI_STYLES", () => {
  it("keeps idle reminders out of layout and readable in either theme", () => {
    expect(WEB_UI_STYLES).toMatch(
      /\.browser-idle-notice \{[^}]*position: absolute;[^}]*background: var\(--surface-raised\);/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.browser-idle-notice p \{[^}]*font-size: 12px;[^}]*color: var\(--muted\);/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.browser-page-reader > \.browser-idle-notice \{[^}]*position: static;[^}]*flex: 0 0 auto;[^}]*flex-wrap: wrap;/s,
    );
  });
  it("anchors navigation to the message viewport and hides inactive controls from focus", () => {
    expect(WEB_UI_STYLES).toMatch(
      /\.message-navigation \{[^}]*grid-row: 1 \/ 2;[^}]*bottom: 12px;/s,
    );
    for (const selector of ["jump-bottom", "jump-earlier"]) {
      expect(WEB_UI_STYLES).toMatch(
        new RegExp(`\\.${selector} \\{[^}]*visibility: hidden;`, "s"),
      );
      expect(WEB_UI_STYLES).toMatch(
        new RegExp(
          `\\.${selector}\\.is-visible \\{[^}]*visibility: visible;`,
          "s",
        ),
      );
    }
    expect(WEB_UI_STYLES).toContain(
      '.settings-index button[aria-current="location"]',
    );
  });

  it("gives inspector content a readable scale and keyboard-safe fields", () => {
    expect(WEB_UI_STYLES).toMatch(
      /\.inspector \{[^}]*width: min\(480px, calc\(100vw - 32px\)\);/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.setting-row p \{[^}]*color: var\(--muted\);[^}]*font-size: 12px;/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.field-control,\s*\.inline-field input \{[^}]*height: 40px;[^}]*font-size: 13px;/s,
    );
    expect(WEB_UI_STYLES).not.toMatch(
      /\.field-control,\s*\.inline-field input \{[^}]*outline: 0;/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.inspector-content \{[^}]*scroll-padding-block: 60px 16px;/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.settings-index \{[^}]*background: var\(--surface-raised\);/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.capability-creator \{[^}]*padding: 16px 0;[^}]*border-block: 1px solid var\(--border\);/s,
    );
  });

  it("keeps narrow conversations compact with visible copy actions", () => {
    expect(WEB_UI_STYLES).toMatch(
      /@media \(max-width: 560px\)[\s\S]*?\.message-column \{[^}]*gap: 16px;/,
    );
    expect(WEB_UI_STYLES).toMatch(
      /@media \(max-width: 560px\)[\s\S]*?\.message-actions \{[^}]*opacity: 1;/,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.toast \{[^}]*box-shadow: var\(--shadow-sm\);/s,
    );
    expect(WEB_UI_STYLES).toMatch(/\.toast \{[^}]*pointer-events: none;/s);
    expect(WEB_UI_STYLES).toMatch(
      /\.toast button \{[^}]*pointer-events: auto;/s,
    );
  });

  it("keeps browser footer actions readable and its settings clear of wrapped controls", () => {
    expect(WEB_UI_STYLES).toMatch(
      /\.browser-preview-footer \{[^}]*flex-wrap: wrap;/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.browser-preview-help \{[^}]*font-size: 12px;/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.browser-settings-popover \{[^}]*bottom: calc\(100% \+ 8px\);/s,
    );
  });
  it("separates working and interrupted browser placeholders using theme tokens", () => {
    expect(WEB_UI_STYLES).toMatch(
      /\.browser-preview-empty\[data-state="opening"\] \.browser-preview-empty-icon, \.browser-preview-empty\[data-state="closing"\] \.browser-preview-empty-icon \{[^}]*background: var\(--accent-soft\);/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.browser-preview-empty\[data-state="disconnected"\] \.browser-preview-empty-icon[^}]*background: var\(--warning-soft\);/s,
    );
  });

  it("keeps meaningful sidebar metadata and browser state legible", () => {
    expect(WEB_UI_STYLES).toMatch(
      /\.project-copy small \{[^}]*color: var\(--sidebar-muted\);[^}]*font: 11\.5px\/1\.35 var\(--font-mono\);/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.recent-session-meta \{[^}]*color: var\(--sidebar-muted\);[^}]*font: 10\.5px\/1\.35 var\(--font-mono\);/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.browser-preview-status \{[^}]*color: var\(--ink\);[^}]*font-size: 12px;/s,
    );
  });

  it("uses one workbench navigation row while a workbench is open", () => {
    expect(WEB_UI_STYLES).toContain(
      ".workspace-view.is-preview-open > .topbar .workspace-tools { display: none; }",
    );
    expect(WEB_UI_STYLES).toContain(".workbench-tabs { display: flex;");
  });

  it("keeps the empty chat secondary in split view without removing quick actions", () => {
    const split = ".workspace-view.is-preview-open:not(.is-preview-focus)";
    expect(WEB_UI_STYLES).toContain(
      `${split} .empty-state h1 { font-size: 20px;`,
    );
    expect(WEB_UI_STYLES).toContain(
      `${split} .suggestion-card { min-height: 34px;`,
    );
    expect(WEB_UI_STYLES).not.toContain(
      `${split} .suggestion-grid { display: none;`,
    );
  });

  it("keeps the page outline contained, readable, and keyboard-focused", () => {
    expect(WEB_UI_STYLES).toMatch(
      /\.browser-page-reader \{[^}]*position: absolute;[^}]*inset: 10px;[^}]*min-height: 0;/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /#browserPageReaderText \{[^}]*overflow: auto;[^}]*font: 13px\/1\.7 var\(--font-mono\);/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /#browserPageReaderStatus \{[^}]*font-size: 12px;/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.browser-page-reader footer \{[^}]*font-size: 11px;/s,
    );
    expect(WEB_UI_STYLES).toContain(
      ".browser-live-canvas.is-reading-page .browser-preview-stage { visibility: hidden; }",
    );
    expect(WEB_UI_STYLES).toMatch(
      /#browserPageReaderControlList \{[^}]*overflow: auto;[^}]*overscroll-behavior: contain;/s,
    );
    expect(WEB_UI_STYLES).toContain(
      "#browserPageReaderText:focus-visible { outline: 2px solid var(--accent);",
    );
    expect(WEB_UI_STYLES).toContain(
      ".browser-live-canvas { margin: 0; border: 0; border-radius: 0; background: var(--surface-subtle); container-type: inline-size; }",
    );
    expect(WEB_UI_STYLES).toContain("@container (min-width: 1100px) {");
    expect(WEB_UI_STYLES).toContain(
      ".browser-live-canvas.is-reading-page .browser-preview-stage { visibility: visible; width: calc(100% - min(34%, 400px) - 20px); overflow: auto; }",
    );
    expect(WEB_UI_STYLES).toContain(
      ".browser-live-canvas.is-reading-page .browser-preview-stage img { margin: 10px 0 auto; }",
    );
    expect(WEB_UI_STYLES).toContain(
      ".browser-live-canvas.is-reading-page .browser-page-reader-pan-hint { display: inline; }",
    );
  });

  it("composes visual regions in stable cascade order", () => {
    const orderedBoundaries = [
      ":root {",
      ".app-shell {",
      ".conversation {",
      ".composer-dock {",
      ".inspector {",
      ".task-overview-card {",
      ".command-palette {",
      ".toast-region {",
      "@media (max-width: 1320px) {",
      "@media (prefers-reduced-motion: reduce) {",
      "@media (forced-colors: active) {",
    ];

    let previousIndex = -1;
    for (const boundary of orderedBoundaries) {
      const currentIndex = WEB_UI_STYLES.indexOf(boundary);
      expect(currentIndex, `missing CSS boundary: ${boundary}`).toBeGreaterThan(
        previousIndex,
      );
      previousIndex = currentIndex;
    }
  });

  it("produces a complete stylesheet without interpolation artifacts", () => {
    const openingBraces = WEB_UI_STYLES.match(/{/g)?.length ?? 0;
    const closingBraces = WEB_UI_STYLES.match(/}/g)?.length ?? 0;

    expect(WEB_UI_STYLES).not.toContain("undefined");
    expect(WEB_UI_STYLES).toContain(".orbit-cat-head");
    expect(WEB_UI_STYLES).toContain(".orbit-cat-satellite");
    expect(WEB_UI_STYLES).toContain(".nav-section-heading");
    expect(WEB_UI_STYLES).toContain(".project-section");
    expect(WEB_UI_STYLES).toContain(".project-path-control");
    expect(WEB_UI_STYLES).toContain(".project-dialog-browse");
    expect(WEB_UI_STYLES).toContain(".recent-projects-shell");
    expect(WEB_UI_STYLES).toMatch(
      /\.registered-project \{[^}]*position: relative;[^}]*background: color-mix[^}]*border-radius: 12px;/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.registered-project-remove \{[^}]*position: absolute;[^}]*transform: translateY\(-50%\);/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.registered-project-open:focus-visible \{\s*outline: none;/,
    );
    expect(WEB_UI_STYLES).toContain(".project-toggle");
    expect(WEB_UI_STYLES).toMatch(
      /\.project-section:has\(\.project-toggle\[aria-expanded="false"\]\) \{[^}]*flex: 0 0 auto;[^}]*grid-template-rows: auto;/s,
    );
    expect(WEB_UI_STYLES).toContain(".project-chat-body[hidden]");
    expect(WEB_UI_STYLES).toContain(".session-row.is-active");
    expect(WEB_UI_STYLES).toContain(".sidebar-collapse-button");
    expect(WEB_UI_STYLES).toContain(".app-shell.sidebar-collapsed");
    expect(WEB_UI_STYLES).toMatch(
      /@media \(max-width: 560px\)[\s\S]*?\.toast-region \{[^}]*top: calc\(64px \+ env\(safe-area-inset-top\)\);[^}]*bottom: auto;/,
    );
    expect(WEB_UI_STYLES).not.toContain("body:has(.toast) .jump-earlier");
    expect(WEB_UI_STYLES).toMatch(
      /\.app-shell \{[^}]*grid-template-rows: minmax\(0, 1fr\);/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.app-shell \{[^}]*min-width: 0;[^}]*min-height: 0;/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.sidebar \{[^}]*min-height: 0;[^}]*overflow: hidden;/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.project-section \{[^}]*grid-template-rows: auto minmax\(0, 1fr\);[^}]*flex: 1 1 280px;[^}]*overflow: hidden;/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.project-chat-body \{[^}]*min-height: 0;[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain;[^}]*scrollbar-gutter: stable;/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.project-list \{[^}]*min-height: 0;[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain;[^}]*scrollbar-gutter: stable;/s,
    );
    expect(WEB_UI_STYLES).toContain(
      ".project-chat-body:hover::-webkit-scrollbar-thumb",
    );
    expect(WEB_UI_STYLES).toContain(".project-list.has-scroll-before");
    expect(WEB_UI_STYLES).toContain(".project-chat-body.has-scroll-after");
    expect(WEB_UI_STYLES).toContain(".message-scroll.has-scroll-before");
    expect(WEB_UI_STYLES).toContain(".message-scroll.has-scroll-after");
    expect(WEB_UI_STYLES).toContain(
      ".inspector-content.has-scroll-before.has-scroll-after",
    );
    expect(WEB_UI_STYLES).toContain(".project-chat-body:focus-visible");
    expect(WEB_UI_STYLES).toContain(".empty-composer-slot");
    expect(WEB_UI_STYLES).toContain(".context-picker");
    expect(WEB_UI_STYLES).toContain(".context-shelf");
    expect(WEB_UI_STYLES).toContain(".prompt-queue-actions");
    expect(WEB_UI_STYLES).toMatch(/\.turn-status:empty \{\s*display: none;/);
    expect(WEB_UI_STYLES).toContain(".agent-steer-editor");
    expect(WEB_UI_STYLES).toContain(".agent-steer-input:focus");
    expect(WEB_UI_STYLES).toContain("max-height: 168px");
    expect(WEB_UI_STYLES).toContain(".context-file-chip");
    expect(WEB_UI_STYLES).toContain(".context-result.is-added");
    expect(WEB_UI_STYLES).toContain('.context-result[aria-selected="true"]');
    expect(WEB_UI_STYLES).toContain(".connection-help");
    expect(WEB_UI_STYLES).toContain(".permission-summary.is-full-access");
    expect(WEB_UI_STYLES).toContain(".full-access-dialog");
    expect(WEB_UI_STYLES).toContain(".full-access-card");
    expect(WEB_UI_STYLES).toContain(".permission-summary.is-warning");
    expect(WEB_UI_STYLES).toContain(
      ".app-shell.is-reconnecting .connection-help",
    );
    expect(WEB_UI_STYLES).toContain('.command-result[aria-selected="true"]');
    expect(WEB_UI_STYLES).toContain(".context-ring");
    expect(WEB_UI_STYLES).toContain(".select-menu");
    expect(WEB_UI_STYLES).toContain(".select-search");
    expect(WEB_UI_STYLES).toContain('.select-option[aria-selected="true"]');
    expect(WEB_UI_STYLES).not.toContain('content: "⌄"');
    expect(WEB_UI_STYLES).toMatch(
      /\.select-menu \{[^}]*box-shadow: var\(--shadow-md\);[^}]*filter: none;/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.select-control\.is-open \.select-trigger \{\s*box-shadow: none;/,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.select-menu \{[^}]*display: grid;[^}]*gap: 2px;/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.select-menu \{[^}]*overflow-x: hidden;[^}]*overflow-y: auto;/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.select-option \{[^}]*min-height: 28px;[^}]*padding: 3px 28px 3px 9px;/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.select-option span \{[^}]*flex: 1 1 auto;[^}]*text-overflow: ellipsis;/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.empty-composer-slot \.composer \{[^}]*box-shadow: var\(--shadow-sm\)/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.composer \{[^}]*box-shadow: var\(--shadow-sm\)[^}]*backdrop-filter: blur\(18px\)/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.composer-dock \{[^}]*min-width: 0;[^}]*max-width: 100%;/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.composer-tools \{[^}]*flex: 1 1 auto;[^}]*min-width: 0;[^}]*overflow-x: auto;/s,
    );
    expect(WEB_UI_STYLES).toContain(
      ".composer-chip > span:not(.context-chip-count):not(.web-status-dot)",
    );
    expect(WEB_UI_STYLES).toContain("overscroll-behavior: none;");
    expect(WEB_UI_STYLES).toMatch(
      /\.inspector-content \{[^}]*overflow-x: hidden;[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain;[^}]*scrollbar-gutter: stable;/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.composer:focus-within \{[^}]*box-shadow: 0 0 0 2px var\(--accent-glow\)/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.app-shell\.is-disconnected \.composer \{[^}]*box-shadow: var\(--shadow-sm\)/s,
    );
    expect(WEB_UI_STYLES).toContain(".message-progress");
    expect(WEB_UI_STYLES).toContain(".control-turn.is-running");
    expect(WEB_UI_STYLES).toContain(".jump-earlier.is-visible");
    expect(WEB_UI_STYLES).toContain(".archive-toggle");
    expect(WEB_UI_STYLES).toContain(".archived-panel");
    expect(WEB_UI_STYLES).toContain(".session-action.is-danger:hover");
    expect(WEB_UI_STYLES).toContain(".session-delete-dialog");
    expect(WEB_UI_STYLES).toMatch(
      /\.session-delete-card \{[^}]*box-shadow: var\(--shadow-lg\);/s,
    );
    expect(WEB_UI_STYLES).toMatch(/\.toast-region \{[^}]*justify-items: end;/s);
    expect(WEB_UI_STYLES).toMatch(
      /\.toast \{[^}]*display: inline-grid;[^}]*width: fit-content;[^}]*max-width: 100%;/s,
    );
    expect(WEB_UI_STYLES).toContain(".toast > div");
    expect(WEB_UI_STYLES).toContain(".toast button:focus-visible");
    expect(WEB_UI_STYLES).toContain(".rich-table");
    expect(WEB_UI_STYLES).toContain(".message-actions");
    expect(WEB_UI_STYLES).toContain(".tool-card-summary");
    expect(WEB_UI_STYLES).toContain(".tool-context");
    expect(WEB_UI_STYLES).toContain(".code-line::before");
    expect(WEB_UI_STYLES).toContain(".code-line.is-addition");
    expect(WEB_UI_STYLES).toContain(".code-block.is-collapsed");
    expect(WEB_UI_STYLES).toContain(".stream-caret > p:last-child::after");
    expect(WEB_UI_STYLES).toContain(
      ".code-line:last-child\n  .code-line-text::after",
    );
    expect(WEB_UI_STYLES).not.toContain(".stream-caret::after {");
    expect(WEB_UI_STYLES).toContain(".token-keyword");
    expect(WEB_UI_STYLES).toContain(".token-function");
    expect(WEB_UI_STYLES).toContain(".tool-detail");
    expect(WEB_UI_STYLES).toContain(".tool-batch-summary");
    expect(WEB_UI_STYLES).toContain(".tool-batch-count");
    expect(WEB_UI_STYLES).toContain(
      ".app-shell.is-reconnecting .connection-help",
    );
    expect(WEB_UI_STYLES).toContain("justify-content: center");
    expect(WEB_UI_STYLES).toContain(".inspector-backdrop");
    expect(WEB_UI_STYLES).toContain(
      ".task-overview-stats {\n    grid-template-columns: minmax(0, 1fr);",
    );
    expect(WEB_UI_STYLES).toContain(".search-dependencies.is-disabled");
    expect(WEB_UI_STYLES).toContain(".switch-track::after");
    expect(WEB_UI_STYLES).toContain(".language-options");
    expect(WEB_UI_STYLES).toContain(".capability-creator");
    expect(WEB_UI_STYLES).toContain(".capability-skill-fields[hidden]");
    expect(WEB_UI_STYLES).toContain(".workflow-row");
    expect(WEB_UI_STYLES).toContain(".capability-preview");
    expect(WEB_UI_STYLES).toContain(".capability-form-error");
    expect(WEB_UI_STYLES).toContain(".compact-filter-bar");
    expect(WEB_UI_STYLES).toContain(".compact-filter-input");
    expect(WEB_UI_STYLES).not.toContain(".sidebar-agent-pill");
    expect(WEB_UI_STYLES).toMatch(
      /\.thinking-block summary \{[^}]*display: inline-flex;[^}]*border-radius: 8px;/s,
    );
    expect(WEB_UI_STYLES).not.toContain(".orbit-companion");
    expect(openingBraces).toBeGreaterThan(100);
    expect(closingBraces).toBe(openingBraces);
  });

  it("preserves the Orbit brand and responsive interaction contract", () => {
    expect(WEB_UI_STYLES).toContain("--brand-coral: #dd7069");
    expect(WEB_UI_STYLES).toContain(':root[data-theme="dark"]');
    expect(WEB_UI_STYLES).toContain("--sidebar: #eef0ed");
    expect(WEB_UI_STYLES).toContain("--sidebar-ink: #202824");
    expect(WEB_UI_STYLES).toContain("--sidebar-active:");
    expect(WEB_UI_STYLES).toContain("--accent-glow:");
    expect(WEB_UI_STYLES).toContain("--sidebar-faint: #64706a");
    expect(WEB_UI_STYLES).toContain("--faint: #64716c");
    expect(WEB_UI_STYLES).toContain("--faint: #81919b");
    expect(WEB_UI_STYLES).toContain(".send-button:disabled");
    expect(WEB_UI_STYLES).toContain("@media (max-width: 900px)");
    expect(WEB_UI_STYLES).toContain("@media (min-width: 901px)");
    expect(WEB_UI_STYLES).not.toContain(
      "#contextPickerButton > span:not(.context-chip-count)",
    );
    expect(WEB_UI_STYLES).toMatch(
      /@media \(max-width: 560px\)[\s\S]*?\.composer-chip,\s*\.composer-select-trigger \{\s*height: 36px;/,
    );
    expect(WEB_UI_STYLES).not.toMatch(
      /@media \(max-width: 420px\)[\s\S]*?\.language-options \{\s*grid-template-columns: minmax\(0, 1fr\);/,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.segmented\.language-options \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/s,
    );
    expect(WEB_UI_STYLES).toContain(".settings-index");
    expect(WEB_UI_STYLES).toContain('#applyModel[aria-busy="true"]');
    expect(WEB_UI_STYLES).toContain("@media (max-width: 560px)");
    expect(WEB_UI_STYLES).toContain("@media (max-width: 420px)");
    expect(WEB_UI_STYLES).toContain(
      "grid-template-rows: calc(54px + env(safe-area-inset-top)) auto minmax(0, 1fr);",
    );
    expect(WEB_UI_STYLES).toContain(
      "height: calc(54px + env(safe-area-inset-top));",
    );
    expect(WEB_UI_STYLES).toContain("@media (min-width: 1680px)");
    expect(WEB_UI_STYLES).toContain("@media (max-height: 760px)");
    expect(WEB_UI_STYLES).toContain("@media (prefers-reduced-motion: reduce)");
    expect(WEB_UI_STYLES).toContain("@media (prefers-contrast: more)");
    expect(WEB_UI_STYLES).toMatch(
      /@media \(max-width: 560px\)[\s\S]*?\.message-scroll \{\s*scrollbar-width: none;/,
    );
    expect(WEB_UI_STYLES).toMatch(
      /@media \(max-width: 560px\)[\s\S]*?\.workspace-view \{\s*scrollbar-gutter: auto;/,
    );
    expect(WEB_UI_STYLES).toMatch(
      /@media \(max-width: 560px\)[\s\S]*?\.prompt-queue-list \{\s*max-height: 76px;/,
    );
    expect(WEB_UI_STYLES).toMatch(
      /@media \(max-width: 560px\)[\s\S]*?\.approval-preview \{[^}]*max-height: min\(128px, 20dvh\);/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /@media \(max-height: 760px\) and \(min-width: 561px\)[\s\S]*?\.approval-preview \{[^}]*max-height: min\(128px, 18dvh\);/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /@media \(max-height: 760px\) and \(min-width: 561px\)[\s\S]*?\.composer-hint \{\s*display: none;/,
    );
    expect(WEB_UI_STYLES).toMatch(
      /@media \(max-height: 640px\)[\s\S]*?\.approval-preview \{\s*max-height: min\(80px, 14dvh\);/,
    );
  });

  it("keeps the empty workspace editorial and mobile prompts single-column", () => {
    expect(WEB_UI_STYLES).toMatch(
      /\.empty-state \{[^}]*width: min\(var\(--composer-width\),[^}]*justify-content: flex-start;[^}]*text-align: left;/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.empty-state h1 \{[^}]*max-width: 24ch;[^}]*font-size: clamp\(36px, 2\.75vw, 48px\);/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.empty-composer-slot #prompt \{[^}]*min-height: clamp\(46px, 5vh, 58px\);/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /@media \(max-width: 420px\) \{[\s\S]*?\.suggestion-grid \{\s*grid-template-columns: minmax\(0, 1fr\);/,
    );
    expect(WEB_UI_STYLES).toContain("--composer-width: 940px");
    expect(WEB_UI_STYLES).toContain("border-radius: 18px");
  });

  it("keeps user turns visually distinct and aligned to the reply edge", () => {
    expect(WEB_UI_STYLES).toMatch(
      /\.message\.user \.message-content \{[^}]*justify-self: end;[^}]*max-width: min\(680px, 78%\);/s,
    );
    expect(WEB_UI_STYLES).toContain("border-radius: 16px 16px 5px 16px");
    expect(WEB_UI_STYLES).toContain(".suggestion-icon .ui-icon");
  });

  it("keeps conversation metadata and composer guidance readable", () => {
    expect(WEB_UI_STYLES).toMatch(
      /\.message\.assistant \.message-content \{\s*max-width: min\(100%, 800px\);/,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.rich-text \{[^}]*font-size: 15\.25px;[^}]*line-height: 1\.7;/s,
    );
    expect(WEB_UI_STYLES).toMatch(/\.composer-hint \{[^}]*font-size: 10px;/s);
  });
});
