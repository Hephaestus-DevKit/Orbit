import { describe, expect, it } from "vitest";

import { WEB_UI_STYLES } from "./WebUiStyles.js";

describe("WEB_UI_STYLES", () => {
  it("composes visual regions in stable cascade order", () => {
    const orderedBoundaries = [
      ":root {",
      ".app-shell {",
      ".conversation {",
      ".composer-dock {",
      ".inspector {",
      ".command-palette {",
      ".toast-region {",
      "@media (max-width: 1320px) {",
      "@media (prefers-reduced-motion: reduce) {",
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
    expect(WEB_UI_STYLES).toContain(".project-chat-body[hidden]");
    expect(WEB_UI_STYLES).toContain(".session-row.is-active");
    expect(WEB_UI_STYLES).toContain(".sidebar-collapse-button");
    expect(WEB_UI_STYLES).toContain(".app-shell.sidebar-collapsed");
    expect(WEB_UI_STYLES).toContain(
      ".recent-sessions:hover::-webkit-scrollbar-thumb",
    );
    expect(WEB_UI_STYLES).toContain(".empty-composer-slot");
    expect(WEB_UI_STYLES).toContain(".context-picker");
    expect(WEB_UI_STYLES).toContain(".context-shelf");
    expect(WEB_UI_STYLES).toContain(".context-file-chip");
    expect(WEB_UI_STYLES).toContain(".context-result.is-added");
    expect(WEB_UI_STYLES).toContain('.context-result[aria-selected="true"]');
    expect(WEB_UI_STYLES).toContain(".connection-help");
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
      /\.select-menu \{[^}]*box-shadow: none;[^}]*filter: none;/s,
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
      /\.empty-composer-slot \.composer \{[^}]*box-shadow: 0 18px 46px/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.composer \{[^}]*box-shadow: 0 12px 34px[^}]*backdrop-filter: blur\(18px\)/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.composer:focus-within \{[^}]*box-shadow: 0 18px 48px/s,
    );
    expect(WEB_UI_STYLES).toMatch(
      /\.app-shell\.is-disconnected \.composer \{[^}]*box-shadow: 0 12px 34px/s,
    );
    expect(WEB_UI_STYLES).toContain(".message-progress");
    expect(WEB_UI_STYLES).toContain(".archive-toggle");
    expect(WEB_UI_STYLES).toContain(".archived-panel");
    expect(WEB_UI_STYLES).toContain(".session-action.is-danger:hover");
    expect(WEB_UI_STYLES).toContain(".session-delete-dialog");
    expect(WEB_UI_STYLES).toMatch(
      /\.session-delete-card \{[^}]*box-shadow: none;/s,
    );
    expect(WEB_UI_STYLES).toContain(".rich-table");
    expect(WEB_UI_STYLES).toContain(".message-actions");
    expect(WEB_UI_STYLES).toContain(".tool-card-summary");
    expect(WEB_UI_STYLES).toContain(".code-line::before");
    expect(WEB_UI_STYLES).toContain(".code-line.is-addition");
    expect(WEB_UI_STYLES).toContain(".code-block.is-collapsed");
    expect(WEB_UI_STYLES).toContain(".token-keyword");
    expect(WEB_UI_STYLES).toContain(".token-function");
    expect(WEB_UI_STYLES).toContain(".tool-detail");
    expect(WEB_UI_STYLES).toContain(
      ".app-shell.is-reconnecting .connection-help",
    );
    expect(WEB_UI_STYLES).toContain("justify-content: center");
    expect(WEB_UI_STYLES).toContain(".inspector-backdrop");
    expect(WEB_UI_STYLES).toContain(".search-dependencies.is-disabled");
    expect(WEB_UI_STYLES).toContain(".switch-track::after");
    expect(WEB_UI_STYLES).not.toContain(".orbit-companion");
    expect(openingBraces).toBeGreaterThan(100);
    expect(closingBraces).toBe(openingBraces);
  });

  it("preserves the Orbit brand and responsive interaction contract", () => {
    expect(WEB_UI_STYLES).toContain("--brand-coral: #dd7069");
    expect(WEB_UI_STYLES).toContain(':root[data-theme="dark"]');
    expect(WEB_UI_STYLES).toContain("--sidebar: #edf1f0");
    expect(WEB_UI_STYLES).toContain("--sidebar-active:");
    expect(WEB_UI_STYLES).toContain("--accent-glow:");
    expect(WEB_UI_STYLES).toContain(".send-button:disabled");
    expect(WEB_UI_STYLES).toContain("@media (max-width: 900px)");
    expect(WEB_UI_STYLES).toContain("@media (min-width: 901px)");
    expect(WEB_UI_STYLES).toContain("@media (max-width: 560px)");
    expect(WEB_UI_STYLES).toContain("@media (max-width: 420px)");
    expect(WEB_UI_STYLES).toContain("@media (min-width: 1680px)");
    expect(WEB_UI_STYLES).toContain("@media (max-height: 760px)");
    expect(WEB_UI_STYLES).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("keeps the empty workspace editorial and mobile prompts single-column", () => {
    expect(WEB_UI_STYLES).toMatch(
      /\.empty-state \{[^}]*justify-content: flex-start;[^}]*text-align: left;/s,
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
    expect(WEB_UI_STYLES).toContain("border-radius: 15px 15px 4px 15px");
    expect(WEB_UI_STYLES).toContain(".suggestion-icon .ui-icon");
  });
});
