# Changelog

All notable user-facing changes are recorded here. Orbit follows semantic
versioning, and configuration or API migrations are called out explicitly.

## Unreleased

## 1.6.2 - 2026-08-17

### Fixed

- Fix the Windows AppContainer helper MSVC warnings-as-errors release gate by
  defining `NOMINMAX` in one place and converting diagnostic wide strings to
  UTF-8 without narrowing conversions.

## 1.6.1 - 2026-08-17

### Mature harness controls

- Add an executable package-layer architecture contract with strict workspace
  dependency direction checks, unknown-package detection, maintainer guidance,
  and release verification coverage.
- Bound the process-wide workspace retrieval cache to eight least-recently-used
  project services so long-lived WebUI and daemon processes do not retain one
  index per project forever.
- Harden daemon SSE delivery against disconnect/write races and clean up both
  request-aborted and response-closed followers without allowing a broken
  client to fail a running task.

- Add an optional offline RS256/JWKS daemon identity adapter with exact
  issuer/audience and time validation, scope/role mapping, clock-skew bounds,
  and CLI `daemon start --jwks --issuer --audience` wiring. Add fsynced,
  redacted, hash-chained local daemon audit records with configurable
  fail-closed append behavior.
- Add provider-neutral fleet/offload primitives: signed job envelopes,
  worker leases and heartbeats, stale-worker recovery, bounded retry,
  explicit patch ownership/base revision/file scope, result digests,
  cancellation, and injected persistence. Add a bounded authenticated
  FleetHttpServer/FleetHttpClient transport with signed idempotent submission,
  worker/control scopes, optional worker-principal identity binding,
  HTTPS-or-loopback policy, and optional fail-closed audit without pretending
  to be a hosted cloud service.
- Add a source-complete CMake/C++ Windows AppContainer helper with structured
  argv validation, per-run AppContainer token/capabilities, declared-root ACL
  grants/restoration, kill-on-close Job Object process-tree cleanup, and
  explicit network policy. CI and the release workflow now compile the helper
  on a real Windows runner; binaries remain administrator-built, signed, and
  separately installed.
- Add bounded `capture_audio` and `inspect_accessibility` tools with ffmpeg
  DirectShow/AVFoundation/Pulse adapters, Windows UI Automation/macOS
  Accessibility/Linux AT-SPI readers, explicit privacy/permission boundaries,
  password-value omission, cancellation, and dependency diagnostics.
- Add local `transcribe_audio` through an explicitly installed Whisper CLI,
  with workspace-safe paths, bounded audio/transcript sizes, cancellation,
  timeout, sanitized environment, and dependency-missing diagnostics; add TUI
  `/attach`, `/attachments`, and `/detach` image staging with signature and
  vision-capability checks.
- Extend `inspect_document` with explicit Tesseract OCR for image files and
  bounded scanned-PDF page extraction through `pdftoppm`, preserving the
  no-upload and dependency-missing contract.
- Add optional per-model `maxImages` and `maxImageBytes` capability limits so
  vision attachments are rejected before provider transport when a gateway
  advertises stricter media ceilings.
- Add model-identity-aware provider composition so DeepSeek V4 models routed
  through TokenDance or another OpenAI-compatible gateway automatically use
  the DeepSeek serializer/reasoning/cache policy while generic models remain on
  their gateway's normal wire format.
- Add hosted ACP registry transport through `fetchAcpRegistry()` and
  `orbit acp registry fetch --url`: HTTPS-only bounded fetch, cancellation and
  timeout, redirect/body limits, Ed25519 trust-root verification, signed
  owner/registry-id/revision/expiry provenance, ETag/304 validation, atomic
  workspace pinning, and explicit rollback protection. Fetching never grants
  entry execution trust or pretends to be a central organization index.
- Activate explicitly trusted extension lifecycle Hooks only after manifest
  process permission, installed-tree integrity, and signature/trust checks.
  Hook execution now carries extension provenance, uses a required native
  sandbox with a read-only extension root, denies network, strips credentials,
  preserves approval/timeout/cancellation/audit behavior, and can be disabled
  centrally with `disableExtensionHooks`; unsupported Windows hosts fail closed.
- Activate versioned `contributes.tools` through a fixed Node stdin/stdout
  protocol. Extension tools require process permission, strict closed-object
  input schemas, required native sandboxing, declared workspace roots, denied
  network, bounded output, cancellation, timeout, redaction, and process-tree
  cleanup; arbitrary extension JavaScript is never imported into Orbit. Add
  signed-policy `disableExtensionTools` enforcement and apply policy before
  extension trust/allow-list materialization.
- Add provider-neutral `orbit review export` with bounded JSON/SARIF 2.1.0
  output, workspace-relative locations, finding fingerprints, disposition
  metadata, and atomic in-workspace writes for CI/code-scanning ingestion.
- Add bounded local ACP registry discovery with user/project precedence,
  symlink rejection, stable manifest digests, validation diagnostics, and an
  explicit trust gate before a manifest can become executable config.
- Add Ed25519-signed ACP registry artifacts using configured trust roots,
  canonical payloads, stable unsigned digests, tamper/untrusted-key rejection,
  signature status diagnostics, and optional fail-closed
  `acp registry ... --require-signature` enforcement.
- Add `orbit sessions retention` with age/count/byte dry-run plans, active-session
  protection, explicit automation confirmation, bounded tree measurement, and
  optimistic concurrency checks before deletion.
- Fix a WebUI bootstrap focus race so asynchronous initialization never steals
  focus from a queue editor or another control the user has already opened.
- Add terminal-aware TUI color modes (`auto`, `always`, and `never`) with
  `NO_COLOR`, `FORCE_COLOR`, and `TERM=dumb` handling for CI and accessibility.
- Add an opt-in persistent `tui.keymap: vim` main-composer mode with explicit
  INSERT/NORMAL state, bounded navigation/editing, Vim operators (`dw`, `cw`,
  `D`, `C`), one-step undo, and preserved global Ctrl shortcuts without
  changing approval or selection-dialog semantics. Add persisted named themes:
  `morandi`, `high-contrast`, and `plain`.
- Add bounded automatic stdio MCP recovery with per-server enable/max-attempt/
  window/backoff policy, catalog refresh, crash-loop suspension, cancellation,
  and no automatic replay of an ambiguous tool call.
- Add `tui.accessibility: screen-reader`, a line-oriented assistive terminal
  path that avoids alternate-screen rendering, mouse capture, dynamic spinner,
  cursor redraws, and ANSI formatting while preserving Agent controls.
- Add signed managed-policy `allowedExtensions` organization allow-lists;
  unlisted installed extensions fail closed before any contribution is
  materialized, even when their local digest and trust checks are valid.
- Add a provider-safe `orbit review github-check` adapter with dry-run-first
  GitHub Checks payloads, explicit `--apply`, token-env isolation, bounded
  annotations, optional PR-head SHA verification, timeout, response limits, and
  redacted API errors.
- Add idempotent `orbit review github-comment` with marker-based duplicate
  detection, safe relative paths, bounded line annotations, dry-run-first
  behavior, paginated duplicate detection, fail-closed path/list limits,
  opaque-token redaction, and partial-failure reporting.
- Add dry-run-first `orbit review github-dispatch` for explicit GitHub Actions
  workflow dispatch with bounded repeatable inputs, safe workflow/ref/repository
  validation, HTTPS/custom-host policy, timeout, bounded responses, and opaque
  token redaction.
- Extend daemon CLI controls to explicit remote URLs through the typed
  `DaemonClient`, with token-env isolation and HTTPS/loopback transport policy;
  local `daemon start` remains separate from remote handoff.
- Harden daemon task ownership for cross-process recovery: every attempt now
  carries a non-CLI lease token, event/heartbeat/finish writes reject stale
  owners, and exclusive per-record locks prevent duplicate claims while still
  reclaiming bounded stale locks after a crash.
- Add optional signed administrator policy bundles with canonical SHA-256
  payloads, Ed25519 trust roots, policy owner/id/revision/expiry validation,
  private trust-root file loading, and `ORBIT_MANAGED_POLICY_REQUIRE_SIGNATURE`
  fail-closed enforcement.
- Add bounded `inspect_document` and privacy-sensitive `capture_screenshot`
  model tools with workspace-safe paths, no shell interpolation, bounded output,
  cancellation/timeouts, native extractor/backend probing, and explicit
  dependency-missing failures across Windows, macOS, and Linux.
- Add daemon-local scoped principals for least-privilege integrations:
  constant-time token matching and read/submit/control/admin endpoint
  authorization, while preserving the existing local-admin token-file path.
- Materialize extension-contributed Agent Profiles transactionally beside
  commands and Skills, discover them through an extension-owned namespace with
  direct-profile precedence, and reject links, directories, nested traversal,
  or non-YAML/JSON contribution files.
- Add truthful process-sandbox execution for Bash and verification commands:
  macOS sandbox-exec, Linux bubblewrap/firejail detection, network policy
  propagation, degraded diagnostics, and fail-closed required mode. Windows
  now also has a separately trusted `windows-appcontainer-helper` contract:
  helper path, regular-file state, SHA-256, Ed25519 signature, trust root, and
  structured argv boundaries are all verified before selection; Windows shell
  fallback now resolves `cmd.exe` through `SystemRoot` so required native
  sandbox execution never receives an avoidable relative executable path;
  missing or invalid attestations never become an OS-sandbox claim.
- Add official ACP v1 external-Agent bridge and `orbit acp list|probe|run`, with
  independent external runtime ownership, permission mediation, cancellation,
  timeout recovery, and bounded redacted updates.
- Add `orbit acp sessions <agent>` for bounded, redacted ACP `session/list`
  discovery without silently importing external threads into Orbit.
- Continue durable ACP sessions through `orbit acp run --session <id>` with
  capability-driven `session/resume` to `session/load` fallback, replay/current
  turn separation, and explicit `orbit acp close` resource release. Shared
  control connections own negotiation, timeout, stderr, and process cleanup.
- Add explicit `orbit acp import <agent> <session>` history migration: bounded
  read-only `session/load`, inert tool/plan evidence, binary omission, digest
  deduplication, rollback on persistence failure, and fail-closed truncation
  unless `--allow-truncated` is explicit.
- Wire MCP Roots, form/URL Elicitation, and approval-gated basic Sampling into
  AgentLoop for both stdio and Streamable HTTP transports. Tool-enabled Sampling
  remains explicitly rejected because MCP `2026-07-28` deprecated Sampling and
  recommends that new implementations do not extend it.
- Preserve URL elicitation completion notifications and `-32042` required-flow
  errors as typed runtime events; add Roots `listChanged` notification APIs and
  catalog-change forwarding for Streamable HTTP.
- Preserve structured `input_required` payloads from `tasks/result` and return
  them from `waitForTask` instead of silently coercing them into empty tool
  results.
- Add per-server MCP interaction policy for independently disabling elicitation,
  sampling, or roots before capability advertisement.
- Honor MCP tool-level `execution.taskSupport` metadata and refuse task
  augmentation for tools that do not explicitly allow it.
- Add explicit, concurrent-safe stdio MCP reconnect with a fresh handshake,
  capability/tool refresh, bounded recovery accounting, and no unbounded
  third-party process restart loop.
- Persist structured multi-agent review findings and enforce rejection for open
  P0/P1 findings; add `orbit review list|show|set|verify` disposition, bounded
  audit-history, and CI-gate controls.
- Add Ed25519 extension signatures over canonical manifests and immutable tree
  digests, enforced by configured managed trust roots.
- Add mature Agent Profile runtime boundaries: named MCP server allow-lists and
  profile-owned lifecycle hooks are validated, inherited, applied before global
  hooks, and reconfigured only at idle boundaries.
- Add the shared `/agent [profile|default]` picker for TUI/REPL/WebUI command
  surfaces and reject worktree-only profiles on main-workspace interactive
  runs instead of silently violating their isolation contract.
- Add `@orbit-build/daemon` and the complete
  `orbit daemon start|status|submit|tasks|inspect|events|cancel|resume|remove|stop`
  lifecycle: a loopback-by-default bearer-authenticated task control plane with
  optional TLS, allowed roots, durable leases/heartbeats/orphan recovery,
  cancellation, explicit resume, bounded SSE replay/follow, slow-client limits,
  and explicit terminal retention cleanup across CLI/WebUI/client processes.
- Harden daemon persistence and shutdown with exclusive atomic token creation,
  schema-bound metadata, journal symlink rejection, task-count retention,
  stable terminal transitions, bounded/redacted spawn failures, and no-follow
  event snapshots for automation.
- Export a schema-validating `DaemonClient` for WebUI, desktop, editor, and
  remote hosts, including bounded JSON/SSE reads, replay/follow callbacks,
  cancellation, resume, terminal removal, and redacted protocol errors.

### Durable execution invariants

- Add a single validated lifecycle transition policy for persisted Agent runs
  and child agents. Repeated cleanup with the same terminal status is
  idempotent; stale terminal rewrites now fail instead of corrupting receipts.
- Keep the transition policy exported from `@orbit-build/session` so future
  daemons, WebUI handoff, and remote clients can share the same state machine.

### MCP capability visibility

- Detect and expose MCP resource subscriptions, list-change notifications,
  elicitation, and sampling capabilities without treating a server's
  advertisement as proof that a user interaction is safe.
- Add validated server-initiated `roots/list` handling, plus
  `resources/subscribe`, `resources/unsubscribe`, and resource-update listeners
  for stdio and Streamable HTTP clients.
- Surface modern MCP `input_required` results as a structured
  `McpInputRequiredError` and allow explicitly supplied host handlers to answer
  server-initiated roots/list, elicitation, and sampling requests over stdio and
  Streamable HTTP. No default handler fabricates user input, exposes a root, or
  silently invokes a model.
- Extend `orbit doctor --json` with an explicit capability-boundary snapshot:
  workspace/worktree isolation and ACP external-Agent bridging are present,
  while Windows/OS sandboxing, cloud offload, and arbitrary signed-extension
  code execution remain unavailable.

### Evaluation evidence

- Add versioned, deterministic acceptance-suite metadata with bounded tags and
  an optional fixture hash; JSON evaluation reports retain that metadata so
  cross-model and cross-release comparisons are reproducible.

### Agent control plane

- Add `orbit runs list|inspect|recover` for bounded, redacted inspection of
  durable multi-Agent runs from a separate terminal. Expired process leases can
  be recovered into explicit failed/blocked states; the command never deletes
  records or claims that a child session was resumed.
- Route background Bash commands through the same Process Sandbox contract as
  foreground execution, including network policy, trust roots, sanitized
  environments, bounded output, cancellation, and Windows process-tree
  termination fallbacks when `taskkill` is restricted by the host.
- Make the Windows release harness deterministic under managed identities:
  tests use one serialized worker with bounded extended startup timeouts,
  child-process fixtures stay in an ignored workspace sandbox, and installed
  CLI smoke packs from that same isolated boundary before uninstall verification.

## 1.5.0 - 2026-08-15

### Durable Agent configuration

- Add bounded Agent Profile inheritance with explicit-field child overrides,
  cycle/depth protection, and diagnostics before runtime execution.
- Add portable `effort` settings to profiles and carry them through one-shot
  runs plus Planner, Coder, and Reviewer agents. DeepSeek V4 maps the generic
  five-level preference to its native reasoning contract automatically.

### MCP durable tasks

- Add validated durable task creation, status retrieval, pagination, result
  retrieval, cancellation, status notifications, and bounded polling to both
  stdio and Streamable HTTP MCP clients.
- Preserve compatibility with synchronous and legacy MCP servers; unsupported
  task capability now produces an actionable diagnostic instead of a silent
  fallback.

### Mission Control

- Make the WebUI task card distinguish ready, running, waiting-for-approval,
  and cancelling states, including a redacted approval reason when available.
- Keep the status contract keyboard-safe, responsive, and compatible with SSE
  reconnect and cancellation behavior.

### Cross-platform reliability

- On Windows, wait for terminated background-process handles to close before
  finalizing task cleanup, preventing intermittent `EPERM` failures when a
  temporary workspace is removed immediately after cancellation.

### Release boundaries

- Add the 1.5.0 harness audit with verification evidence and explicit non-claims
  for OS sandbox, remote execution, ACP, full MCP elicitation/sampling, and
  enterprise governance.

## 1.0.1 - 2026-08-15

### Agent Profiles and command compatibility

- Add schema-validated project/user Agent Profiles with deterministic
  precedence, bounded YAML/JSON loading, duplicate and malformed-manifest
  diagnostics, and `orbit agents list|validate` automation.
- Apply selected profiles to provider/model choice, managed-policy-safe
  permission and iteration limits, planner/coder prompt policy, and tool
  allow/deny filters without bypassing the shared approval or audit path.
- Add `/permissions` as a compatibility alias for `/mode` while preserving the
  existing Full Access confirmation and persisted mode behavior.

### Release readiness

- Align the root workspace, every publishable package, and the VS Code
  extension at `1.0.1`.
- Verify the release artifact, provenance workflow, package allowlist, smoke
  install, dependency audit, and cross-surface test gates before publication.

### Competitive harness audit

- Add a Codex, Claude Code, and Zed capability matrix with explicit Orbit
  evidence and non-claims in `docs/HARNESS_AUDIT_0.9.2.md`.
- Record the full cross-platform acceptance suite and the competitive harness
  boundaries in `docs/HARNESS_AUDIT_0.9.2.md`.

## 1.0.0 - 2026-08-15

### Production harness foundation

- Make provider startup a first-class failure boundary: initialization errors
  are persisted, shown with a bounded message, and returned as a deterministic
  `provider_error` outcome instead of being swallowed.
- Give semantic context compaction the owning run's cancellation signal and
  usage callback, so compaction tokens and cost telemetry are accounted for
  exactly like visible model turns.
- Move retry ownership to the Agent loop for orchestrated runs. Provider
  transports accept an explicit `retryBudget`, preventing nested transport and
  Agent retries from multiplying latency and spend; standalone provider calls
  retain their existing defaults.
- Surface durable agent-run lease loss through an owner callback so long tasks
  can report that persistence stopped renewing instead of silently continuing
  without recovery metadata.
- Stop sending full source diffs to remote models for automatic commit-message
  generation. The optional helper now sends only redacted file paths and line
  counts, preserving convenience without exfiltrating proprietary content.

### WebUI recovery and evidence integrity

- Prefer session/task identity carried by an event payload when routing SSE
  events, reducing cross-turn attribution during concurrent work.
- Report bounded SSE replay-window gaps explicitly and reconcile the authoritative
  session snapshot in the browser instead of presenting an incomplete stream as
  if it were current.
- Fail vector-cache persistence loudly with a bounded diagnostic and expose the
  last persistence error for health checks; silent cache loss is no longer
  mistaken for a successful index update.

### Compatibility and migration

- All workspace packages and the VS Code extension are aligned at `1.0.0`.
- Existing provider callers remain compatible: omit `retryBudget` to keep the
  provider's configured retry policy. Orbit Agent runs set it to `0` and apply
  the loop-level bounded retry/fallback policy.
- Existing session, agent-run, vector-cache, WebUI SSE, and CUMCM project data
  remains readable; no destructive migration is required.

## 0.9.0 - 2026-08-15

### Typed lifecycle and policy automation

- Replace the two-hook baseline with typed session, prompt, permission,
  pre/post tool, tool-failure, compaction, verification, subagent, and stop
  lifecycle events. Each command has a bounded timeout, safe glob matcher, and
  explicit block/warn/ignore policy while retaining legacy `preEdit` and
  `postEdit` compatibility.
- Keep Hook payloads metadata-only and credential-redacted; raw prompts, tool
  arguments, model output, and diffs never enter the Hook environment. Route
  every Hook through the same permission, approval, cancellation, event, and
  audit path as other executable tools.

### Live MCP runtime health

- Consume bounded stdio catalog-change notifications and refresh tool,
  resource, and prompt registrations transactionally without restarting
  healthy servers. Compatible HTTP catalogs refresh between user turns or on
  explicit request.
- Add `/mcp status` and `/mcp refresh [server]` with browser-safe protocol,
  connection, registered-tool, recovery-count, and redacted-error diagnostics.
  Preserve old registrations when a replacement catalog collides or fails.

### Reviewable workflow reuse

- Add `orbit workflow-export` and `/workflow export` to compile an existing
  credential-redacted session trace into a local or versioned Skill. The
  compiler extracts objectives, plan steps, tool families, verification, and
  failure signals but deliberately excludes raw history, commands, arguments,
  outputs, diffs, and absolute paths.
- Create exported Skills atomically, refuse overwrites, invalidate interactive
  Skill caches immediately, and require regenerated operations to pass current
  permissions instead of blindly replaying historical side effects.

### Competitive acceptance evidence

- Extend acceptance limits and reports with attempts, approval requests, tool
  failures, denied tools, compactions, failure rate, crash/abort rate, median
  duration, verification pass rate, token/cache totals, and unintended-file
  findings. Suite-level defaults make reliability metrics enforceable gates.
- Expand the checked-in cross-language DeepSeek baseline from six to eight
  tasks with isolated multi-file API migration and merge-conflict resolution
  scenarios.

## 0.8.6 - 2026-08-15

### Reliable autonomous execution

- Keep foreground request deadlines, stream waits, retry backoff, cancellation
  grace periods, background-task joins, web search, and provider diagnostics
  referenced until their awaited work settles, preventing Node from ending a
  long task with an unresolved top-level await.
- Normalize premature OpenAI-compatible, Anthropic-compatible, and DeepSeek
  Responses stream closure as retryable transport failure before output while
  preserving partial-output state after any delta so tool side effects are
  never replayed blindly.
- Return bounded, credential-redacted stdout and stderr with failed commands to
  both the Agent and UI. The DeepSeek Flash path-boundary eval consequently fell
  from repeated redirection/debug attempts to one focused implementation pass.

### Merge-aware parallel agents

- Add validated structured writer plans with at most four disjoint ownership
  scopes; malformed, traversing, absolute, duplicate, or overlapping plans fall
  back to the established single-writer path.
- Run each writer in its own Git worktree, reject actual changes outside its
  declared ownership, integrate binary-safe deltas into a separate review
  worktree, and merge into the user's workspace only after the existing
  multi-perspective review accepts the combined result.
- Preserve the user's dirty state throughout orchestration, roll back a failed
  integration target, bypass repository hooks for automatic commits, and clean
  temporary branches/worktrees on accepted and safely rejected paths.

### Context, Skills, and verified evals

- Require at least two independent lexical signals for implicit Skill
  activation unless the Skill name is mentioned, eliminating incidental
  `workflow` matches while retaining explicit `$skill-name` priority.
- Give automatic codebase search, symbol references, and landmark maps separate
  hard budgets; explicit `@codebase` requests retain a larger bounded review
  budget without allowing a small coding task to absorb the repository map.
- Install reviewed eval commands as an isolated verification contract only
  after `--allow-commands`, aligning the Agent completion gate with the outer
  scorer without globally trusting arbitrary Node or Python scripts.
- Record a complete DeepSeek V4 Flash acceptance run at 6/6 tasks after the
  transport, completion, and context changes; the evidence remains local and
  credential-redacted under the evaluation runtime directory.

### CUMCM delivery contract

- Remove empty legacy `paper/sections` and `paper/build` shells during additive
  bootstrap while preserving every non-empty authored legacy project.
- Reject qN deliveries that contain only `main.py` or an unimplemented TODO
  scaffold before LaTeX compilation. The hidden `.cumcm/finalize.py` remains a
  trusted workflow launcher only and is excluded from modeling code, the source
  appendix, and the support archive.
- Keep the human-facing paper directory limited to `main.tex`, AI-use details,
  final PDFs, and `支撑材料.zip`; retain descriptive Chinese result/figure names
  and Chinese table schemas unless the problem supplies an immutable schema.

## 0.8.5 - 2026-08-15

### Cross-platform release portability

- Build Windows PowerShell candidate paths with `path.win32` even when the
  Windows resolver is exercised from Linux or macOS, keeping native execution,
  quoted executable normalization, and CI tests deterministic across hosts.
- Supersede the source-only 0.8.4 GitHub release after its Linux publication
  gate caught the host-dependent path construction before any npm artifact was
  published.

## 0.8.4 - 2026-08-15

### Uninterrupted long-running agents

- Make Full Access continue periodic iteration checkpoints automatically instead
  of interrupting at 20/40/60 rounds, while retaining cancellation, budgets,
  stalled-loop detection, and the configured final iteration ceiling.
- Raise the default single-task allowance from 64 to 200 model/tool rounds and
  the supported configurable ceiling from 200 to 1,000 rounds.
- Expose the effective long-task iteration limit in WebUI settings and persist
  it per project without bypassing CLI overrides or administrator policy.

### Native tool execution and faster feedback

- Execute agent-authored commands in native non-interactive PowerShell on
  Windows and Bash/POSIX sh on macOS/Linux, with matching platform guidance so
  models no longer guess the shell dialect or prepend redundant workspace
  changes.
- Preserve native-process exit codes through Windows PowerShell and recognize
  quoted executable paths, standard Python syntax checks, and CUMCM
  finalization as completion evidence, preventing successful deliveries from
  being recorded as failed.
- Cap oversized background waits instead of rejecting them, condense schema
  failures into field-level repair hints, and detect varied read-only shell
  probes against the same files before they burn long-task iterations.
- Show credential-redacted command summaries in WebUI and collapse three or
  more consecutive low-value read/search/shell steps into one accessible tool
  group while keeping failures and verification steps prominent.

### Skill and agent workflow foundations

- Redesign the bundled CUMCM project contract so `paper/` contains only the two
  authored TeX files and final PDF/ZIP deliverables, while `.cumcm/` owns build
  caches, generated appendices, profiles, evidence state, audits, and the trusted
  finalizer launcher. New projects no longer expose `paper/sections`,
  `paper/build`, `code/finalize.py`, empty shared modules, synthetic
  `summary.json`, or an all-purpose dependency list.
- Require real responsibility-named qN modules before strict completion, keep
  `main.py` orchestral, require descriptive Chinese figure names, reject generic
  `summary/plot/output/final` visuals, and package only runnable code, necessary
  results/figures, the AI details PDF, and renamed environment evidence.
- Update the bundled CUMCM workflow to the official 2026 trial AI-use rule,
  including the declaration before references, current official wording,
  support-PDF contract, executable training/formal submission intent, team-led
  core analysis, and removal of obsolete inline marker and AI-bibliography
  gates.
- Add targeted `skills validate --directory <path...> --deep` checks so Skill
  authors can validate the source bundle they are editing even when a personal
  installation with the same name wins normal discovery precedence.
- Turn the project-local CUMCM finalizer marker into a trusted terminal
  completion contract: after verified success Orbit blocks later tool calls and
  requests only the final delivery report, while a new user instruction rearms
  the Agent for further work.

## 0.8.3 - 2026-08-14

### Full Access controls

- Make Full Access genuinely unrestricted: every tool risk is approved,
  dangerous and opaque commands are no longer intercepted, and filesystem
  tools may address paths available to the current host account.
- Require an explicit, keyboard-accessible WebUI confirmation before elevating
  to Full Access, with clear host-process and safety-boundary disclosure.
- Keep non-permission runtime controls—schema validation, bounded output,
  cancellation, timeouts, and periodic cost/runaway checkpoints—independent
  from Full Access.
- Remove secondary execution boundaries in Full Access: outside-workspace
  writes no longer enter workspace checkpoint code, post-write acceptance is
  automatic, private network targets are available, and child commands inherit
  the current process environment.
- Apply the same Full Access semantics to Agent-owned formatters, linters,
  dependency installers, hooks, verification commands, background processes,
  and Git flows; secondary dependency-install, repair, and failed pre-commit
  permission prompts no longer interrupt autonomous work.
- Continue redacting credentials from logs, sessions, events, and model-visible
  output even when unrestricted child processes may use those credentials.
- Clarify the remaining non-permission boundaries: existing child processes
  retain inherited authority until stopped, project hooks and verification
  contracts remain active, and workspace services such as rollback and context
  indexing do not extend to arbitrary host paths.

## 0.8.2 - 2026-08-14

### WebUI project onboarding

- Unified the project dialog around one Open or create action. Selecting an
  existing folder now safely adds and opens it instead of failing with a
  contradictory folder-already-exists error; a missing final directory is
  still created only when its parent exists.
- Refresh the originating sidebar after a successful project handoff so the
  new project appears immediately, and replace blank handoff tabs with an
  Orbit status surface that closes cleanly on launch failures.
- Keep project handoffs atomic in the browser: the dialog remains visibly busy
  and cannot be dismissed while startup is in flight, typed launcher failures
  are localized, and native picker process failures are no longer mistaken for
  a user cancellation.
- Revalidate canonical project paths after resolving links so a junction or
  symlink cannot bypass the filesystem-root guard; project API paths now reject
  control characters at the HTTP boundary.

## 0.8.1 - 2026-08-14

### WebUI sidebar and project workflow

- Kept the Orbit identity, New chat action, tools, and project header anchored
  when a project contains many chats. The active project's chat history now
  owns its scroll boundary instead of moving the whole sidebar, with a visible
  Orbit-styled scrollbar, contained wheel behavior, and keyboard scrolling.
- Bounded recent projects in a separate scroll region and preserved the same
  hierarchy on narrow and mobile viewports without horizontal overflow.
- Made Open folder, Create & open, and recent-project activation honor the
  dialog's new-tab contract. Orbit reserves the tab during the user gesture,
  validates the returned loopback URL and bootstrap token, closes failed
  placeholders, and falls back to the current tab when popups are unavailable.
- Clarified that a newly entered project path must have an existing parent.
  Creating a project continues to create the directory and launch an isolated
  local WebUI with its own chats and context.

### Verification

- Added browser regression coverage for a 44-chat project, fixed sidebar
  controls, wheel and keyboard scrolling, mobile containment, and real
  new-project tab navigation.

## 0.8.0 - 2026-08-14

### Model-aware provider foundation

- Decoupled model-family semantics from provider transport. Recognized
  DeepSeek V4 models now receive the same reasoning, tool-history, context,
  cache, and capability policy through TokenDance and arbitrary OpenAI- or
  Anthropic-compatible gateways while preserving each gateway's protocol and
  exact namespaced model ID.
- Reorganized provider ownership into symmetric `openai-compatible` and
  `anthropic-compatible` transports, an official DeepSeek product router,
  shared request canonicalization, and shared transport lifecycle helpers.
  The former `DeepSeekOpenAIProvider` name remains as a deprecated compatibility
  export; new integrations use `OpenAICompatibleProvider`.
- Added endpoint-independent model adaptation tests at the provider factory and
  both compatible wire boundaries, including official-only model mapping,
  gateway model preservation, DeepSeek thinking/output policy, tool ordering,
  and model-specific capability discovery.

### DeepSeek correctness, cache, and latency

- Canonicalized complete tool definitions and JSON schemas recursively before
  all transports, validated duplicate/invalid tools and DeepSeek user IDs, and
  centralized DeepSeek Chat message serialization so reasoning is replayed only
  on assistant tool turns.
- Hardened Responses and Anthropic-compatible streaming contracts, request
  metadata, bounded parsing, terminal-event validation, retry ownership, and
  protocol-native usage/cache reporting without synthetic cache primers.
- Made connection preheating explicit, side-effect-free, idempotent, bounded,
  and shared across compatible transports. Official DeepSeek remains
  zero-retry by default while third-party gateways retain configurable retry
  behavior.
- Versioned local prompt-cache slab identity by provider, model, stable system
  content, and the complete canonical tool schema. Skill ordering and line
  endings are deterministic, so equivalent requests stay stable without
  leaking cache observations across providers.
- Updated the cache benchmark to use an append-only conversation profile and
  report provider-observed hit/miss telemetry. Diagnostics now show the
  effective provider type when legacy official configurations are upgraded.

### Architecture and documentation

- Added a package-level provider architecture guide and refreshed the product,
  CLI, architecture, maintainer, and Agent documentation around model-driven
  routing, protocol ownership, cache identity, and future gateway extension.
- Retained the CUMCM Chinese-first result contract: leaf CSV/TSV/XLS/XLSX
  deliverables use descriptive Chinese names, headers, worksheet names, units,
  and UTF-8-SIG unless the supplied problem fixes an exact schema.

## 0.7.6 - 2026-08-14

### Agent foundation and project scaffolding

- Rebuilt `orbit init` as a safe, non-destructive Agent project bootstrap. It
  now creates an explicit `ORBIT.md` execution contract, detects Node.js,
  Python, Rust, and Go verification candidates, and adds starter implement and
  read-only review workflows. Existing files are never overwritten, `--minimal`
  preserves the former single-file behavior, and `--json` supports automation.
- Added a stable Agent run receipt to completed, failed, and aborted initialized
  runs. Automation and lifecycle events can now consume workspace-relative
  modified files, current verification evidence, token/cache usage, known or
  unknown cost, and durable plan progress without scraping terminal text.
- Persisted every new one-shot or orchestrated task as the Session goal before
  provider work starts. Resuming an existing Session preserves its established
  objective instead of replacing it with the resume prompt.
- Hardened Skill and workflow scaffolding with Zod boundary validation,
  lowercase kebab-case identifiers, bounded fields, unique dependencies,
  canonical workspace checks, exclusive writes, and atomic staged Skill
  directory publication with failure cleanup.

### DeepSeek, context, and compatibility

- Consolidated official DeepSeek support behind one provider boundary while
  retaining three explicit wire transports: Chat Completions, Responses, and
  Anthropic. Removed the redundant standalone DeepSeek-Anthropic provider
  identity and retained safe migration for older official profiles.
- Completed model-aware context and output budgeting for DeepSeek V4 Flash/Pro,
  TokenDance-hosted models, discovered catalogs, and conservative unknown-model
  fallbacks. Provider switching no longer leaks another model's context limits.
- Strengthened official Responses parsing, reasoning/tool replay, semantic SSE
  completion, nullable interim usage, request metadata, error classification,
  retry ownership, timeout budgets, and shared tool-argument normalization
  across transports.

### Release quality

- Expanded critical coverage for project scaffolding, capability creation,
  session-goal recovery, run receipts, DeepSeek protocols, runtime migration,
  provider diagnostics, and per-model context policy.
- Updated the product and architecture documentation around Agent-first
  outcomes, generated verification trust, workflow ownership, and machine-
  readable completion evidence.

## 0.7.5 - 2026-08-14

### DeepSeek and provider architecture

- Replaced split DeepSeek identities with one `deepseek` provider that exposes
  the official Chat Completions, Responses, and Anthropic wire formats behind
  isolated adapters. Automatic mode keeps Chat as the continuity default and
  selects Responses for schema-constrained output; Anthropic remains explicit.
- Aligned V4 Flash/Pro with the official 0813 contracts: stable request model
  IDs, 1,000,000-token advertised context, 384,000-token maximum output,
  native low/high/max effort, plain Responses reasoning replay, semantic SSE
  terminal handling, request IDs, cache usage, and structured provider errors.
- Added safe migration from official `deepseek-openai` and
  `deepseek-anthropic` profiles, while leaving third-party compatible gateways
  on their explicitly configured protocol.
- Added request-time credential resolution, end-to-end timeout budgets,
  protected header merging, provider-local retry suppression for official
  DeepSeek, and durable agent-level retries only before partial output.

### Context and model portability

- Made context and output budgets resolve per concrete model from provider
  discovery or configuration. Different TokenDance models can now carry
  different windows; unknown future models use a conservative 128K fallback
  instead of inheriting DeepSeek's 1M profile.
- Stabilized cacheable system/tool prefixes by moving session goals, memory,
  and live plans into volatile context, and disabled plaintext pseudo-tool
  recovery whenever a provider supports native tool calls.
- Added scheduled DeepSeek peak/off-peak pricing activation for the published
  2026-08-16 16:00 UTC change without rewriting historical cost calculations.

### Workflow and verification

- Kept `$cumcm-draft` result tables Chinese-first by default: descriptive
  Chinese filenames, headers, worksheet names, units, and UTF-8-SIG CSV/TSV,
  except for exact problem-prescribed submission schemas.
- Expanded DeepSeek regression coverage across all three protocols, legacy
  migration, provider metadata, malformed streams, model-specific context
  budgets, and safe unknown-model fallback.

## 0.7.0 - 2026-08-13

### Security and reliability

- Added corruption-preserving credential reads, serialized credential
  mutations, master-key creation race recovery, zeroization on purge, and
  exact opaque-secret redaction across structured tool/event payloads.
- Removed credential-bearing environment entries from workspace child
  processes while retaining ordinary compiler, language-runtime, locale, and
  build configuration; fixed internal helpers use a smaller allowlist.
- Expanded protected-path and risky-network-command classification, redacted
  Git/hook/tool results at event boundaries, and added bounded commit-diff and
  conventional commit-message normalization.
- Pinned every third-party GitHub Action to an immutable revision and added
  CodeQL, secret scanning, CycloneDX SBOM generation, release provenance,
  checksum artifacts, registry propagation checks, and clean reinstall smoke
  verification.

### DeepSeek V4

- Completed the official `DeepSeek-V4-Pro-0813` and
  `DeepSeek-V4-Flash-0731` alignment for Responses, Chat Completions, and
  Anthropic-compatible transports, including 1M context, 384K output, native
  low/high/max reasoning, tool-history preservation, SSE tail flushing, and
  dated diagnostic metadata behind stable model IDs.
- Added an endpoint-unavailable circuit so `auto` mode does not repeatedly
  probe a missing Responses route. Authentication, validation, and post-output
  failures never switch transports.
- Refined automatic model routing so a single-file continuation does not
  automatically escalate to Pro, while multi-file, repair, large-context, and
  structurally complex work still receives the stronger lane. DeepSeek's
  provider default remains high; Orbit may explicitly use low for simple Flash
  turns and max for repairs.

### Context, sessions, and performance

- Added conservative repository indexing for Go, Rust, Java, C#, C/C++, SQL,
  Markdown, shell, and stylesheet files while excluding credential-prone
  configuration formats from the default glob.
- Batched embedding and BM25/vector persistence, bounded embedding cache size,
  file fan-out, and summarization concurrency, and enforced the final context
  budget without silently dropping explicitly requested Skills.
- Replaced repeated full-history rewrites with an atomic snapshot plus fsynced,
  crash-tolerant tail journal and bounded periodic compaction.
- Bounded repository-map output and long TUI history rendering, reduced timer
  churn, and made terminal width, wrapping, truncation, cursor offsets, and
  styling grapheme-aware for combining characters and joined emoji.

### CUMCM workflow and UX

- Strengthened `$cumcm-draft` so result CSV/TSV/XLS/XLSX files use descriptive
  Chinese filenames, headers, and worksheet names by default, with UTF-8-SIG
  text tables and units. Problem-prescribed exceptions now require an exact,
  safe source artifact and verify tabular headers, sheets, and encoding against
  that source where mechanically provable.
- Added contest-rule expiry checks and evidence-freeze provenance for the
  validator/finalizer scripts, preventing a stale compliance snapshot or
  changed validation program from passing silently.
- Improved high-contrast focus/status rendering, Traditional Chinese field
  placeholders, and narrow/forced-color WebUI behavior without changing the
  established visual hierarchy.
- Added a review-oriented architecture map covering dependency direction,
  turn lifecycle, trust boundaries, persistence, retrieval, and cross-module
  review neighborhoods.

## 0.6.1 - 2026-08-13

### Changed

- Aligned the built-in DeepSeek profiles with the official
  `DeepSeek-V4-Pro-0813` and `DeepSeek-V4-Flash-0731` production builds while
  preserving the stable request IDs `deepseek-v4-pro` and
  `deepseek-v4-flash` in configuration and model selectors.
- Enabled the native Responses API for both official DeepSeek V4 lanes in
  `auto` mode, retaining the bounded pre-output Chat Completions fallback for
  unavailable compatible endpoints.
- Restored all three official reasoning levels (`low`, `high`, and `max`):
  simple Flash turns use `low`, complex work and Pro use `high`, and repair
  turns use `max`.
- Made official DeepSeek FIM completion honor the requested stable Pro/Flash
  lane and default to Flash for latency-sensitive completion work, while
  keeping the required non-thinking beta endpoint contract.

### Fixed

- Removed the stale assumption that V4 Pro did not support Responses and added
  regression coverage for Pro 0813 auto-routing, dated gateway identifiers,
  native reasoning effort propagation, capability diagnostics, and stable
  catalog normalization.

## 0.6.0 - 2026-08-12

### Changed

- Upgraded `$cumcm-draft` so generated CSV, TSV, XLS, and XLSX evidence uses
  descriptive Chinese filenames, Chinese column and worksheet names, explicit
  units, and Excel-safe UTF-8-SIG text output by default.
- Added narrow, provenance-backed exceptions for problem-prescribed upload or
  fill-in schemas; each exception must identify the exact result path, its
  immutable problem source, its reason, and only the fixed schema surfaces that
  may remain untranslated.
- Refreshed the bundled CUMCM compliance snapshot against the official 2026
  rules and replaced the unavailable Chinese AI-rule detail link with the
  accessible official English mirror while retaining the Chinese rules index.

### Fixed

- Made strict CUMCM finalization reject accidental English result filenames,
  headers, and worksheet names; missing, empty, or duplicate table headers;
  non-BOM CSV/TSV output; malformed exception records; unsafe linked result
  paths; and generated legacy XLS files whose schema cannot be inspected.
- Expanded deterministic workflow and model-smoke coverage for Chinese CSV and
  XLSX contracts, fixed-template encoding exceptions, and official-source
  provenance.

## 0.5.8 - 2026-08-12

### Fixed

- Restored the official `deepseek-v4-flash` and `deepseek-v4-pro` names in
  model selectors while continuing to normalize dated models returned by the
  live DeepSeek API; non-DeepSeek providers now receive a generic `Auto` label.

## 0.5.7 - 2026-08-12

### Changed

- DeepSeek official-provider selectors now refresh the live `/models` catalog,
  expose stable `Auto`, `Flash`, and `Pro` choices instead of dated backend
  builds such as `0731`, keep the same choices available in narrow-screen
  settings, and reject unlisted WebUI model overrides.
- Renamed the bundled mathematical-modeling workflow to `$cumcm-draft`, added
  `/cumcm-draft` while retaining `/math-draft` as a compatibility alias, and
  reserved a non-implicit `$mcm-draft` placeholder for a future MCM/ICM flow.
- Updated CUMCM delivery checks to the official 2026 paper/support rules and
  current AI-use requirements, including exact grouped support inventories,
  inline AI marks, AI reference entries, and key interaction records.
- Refined generated question sections into adaptive, domain-specific modeling
  stages and added audit warnings for overly coarse, fragmented, or repeated
  generic question outlines.
- Changed CUMCM code scaffolds and audits to favor responsibility-based question
  modules over a universal `main.py + model.py + output.py` trio, with concise
  Chinese `#` comments at assumptions, units, leakage controls, and safeguards.
- Hardened CUMCM modeling guidance around business-field semantics,
  decision-time feature availability, validation-only model selection,
  executable cross-question result contracts, conditional optimization claims,
  and lean delivery hygiene for dependencies and support archives.
- Migrated WebUI approval and image-attachment controllers from untyped source
  strings to strictly checked browser factories, and expanded the client
  typecheck entry to cover the complete assembled browser asset.
- Extracted model-visible tool-result compaction from the agent loop into a
  focused, directly tested module with an explicit critical-coverage contract.

### Fixed

- Made documentation verification follow the current working tree, including
  untracked rename targets, instead of crashing on deleted Git-index entries.
- Published restored checkpoint files through same-directory, fsynced atomic
  replacements so an interrupted rollback cannot expose a truncated file.
- Corrected tool-result truncation to honor its exact configured character
  limit rather than exceeding the boundary by the truncation suffix length.

## 0.5.6 - 2026-08-11

### Changed

- Refined Web UI settings navigation, custom-model feedback, keyboard focus,
  mobile touch targets, localization coverage, streaming-state clarity, and
  responsive interaction tests.
- Made Vitest resolve every workspace package directly to its source entry so
  clean-workspace test and coverage runs cannot consume stale build output.

### Fixed

- Changed `pnpm install-global` to build and install a standalone npm tarball
  instead of linking `packages/cli`, so cleaning workspace build artifacts no
  longer breaks the global `orbit` command.
- Enforced unique Web UI attachment IDs, reserved concurrent upload capacity,
  and cleared attachment state only after in-flight requests finish during
  shutdown.
- Prevented DeepSeek-compatible non-stream responses from retaining abort
  listeners when a consumer stops reading early, and rejected extra arguments
  after a standalone `/review` preset.
- Hardened cleanup against unreadable targets and linked filesystem roots while
  unlinking junction-backed `.orbit` entries without touching their contents.
- Kept failed session resumes from masquerading as the previously active
  session, and recovered interrupted agent runs even after their history grows
  beyond the public 100-record window.
- Prevented agent-run initialization through workspace-escaping ancestor links
  and bounded project-registry session metadata before persistence.

## 0.5.5 - 2026-08-09

### Changed

- Adopted the Apache License 2.0 across the repository, published CLI package,
  editor extension, and workspace metadata.
- Reworked the repository and npm READMEs with faster navigation, clearer
  setup requirements, MCP guidance, and explicit security and data boundaries.
- Included matching license copies with the CLI and VS Code extension, and
  shipped generated third-party notices inside the bundled npm artifact.
- Expanded release verification to reject version, license, or notice drift
  across the repository, editor extension, workspace packages, and tarball.

### Fixed

- Clarified that Git enriches rollback and isolated agent work but is not a
  hard runtime dependency because filesystem and main-workspace fallbacks
  remain available.

## 0.5.4 - 2026-08-09

### Changed

- Made selective `/rollback` operations transactional across checkpoint files,
  the working tree, and the Git index, with bounded preflight snapshots and
  best-effort compensation when a later restore step fails.
- Added typed Web UI request failures so malformed JSON and oversized payloads
  map to stable HTTP responses independently of display text.
- Centralized browser- and MCP-facing external error sanitization, including
  credential redaction, terminal-control removal, and bounded output.

### Fixed

- Restored staged modifications, additions, renames, copies, and unborn-repo
  files without deleting tracked content when Git restoration fails.
- Revalidated selected Git status entries after confirmation and rejected
  workspace escapes, unsafe file types, and unresolved merge states before
  mutating the workspace.
- Returned HTTP 413 for oversized image attachments and HTTP 400 for malformed
  JSON request bodies.
- Prevented OAuth callback errors and MCP transport failures from exposing
  credentials or injecting terminal control sequences.

## 0.5.3 - 2026-08-09

### Added

- Added automatic, per-turn repository retrieval for implementation, debugging,
  review, and architecture prompts, with explicit `@codebase` and
  `@no-codebase` controls plus TypeScript, JavaScript, and Python symbol/import
  frontends.
- Added durable child-agent recovery in Web UI Mission Control. Persisted runs
  now carry renewable ownership leases, retain child sessions, and can be
  resumed after an interrupted owner exits.
- Added MCP `2026-07-28` stateless discovery and per-request metadata alongside
  the existing 2024/2025 session protocol, including structured output
  validation and safe HTTP parameter mirroring.
- Added release evaluation fixtures for async cancellation, workspace path
  boundaries, Python unit conversion, and session migration.

### Changed

- Coalesced repository indexing into one workspace-owned stale-while-refresh
  lifecycle, made Git file discovery asynchronous, and removed redundant
  end-of-run scans when no workspace mutation is pending.
- Expanded the Web UI mission-control summary and typed its serialized browser
  renderer independently from the server runtime.
- Serialized durable agent-run mutations with per-run cross-process locks so
  recovery, heartbeat renewal, and completion cannot overwrite each other.

### Fixed

- Correctly downgrade MCP discovery to a supported legacy protocol when a
  server rejects the modern revision, while preserving hard failures when no
  mutually supported revision exists.
- Accept spec-compliant numeric `x-mcp-header` parameters and avoid sending
  legacy cancellation notifications on stateless stdio requests.
- Preserved recoverable child ownership and indexing completion across abort,
  failure, and disposal paths without delaying clean runs unnecessarily.

## 0.5.0 - 2026-08-09

### Added

- Added stable MCP 2025-11-25 negotiation with supported-version validation,
  bounded opaque-cursor pagination for tools, resources, URI templates, and
  prompts, plus preservation of non-text tool and embedded-resource results.
- Added Streamable HTTP protocol headers, validated session identifiers,
  one-shot concurrent session recovery, pagination restart after recovery, and
  standards-compliant session termination.

### Changed

- Isolated every Agent loop behind its own validated tool registry so dynamic
  MCP tools cannot leak into another chat or remove a replacement they no
  longer own.
- Made MCP connections loop-scoped and reusable across turns. Interactive
  startup now discovers MCP prompt commands before the first input, while one
  invalid server remains isolated from healthy servers.
- Made checkpoint and project-memory initialization explicit and centralized
  all session-bound runtime rebinding in one path.

### Fixed

- Preserved checkpoint encryption, verification-manager ownership, configured
  iteration limits, and session review/cache isolation when creating or
  resuming chats.
- Bounded tool execution even when an extension ignores its abort signal, and
  prevented late completion from overriding timeout or user cancellation.
- Added graceful stdio MCP shutdown and real request cancellation on stdio and
  HTTP timeout paths instead of emitting an unrelated cancellation ID.

## 0.4.11 - 2026-08-08

### Changed

- Made multi-checkpoint rewind transactional: Orbit now preflights every target,
  preserves the current workspace state for compensation, applies checkpoints
  in order, and removes checkpoint metadata only after the complete rewind
  succeeds.
- Persisted checkpoints through a complete staging directory before atomically
  publishing them to the live session, preventing interrupted writes from
  creating false rewind targets.

### Fixed

- Bounded scheduler cancellation when an active task ignores its abort signal,
  so manual cancellation and timeout cannot leave the remaining agent graph
  waiting forever.
- Prevented common cloud credentials, package-manager tokens, SSH/GPG state,
  OAuth client secrets, and private-key files from entering isolated worktree
  snapshots as untracked context.

## 0.4.10 - 2026-08-08

### Fixed

- Applied canonical workspace-boundary checks to shell command paths so an
  in-workspace symbolic link or Windows junction cannot silently reach files
  outside the authorized workspace.
- Expanded dangerous-command detection to cover reordered recursive `rm`
  flags and common PowerShell recursive-removal aliases without weakening the
  guarded Full Access workflow.

## 0.4.9 - 2026-08-08

### Changed

- Made the DeepSeek release gate build the complete workspace before running
  provider probes and allowed max-effort repair checks enough output tokens to
  finish after extended reasoning.

### Fixed

- Stabilized background-task ordering and retention when multiple commands
  start within the same millisecond, with a deterministic cross-platform
  regression test.

## 0.4.8 - 2026-08-08

### Added

- Added generation-aware workspace mutation tracking so file, shell, and test
  changes invalidate stale verification evidence and completion requires a
  successful check against the current workspace state.
- Added atomic file replacement with create/overwrite intent and optimistic
  hash checks, plus an isolated Git index for auto-commits that preserves
  unrelated user-staged changes.
- Added explicit unknown-pricing state across sessions, events, TUI, and WebUI
  instead of applying synthetic prices to future or custom models.

### Changed

- Aligned DeepSeek V4 Flash and Pro with the current official high/max effort
  protocol, enabled high thinking by default, retained legacy effort aliases,
  and expanded the release gate across official DeepSeek and TokenDance
  thinking, non-thinking, and repair lanes.
- Made Full Access accurately describe its host-process security boundary and
  require confirmation for opaque command substitution, compound shell stages,
  nested interpreters, inline code, and unresolved runtime expansion.
- Limited completion evidence to recognized standalone test, build, lint,
  typecheck, or syntax commands while keeping arbitrary successful commands
  available as ordinary tool output.

### Fixed

- Prevented shell mutations from being attributed to every pre-existing dirty
  file and prevented auto-commit pathspecs from expanding beyond the exact
  Orbit-owned paths.
- Prevented verification from remaining valid after later edits and prevented
  weak-model success text or permissive no-test flags from bypassing the final
  completion gate.
- Prevented unknown model costs from appearing as a misleading `$0.0000` in
  terminal and browser status views.

## 0.4.7 - 2026-08-07

### Added

- Added a completion verification gate that requires a successful relevant
  check after file mutations before an agent can report completion.
- Added numerical-evidence freezing to the bundled `$math-model-draft` Skill,
  with explicit refresh authorization, archive validation, and reproducible
  result and figure hashes.
- Added platform-aware command-shell resolution for foreground tests and
  background tasks, including Git Bash on Windows and deterministic Bash with
  a POSIX fallback on macOS and Linux.

### Changed

- Increased the default agent run depth to 64 iterations and DeepSeek Flash
  output allowance to 32,768 tokens for complete document and coding workflows.
- Treat reaching the iteration boundary as a resumable pause that preserves
  session state and verification evidence instead of a terminal failure.
- Accept complete DeepSeek tool calls from compatible gateways when transport
  metadata normalizes or omits the official `tool_calls` finish reason.
- Expanded the modeling-paper audit with root-level problem discovery, PDF
  parser fallbacks, safer cache exclusion, figure freshness checks, XeLaTeX
  handling for Windows paths, and improved source-code typography.

### Fixed

- Prevented Full Access from repeatedly prompting for active Skill resources,
  temporary files, system fonts, and verified PATH executables while retaining
  protected-file and workspace-boundary enforcement.
- Fixed custom slash-command expansion so the expanded prompt, rather than the
  original command text, reaches both interactive and WebUI agent runs.
- Prevented successful long-running document deliveries from being mislabeled
  as failed solely because the consecutive-iteration boundary was reached.

## 0.4.6 - 2026-08-06

### Added

- Added guarded Full Access as a coherent permission preset across the WebUI,
  `/mode auto`, and `orbit --yes`, with explicit live safety status and
  keyboard-accessible desktop and narrow-screen controls.
- Remembered interactive permission-mode choices per workspace while preserving
  explicit one-shot CLI overrides.

### Changed

- Made Full Access atomically allow workspace writes, ordinary command
  execution, and enabled network tools without per-action approval while
  retaining dangerous-command, secret, and workspace-boundary protections.
- Extended managed policy metadata and runtime validation so administrator
  requirements for write or command approval cannot be bypassed by Full Access.

### Fixed

- Prevented `auto` mode from continuing to prompt because stale write or command
  approval flags remained enabled from a previously selected mode.

## 0.4.5 - 2026-08-06

### Added

- Bundled the explicit `$math-model-draft` Skill and `/math-draft` workflow with
  the npm CLI, including safe project scaffolding, evidence-linked code and
  paper generation, current CUMCM AI-use disclosure templates, real TeX builds,
  page rendering, validation, cleanup, and support-material packaging.
- Added installed-package smoke coverage for bundled Skill discovery and npm
  package allowlist checks for the workflow assets.

### Changed

- Made isolated acceptance runs continue through periodic runaway checkpoints
  while retaining finite iteration, budget, permission, worktree, and command
  safety bounds.
- Increased acceptance-run depth so implementation, verification, and repair
  workflows can complete without changing the interactive-session default.

### Fixed

- Distinguished output-token truncation from input-context overflow, retrying
  oversized responses as bounded action batches instead of incorrectly
  compacting the conversation.
- Made context-overflow recovery adapt to the observed history size when a
  compatible third-party gateway reports smaller limits than the model profile.

## 0.4.4 - 2026-08-04

### Changed

- Replaced Orbit's legacy Windows folder browser with the native Explorer-style
  picker, owned by the foreground Edge window and configured for per-monitor
  DPI awareness so full-screen WebUI project selection stays visible and sharp.
- Tightened workspace package boundaries by removing unused direct dependencies,
  declaring every production import at its true owner, and adding an automated
  dependency audit to the standard verification and release gates.

### Fixed

- Prevented the Windows project picker from opening behind a full-screen browser
  and improved its scaling on high-DPI displays.

## 0.4.3 - 2026-08-04

### Changed

- Made Create & open a strict new-folder operation: it rejects existing paths,
  requires an existing parent directory, and never creates an unintended chain
  of missing ancestors. Open folder remains the explicit existing-directory
  action.
- Serialized project-registry mutations across Orbit processes with bounded
  lock waiting and stale-lock recovery, preserving recent-project updates when
  multiple local instances start or modify the registry together.

### Fixed

- Fixed the WebUI project flow so New project opens an explicit open-or-create
  dialog. The native folder picker now fills the editable path without
  automatically forcing the existing-folder action, keeping Create & open
  reachable on every supported platform.
- Prevented concurrent WebUI project actions from racing multiple folder
  pickers or child launches, and converted expected launch failures into
  actionable conflict responses without handing off the current instance.
- Removed redundant parent-side project registration before process spawn; the
  launched Orbit instance is now the sole registrar, eliminating duplicate
  writes and registry mutations when spawning fails.

### Security

- Removed the authentication cookie from unauthenticated WebUI shell responses.
  Browser sessions can now obtain or recover that cookie only by exchanging the
  secret from the local launch URL through the protected bootstrap endpoint.
- Restricted project handoff URLs to Orbit's exact loopback-root shape with an
  explicit port and one bounded token, rejecting credentials, paths, queries,
  duplicate tokens, and extra fragment fields before browser navigation.

## 0.4.2 - 2026-08-04

### Added

- Added a session-scoped background task runtime for long builds, development
  servers, and watchers, with bounded output, configurable concurrency and
  retention, task status/wait/list tools, and cross-platform process-tree
  termination.
- Added validated background-task lifecycle events for TUI, WebUI, JSONL, and
  session traces, plus model notifications when a task completes between agent
  iterations.
- Added a durable, session-owned input queue shared by the TUI and WebUI, with
  ordered follow-ups, bounded image retention, reconnect recovery, and safe
  mid-turn steering that never cancels an in-flight model request or tool call.
- Added interruptible background waits and completion reconciliation so Orbit
  accounts for long-running verification and build results before declaring a
  task complete.
- Added durable queue editing, one-step reordering, removal, priority promotion,
  and follow-up-to-steering promotion in the WebUI and terminal `/queue`
  command, with content-free lifecycle events for every mutation.
- Added targeted steering for active planner, coder, and reviewer agents from
  WebUI Mission Control, with metadata-only durable steering counts.
- Added bounded FIFO handling for simultaneous child-agent approvals, with the
  requesting agent's role shown in the WebUI before the decision is made.
- Added provider-neutral `fast`, `balanced`, and `thorough` agent-team presets,
  with bounded review attempts/concurrency and stable reviewer budget sharing.
- Added durable child-agent Sessions under `.orbit/agent-sessions`, linked from
  AgentRun records and retained independently from temporary Git worktrees.

### Changed

- Made Agent, Orchestrator, one-shot CLI, session switching, and interactive
  shutdown share one explicit process lifecycle so background commands cannot
  become unreachable or survive Orbit shutdown accidentally.
- Replaced the WebUI's browser-local follow-up queue and the TUI's single
  cancel-and-rerun correction slot with one validated AgentLoop/Session
  protocol observed consistently by every local UI.
- Bounded the visible WebUI queue so long follow-up lists remain manageable
  without displacing the conversation or message composer.
- Kept background commands alive across chat switches while retaining
  session-scoped model/tool access and explicit cleanup on chat deletion or
  Orbit shutdown.
- Extracted the durable input-queue mutation and event protocol from
  `AgentLoop` into an independently tested core controller.
- Separated WebUI Mission Control rendering from connection/session lifecycle
  code so task and child-agent controls can evolve behind one focused boundary.
- Centralized agent ownership-scope validation and normalization so workspace,
  nested, disjoint, Windows-style, and unsafe traversal scopes have one tested
  scheduling meaning before parallel work starts.

### Security

- Pinned the Ajv URI parser dependency to patched `fast-uri` 3.1.5 or newer
  within the 3.x line, closing the backslash-authority host-confusion advisory
  without weakening the production audit gate.

## 0.4.1 - 2026-08-03

### Changed

- Unified the WebUI's streaming and completed-message rich-text pipelines so
  headings, emphasis, lists, tables, links, and syntax-highlighted code render
  consistently while a response is still arriving.
- Added adaptive streaming render batching for long responses, keeping short
  answers visually immediate while bounding repeated DOM work as output grows.
- Kept live code blocks expanded during generation and restored normal long-code
  collapsing after the response is complete.

### Fixed

- Prevented raw Markdown and unfinished code-fence markers from flashing before
  the completed response was rendered.
- Anchored the streaming caret to the final visible paragraph, list item, table
  cell, or code character instead of placing it below structured content.
- Preserved the final pending text when a response completes or is cancelled
  while an adaptive render flush is scheduled.

## 0.4.0 - 2026-08-02

### Added

- Added an explicit `AgentInteraction` port so the core agent lifecycle no
  longer depends on concrete TUI classes; CLI/TUI and WebUI can provide their
  own prompt, progress, and rendering adapters.
- Added a model-neutral thinking-policy boundary while keeping DeepSeek V4
  family behavior consistent across the official API, TokenDance, and future
  compatible gateways.
- Added shared, bounded JSON-object tool-argument validation for the DeepSeek
  OpenAI, Responses API, and Anthropic-compatible transports.
- Added an explicit default-tool registry module and isolated registry factory
  for embedded runtimes and tests without changing the legacy process-wide
  registry export.
- Added complete local and versioned Skill bundle scaffolding with
  `references`, `scripts`, `assets`, and presentation metadata, plus bounded
  validation for missing, unsafe, or oversized resources.
- Added safe `skill://` resource access to the read, list, glob, and grep tools
  so activated Skills can use their bundled material without weakening
  workspace isolation.
- Added a first-class DeepSeek V4 model-family adapter for the concrete
  `DeepSeek-V4-Flash-0731` release across the official API, TokenDance, and
  future compatible gateways, while preserving the generic path for other
  model families.
- Added native DeepSeek Responses API support with semantic SSE events,
  reasoning-effort controls, tool-call replay, bounded response validation,
  protocol diagnostics, and a safe pre-output fallback to Chat Completions.

### Changed

- Moved the core package's TUI dependency to development-only test wiring and
  documented package ownership and split criteria for long-lived coordinators.
- Centralized release-facing architecture documentation and expanded model
  adaptation tests for generic and DeepSeek policy resolution.
- Moved active WebUI files into the context picker popover so large context
  sets no longer consume composer space, with keyboard and responsive coverage.
- Made the TUI workspace header preserve useful trailing path segments while
  respecting terminal display width for CJK and other full-width characters.
- Applied DeepSeek capabilities by detected model family instead of Provider
  hostname, and exposed an `auto`, `responses`, or `chat-completions` transport
  preference for each compatible Provider profile.
- Updated the agent reasoning policy so Flash uses `low` for simple turns,
  `high` for complex turns, and `max` for repair work, with the resolved model
  version and transport recorded in events and diagnostics.

### Fixed

- Treated an unavailable or policy-blocked Python runtime as a safe syntax-check
  fallback instead of incorrectly rejecting edits as Python syntax errors.

## 0.3.8 - 2026-07-29

### Security

- Added collision-resistant, framed extension directory digests for new
  installations while preserving verification compatibility for legacy
  registries.
- Restricted trusted extension registry entries to their exact managed
  installation slot and rejected symlinked or unsupported tree entries without
  allowing them to interrupt configuration loading.
- Validated, size-bounded, and transactionally replaced project-local runtime
  state without following symbolic links.
- Added bounded regular-file reads and rollback-safe private-file replacement
  for credentials, Provider profiles, and the recent-project registry.
- Bounded global, project, pricing, and managed-policy configuration input
  before parsing while preserving explicit non-secret config symlinks.
- Bounded file-tool, checkpoint, project-instruction, Skill metadata, package
  manifest, and project-backup input at the descriptor boundary so concurrent
  growth and sparse oversized files cannot be materialized unexpectedly.
- Added shared streaming limits for search, DNS, model discovery,
  non-streaming Provider, and MCP HTTP responses so untrusted peers cannot
  force unbounded response buffering.
- Added structural collection limits for configuration, session traces,
  symbol/vector caches, search payloads, and non-streaming model responses so
  byte-valid inputs cannot expand into unbounded in-memory collections.
- Bounded individual and cumulative Provider SSE data, streaming tool
  arguments, and tool-call counts so a responsive but non-conforming endpoint
  cannot bypass inactivity timeouts and grow memory indefinitely.
- Rejected oversized configuration collections, malformed environment names,
  and newline-injected MCP headers before they reach process or HTTP
  boundaries.
- Made MCP OAuth refresh-token keys collision-resistant across server names
  while safely migrating legacy keys whose original name is unambiguous.

### Fixed

- Made extension installation, updates, and removals restore the previous
  package, commands, and Skills when registry commit fails.
- Replaced extension registries transactionally and rejected registry
  symlinks, directories, oversized input, and other non-regular files.
- Persisted Skills settings across restarts and restored Provider/model
  selections as one compatible pair instead of applying a model to the wrong
  Provider.
- Preserved last-known-good Provider and project registry backups when the
  primary snapshot is malformed, and refused unsafe backup destinations.
- Made Provider benchmark and capability caches bounded, workspace-confined,
  schema-validated, and safe across concurrent Orbit processes.
- Released completed autocomplete debounce timers and cancelled speculative
  race timers so long-running editor sessions do not accumulate stale handles.
- Cleared task cancellation grace timers as soon as timed-out agent work exits,
  preventing completed scheduler runs from holding the CLI open.
- Closed OAuth loopback listeners deterministically after success, timeout, or
  callback failure, removed settled request listeners and timers, and applied
  cancellation-aware timeouts and bounded credential/token validation to OAuth
  exchanges.
- Made index, prompt-cache, autocomplete-discovery, trace, and evaluation
  temporary files collision-resistant across concurrent Orbit processes and
  cleaned abandoned cache temporaries after failed replacement.
- Released discarded `web_fetch` response bodies before following redirects or
  returning early, preventing repeated fetches from exhausting HTTP resources.
- Released bounded HTTP and `web_fetch` stream readers on success and failure,
  cancelled discarded MCP OAuth retry bodies, and honored already-aborted MCP
  tool calls before issuing a network request.
- Bounded and transactionally replaced terminal input history, centralized
  prompt-cache metadata validation, and reused the shared safe registry reader
  and writer across extension loading and mutation paths.
- Bounded symbol, embedding, vector, lexical, verification-contract, project
  memory, and durable-agent state inputs; preserved the last valid project
  memory backup instead of replacing it from a corrupt primary snapshot.
- Kept failed WebUI attachment deletions visible and retryable instead of
  reporting false success, and bounded/redacted transactional TUI error logs.
- Validated and bounded session snapshots and audit logs before loading, and
  stopped corrupt session metadata, history, plans, or run journals from
  replacing their last-known-good backup during recovery writes.
- Made Provider switching and combined WebUI settings updates transactional,
  including automatic-model routing, rollback after partial runtime failures,
  and rejection while a terminal or browser task owns the shared runtime.
- Preserved rapid consecutive Skill toggles, bounded deterministic Skill
  discovery, and kept mobile notifications clear of the composer and
  navigation controls.
- Kept disabled Skill actions disabled after terminal and WebUI task busy-state
  transitions instead of accidentally re-enabling them when a turn finished.
- Reused validated symbol search for automatic import repair instead of
  parsing internal index files directly, rejected self-imports and unsafe
  paths, and made plan and prompt-cache persistence transactional.
- Bounded project backup depth and entry traversal, command templates, file
  summaries, extension copies, and post-edit audit reads before loading them.
- Returned the first relevant result from each parallel web-search fallback
  group and cancelled slower peers, instead of delaying a successful search
  until every unavailable backend timed out.
- Made system DNS verification cancellation-aware so a stalled lookup cannot
  outlive the configured `web_fetch` timeout.
- Pinned every `web_fetch` connection and redirect hop to the exact addresses
  approved by validation, closing the DNS-rebinding window in SSRF protection.
- Bounded shell and test-runner output at the child-process boundary and
  prevented timeout, cancellation, or output overflow from reporting success.
- Released Provider connection-preheat response bodies so repeated startup and
  model switching cannot retain discarded HTTP resources.
- Rejected impossible Provider token counters and collection indices before
  they can distort cost, cache, or usage accounting.
- Moved large symbol, vector, lexical, reference, and autocomplete cache reads
  onto bounded asynchronous descriptors so indexing and search no longer
  monopolize the CLI or WebUI event loop.
- Typed and validated the shared full-screen Prompt protocol so malformed TUI
  responses cannot leak into terminal selection, approval, or credential flows.

## 0.3.7 - 2026-07-28

### Changed

- Refined the WebUI empty workspace with a single-line desktop heading,
  tighter composer proportions, and aligned content widths without replacing
  the established card, border, or radius language.
- Simplified sidebar scrolling to one predictable navigation surface and split
  Skill and Workflow client behavior into a dedicated maintainable module.
- Clarified the WebUI capability center and exposed each Skill's automatic or
  explicit activation behavior directly in its catalog row.
- Updated the repository and npm README guidance around WebUI capabilities,
  validation, and local startup behavior.

### Fixed

- Serialized WebUI settings mutations and restored Skill controls from the
  server after failed saves, preventing stale or misleading toggle states.
- Prevented overlapping Skill refreshes from allowing slower responses to
  overwrite newer catalog state.
- Rejected Workflows that reference missing Skills in both the browser form and
  authenticated server API instead of silently dropping invalid dependencies.
- Added visible, localized, accessible capability-form errors and calmer live
  regions for streaming conversations and notifications.

## 0.3.6 - 2026-07-28

### Changed

- Replaced the light-theme navigation frame's heavy green fill with a quiet
  warm-gray palette while preserving the established borders, radii, shadows,
  spacing, and responsive structure.
- Made model catalog refresh an explicit `/model` action instead of an
  invisible network dependency during ordinary model switching.

### Fixed

- Made `/webui` bind its loopback server and display the authenticated URL
  before refreshing a remote model catalog, so a slow or unavailable gateway
  cannot stall local startup.
- Restored the terminal input lifecycle across the provider and model steps of
  `/model`, including cached fallback, explicit refresh feedback, atomic
  provider/model switching, and recovery after catalog refresh failure.

## 0.3.5 - 2026-07-28

### Added

- Added runtime validation for remote MCP tool JSON Schemas, including required
  fields, primitive types, numeric constraints, and additional-property rules.
- Added a maintained WebUI preview example for successful web-search quality
  cards so source, confidence, responsive layout, and privacy behavior remain
  visible during design review.
- Added a real-product WebUI preview to the repository README.

### Changed

- Ranked same-priority search providers by result quality, preferred fresh
  structured Google News RSS for news queries, and stopped treating irrelevant
  or stale result sets as successful evidence.
- Replaced the hand-written Zod-internals JSON Schema converter with
  `zod-to-json-schema`.
- Made public URL validation proxy-aware: RFC 2544 synthetic DNS answers are
  verified through public DNS-over-HTTPS while private, reserved, mixed, and
  unverifiable destinations remain blocked.
- Made successful WebUI search cards show a bounded provider and quality
  summary while keeping raw search-result bodies out of persisted browser
  history.
- Refined the WebUI into a clearer three-layer hierarchy with a focused
  navigation frame, quieter conversation canvas, stronger action surfaces,
  improved type rhythm, and consistent light, dark, desktop, and mobile
  presentation.
- Reworked the README around a visual product introduction, 60-second setup,
  trust model, workflows, operations, and progressive documentation paths.

### Security

- Hardened Git restore against option and pathspec injection, local package
  binary resolution against package-directory escape, and shell permission
  analysis for attached redirections and unresolved path variables.

### Fixed

- Prevented failed live lookups from being summarized as evidence that nothing
  happened or that news sources had not updated.
- Kept `ProjectRegistry` construction free of filesystem side effects.
- Made `pnpm webui:preview` resolve its declared esbuild dependency reliably on
  Windows instead of depending on an unavailable `npx` binary lookup.
- Made third-party notice generation use the active project pnpm runtime on
  Windows so mixed global stores cannot produce false missing-package errors.

## 0.3.4 - 2026-07-28

### Added

- Added progressive Skill discovery with concise runtime diagnostics, explicit
  selection metadata, and reusable parsing, presentation, and selection
  modules instead of one growing registry implementation.
- Added bounded conversation-history pages that load earlier messages on
  demand while preserving the reader's exact scroll position.
- Added editable workflow input hints, including a ready-to-run mathematical
  modeling template for PDF, CSV, and requirement inputs.
- Added a loop-progress guard that detects consecutive identical or failing
  tool calls, tells the model to change course inside the tool result, and
  surfaces the stall to the user instead of silently burning iterations.
- Added recovery of tool calls that local models emit as plain text — bare
  `<tool_call>` JSON tags and fenced `json` blocks now execute instead of
  being silently dropped, and `<thinking>`/`<reasoning>` tags stream as
  reasoning alongside `<think>`.
- Added fast-model semantic summaries when older conversation turns are
  compacted, preserving objectives, file paths, decisions, and unfinished
  steps; the mechanical snippet summary remains the automatic fallback.
- Added inline italic, strikethrough, and h4–h6 heading rendering to WebUI
  messages, completing the existing table, list, quote, and code-block
  support.
- Added an offline weak-model regression suite that drives the real agent
  loop with scripted providers reproducing text-form tool calls, repeated
  identical calls, and provider overload, proving the recovery harness
  end-to-end in CI without any API key.
- Added per-server `mcpServers.<name>.requestTimeoutMs` (1s–600s) so
  long-running MCP operations such as builds or migrations are no longer cut
  off at the fixed 30-second default, on both stdio and Streamable HTTP
  transports.
- Added interactive diff review to the WebUI: file edits stream a
  color-rendered unified diff into the browser conversation — for
  terminal-driven turns too — and the change-approval panel now shows real
  red/green hunks instead of monochrome text, with accept and reject wired
  to keep-or-rollback.
- Added MCP resources support: servers advertising `resources` get one
  read-only `mcp__<server>__read_resource` tool listing their discovered
  URIs, on both stdio and Streamable HTTP transports
  (`mcpServers.<name>.resources.enabled` opts out).
- Added MCP prompts as slash commands: prompts discovered on running servers
  appear in autocomplete as `/mcp__<server>__<prompt>`, accept `key=value`
  or free-text arguments, and expand through `prompts/get` before the turn
  starts (`mcpServers.<name>.prompts.enabled` opts out).
- Added OAuth authorization-code login with PKCE for Streamable HTTP MCP
  servers: `orbit mcp login <server>` walks the browser flow on a loopback
  redirect, stores the refresh token in the encrypted credential store, and
  the runtime refreshes access tokens silently from then on. Public clients
  need no client secret (`oauth.mode: authorization_code` +
  `oauth.authorizationUrl`).

### Changed

- Refined the WebUI visual system end to end: the dark theme's accent
  returns to the brand teal (buttons, toggles, focus rings, and diff hunks
  had drifted to steel blue), diff added/deleted lines now meet AA contrast
  in light mode, every floating surface shares the tokenized shadow and
  scrim scale (modals no longer render flat or brighten the dark theme),
  uppercase labels follow one two-tier letter-spacing system, micro-type
  moves up to a legible floor, corner radii snap to the design-token scale,
  and hover/expand transitions cover the controls that previously snapped.
  A maintained `pnpm webui:preview` + `pnpm webui:shots` harness under
  `scripts/webui-preview/` serves the real WebUI with demo data and captures
  the standard light/dark/mobile screenshot set for future design review.
- Extracted browser conversation history, pagination, and scroll anchoring
  into a focused client module instead of growing the message renderer.
- Kept recovery and reversible review actions in the conversation timeline so
  their outcome remains visible after transient notifications disappear.
- Raised the default agent iteration limit from 8 to 24 now that the loop
  guard and an always-finite runaway confirmation bound the cost; explicit
  `agent.maxIterations` settings are unchanged.
- Made provider-overload degradation temporary: after a short cooldown the
  loop returns to the primary model lane instead of finishing the whole run
  on the fast model, and auto-repair budgets now reset per task instead of
  accumulating across the whole session history.
- Made fuzzy and AST edit fallbacks trustworthy: results now quote the exact
  replaced block with line numbers for verification, and an edit is refused
  as ambiguous when two distinct locations both resemble the target text.

### Security

- Shell commands now honor the same protected-path patterns and workspace
  boundary as the file tools: `bash` and `run_tests` commands referencing
  secrets such as `.env` or paths outside the workspace prompt for approval
  (or are blocked under strict mode) instead of auto-running.
- Broadened secret redaction in logs, traces, and tool output to cover AWS,
  GitHub, Slack, JWT, npm, Google, and Stripe token formats plus env-style
  `NAME_KEY=value` assignments, in addition to the existing OpenAI,
  Anthropic, Bearer, private-key, and MongoDB patterns.
- Encrypted checkpoint backups at rest: the pre-edit copy of every file the
  agent touches is now written AES-256-GCM encrypted, keyed from the
  DPAPI/keychain-backed credential store, so checkpoints stop being a
  plaintext archive of edited files. Legacy plaintext checkpoints still
  load, tampered ciphertext is skipped instead of restored, and
  `security.encryptCheckpoints: false` opts out.
- Restricted workspace `.orbit/` state to the current user: on Windows the
  directory now carries an inheritable owner-only ACL (previously it was
  world-readable on most setups), and POSIX modes stay 0700/0600.

### Fixed

- Preserved ripgrep-specific regular expressions, Windows CRLF output, and
  JavaScript fallback behavior when ripgrep is missing or incompatible.
- Centralized workspace-safe glob discovery for grep, glob, and recursive file
  listing, rejecting parent traversal and linked-directory escapes before any
  fallback file is read.
- Kept a reader's place when the WebUI refreshes chat messages, exposed a
  visible earlier-message shortcut, and made long conversations easier to
  review without being forced back to the newest turn.
- Rendered slash-command execution in the conversation timeline so commands
  such as `/compact` visibly move from running to completed, stopped, or
  failed instead of relying on a transient toast.
- Kept the clickable WebUI address at the end of the active TUI conversation
  instead of inserting it above assistant text that was still streaming.
- Kept the WebUI workspace, sidebar, conversation, and composer inside short
  desktop viewports instead of allowing Grid intrinsic sizing to push the
  composer below the visible window.
- Made the sidebar independently scrollable when project and chat navigation
  cannot fit the available height.

No configuration migration is required from 0.3.1.

## 0.3.1 - 2026-07-26

### Changed

- Reworked the GitHub and npm READMEs into a clearer product introduction with
  faster onboarding, sharper surface selection, Skills and workflow guidance,
  provider continuity, safety guarantees, operations, and repository ownership.
- Clarified which generated, test, scratch, and runtime directories sit outside
  the source architecture.

### Fixed

- Added a release-gate documentation check that rejects broken or
  repository-escaping local Markdown links before publication.
- Ignored legacy visual and RAG scratch workspaces so local verification debris
  cannot reappear as accidental source.

No configuration migration is required from 0.3.0.

## 0.3.0 - 2026-07-26

### Added

- Added guided Skill and workflow templates for code review, research briefs,
  and reproducible mathematical-modeling papers, with editable invocation
  previews and a portable capability-catalog export.
- Added Activity filters for live, completed, warning, and failed execution
  states, plus changed-file filtering and one-click patch copying in the
  review workbench.

### Changed

- Refined the WebUI conversation hierarchy, message measure, reasoning
  disclosure, composer focus, project navigation, and responsive behavior
  across wide desktop, laptop, tablet, and narrow mobile viewports.
- Simplified the sidebar footer and capability settings so project work,
  chats, Skills, and workflows remain visually dominant.
- Kept project switching inside the current browser surface while launching
  isolated project runtimes with hidden child processes on Windows and
  compatible detached behavior on macOS and Linux.

### Fixed

- Prevented the composer dock and send controls from clipping or creating
  horizontal overflow at narrow viewport widths.
- Improved truncation, focus visibility, compact status presentation, and
  localized English, Simplified Chinese, and Traditional Chinese labels for
  the new workflow and review controls.

No configuration migration is required from 0.2.3. Existing chats,
checkpoints, project memory, commands, Skills, and workflows remain compatible.

## 0.2.3 - 2026-07-26

### Added

- Added a responsive WebUI Mission Control surface for the active goal,
  recoverable plan, model, cost, and delegated-agent state, with fixed
  planning-only and reviewed parallel-improvement actions.
- Added project switching from the WebUI with authenticated handoff to an
  isolated Orbit process, plus native folder selection and recent-project
  management.
- Added project-local Skill and workflow discovery, validation, activation,
  diagnostics, enable/disable controls, and guided creation from the WebUI.
- Added English, Simplified Chinese, and Traditional Chinese language selection
  shared by the WebUI and `/language`, plus canonical slash-command argument
  suggestions in both browser and terminal interfaces.

### Changed

- Refined the WebUI information hierarchy, responsive sidebar and inspector,
  compact notifications, command discovery, settings, task states, and
  keyboard behavior across desktop and narrow viewports.
- Centralized Skill parsing and selection, slash-command metadata, language
  normalization, and cross-platform hidden-child-process policy into focused
  modules with bounded browser projections.
- Expanded the TUI command palette with localized descriptions and argument
  hints while keeping the conversation and input surface visually dominant.

### Fixed

- Prevented Windows console windows from flashing during project switching,
  chat deletion, Git inspection, verification, credential access, and other
  runtime child-process operations.
- Kept task launch, cancellation, approval, agent refresh, stale runtime,
  credential redaction, and workspace path boundaries intact across the WebUI
  and terminal surfaces.
- Prevented malformed Agent events, unsafe project-ready URLs, capability path
  escapes, duplicate Skills, and partial Skill metadata from crossing their
  security or persistence boundaries.

No configuration migration is required from 0.2.2. Existing chats,
checkpoints, project memory, commands, and Skills remain compatible.

## 0.2.2 - 2026-07-25

### Added

- Added a dedicated `/review` product flow with comprehensive, security, test,
  performance, accessibility, commit, branch, and custom-policy scopes.
- Added a Web UI review launcher with focused read-only presets.
- Added durable multi-agent run records under `.orbit/agent-runs`, including
  each agent's role, model, status, access scope, budget, cost, and timestamps.
- Added a Web UI Agent control panel with per-agent cancellation.

### Changed

- Split review parsing, browser-safe Agent projections, and durable Agent
  tracking into focused modules instead of expanding the existing routing and
  runtime hotspots.
- Expanded critical coverage to checkpoint, rollback, Agent persistence, and
  review-command boundaries.
- Expanded Web UI regression coverage across desktop, narrow screens, keyboard
  focus, review presets, and Agent controls.

### Fixed

- Kept durable Agent observability failures from interrupting orchestration.
- Bounded and redacted all Agent records before they cross the Web UI boundary.
- Distributed planner, coder, and reviewer budgets across retry attempts
  without exceeding the configured orchestration budget.

No configuration migration is required from 0.2.1. Existing sessions,
checkpoints, and project data remain compatible.

## 0.2.1 - 2026-07-25

### Changed

- Made `/webui` start the local workspace without opening a browser
  automatically.
- Moved the authenticated Web UI URL beside the terminal `completed` message
  and removed the separate pinned footer row.
- Kept the former browser-open options as inert compatibility inputs so
  existing scripts continue to work without launching a browser.

### Fixed

- Made terminal width measurement and wrapping understand OSC 8 hyperlinks so
  authenticated links remain clickable without distorting the TUI layout or
  exposing their token in visible text.

No configuration migration is required from 0.2.0.

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
