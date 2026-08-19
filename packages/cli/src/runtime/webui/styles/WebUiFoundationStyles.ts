/** Design tokens, theme variants, and shared browser defaults. */
export const WEB_UI_FOUNDATION_STYLES = String.raw`
:root {
  color-scheme: light;
  --canvas: #f4f6f3;
  --canvas-deep: #e8ebe8;
  --sidebar: #eef0ed;
  --sidebar-ink: #202824;
  --sidebar-muted: #59645f;
  --sidebar-faint: #64706a;
  --sidebar-border: rgba(29, 43, 37, 0.11);
  --sidebar-surface: rgba(255, 255, 255, 0.5);
  --sidebar-active: rgba(255, 255, 255, 0.78);
  --surface: #fafbf9;
  --surface-raised: #ffffff;
  --surface-subtle: #eef2ef;
  --surface-hover: #e7ece9;
  --surface-glass: rgba(250, 252, 250, 0.9);
  --ink: #2c3834;
  --ink-strong: #111d19;
  --muted: #596761;
  --faint: #64716c;
  --border: rgba(28, 49, 42, 0.105);
  --border-strong: rgba(28, 49, 42, 0.18);
  --accent: #4f857b;
  --accent-strong: #276a5f;
  --accent-soft: #dfeee9;
  --accent-glow: rgba(70, 128, 116, 0.18);
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
  --shadow-sm: 0 1px 2px rgba(19, 36, 31, 0.07), 0 4px 12px rgba(19, 36, 31, 0.04);
  --shadow-md: 0 18px 48px rgba(10, 24, 20, 0.14), 0 3px 10px rgba(10, 24, 20, 0.06);
  --shadow-lg: 0 32px 90px rgba(8, 21, 17, 0.21), 0 6px 20px rgba(8, 21, 17, 0.08);
  --scrim: rgba(21, 27, 25, 0.32);
  --sidebar-width: clamp(232px, 14vw, 258px);
  --content-width: 880px;
  --composer-width: 900px;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 18px;
  --radius-xl: 24px;
  --font-sans: "Segoe UI Variable Text", Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", sans-serif;
  --font-mono: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --canvas: #151b21;
  --canvas-deep: #11171c;
  --sidebar: #141a20;
  --sidebar-ink: #f4f6f7;
  --sidebar-muted: #9aa5ae;
  --sidebar-faint: #79858e;
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
  --faint: #81919b;
  --border: rgba(220, 231, 236, 0.1);
  --border-strong: rgba(220, 231, 236, 0.18);
  --accent: #83aca4;
  --accent-strong: #a9ccc4;
  --accent-soft: #21322e;
  --accent-glow: rgba(131, 172, 164, 0.13);
  --brand-coral: #e77872;
  --brand-coral-soft: #3a2625;
  --success: #8cb792;
  --success-soft: #233329;
  --warning: #dbb36d;
  --warning-soft: #362e20;
  --danger: #e28a85;
  --danger-soft: #3b2726;
  --code: #10161c;
  --code-ink: #e7edf0;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.18);
  --shadow-md: 0 14px 38px rgba(0, 0, 0, 0.28), 0 2px 8px rgba(0, 0, 0, 0.2);
  --shadow-lg: 0 24px 72px rgba(0, 0, 0, 0.44), 0 4px 18px rgba(0, 0, 0, 0.25);
  --scrim: rgba(0, 0, 0, 0.5);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --canvas: #151b21;
    --canvas-deep: #11171c;
    --sidebar: #141a20;
    --sidebar-ink: #f4f6f7;
    --sidebar-muted: #9aa5ae;
    --sidebar-faint: #79858e;
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
    --faint: #81919b;
    --border: rgba(220, 231, 236, 0.1);
    --border-strong: rgba(220, 231, 236, 0.18);
    --accent: #83aca4;
    --accent-strong: #a9ccc4;
    --accent-soft: #21322e;
    --accent-glow: rgba(131, 172, 164, 0.13);
    --brand-coral: #e77872;
    --brand-coral-soft: #3a2625;
    --success: #8cb792;
    --success-soft: #233329;
    --warning: #dbb36d;
    --warning-soft: #362e20;
    --danger: #e28a85;
    --danger-soft: #3b2726;
    --code: #10161c;
    --code-ink: #e7edf0;
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.18);
    --shadow-md: 0 14px 38px rgba(0, 0, 0, 0.28), 0 2px 8px rgba(0, 0, 0, 0.2);
    --shadow-lg: 0 24px 72px rgba(0, 0, 0, 0.44), 0 4px 18px rgba(0, 0, 0, 0.25);
    --scrim: rgba(0, 0, 0, 0.5);
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
  overscroll-behavior: none;
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
summary:focus-visible,
a:focus-visible,
[tabindex]:focus-visible {
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
