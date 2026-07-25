# Changelog

All notable user-facing changes are recorded here. Orbit is pre-1.0; minor
versions may still include configuration or API migrations, which must be
called out explicitly.

## Unreleased

## 0.2.0 - 2026-07-25

### Changed

- Refined the Web UI into a clearer browser-first product workspace with
  stronger visual hierarchy, improved canvas and composer focus, more legible
  conversation layout, and verified desktop and narrow-screen behavior.
- Made `/webui` open the default browser automatically with a detected launch
  result. When automatic launch is unavailable, Orbit now keeps an
  authenticated clickable link pinned at the bottom of the full-screen TUI or
  as the final line in text mode.

### Fixed

- Hardened persisted checkpoints against forged session and checkpoint IDs,
  path traversal, malformed metadata, symlink escapes, and incomplete backup
  payloads that could otherwise produce an unsafe rollback.
- Made rollback failures return concise actionable results instead of allowing
  filesystem errors to crash the calling command.

No configuration migration is required from 0.1.11. Existing sessions and
project data remain compatible.

## 0.1.11 - 2026-07-22

### Added

- Added authenticated Web UI image input, queued follow-ups, reconnect replay,
  bounded activity history, and changes review with rollback, rewind, and
  redacted trace export.
- Added Streamable HTTP MCP with bounded JSON/SSE handling, session lifecycle,
  bearer and OAuth client-credentials authentication, plus trusted extension
  install/list/remove and administrator-managed policy enforcement.
- Added `orbit backup create|inspect|restore` with a versioned, size-bounded,
  credential-free project bundle and per-file SHA-256 integrity validation.

### Changed

- Hardened accepted-prompt durability and crash recovery. Resumed sessions seal
  incomplete tool protocol without replaying side effects, reset interrupted
  plan work safely, and expose one concise recovery report.
- Persisted tool start/end timing, risk, approval decision, and result status;
  the Web UI shows safe metadata while keeping raw tool inputs and output out of
  its activity summary.
- Extended provider capability overrides and DeepSeek V4 tool-stream handling
  while preserving model-aware context limits and mid-chat continuity.

### Fixed

- Prevented stale Web UI tabs from losing bounded events during short reconnects
  and tightened upload, extension, MCP, policy, and audit serialization limits.
- Made session metadata and history writes more durable across interrupted
  replacement, including parent-directory synchronization where supported.

No configuration migration is required from 0.1.10. Existing project data stays
compatible; project backups use schema version 1.

## 0.1.10 - 2026-07-21

### Added

- Added a guarded cross-platform source installer that rebuilds and repairs the
  global `orbit` command without replacing the npm executable with a wrapper.
- Added explicit installed-versus-running version state so `/update`, the TUI
  cat heart, and Web UI describe the same required restart.

### Changed

- Reorganized the repository and npm READMEs into a short product overview,
  task-oriented user guide, and maintainer ownership guide.
- Strengthened update verification and rollback while keeping startup checks
  non-blocking and install-free.

No configuration migration is required from 0.1.9.

## 0.1.9 - 2026-07-19

### Added

- Added keyboard-accessible `/` command discovery to the Web UI composer and
  command palette, including validated project and user custom commands.
- Connected `/timeline` and `/rewind <id|number>` to Orbit's persisted file
  checkpoints with localized, bounded history output.
- Added model-callable `update_plan` for durable multi-step progress and
  `web_fetch` for bounded, redirect-safe public source retrieval.

### Changed

- Unified built-in slash command names, usage hints, localized descriptions,
  terminal help, completion, and Web UI discovery under one catalog.
- Preserved dynamic MCP JSON Schemas end to end, normalized provider-compatible
  tool names, and added cancellation plus collision-safe registration.
- Bounded and redacted file, search, shell, test, Git, web, and MCP tool output
  before it enters model history or the terminal status stream.

### Fixed

- Rejected malformed, duplicate, unknown, and schema-invalid model tool calls
  without crashing the agent loop or persisting invalid provider history.
- Kept tool cancellation, permission preflight, checkpointing, and DeepSeek
  tool definitions consistent across repeated model sub-turns.

No configuration migration is required from 0.1.8.

## 0.1.8 - 2026-07-19

### Added

- Added a bounded dependency-aware agent task scheduler with normalized scope
  ownership, graph-wide timeout cancellation, and isolated parallel review.
- Added task-level acceptance limits for duration, tokens, cost, and measured
  prompt-cache hit rate, plus a protected credentialed DeepSeek release gate.
- Added a versioned, workspace-bound extension manifest validator covering
  compatibility, permissions, commands, skills, agents, tools, hooks, MCP
  servers, and templates without executing third-party code.
- Added real-browser Web UI release smoke tests, critical coverage thresholds,
  installed-package smoke tests, and generated third-party notices.

### Changed

- Moved new/resumed session I/O into an explicit bootstrap boundary so the
  agent loop constructor remains side-effect free.
- Routed hooks through the shared permission, approval, audit, cancellation,
  and secret-redaction path.
- Split terminal conversation grouping and environment telemetry into focused,
  tested view-model modules without changing the established TUI layout.
- Strengthened macOS credential cleanup and key migration, npm update rollback,
  provider capability routing, model-aware context budgeting, and MCP runtime
  lifecycle ownership.

### Fixed

- Preserved event IDs and schema-version compatibility across JSONL, TUI, Web
  UI, and trace consumers with a golden v1 wire fixture.
- Prevented agent DAG tasks from continuing after timeout and rejected unsafe
  scheduler reuse or overlapping nested write scopes.
- Kept legacy DeepSeek aliases on their documented thinking behavior while
  retaining V4 capability-aware routing for current models.
- Made `orbit doctor --provider <id>` apply the requested provider so protected
  DeepSeek and TokenDance release probes inspect the intended endpoint.
- Isolated Playwright specifications from Vitest discovery so unit and browser
  suites run through their correct test runners.

No configuration migration is required from 0.1.7.

## 0.1.7 - 2026-07-19

### Added

- Added `orbit clean` with explicit user/project scopes, inventory previews,
  versioned JSON output, exact interactive confirmation, and guarded
  non-interactive deletion.
- Added native macOS Keychain storage for the credential encryption key, with
  portable encrypted-file fallback when the native service is unavailable.
- Added an explicit `orbit update` workflow with npm latest-tag checks, semantic
  version validation, confirmation, timeouts, and machine-readable check mode.

### Changed

- macOS installations migrate an existing restricted `~/.orbit/master.key`
  into Keychain on first credential use. `orbit clean --user` removes both
  Orbit's user data and its native Keychain item; project source and instruction
  files remain untouched.
- Interactive `/update` now updates Orbit itself through the same guarded CLI
  updater instead of installing dependencies in the active project.
- The TUI cat heart now reflects the published Orbit version rather than project
  dependency timestamps: it blinks for an available release and stays steady
  when current or when the one-shot background check cannot complete.

## 0.1.6 - 2026-07-18

### Changed

- Reorganized the core agent runtime by separating tool-protocol parsing,
  SEARCH/replace and log transforms, audit-diff helpers, and local package
  binary execution from the main stateful agent loop.
- Rebuilt the repository and npm READMEs around the published installation,
  project/chat workflow, synchronized TUI/Web UI, provider profiles, live model
  discovery, local Ollama, DeepSeek V4 routing, and model-aware continuity.
- Added focused agent-runtime navigation and tests for the extracted support
  boundaries, keeping future maintenance changes easier to locate and verify.

No configuration migration or runtime behavior change is required from 0.1.5.

## 0.1.5 - 2026-07-18

### Added

- Project-scoped chat management with persisted chat metadata, recent-project
  recovery, archive/delete controls, and native Windows folder selection.
- Saved provider profiles, explicit OpenAI-compatible base URLs, authenticated
  model discovery, and live local Ollama model scanning.
- Durable `/goal`, `/plan`, and opt-in secret-redacted `/memory` workflows, plus
  local metrics, evaluation, and trace commands for production diagnosis.
- Capability-aware model metadata, automatic context-window budgeting, and a
  task router that keeps DeepSeek V4 Flash/Pro as the optimized primary path.

### Changed

- Reworked the Web UI into a responsive project-and-chat workspace with compact
  model/provider selectors, synchronized model state, improved navigation, and
  consistent Orbit line-art branding.
- Made model switching atomic across the TUI, Web UI, provider runtime, session
  history, and context compaction so a mid-chat switch preserves continuity.
- Hardened session audit serialization, project memory, worktree cleanup,
  verification contracts, file editing, benchmark gates, and secret redaction.

### Fixed

- Prevented stale model labels and transient selector flashes when switching
  providers or models, including local Ollama models.
- Restored the terminal screen cleanly on orderly Ctrl+C exit without leaving
  the Orbit TUI or duplicate shell prompts behind.
- Corrected Web UI reconnect, project-card alignment, select-menu clipping,
  assistant-avatar alignment, and responsive sidebar behavior.

No configuration migration is required from 0.1.4.

## 0.1.4 - 2026-07-17

### Added

- A production-grade Web UI conversation workspace with direct chat, live
  terminal synchronization, recent-session switching, searchable commands,
  file context selection, approval prompts, cancellation, and reconnect-safe
  drafts.
- Rich streamed responses for Markdown, tables, syntax-highlighted code,
  collapsible long blocks, tool progress, reasoning summaries, verification
  state, response copying, and jump-to-latest navigation.
- A cohesive responsive Orbit design system with the cat mark, light/dark/system
  themes, mobile navigation, a persistent desktop focus mode, keyboard shortcuts,
  accessible dialogs, and reduced-motion support.
- Model-aware `/compact` support, automatic context compaction, context-window
  telemetry, session titles, and production release/package auditing.

### Changed

- Reworked Web UI authentication and lifecycle handling around short-lived
  bootstrap credentials, authenticated cookies, bearer fallback, bounded SSE
  retries, and isolated server instances.
- Improved DeepSeek V4 Flash/Pro routing, cache-aware context construction,
  provider diagnostics, benchmark output, token budgeting, and streamed status
  reporting.
- Split the Web UI client, styles, approval flow, context picker, event stream,
  and runtime responsibilities into independently tested modules.
- Reduced session-switch latency by reusing the autocomplete candidate cache
  instead of rescanning the workspace for every Web UI navigation action.

### Fixed

- Prevented expired Web UI tabs from entering repeated unauthorized/reconnect
  loops while preserving drafts and providing a deterministic recovery path.
- Kept terminal and browser turns synchronized without duplicating history or
  routing slash commands through the wrong execution path.
- Preserved the npm `orbit` executable on Windows and kept CLI, workspace,
  extension, MCP, and package versions aligned for release.
- Hardened context paths, event payloads, approvals, cancellation, verification
  outcomes, session persistence, and sensitive diagnostic output.

## 0.1.3 - 2026-07-14

### Added

- Local authenticated Web UI with responsive chat, settings, cancellation, and
  live event streaming.
- DeepSeek V4 Flash/Pro routing, thinking-mode controls, cache telemetry,
  capability probes, and repeatable benchmarks.
- Persistent checkpoints, timeline rewind, custom slash commands, and
  cross-platform global CLI installation.
- Cross-platform CI, production dependency auditing, and CLI package-content
  verification.
- Versioned `doctor --json` support snapshots with strict automation status and
  workspace-path redaction.
- Explicit configuration schema versioning with safe legacy defaults and
  rejection of unsupported future formats.

### Changed

- Split the CLI command router, terminal UI, and Web UI into smaller ownership
  boundaries for safer maintenance.
- Hardened credential storage, workspace path verification, request redaction,
  and Web UI authentication.
- Bounded and validated LSP/MCP protocol input, redacted MCP process failures,
  and deterministic cleanup of autocomplete work.

### Fixed

- Prevented workspace traversal through added files and rollback paths.
- Prevented stopped Web UI instances from receiving events from later runs.
- Preserved prompt/history behavior and terminal fallback operation during the
  UI refactor.
