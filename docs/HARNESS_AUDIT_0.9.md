# Orbit 0.9 Harness maturity audit

Reviewed: 2026-08-15

This document is the short-term closure record for Orbit 0.9. It separates
implemented, tested harness behavior from longer-term product or infrastructure
work. A green release gate is evidence for the checked contract, not a claim
that arbitrary model output or host execution is safe.

## External baseline

The comparison uses public, reviewable primary sources:

- Codex: [long-running work](https://developers.openai.com/codex/long-running-work),
  [subagents](https://developers.openai.com/codex/agent-configuration/subagents),
  [Hooks](https://developers.openai.com/codex/hooks),
  [approvals and security](https://developers.openai.com/codex/agent-approvals-security),
  and [record/replay](https://developers.openai.com/codex/extend/record-and-replay).
- Claude Code: [official overview](https://docs.anthropic.com/en/docs/claude-code/overview)
  and [how it works](https://docs.anthropic.com/en/docs/claude-code/how-claude-code-works).
- CodeWhale: [public source and architecture index](https://github.com/Hmbown/CodeWhale).
- DeepSeek Harness is not treated as the target architecture. Only wire-level
  behavior corroborated by official API documentation is eligible for Orbit.
- Grok Build currently has no complete public official source tree suitable for
  architecture verification. Third-party account-pool and compatibility proxy
  repositories are excluded from the trust baseline.

## 0.9 short-term closure

| Boundary            | 0.9 evidence                                                                                                                                          | Remaining constraint                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Agent lifecycle     | Typed Hooks cover 13 lifecycle events with matcher, timeout, failure policy, permission, cancellation, redaction, and event audit                     | Extension-supplied executable Hooks remain inactive until signed/sandboxed plugin execution exists                |
| Parallel work       | Up to four disjoint writers use isolated worktrees, ownership verification, isolated integration, and review-before-apply                             | Dependency-aware writer snapshots need measured evidence before adding coordination cost                          |
| Long tasks          | Durable sessions, bounded 200-round default, background process ownership, steering, compaction, verification, and conservative crash recovery        | The owning CLI process remains the task owner; no remote daemon handoff                                           |
| Provider adaptation | Model semantics are independent from provider transport; Chat, Responses, Anthropic, compatible gateways, and DeepSeek family policy are isolated     | Unknown providers still require explicit capability overrides or conservative defaults                            |
| MCP                 | Dual-era negotiation, bounded pagination/SSE/JSON, OAuth, cancellation, dynamic refresh, health, and recovery telemetry                               | Modern subscriptions, autonomous stdio reconnect, MRTR input, and per-server organization policy remain           |
| Workflow reuse      | Redacted session traces compile to reviewable Skills without raw side-effect replay                                                                   | Interactive step disposition and parameter suggestions remain                                                     |
| Evaluation          | Eight isolated tasks plus correctness, file-scope, verification, latency, token/cache/cost, approval, failure, compaction, attempt, and crash metrics | Repository-orientation precision, accessibility, multimodal, and large-repository suites need additional fixtures |
| Release trust       | Cross-platform CI, provenance, package allowlist, install smoke, dependency audit, documentation verification, and rollback record                    | Commercial support, privacy, signing ownership, and SLA decisions remain owner responsibilities                   |

## Safety invariants

1. Raw credentials never belong in config, events, traces, Hook payloads,
   browser responses, evaluation artifacts, or npm packages.
2. Normal filesystem execution stays inside the authorized workspace. Full
   Access intentionally grants host-account authority and clearly loses Orbit
   rollback coverage outside the workspace.
3. A provider stream may retry only before any output. Partial output is
   reconciliation evidence and must never trigger blind tool replay.
4. A workflow export is guidance, not an executable recording. Historical
   commands and arguments must be reconstructed against current state.
5. Parallel writers never share a writable worktree. Ownership and integration
   are verified before the main workspace changes.
6. Cancellation must prevent late writes and false completion. Cleanup remains
   idempotent across normal, failed, and interrupted exits.
7. External schemas, protocol frames, paths, manifests, config, and durable
   state are runtime-validated and size-bounded.

## Known post-0.9 priorities

### P1 — trust and policy

- Signed extension manifests and organization trust roots.
- Sandboxed plugin lifecycle/tool execution with explicit network and
  credential capabilities.
- Retention enforcement and policy diagnostics suitable for managed fleets.
- Optional OS-level process and network isolation. Full Access remains a valid
  user posture, but mature deployments also need a hardened lower-authority
  posture on Windows, macOS, and Linux.

### P1 — protocol and review

- MCP modern subscriptions and autonomous, bounded reconnect backoff.
- Inline review-finding disposition, GitHub PR/CI context, and automatic review
  triggers.
- Live provider capability negotiation where a protocol exposes authoritative
  metadata, while retaining conservative fallback.

### P2 — runtime topology and experience

- Authenticated TLS daemon, cross-process task leases, client handoff, and
  explicit remote administration.
- Provider-neutral cloud/offload interface with best-of-N attempts and local
  reviewed patch application.
- Persistent keymaps/themes, Vim mode, reverse history search, no-color and
  screen-reader direct modes.
- Native screenshot capture, TUI image references, richer document inputs, and
  provider-specific multimodal limits.

## Release acceptance

0.9 is releasable only when the repository release gate, strict doctor, packed
artifact inspection, clean-install smoke, cross-platform CI, version alignment,
and immutable GitHub/npm publication checks all pass. Credentialed provider
benchmarks remain a separate controlled gate and must record provider account,
region, runner, model identity, and redacted results.
