/** Conversation messages, rich content, tools, and empty-state styles. */
export const WEB_UI_CONVERSATION_STYLES = String.raw`
.conversation {
  position: relative;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  overflow: hidden;
}

.conversation::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 42% -16%, color-mix(in srgb, var(--accent) 7%, transparent), transparent 36%),
    radial-gradient(circle at 92% 12%, color-mix(in srgb, var(--brand-coral) 3%, transparent), transparent 26%),
    linear-gradient(color-mix(in srgb, var(--border) 18%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--border) 14%, transparent) 1px, transparent 1px);
  background-size: auto, auto, 48px 48px, 48px 48px;
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.42), transparent 48%);
  pointer-events: none;
}

.message-scroll {
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.message-scroll::-webkit-scrollbar,
.inspector-content::-webkit-scrollbar,
.sidebar::-webkit-scrollbar {
  width: 9px;
}

.message-scroll::-webkit-scrollbar-thumb,
.inspector-content::-webkit-scrollbar-thumb,
.sidebar::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--faint) 35%, transparent);
  border: 3px solid transparent;
  border-radius: 9px;
  background-clip: padding-box;
}

.message-column {
  width: min(var(--content-width), calc(100% - 48px));
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin: 0 auto;
  padding: 34px 0 40px;
}

.message-column:empty {
  display: none;
}

.message {
  position: relative;
  width: 100%;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 13px;
  animation: message-in 220ms ease-out both;
}

.message.user {
  grid-template-columns: minmax(0, 1fr);
}

.message-avatar {
  position: relative;
  width: 32px;
  height: 24px;
  display: grid;
  place-items: center;
  align-self: start;
  margin-top: 0;
  color: var(--accent-strong);
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}

.message-avatar .message-mark {
  width: 22px;
  height: 22px;
}

.message-content {
  min-width: 0;
}

.message.assistant .message-content {
  max-width: min(100%, 760px);
}

.message-role {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
  margin-bottom: 6px;
  color: var(--ink-strong);
  font-size: 12.5px;
  font-weight: 700;
}

.message-time {
  color: var(--faint);
  font-size: 10.5px;
  font-weight: 450;
}

.message-model {
  max-width: min(38vw, 260px);
  min-width: 0;
  padding: 2px 6px;
  overflow: hidden;
  color: var(--ink-muted);
  background: color-mix(in srgb, var(--surface-raised) 78%, var(--accent-soft));
  border: 1px solid color-mix(in srgb, var(--accent) 13%, var(--border));
  border-radius: 7px;
  font-size: 10.5px;
  font-weight: 650;
  line-height: 1.15;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-attachment {
  display: inline-flex;
  align-items: center;
  max-width: 220px;
  margin: 5px 5px 0 0;
  padding: 5px 8px;
  overflow: hidden;
  color: var(--muted);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 8px;
  font: 9px/1.3 var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message.user .message-content {
  grid-column: 1;
  justify-self: end;
  width: fit-content;
  max-width: min(680px, 78%);
  padding: 11px 15px;
  color: var(--ink-strong);
  background: color-mix(in srgb, var(--accent-soft) 64%, var(--surface-raised));
  border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--border));
  border-radius: 15px 15px 4px 15px;
  box-shadow: var(--shadow-sm);
}

.message.user .message-role {
  display: none;
}

.rich-text {
  min-width: 0;
  color: var(--ink);
  font-size: 15px;
  line-height: 1.68;
  overflow-wrap: anywhere;
}

.rich-text > :first-child {
  margin-top: 0;
}

.rich-text > :last-child {
  margin-bottom: 0;
}

.rich-text p {
  margin: 0.72em 0;
}

.rich-text h1,
.rich-text h2,
.rich-text h3 {
  margin: 1.35em 0 0.55em;
  color: var(--ink-strong);
  line-height: 1.28;
  letter-spacing: -0.02em;
}

.rich-text h1 {
  font-size: 21px;
}

.rich-text h2 {
  font-size: 17px;
}

.rich-text h3 {
  font-size: 15px;
}

.rich-text ul,
.rich-text ol {
  margin: 0.72em 0;
  padding-left: 1.5em;
}

.rich-text li {
  margin: 0.32em 0;
  padding-left: 0.2em;
}

.rich-text blockquote {
  margin: 0.9em 0;
  padding: 2px 0 2px 14px;
  color: var(--muted);
  border-left: 3px solid var(--border-strong);
}

.rich-text a {
  color: var(--accent-strong);
  text-decoration-color: color-mix(in srgb, var(--accent) 42%, transparent);
  text-underline-offset: 3px;
}

.rich-text code:not(.code-block code) {
  padding: 2px 5px;
  color: var(--ink-strong);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 5px;
  font: 0.88em/1.5 var(--font-mono);
}

.table-scroll {
  width: 100%;
  margin: 14px 0;
  overflow-x: auto;
  background: color-mix(in srgb, var(--surface-raised) 88%, transparent);
  border: 1px solid var(--border);
  border-radius: 11px;
  box-shadow: var(--shadow-sm);
  scrollbar-width: thin;
}

.table-scroll:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 62%, transparent);
  outline-offset: 2px;
}

.rich-table {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  color: var(--ink);
  font-size: 12.5px;
  line-height: 1.5;
}

.rich-table th,
.rich-table td {
  min-width: 108px;
  padding: 9px 12px;
  text-align: left;
  vertical-align: top;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.rich-table th:last-child,
.rich-table td:last-child {
  border-right: 0;
}

.rich-table tbody tr:last-child td {
  border-bottom: 0;
}

.rich-table th {
  color: var(--ink-strong);
  background: var(--surface-subtle);
  font-size: 11.5px;
  font-weight: 680;
}

.rich-table tbody tr:nth-child(even) td {
  background: color-mix(in srgb, var(--surface-subtle) 52%, transparent);
}

.message-actions {
  min-height: 27px;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 7px;
  opacity: 0;
  transform: translateY(-2px);
  transition: opacity 140ms ease, transform 140ms ease;
}

.message:hover .message-actions,
.message:focus-within .message-actions {
  opacity: 1;
  transform: translateY(0);
}

.message-action {
  min-width: 54px;
  height: 27px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 8px;
  color: var(--faint);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 7px;
  font-size: 10.5px;
}

.message-action:hover {
  color: var(--ink-strong);
  background: var(--surface-subtle);
  border-color: var(--border);
}

@media (hover: none), (pointer: coarse) {
  .message-actions {
    opacity: 0.82;
    transform: none;
  }
}

.code-block {
  position: relative;
  margin: 14px 0;
  overflow: hidden;
  color: var(--code-ink);
  background: var(--code);
  border: 1px solid color-mix(in srgb, var(--code-ink) 10%, transparent);
  border-radius: 12px;
  box-shadow: var(--shadow-sm);
}

.code-header {
  min-height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 7px 0 13px;
  color: #999b98;
  background: rgba(255, 255, 255, 0.035);
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  font: 10px/1 var(--font-mono);
}

.code-identity,
.code-actions {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.code-language {
  color: #d2d4cf;
  font-weight: 650;
  text-transform: lowercase;
}

.code-metadata {
  min-width: 0;
  overflow: hidden;
  color: #80837e;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.copy-code,
.expand-code {
  height: 25px;
  padding: 0 8px;
  color: #b9bbb7;
  background: transparent;
  border: 0;
  border-radius: 6px;
  font: 10px/1 var(--font-sans);
}

.copy-code:hover,
.expand-code:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}

.code-frame {
  position: relative;
}

.code-viewport {
  max-height: 620px;
  overflow: auto;
  scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
  scrollbar-width: thin;
  transition: max-height 180ms ease;
}

.code-viewport:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 64%, transparent);
  outline-offset: -2px;
}

.code-block.is-collapsed .code-viewport {
  max-height: 310px;
  overflow-y: hidden;
}

.code-block.is-collapsed .code-frame::after {
  content: "";
  position: absolute;
  inset: auto 0 0;
  height: 56px;
  background: linear-gradient(transparent, var(--code));
  pointer-events: none;
}

.code-lines {
  display: block;
  min-width: max-content;
  padding: 11px 0 13px;
  color: inherit;
  font: 12px/1.62 var(--font-mono);
  tab-size: 2;
}

.code-line {
  position: relative;
  display: block;
  min-width: 100%;
  min-height: 1.62em;
  padding: 0 18px 0 56px;
  white-space: pre;
}

.code-line::before {
  content: attr(data-line);
  position: absolute;
  left: 0;
  width: 42px;
  color: #61645f;
  text-align: right;
  user-select: none;
}

.code-line-text {
  white-space: pre;
}

.token-comment {
  color: #777d78;
  font-style: italic;
}

.token-string {
  color: #b7d59f;
}

.token-keyword {
  color: #c5a7e7;
}

.token-number,
.token-literal {
  color: #e3bd7f;
}

.token-function {
  color: #8fc7d5;
}

.token-property {
  color: #9ebbe4;
}

.code-line.is-addition {
  color: #c1e5c8;
  background: rgba(70, 150, 91, 0.16);
  box-shadow: inset 3px 0 rgba(79, 172, 104, 0.52);
}

.code-line.is-deletion {
  color: #efc2bd;
  background: rgba(190, 79, 69, 0.15);
  box-shadow: inset 3px 0 rgba(214, 92, 82, 0.5);
}

.code-line.is-hunk {
  color: #b9cde5;
  background: rgba(84, 125, 168, 0.14);
}

.code-line.is-diff-file {
  color: #a2a7a0;
  font-weight: 650;
}

.thinking-block {
  margin: 7px 0 14px;
  color: var(--muted);
}

.thinking-block summary {
  width: fit-content;
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  padding: 4px 9px;
  color: var(--muted);
  background: color-mix(in srgb, var(--surface-subtle) 72%, transparent);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
  list-style: none;
}

.thinking-block summary::-webkit-details-marker {
  display: none;
}

.thinking-block summary::before {
  content: "›";
  display: inline-block;
  margin-right: 7px;
  transition: transform 140ms ease;
}

.thinking-block[open] summary::before {
  transform: rotate(90deg);
}

.thinking-body {
  max-height: 260px;
  margin-top: 7px;
  padding: 5px 12px 9px 15px;
  overflow: auto;
  color: var(--faint);
  border-left: 2px solid var(--border-strong);
  font-size: 12px;
  white-space: pre-wrap;
}

.tool-card {
  margin: 9px 0;
  color: var(--muted);
  background: color-mix(in srgb, var(--surface-subtle) 88%, transparent);
  border: 1px solid var(--border);
  border-radius: 10px;
  font-size: 12px;
  overflow: hidden;
  transition: border-color 140ms ease, background 140ms ease;
}

.tool-card[open] {
  background: color-mix(in srgb, var(--surface-raised) 86%, transparent);
  border-color: var(--border-strong);
}

.tool-card-summary {
  min-height: 39px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 9px;
  padding: 7px 10px;
  cursor: default;
  list-style: none;
}

.tool-card.has-detail .tool-card-summary {
  cursor: pointer;
}

.tool-card-summary::-webkit-details-marker {
  display: none;
}

.tool-name {
  min-width: 0;
  overflow: hidden;
  color: var(--ink-strong);
  font: 600 11.5px/1.3 var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-outcome {
  color: var(--faint);
  font-size: 10.5px;
}

.tool-chevron {
  width: 14px;
  color: var(--faint);
  font-size: 16px;
  text-align: center;
  transition: transform 140ms ease;
}

.tool-card:not(.has-detail) .tool-chevron {
  visibility: hidden;
}

.tool-card[open] .tool-chevron {
  transform: rotate(90deg);
}

.tool-detail {
  max-height: 210px;
  margin: 0;
  padding: 10px 12px 12px 35px;
  overflow: auto;
  color: var(--muted);
  background: color-mix(in srgb, var(--surface-subtle) 62%, transparent);
  border-top: 1px solid var(--border);
  font: 10.5px/1.58 var(--font-mono);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.tool-status {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--warning);
  box-shadow: 0 0 0 3px var(--warning-soft);
}

.tool-card.is-success .tool-status {
  background: var(--success);
  box-shadow: 0 0 0 3px var(--success-soft);
}

.tool-card.is-success .tool-outcome {
  color: var(--success);
}

.tool-card.is-error .tool-status {
  background: var(--danger);
  box-shadow: 0 0 0 3px var(--danger-soft);
}

.tool-card.is-error .tool-outcome {
  color: var(--danger);
}

.stream-caret::after {
  content: "";
  display: inline-block;
  width: 6px;
  height: 1.15em;
  margin-left: 3px;
  vertical-align: -0.2em;
  background: var(--accent);
  border-radius: 1px;
  animation: caret 900ms steps(1) infinite;
}

.message-progress {
  width: fit-content;
  min-height: 29px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 1px 0 7px;
  padding: 0 10px;
  color: var(--muted);
  background: color-mix(in srgb, var(--surface-subtle) 78%, transparent);
  border: 1px solid var(--border);
  border-radius: 9px;
  font-size: 11px;
}

.message-progress[hidden] {
  display: none;
}

.message-progress-indicator {
  width: 9px;
  height: 9px;
  flex: 0 0 auto;
  border: 2px solid color-mix(in srgb, var(--accent) 28%, transparent);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 720ms linear infinite;
}

.message-progress.is-success .message-progress-indicator,
.message-progress.is-warning .message-progress-indicator,
.message-progress.is-error .message-progress-indicator {
  border: 0;
  animation: none;
}

.message-progress.is-success .message-progress-indicator {
  background: var(--success);
  box-shadow: 0 0 0 3px var(--success-soft);
}

.message-progress.is-warning .message-progress-indicator {
  background: var(--warning);
  box-shadow: 0 0 0 3px var(--warning-soft);
}

.message-progress.is-error .message-progress-indicator {
  background: var(--danger);
  box-shadow: 0 0 0 3px var(--danger-soft);
}

.empty-state {
  width: min(880px, calc(100% - clamp(40px, 7vw, 96px)));
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  margin: 0 auto;
  padding: clamp(72px, 11vh, 124px) 0 clamp(44px, 8vh, 86px);
  text-align: left;
}

.empty-state[hidden] {
  display: none;
}

.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  margin: 0 0 14px;
  color: var(--accent-strong);
  font: 720 10px/1.4 var(--font-mono);
  letter-spacing: 0.11em;
}

.eyebrow::after {
  content: "";
  width: 28px;
  height: 1px;
  margin-left: 3px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 55%, transparent), transparent);
}

.eyebrow-mark {
  width: 22px;
  height: 22px;
  color: var(--accent-strong);
}

.empty-state h1 {
  max-width: 720px;
  margin: 0;
  color: var(--ink-strong);
  font-size: clamp(34px, 2.65vw, 48px);
  font-weight: 690;
  letter-spacing: -0.035em;
  line-height: 1.16;
}

.empty-description {
  max-width: 600px;
  margin: 10px 0 0;
  color: var(--muted);
  font-size: 14.5px;
  line-height: 1.65;
}

.connection-help {
  display: none;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  margin: 0;
  padding: 9px 24px;
  color: var(--ink);
  background: color-mix(in srgb, var(--danger-soft) 72%, var(--surface));
  border-bottom: 1px solid color-mix(in srgb, var(--danger) 18%, var(--border));
  text-align: left;
  z-index: 14;
}

.app-shell.is-reconnecting .connection-help,
.app-shell.is-disconnected .connection-help {
  display: grid;
}

.app-shell.is-reconnecting .connection-help {
  color: var(--ink);
  background: color-mix(in srgb, var(--accent-soft) 78%, var(--surface));
  border-bottom-color: color-mix(in srgb, var(--accent) 22%, var(--border));
}

.app-shell.is-reconnecting .connection-help-icon {
  color: var(--accent-strong);
  background: color-mix(in srgb, var(--accent) 13%, transparent);
}

.app-shell.is-reconnecting .connection-help button {
  color: var(--accent-strong);
  border-color: color-mix(in srgb, var(--accent) 24%, var(--border));
}

.connection-help-icon {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  border-radius: 8px;
  font: 700 11px/1 var(--font-mono);
}

.connection-help > span:nth-child(2) {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.connection-help strong {
  color: var(--ink-strong);
  font-size: 11px;
}

.connection-help small {
  color: var(--muted);
  font-size: 10px;
  line-height: 1.4;
}

.connection-help button {
  height: 30px;
  padding: 0 10px;
  color: var(--danger);
  background: var(--surface-raised);
  border: 1px solid color-mix(in srgb, var(--danger) 18%, var(--border));
  border-radius: 7px;
  font-size: 10px;
  font-weight: 650;
}

.suggestion-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 16px;
  text-align: left;
}

.suggestion-card {
  min-width: 0;
  min-height: 62px;
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 10px 13px;
  color: var(--ink);
  background: color-mix(in srgb, var(--surface-raised) 72%, transparent);
  border: 1px solid var(--border);
  border-radius: 13px;
  text-align: left;
  box-shadow: 0 1px 2px rgba(26, 43, 40, 0.035);
  transition: background 150ms ease, border-color 150ms ease, transform 150ms ease, box-shadow 150ms ease;
}

.suggestion-card:hover {
  background: var(--surface);
  border-color: var(--border-strong);
  box-shadow: 0 10px 28px rgba(26, 43, 40, 0.08);
  transform: translateY(-1px);
}

.suggestion-icon {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  color: var(--accent-strong);
  background: var(--accent-soft);
  border: 1px solid color-mix(in srgb, var(--accent) 16%, var(--border));
  border-radius: 9px;
  font: 600 12px/1 var(--font-mono);
}

.suggestion-icon .ui-icon {
  width: 16px;
  height: 16px;
  stroke-width: 1.7;
}

.suggestion-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.suggestion-copy strong {
  color: var(--ink-strong);
  font-size: 12px;
  font-weight: 650;
}

.suggestion-copy small {
  overflow: hidden;
  color: var(--muted);
  font-size: 10px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}


`;
