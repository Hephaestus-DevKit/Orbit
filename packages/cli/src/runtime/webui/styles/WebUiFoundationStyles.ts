/** Design tokens, theme variants, and shared browser defaults. */
export const WEB_UI_FOUNDATION_STYLES = String.raw`
:root {
  color-scheme: light;
  --canvas: #f7f8f6;
  --canvas-deep: #e7ece9;
  --sidebar: #edf1f0;
  --sidebar-ink: #202a2a;
  --sidebar-muted: #596765;
  --sidebar-faint: #7b8986;
  --sidebar-border: rgba(42, 61, 59, 0.12);
  --sidebar-surface: rgba(255, 255, 255, 0.68);
  --sidebar-active: rgba(255, 255, 255, 0.84);
  --surface: #fbfcfa;
  --surface-raised: #ffffff;
  --surface-subtle: #f0f3f1;
  --surface-hover: #e8edeb;
  --surface-glass: rgba(250, 252, 251, 0.88);
  --ink: #303b38;
  --ink-strong: #14201d;
  --muted: #5f6c68;
  --faint: #87928f;
  --border: rgba(39, 57, 54, 0.1);
  --border-strong: rgba(39, 57, 54, 0.17);
  --accent: #638c85;
  --accent-strong: #356b63;
  --accent-soft: #e0eeea;
  --accent-glow: rgba(72, 121, 111, 0.15);
  --brand-coral: #dd7069;
  --brand-coral-soft: #f7e4e1;
  --success: #4f815e;
  --success-soft: #e4efe6;
  --warning: #a7782c;
  --warning-soft: #f4ecd9;
  --danger: #bb5755;
  --danger-soft: #f7e4e2;
  --code: #182027;
  --code-ink: #e7edf0;
  --shadow-sm: 0 1px 2px rgba(26, 43, 40, 0.06), 0 3px 10px rgba(26, 43, 40, 0.035);
  --shadow-md: 0 20px 54px rgba(26, 43, 40, 0.1), 0 4px 12px rgba(26, 43, 40, 0.045);
  --shadow-lg: 0 30px 86px rgba(21, 34, 32, 0.15), 0 5px 18px rgba(21, 34, 32, 0.06);
  --sidebar-width: clamp(232px, 14vw, 258px);
  --content-width: 880px;
  --composer-width: 900px;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 18px;
  --radius-xl: 24px;
  --font-sans: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", sans-serif;
  --font-mono: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --canvas: #151b21;
  --canvas-deep: #11171c;
  --sidebar: #141a20;
  --sidebar-ink: #f4f6f7;
  --sidebar-muted: #9aa5ae;
  --sidebar-faint: #68747d;
  --sidebar-border: rgba(255, 255, 255, 0.09);
  --sidebar-surface: rgba(255, 255, 255, 0.06);
  --sidebar-active: rgba(255, 255, 255, 0.085);
  --surface: #1a2229;
  --surface-raised: #202930;
  --surface-subtle: #263139;
  --surface-hover: #2c3942;
  --surface-glass: rgba(21, 27, 33, 0.82);
  --ink: #d8e0e4;
  --ink-strong: #f1f5f6;
  --muted: #a5b1b8;
  --faint: #74838d;
  --border: rgba(220, 231, 236, 0.1);
  --border-strong: rgba(220, 231, 236, 0.18);
  --accent: #9eb8c4;
  --accent-strong: #b6ccd5;
  --accent-soft: #243237;
  --accent-glow: rgba(158, 184, 196, 0.12);
  --brand-coral: #e77872;
  --brand-coral-soft: #3a2625;
  --success: #8cb792;
  --success-soft: #233329;
  --warning: #dbb36d;
  --warning-soft: #362e20;
  --danger: #e28a85;
  --danger-soft: #3b2726;
  --code: #0b0d0c;
  --code-ink: #e6ebe4;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.18);
  --shadow-md: 0 14px 38px rgba(0, 0, 0, 0.28), 0 2px 8px rgba(0, 0, 0, 0.2);
  --shadow-lg: 0 24px 72px rgba(0, 0, 0, 0.44), 0 4px 18px rgba(0, 0, 0, 0.25);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --canvas: #151b21;
    --canvas-deep: #11171c;
    --sidebar: #141a20;
    --sidebar-ink: #f4f6f7;
    --sidebar-muted: #9aa5ae;
    --sidebar-faint: #68747d;
    --sidebar-border: rgba(255, 255, 255, 0.09);
    --sidebar-surface: rgba(255, 255, 255, 0.06);
    --sidebar-active: rgba(255, 255, 255, 0.085);
    --surface: #1a2229;
    --surface-raised: #202930;
    --surface-subtle: #263139;
    --surface-hover: #2c3942;
    --surface-glass: rgba(21, 27, 33, 0.82);
    --ink: #d8e0e4;
    --ink-strong: #f1f5f6;
    --muted: #a5b1b8;
    --faint: #74838d;
    --border: rgba(220, 231, 236, 0.1);
    --border-strong: rgba(220, 231, 236, 0.18);
    --accent: #9eb8c4;
    --accent-strong: #b6ccd5;
    --accent-soft: #243237;
    --accent-glow: rgba(158, 184, 196, 0.12);
    --brand-coral: #e77872;
    --brand-coral-soft: #3a2625;
    --success: #8cb792;
    --success-soft: #233329;
    --warning: #dbb36d;
    --warning-soft: #362e20;
    --danger: #e28a85;
    --danger-soft: #3b2726;
    --code: #0b0d0c;
    --code-ink: #e6ebe4;
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.18);
    --shadow-md: 0 14px 38px rgba(0, 0, 0, 0.28), 0 2px 8px rgba(0, 0, 0, 0.2);
    --shadow-lg: 0 24px 72px rgba(0, 0, 0, 0.44), 0 4px 18px rgba(0, 0, 0, 0.25);
  }
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

body {
  margin: 0;
  background: var(--canvas);
  color: var(--ink);
  font: 14px/1.55 var(--font-sans);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

button,
input,
select,
textarea {
  color: inherit;
  font: inherit;
}

button,
select {
  -webkit-tap-highlight-color: transparent;
}

button {
  cursor: pointer;
}

button:disabled,
select:disabled,
input:disabled,
textarea:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
summary:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 72%, transparent);
  outline-offset: 2px;
}

::selection {
  background: color-mix(in srgb, var(--accent) 28%, transparent);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

`;
