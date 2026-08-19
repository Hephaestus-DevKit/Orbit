# Orbit CLI Competitive Roadmap

Last reviewed: 2026-08-19

## Product objective

Orbit should not claim to be the best CLI based on feature count. It should win on measurable engineering outcomes:

1. Higher task completion rate on real repositories.
2. Fewer unsafe or unintended changes.
3. Faster recovery from failed agent actions.
4. Better long-session context quality.
5. Lower latency and model cost for equivalent outcomes.
6. Stronger automation, extension, and team-governance surfaces.

The comparison baseline includes current public capabilities documented by Codex CLI, Claude Code, Gemini CLI, Aider, OpenCode, Goose, Qwen Code, and other observable coding-agent CLIs. Products without complete public documentation should be evaluated through reproducible black-box workflows rather than assumed feature claims.

## Current Orbit advantages

- Local-first provider abstraction across DeepSeek, OpenAI, Anthropic, and Ollama.
- DeepSeek V4 automatic stable-prefix cache telemetry and cache-aware cost visibility without synthetic keepalive traffic.
- Hybrid repository context with symbols, PageRank landmarks, BM25/vector retrieval, and reference expansion.
- Automatic repository retrieval with TypeScript, JavaScript, and Python symbol/import frontends plus an explicit per-turn opt-out.
- Workspace path-boundary utilities and protected-path policy.
- Read-only context references enforced during tool execution.
- Persistent sessions, command history, context controls, and session forking.
- Interactive steering while an agent is running.
- Persistent file checkpoints with `/timeline`, `/rewind`, and `/rollback`.
- Project and user custom prompt commands under `.orbit/commands/` and `~/.orbit/commands/`.
- Permission-aware direct shell and Git commands.
- Chinese and English terminal UI.

## Delivery status and highest-priority gaps

| Priority | Capability                 | Current state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Required outcome                                                                                                                                                                                        |
| -------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Done     | Parallel subagents         | A dependency DAG scheduler provides disjoint-writer plans, isolated worktrees, actual-change ownership checks, an integration/review worktree, durable records, steering, attributed approvals, leases, interrupted-child resume, team presets, and WebUI Mission Control.                                                                                                                                                                                                                                                                                                                                                          | Add dependency-aware writer snapshots only when measured tasks justify the coordination cost.                                                                                                           |
| Done     | Custom agent profiles      | Schema-validated project, compatibility, and user registries enforce precedence, duplicate/size/symlink diagnostics, provider/model/permission/max-turn policy, tool filtering, prompts, MCP allow-lists, hooks, worktree isolation, `orbit agents list`, `orbit agents validate`, and idle-only TUI/WebUI selection. Extension profiles use an isolated namespace.                                                                                                                                                                                                                                                                 | Add organization-distributed profile catalogs after signed registry ownership is defined.                                                                                                               |
| Done     | Non-interactive automation | `orbit exec` provides JSONL events, schema versions, deterministic exit codes, resume, output-schema validation, and CI-safe approvals.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Preserve compatibility and add fixtures whenever the event schema evolves.                                                                                                                              |
| Done     | Verification contracts     | Build, test, lint, typecheck, security, file-limit, and artifact policies are first-class and persisted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Expand contract presets from measured customer repositories.                                                                                                                                            |
| Done     | Full audit trail           | Secret-redacted trace export covers prompts, routing, tools, approvals, diffs, checkpoints, verification, timing, and cost.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Maintain redaction regression tests and schema compatibility.                                                                                                                                           |
| Done     | Project portability        | Versioned, size-bounded project backups preserve durable chats, memory, commands, Skills, plans, and verification settings with per-file SHA-256 validation while excluding credentials and caches.                                                                                                                                                                                                                                                                                                                                                                                                                                 | Add explicit migrations when a future bundle schema is introduced.                                                                                                                                      |
| Done     | Agent isolation            | Orchestration uses temporary Git worktrees with merge/conflict handling and safe fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Require isolation for future parallel writers and keep cleanup tests cross-platform.                                                                                                                    |
| Done     | Hook system                | Typed lifecycle hooks cover session, prompt, permission, tool, compaction, verification, subagent, and stop events. Metadata is bounded; commands share permission/audit/cancellation; legacy hooks remain compatible; trusted extension hooks carry provenance and require a native sandbox.                                                                                                                                                                                                                                                                                                                                       | Keep event compatibility and place future executable extension tools behind the same sandboxed policy.                                                                                                  |
| Done     | Plugin and Skill system    | Local install/list/update/remove validates compatibility and permissions, hashes installed files, activates declarative commands/Skills/profiles, integrity-checks MCP definitions, verifies Ed25519 signatures, enforces signed managed-policy `allowedExtensions` and `disableExtensionTools`, and runs trusted hooks/tools only in required native sandboxes with provenance, denied network, strict schemas, bounded output, cancellation, and process-tree cleanup. Arbitrary JavaScript is never imported into Orbit.                                                                                                         | Add a hosted signed registry distribution service.                                                                                                                                                      |
| Done     | MCP completeness           | The dual-era baseline includes Tasks with tool-level support checks and structured input requirements, coalesced catalog changes, resource subscriptions, Roots, form/URL Elicitation, per-server interaction policy, legacy approval-gated Sampling, explicit stdio reconnect, and bounded automatic recovery with per-server backoff, crash-loop suspension, catalog refresh, cancellation, and no ambiguous-call replay.                                                                                                                                                                                                         | Keep deprecated Sampling tool loops unsupported.                                                                                                                                                        |
| Done     | ACP external agents        | ACP v1 processes retain auth/model/runtime ownership. Orbit negotiates capabilities, mediates permissions, streams bounded updates, lists durable sessions, resumes or loads sessions, closes sessions, discovers signed local registries, fetches and atomically pins signed hosted registries with owner/id/revision/expiry and rollback checks, and performs explicit inert history imports.                                                                                                                                                                                                                                     | Add a central hosted index service and cross-process migration only after organization ownership, provenance, and rollback semantics are specified.                                                     |
| Done     | Code review baseline       | `/review` covers working changes, commits, branches, security, tests, performance, accessibility, and custom policy. Findings are schema-validated and persisted; `orbit review list`, `show`, `set`, and `verify` provide disposition history and CI gating. SARIF, GitHub Checks, inline comments, and workflow dispatch are bounded and dry-run first.                                                                                                                                                                                                                                                                           | Add automatic review triggers only through explicit project-owned CI policy.                                                                                                                            |
| Done     | Multimodal input           | WebUI and TUI image attachments (`/attach`, `/attachments`, `/detach`) use bounded common image formats, signatures, model capability checks, and safe transcript metadata. The model tool registry exposes bounded `inspect_document` extraction for text/CSV/code, PDF (`pdftotext`), DOCX/PPTX (`pandoc`), common Office formats (`LibreOffice`), opt-in Tesseract image/scanned-PDF OCR, privacy-sensitive `capture_screenshot`, ffmpeg `capture_audio`, local Whisper `transcribe_audio`, and read-only UIA/Accessibility/AT-SPI `inspect_accessibility`; all use argv boundaries and explicit dependency/permission failures. | Add provider-specific audio/image limits, visual attachment transport in non-WebUI clients, and hosted media processing only with explicit consent.                                                     |
| Done     | TUI power-user controls    | The custom TUI supports safe live steering and a durable `/queue` surface shared with WebUI. `config.tui.color` provides terminal-aware/no-color output, `config.tui.theme` persists `morandi`/`high-contrast`/`plain`, and `config.tui.keymap: vim` provides bounded INSERT/NORMAL navigation, operators (`dw`, `cw`, `D`, `C`), and one-step undo without changing approval keys. `config.tui.accessibility: screen-reader` routes assistive sessions through a stable line-oriented path without alternate-screen, mouse, spinner, cursor-redraw, or ANSI output.                                                                | Keep key semantics stable and add operators only behind tested bounded edits.                                                                                                                           |
| Done     | WebUI quality gates        | The authenticated local workspace has bounded responsive layouts, independent scroll ownership, keyboard-safe drawers and tabs, strict CSP, safe text rendering, SSE reconciliation, assembled-script syntax and undefined-identifier checks, focused contracts, and real-browser desktop/mobile E2E.                                                                                                                                                                                                                                                                                                                               | Move browser fragments to a bundled typed client only when the dependency and package-size tradeoff is explicitly accepted; keep runtime behavior protected meanwhile.                                  |
| Done     | Memory                     | Explicit opt-in project memory has provenance, secret redaction, review/delete controls, and excludes external context by default.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Add user scope only after a clear precedence and privacy design exists.                                                                                                                                 |
| Done     | Remote runtime             | `orbit daemon` provides a bearer-authenticated, loopback-by-default control plane with TLS for non-loopback listeners, durable task states, leases, heartbeats, submit/inspect/replay/follow/cancel/resume/remove, bounded SSE, allowed-root enforcement, typed remote handoff, optional RS256/JWKS identity, fsynced hash-chain audit, and the provider-neutral FleetCoordinator contract with signed envelopes, worker leases, stale recovery, patch ownership, and rollback-safe digests.                                                                                                                                        | Add a hosted transport/storage/identity adapter only after deployment ownership, tenancy, retention, and rollback operations are defined.                                                               |
| External | Cloud/offload              | Local provider-neutral coordinator is supported with signed job envelopes, worker leases/heartbeats, stale recovery, bounded attempts, explicit patch ownership/base revisions and result digests, plus injected persistence. No workspace is uploaded automatically.                                                                                                                                                                                                                                                                                                                                                               | A separately operated service must provide multi-tenant transport/storage, patch transfer, identity, retention, incident response, and rollback. The CLI cannot honestly mark that deployment complete. |
| Done     | Workflow recording         | Redacted traces compile into local or versioned reviewable Skills; raw prompts, arguments, output, diffs, and executable command replay are excluded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Add an interactive disposition editor and parameter suggestions without weakening the no-blind-replay invariant.                                                                                        |
| External | Enterprise governance      | Administrator policy is applied last and constrains providers, models, permissions, network tools, budgets, iterations, extension hooks, and paths. Signed extension/ACP trust roots, signed managed-policy bundles, policy diagnostics, local retention enforcement, redacted hash-chain audit, daemon-local scoped principals (`read`/`submit`/`control`/`admin`), and optional RS256/JWKS verification are available.                                                                                                                                                                                                            | A separately owned deployment must supply hosted SSO/federated lifecycle, centralized audit/retention, key rotation, availability, and legal operating policy.                                          |

## Architecture changes required

### 1. Split the CLI runtime

`packages/cli/src/commands/run.ts` is now a thin entry point. The first runtime
split is also complete:

- `runtime/CommandRouter.ts` delegates shell, config, context, rollback, and
  session domains to tested handlers under `runtime/commands/`.
- `tui/FullscreenTui.ts` delegates prompt state/rendering, input history,
  terminal text, paging, input helpers, and theme constants to focused modules;
  terminal I/O now starts through an explicit lifecycle method.
- `runtime/webui/` separates its process facade, per-instance server, SSE
  bridge, security, serialization, HTTP boundary, browser fragments, and CSS
  fragments. Stopped instances cannot publish into replacement runtimes. The
  assembled browser controller is parsed, checked for undefined identifiers,
  and exercised in a real browser; cross-fragment references no longer rely on
  fragment-local TypeScript checks alone.

The conversation turn grouping and environment/status telemetry are now owned
by tested `TuiConversationViewModel.ts` and `TuiEnvironmentStatus.ts` modules.
`FullscreenTui.ts` remains the composition and rendering owner so this split did
not change the established terminal layout.

Target modules:

- `runtime/ReplController.ts`
- `runtime/commands/*.ts`
- `runtime/TaskExecutor.ts`
- `runtime/ProviderFactory.ts`
- `tui/TuiPromptSession.ts` and `tui/TuiPromptView.ts`
- `commands/builtin/*.ts`
- `commands/custom/CustomCommandRegistry.ts`
- `security/InteractiveApproval.ts`
- `automation/JsonlReporter.ts`

No major feature should expand these hotspot files without first extracting a
focused handler, coordinator, or view module with colocated tests.

### 2. Typed event protocol (implemented baseline)

`EventBus` payloads use a discriminated Zod envelope shared by the TUI, Web UI,
JSONL automation, and trace surfaces. The v1 golden fixture protects serialized
compatibility. New event families must extend that schema and add a migration or
versioned fixture when the wire representation changes.

Required event families:

- session lifecycle
- model request and usage
- reasoning and response deltas
- tool proposal, approval, execution, and result
- file diff and checkpoint
- verification start/result
- agent spawn/status/result
- context assembly and compaction
- warning/error/final result

### 3. Explicit provider capabilities (implemented baseline)

Providers declare and routing consumes support for:

- streaming
- native tools
- reasoning
- prompt caching
- images
- embeddings
- structured output
- maximum context/output

Known profiles provide the authoritative capability record. Unknown compatible
models use conservative defaults rather than optimistic name guessing; live
capability negotiation remains a future enhancement.

### 4. Shared safety path (implemented baseline, keep extending)

Model tools, direct commands, Git, hooks, MCP tools, and orchestrated agents now
pass through the shared permission/audit path. Future extension loaders and new
execution surfaces must do the same:

- model tool calls
- direct shell commands
- Git commands
- hooks
- MCP tools
- custom commands that request execution
- subagents
- plugins

Permission decisions should include normalized target scope, command classification, source agent/thread, policy layer, and an auditable reason.

## Delivery sequence

### Phase A: automation and trust

1. `orbit exec --jsonl` — complete
2. typed event protocol — complete baseline
3. verification contracts — complete baseline
4. trace export and replay fixtures — complete baseline
5. worktree isolation — complete baseline

### Phase B: agent leverage

1. parallel agent-thread manager
2. custom agent manifests
3. dedicated review engine
4. task DAG and dependency-aware scheduling
5. per-agent model, budget, tool, and sandbox configuration

### Phase C: ecosystem

1. hooks v2 — complete baseline
2. plugin manifest and installer
3. MCP live catalog refresh and health diagnostics — complete baseline; finer server policy remains
4. skills with progressive loading
5. signed/team-managed extension policy

### Phase D: experience

1. image input
2. theme/keymap/Vim/history search
3. remote TUI protocol
4. opt-in durable memory
5. safe workflow trace-to-Skill compilation — complete baseline; blind side-effect replay remains intentionally unsupported

## Competitive acceptance suite

Orbit should extend the existing `orbit bench` provider latency/cache microbenchmark into a public competitive acceptance harness instead of relying on subjective comparisons. Acceptance suites carry a bounded version, deterministic flag, tags, and optional fixture hash so results cannot silently mix different fixtures.

Minimum scenarios:

- repository orientation and architecture explanation
- multi-file feature implementation
- failing-test diagnosis and repair
- security review with exploitable finding detection
- dependency/API migration
- merge-conflict resolution
- long-session context retention
- interrupted task resume
- unsafe command rejection
- rollback after partial failure
- parallel review across six independent concerns
- non-interactive CI execution
- custom workflow reuse
- MCP tool failure and reconnect
- Windows, macOS, and Linux terminal compatibility

Track:

- completion rate
- verified correctness
- median wall-clock time
- model input/output/cache tokens
- user approval count
- unintended file changes
- rollback success
- context-retrieval precision
- crash/hang rate

## Source baseline

- Codex CLI features and customization: <https://developers.openai.com/codex/cli/features>
- Codex subagents: <https://developers.openai.com/codex/subagents>
- Codex hooks: <https://developers.openai.com/codex/hooks>
- Claude Code permissions: <https://code.claude.com/docs/en/permissions>
- Claude Code subagents: <https://code.claude.com/docs/en/sub-agents>
- Claude Code hooks: <https://code.claude.com/docs/en/hooks>
- Zed AI quick start: <https://zed.dev/docs/ai/quick-start>
- Zed Agent Panel: <https://zed.dev/docs/ai/agent-panel>
- Zed Agent Profiles: <https://zed.dev/docs/ai/agent-profiles>
- Gemini CLI repository: <https://github.com/google-gemini/gemini-cli>
- Aider repository: <https://github.com/Aider-AI/aider>
- OpenCode repository: <https://github.com/sst/opencode>
- Goose repository: <https://github.com/block/goose>
- Qwen Code repository: <https://github.com/QwenLM/qwen-code>
