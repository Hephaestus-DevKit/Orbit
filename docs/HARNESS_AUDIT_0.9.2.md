# Orbit 0.9.2 Harness Audit

Date: 2026-08-15  
Scope: Orbit Agent runtime, WebUI/TUI, provider routing, permissions,
extensions, recovery, and release readiness.

This audit uses the current public product documentation for OpenAI Codex,
Claude Code, and Zed as comparison evidence. It is a capability review, not a
claim that Orbit is an implementation of any of those products.

## Executive conclusion

Orbit already has a stronger local-first foundation than a chat-only wrapper:
provider-aware routing, DeepSeek protocol selection, bounded context and cost
accounting, durable sessions, input queues, checkpoints, verification contracts,
worktree orchestration, typed lifecycle hooks, MCP catalog recovery, trace
redaction, and a responsive WebUI are implemented and tested.

The remaining gaps are concentrated in product surfaces rather than the core
turn loop:

- custom Agent Profiles now have a schema-validated registry with project/user
  precedence, provider/model/permission/max-turn policy, allow/deny tools, and
  CLI diagnostics; interactive profile switching and signed extension profiles
  remain future work;
- extension integrity is hash-checked, but signed trust roots and sandboxed
  extension execution are not implemented;
- MCP has a strong dual-era baseline, but subscriptions, elicitation, sampling,
  and autonomous stdio recovery are not complete;
- Orbit is local-first. A hardened remote daemon, cloud/offload runner, ACP
  external-agent bridge, and OS-level sandbox are not shipped;
- review is evidence-first and preset-driven, but inline finding disposition,
  PR context, and automatic CI review triggers remain future work;
- TUI/WebUI support images and queues, but native screenshots, richer document
  inputs, and editor-native inline assistant behavior are not universal.

These boundaries are intentional. A missing feature must remain visible as a
bounded limitation instead of being reported as “complete”.

## Competitive capability matrix

| Capability                | Codex                                                            | Claude Code                                                                           | Zed                                                       | Orbit 0.9.2 status                                                                                                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local repository loop     | Inspect, edit, run, review, and compose with scripts/CI          | Read, edit, search, run, and continue a coding session                                | Agent Panel reads, edits, searches, and runs in a project | **Implemented** through AgentLoop, tools, TUI, WebUI, and `orbit exec`                                                                                                                                                                            |
| Durable long-running work | Durable objectives, background/remote workflows, resumable tasks | Background agents, resumable sessions, worktree isolation                             | Threads and restore checkpoints                           | **Local recovery implemented** with SessionStore, AgentRunStore lease, queue, checkpoints, and resume; remote/cloud is not implemented                                                                                                            |
| Permissions and approvals | Profiles, sandbox modes, approval/security controls              | Permission modes and per-tool allow/deny rules                                        | Agent Profiles and Tool Permissions                       | **Implemented locally** with strict/normal/auto/plan/full-access modes, shared approval/audit path, and explicit Full Access warning                                                                                                              |
| Custom agents             | Subagents and model/tool configuration                           | Custom subagents with model, tools, permissions, hooks, skills, memory, and isolation | Agent Profiles and external agents                        | **Implemented locally** for schema-validated user/project profiles, policy-checked model/provider/permission/max-turn selection, tool allow/deny, and prompt policy; interactive switching, signed extension profiles, and external agents remain |
| Parallelism and isolation | Multi-agent workflows and Git worktrees                          | Subagents, teams, hooks, and worktree isolation                                       | Parallel Agents and ACP external agents                   | **Implemented locally** with bounded DAG scheduling, worktrees, ownership checks, merge/review worktree, leases, and steering                                                                                                                     |
| Skills/instructions       | `AGENTS.md`, Skills, plugins, MCP                                | Skills, `CLAUDE.md`, plugins, MCP                                                     | Skills, Instructions, Agent Profiles, MCP                 | **Implemented** for project/user Skills, commands, `AGENTS.md`, workflows, and MCP; signed distribution policy remains open                                                                                                                       |
| Lifecycle automation      | Hooks and repeatable non-interactive mode                        | Deterministic hooks around prompts, tools, subagents, compaction, and sessions        | Settings/skills/MCP integrations                          | **Implemented baseline** with typed hooks, matchers, block/warn/ignore policy, cancellation, redaction, and event/audit emission                                                                                                                  |
| MCP                       | MCP and server integrations                                      | MCP servers, elicitation, hooks, and tool integrations                                | MCP servers in Agent Settings                             | **Partial**: modern/legacy negotiation, transactional refresh, health diagnostics, HTTP recovery telemetry; subscriptions/elicitation/sampling and stdio backoff remain                                                                           |
| Review and rollback       | `/review`, code-review workflows, checkpoints                    | Review/edit checkpoints and rewind workflows                                          | Restore Checkpoint after edits                            | **Implemented baseline** with review presets, diff/checkpoint/rollback/rewind, verification evidence, and redacted trace export; inline dispositions/PR context remain                                                                            |
| Multimodal/context        | Images, files, browser/computer workflows                        | Images, MCP, project context                                                          | Image/file context and editor selection                   | **Partial**: bounded WebUI image input, file context, retrieval, and clipboard/paste; native screenshots and rich document extraction remain                                                                                                      |
| Editor integration        | CLI, IDE, cloud, GitHub/CI surfaces                              | CLI/desktop/SDK integrations                                                          | Native editor Agent Panel and Inline Assistant            | **Partial**: VS Code autocomplete and WebUI/TUI; no full editor-native inline assistant or ACP external-agent bridge                                                                                                                              |
| Observability and cost    | Status, approvals, model/reasoning controls                      | Usage, hooks, background state, permissions                                           | Thread/tool status and settings                           | **Implemented locally** with event schema, redacted trace, token/cache/cost ledger, health diagnostics, and Mission Control                                                                                                                       |
| Remote/cloud execution    | Available in Codex surfaces                                      | Background/remote options vary by product surface                                     | External agents/ACP                                       | **Not shipped**; loopback WebUI only, no TLS daemon or cloud offload claim                                                                                                                                                                        |

## Evidence in the Orbit tree

The following are current implementation anchors, not aspirational names:

- `packages/core/src/agent/AgentLoop.ts` — bounded agent loop, approval,
  verification, hooks, cancellation, compaction, and outcome receipts.
- `packages/core/src/agent/Orchestrator.ts` and
  `packages/core/src/agent/AgentTaskScheduler.ts` — worktree-backed parallel
  plans, ownership enforcement, reviewer iterations, steering, and cleanup.
- `packages/session/src/SessionStore.ts` and `AgentRunStore.ts` — durable
  session/event/run state, leases, migration, atomic writes, and recovery.
- `packages/cli/src/runtime/webui/` — authenticated WebUI boundary, SSE
  replay-gap reconciliation, event sanitization, responsive shell, modal
  isolation, focus traps, queue, approval, Mission Control, and settings.
- `packages/mcp/src/` — protocol negotiation, catalog refresh, health, and
  recovery behavior across modern and legacy servers.
- `packages/cli/src/runtime/ExtensionManager.ts` and
  `packages/context-engine/src/skills/` — bounded extension/Skill loading,
  validation, hashes, and discovery.
- `scripts/verify-cli-package.mjs`, `scripts/smoke-cli.mjs`, and
  `scripts/smoke-installed-cli.mjs` — version, package allowlist, clean-install,
  CLI behavior, and artifact checks.

## Acceptance suite for this release line

The release gate must measure behavior, not only compile success:

1. Repository orientation and architecture explanation.
2. Multi-file feature implementation with a verification contract.
3. Failing-test diagnosis and repair.
4. Security review with protected-path and credential-redaction checks.
5. Provider/model switch including automatic DeepSeek adaptation.
6. Long-session context retention and semantic compaction accounting.
7. Interrupted task resume after process restart or expired lease.
8. Unsafe command rejection, explicit Full Access, and cancellation.
9. Checkpoint, rewind, rollback, and merge-conflict handling.
10. Parallel review with attributed approvals and disjoint-writer ownership.
11. Non-interactive JSONL execution with deterministic exit codes.
12. Skill/workflow reuse and MCP refresh/reconnect failure paths.
13. Agent Profile discovery, duplicate/unsafe manifest rejection, managed
    policy enforcement, and tool deny-list behavior.
14. WebUI desktop, 390px mobile, keyboard-only, reduced-motion, and
    forced-colors checks.
15. Windows, macOS, and Linux command-shell compatibility.

Required commands:

```text
corepack pnpm verify:release
corepack pnpm test:deepseek
corepack pnpm test:webui:e2e
node packages/cli/dist/index.js doctor --json --strict
node scripts/verify-cli-package.mjs
git diff --check
```

## Release blocker: requested version is lower than the published baseline

The repository and npm currently expose `1.0.0`; GitHub also has `v1.0.0`.
`0.9.2` does not exist yet, but publishing it as the default npm `latest`
channel would move consumers from `1.0.0` backwards. This is a release-channel
decision, not a build failure.

Safe options are:

- publish the same work as a monotonic `1.0.1` patch release; or
- intentionally publish `0.9.2` under a non-latest dist-tag and document that
  it is a compatibility/backport line.

Do not tag, push, create a GitHub release, or publish npm until the intended
option is confirmed.

## Primary comparison sources

- [OpenAI Codex CLI](https://developers.openai.com/codex/cli/features)
- [OpenAI Codex subagents](https://developers.openai.com/codex/subagents)
- [OpenAI Codex hooks](https://developers.openai.com/codex/hooks)
- [Claude Code permissions](https://code.claude.com/docs/en/permissions)
- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Zed AI Quick Start](https://zed.dev/docs/ai/quick-start)
- [Zed Agent Panel](https://zed.dev/docs/ai/agent-panel)
- [Zed Agent Profiles](https://zed.dev/docs/ai/agent-profiles)
