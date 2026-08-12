# Changelog

All notable user-facing changes are recorded here. Orbit follows semantic
versioning, and configuration or API migrations are called out explicitly.

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
