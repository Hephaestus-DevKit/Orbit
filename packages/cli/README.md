<div align="center">

# @orbit-build/cli

**The terminal, browser, and editor runtime for Orbit.**

[![npm](https://img.shields.io/npm/v/@orbit-build/cli?label=npm&color=426b63)](https://www.npmjs.com/package/@orbit-build/cli)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-43853d)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-Apache--2.0-3b82f6)](LICENSE)

</div>

Orbit is a local-first AI coding workspace optimized for DeepSeek V4, with
OpenAI-compatible, Anthropic, and local Ollama support. Its full-screen TUI and
authenticated local Web UI share the same project chats, model, task,
permissions, checkpoints, and cancellation state.

## Install

Requires Node.js 20 or newer on Windows, macOS, or Linux.
Git is recommended for richer rollback and isolated agent work, but Orbit keeps
a filesystem-checkpoint fallback when Git is unavailable.

```bash
npm install --global @orbit-build/cli
orbit login
cd path/to/project
orbit init
orbit
```

`orbit init` creates a non-destructive Agent contract, inferred verification
candidates, and starter `/implement` and `/review` workflows. Inspect inferred
commands before trusting project executables. Use `--minimal` for only
`ORBIT.md`, or `--json` when another tool consumes the result.

Use natural language to start work or type `/` in the TUI or Web UI to open the
same localized command catalog:

```text
Review this codebase, fix the highest-impact problem, and verify it.
/model                  Switch model without losing the conversation
/goal ship this safely  Set a durable objective
/plan                   Inspect the recoverable task plan
/webui                  Start the synchronized browser workspace
```

`/webui` does not open a browser automatically. It presents an authenticated,
clickable local URL beside the terminal's completed message before any optional
remote model refresh, so provider latency cannot block local startup.

## Other entry points

```bash
orbit "Fix the failing tests"               # immediate interactive task
orbit exec "Review src" --jsonl             # automation-friendly JSONL
orbit doctor --probe --deepseek              # configuration + live probe
orbit bench --model deepseek-v4-flash --thinking high
orbit agents validate --json                 # validate project/user Agent Profiles
orbit --agent-profile reviewer "Review src"  # run one task with a named profile
orbit                                         # then /agent reviewer in TUI/REPL
orbit runs list --json                        # inspect durable Agent runs
orbit runs inspect run_...                    # inspect child-agent state and lease
orbit runs recover                            # recover expired process leases
orbit daemon start --root .                  # start a durable local task daemon
orbit daemon start --jwks idp-jwks.json --issuer https://id.example --audience orbit
orbit daemon status --json                    # inspect daemon health
orbit daemon submit "Fix tests" --json        # enqueue a durable task
orbit daemon inspect task_... --json           # inspect state, lease, and outcome
orbit daemon events task_... --follow --jsonl  # replay then follow bounded events
orbit daemon cancel task_...                   # stop a queued/running task
orbit daemon resume task_...                   # retry with durable session context
orbit daemon remove task_...                   # remove one terminal task + journal
orbit daemon tasks --limit 20 --json           # list cross-process task records
orbit daemon stop                             # authenticated shutdown
orbit daemon audit --limit 100 --json         # verify/read redacted audit chain
orbit acp list                                # list ACP external Agents
orbit acp probe <agent>                       # negotiate an external Agent
orbit acp sessions <agent>                    # inspect its durable sessions
orbit acp run <agent> <prompt> --session <id> # continue a durable session
orbit acp close <agent> <session>             # release an active session
orbit review list                             # inspect persisted review findings
orbit review verify --json                    # CI gate for open P0/P1 findings
orbit update --check                         # check without installing
```

Orbit exits automation with `0` for completion, `2` for task or verification
failure, `4` for provider startup failure, and `130` for abort.
Every initialized run also returns a structured receipt with changed files,
verification state, plan progress, usage, and cost availability through the
final `agent_completed` event.

## What is included

- Project-scoped chats with model-aware context compaction and conservative
  crash recovery.
- Validated file, search, symbol, shell, test, Git, web, fetch, plan, and MCP
  tools with bounded, redacted results. `inspect_document` extracts supported
  text/PDF/Office inputs through explicit local extractors and opt-in
  Tesseract OCR, while `capture_screenshot`, `capture_audio`, and
  `transcribe_audio`, and `inspect_accessibility` use privacy-sensitive,
  platform-native adapters with
  bounded output, password-value omission, and dependency/permission
  diagnostics.
- Platform-native command execution—PowerShell on Windows and Bash/POSIX sh on
  macOS/Linux—with model guidance that matches the active shell dialect.
- Workspace isolation, approval policy, checkpoints, timeline, rewind,
  rollback, Changes review, verification contracts, and trace export.
- Browser image input, project switching, queued follow-ups, task and delegated
  agent visibility, paginated long-chat history, responsive layouts, and
  English/简体中文/繁體中文 controls.
- Guided Skills and workflows with localized inline validation, activation
  visibility, failed-save recovery, invocation preview, editable input hints,
  enable/disable controls, portable catalog export, and source-targeted deep
  bundle validation for duplicate-name development setups.
- Typed lifecycle Hooks with bounded metadata, matchers, timeout/failure
  policy, shared approvals, and browser-safe audit events. Trusted extension
  Hooks additionally require process permission and an integrity-matched
  install, then run with provenance in a required native sandbox, denied
  network, read-only extension root, and credential-free environment.
- Schema-validated Agent Profiles from `.agents/agents`, `.orbit/agents`,
  `.claude/agents`, and user directories with deterministic precedence,
  managed-policy checks, tool allow/deny controls, named MCP server
  allow-lists, profile-owned lifecycle hooks, and an idle-only `/agent` picker.
  Extensions may contribute validated YAML/JSON profiles under an isolated
  extension namespace; direct project/user profiles always win duplicate names.
- A durable Agent control plane that can be inspected from a second terminal:
  `orbit runs list|inspect|recover` exposes bounded, redacted state without
  attaching to or interrupting the active Web UI/TUI process.
- Official ACP v1 external-Agent bridge with capability probing, streaming,
  bounded session discovery, capability-driven resume/load continuation,
  explicit close, permission requests, cancellation, timeout recovery, and
  redacted logs.
- `orbit acp import <agent> <session>` performs an explicit bounded
  `session/load` replay into a native Orbit session. Imported tool/plan updates
  are inert provenance text, binary content is omitted, oversized history is
  rejected unless `--allow-truncated` is explicit, and identical snapshots are
  digest-deduplicated.
- Local ACP registry discovery with user/project precedence, bounded manifest
  validation, symlink rejection, stable digests, and explicit trust metadata:
  `orbit acp registry list|validate`. `orbit acp registry fetch --url` adds
  HTTPS-only hosted distribution with signed owner/id/revision/expiry metadata,
  bounded timeout/cancellation, conditional ETag support, and atomic local
  pinning; older local revisions are never overwritten without `--force`.
- Authenticated durable task daemon with loopback-by-default HTTP, optional
  TLS for remote listeners, atomic private bearer-token storage, task leases and
  heartbeats, resumable/orphaned state, cancellation, bounded event replay with
  slow-client limits, explicit terminal-record removal, and a complete
  `start|status|submit|tasks|inspect|events|cancel|resume|remove|stop` CLI.
  Every control action can also target an explicit remote daemon with
  `--url` plus a bearer token from `--token-env`; remote HTTP is rejected except
  for loopback, and remote execution still uses the typed `DaemonClient`
  protocol with the same bounds and cancellation semantics.
  Remote `submit` requires an explicit `--cwd` visible to the daemon host;
  Orbit never guesses a cross-machine path mapping.
  Hosts can provide daemon-local `read`/`submit`/`control`/`admin` principals;
  the token-file compatibility principal is intentionally full local-admin,
  not an SSO identity. Optional RS256/JWKS verification maps an existing IdP's
  short-lived claims to those scopes; `DaemonAuditLog` provides a redacted,
  fsynced hash-chain record and `requireAudit` can fail closed.
- Provider-neutral `FleetCoordinator` primitives plus the daemon package's
  `FleetHttpServer`/`FleetHttpClient` define signed idempotent job envelopes,
  worker leases, stale recovery, retry limits, patch ownership/base revisions,
  result digests, cancellation, bounded HTTP transport, and scoped auth. They
  are a deployable cloud/offload seam, not an automatic workspace uploader;
  tenancy, storage, patch transfer, and rollback remain deployment-owned.
- Review findings persisted as structured evidence under `.orbit/reviews/`, with
  `orbit review list|show|set|verify` disposition and CI-gate controls that
  never edit source files; disposition changes retain a bounded audit history.
  `orbit review export [artifact] --format sarif --out artifacts/review.sarif`
  emits standard SARIF 2.1.0 with workspace-relative locations, severity,
  disposition, evidence, and stable finding fingerprints for code-scanning
  uploads. The export is local and provider-neutral; it does not silently call
  GitHub or upload source data.
- `orbit review github-check [artifact]` turns the same findings into a bounded
  GitHub Checks API payload. It is dry-run by default; `--apply` is required to
  send an HTTPS request and the token is read only from the selected environment
  variable. Repository/SHA validation, 50-annotation limits, timeout, and
  redacted failures are enforced. Enterprise API hosts require the explicit
  `--allow-custom-api` opt-in so a token is never sent to an accidental host;
  `--pr <number>` verifies the PR head SHA before the Check Run is created.
- `orbit review github-comment <pr> <artifact> --repo owner/repo --sha <commit>`
  provides an idempotent inline-comment adapter. It is dry-run by default;
  `--apply` first pages through existing Orbit markers (up to 1,000), skips
  duplicates, and only posts bounded line comments for open findings with safe
  repository-relative paths. A bounded `orbit review github-dispatch <workflow>
[ref] --repo owner/repo` command can trigger a configured GitHub Actions
  workflow; it is also dry-run by default, accepts repeatable `--input name=value`
  values, and requires `--apply` plus an environment token to send the request.
- Process sandbox policy with truthful macOS/Linux native backend detection and a
  signed Windows native-helper contract (`windows-appcontainer-helper`); invalid
  or missing Windows helper attestations fail closed in `required` mode and are
  reported as degraded in `auto` mode.
- Live MCP catalog refresh and health diagnostics, plus safe trace-to-Skill
  workflow export that never replays recorded commands or arguments.
- Per-server MCP interaction policy can disable elicitation, sampling, or roots
  before those capabilities are advertised to an untrusted server.
- Secure provider profiles and authenticated model catalogs without storing
  credentials in project sessions or support data.

Accepted prompts are persisted before provider work begins. After an unexpected
shutdown, Orbit repairs the conversation conservatively and never silently
replays an unfinished side-effecting tool.

## Security and data boundaries

Orbit stores chats, checkpoints, indexes, and project state locally. Requests
to an external model provider include the prompt and selected context required
for that request; web, MCP, and extension tools may contact their configured
services. The local Web UI binds to loopback and uses a per-run capability
token. Credentials are redacted from configuration, diagnostics, events,
sessions, and exported traces.

Review provider privacy terms before sending sensitive code, and treat the Web
UI URL as a secret. See the repository [security
policy](https://github.com/Hephaestus-DevKit/Orbit/blob/main/SECURITY.md) for
supported versions and private vulnerability reporting.

## Providers

`orbit login` manages DeepSeek, TokenDance, OpenAI, Anthropic,
OpenAI-compatible, and Ollama profiles. Enter the provider's exact base URL,
including `/v1` when required; Orbit does not guess URL suffixes. Switching
providers or models preserves the current chat and recalculates its available
context.

The official DeepSeek profile refreshes its live catalog after login and keeps
the selector stable as `Auto`, `deepseek-v4-flash`, and `deepseek-v4-pro`;
dated backend build names are
shown only in diagnostics (`Flash-0731` and `Pro-0813`). Both official lanes
expose 1,000,000-token context, 384,000-token maximum output, and native
low/high/max reasoning. One DeepSeek profile supports Chat Completions,
Responses, and Anthropic transports; automatic mode keeps Chat as the default
and selects Responses for schema-constrained output. Compatible gateways retain
their explicitly configured transport, exact model ID, and per-model discovered
context limits. Model-family behavior is independent from that transport: any
recognized DeepSeek V4 model on TokenDance, an OpenAI-compatible endpoint, or
an Anthropic-compatible endpoint automatically receives DeepSeek reasoning,
tool replay, canonical schema, cache, and context policy. Unknown models remain
on the conservative generic-compatible path.

Credentials use native OS protection when available and are redacted from
configuration, diagnostics, events, sessions, and exported traces.

In the interactive terminal, `/permissions` is a compatibility alias for
`/mode`; both use the same approval, Full Access confirmation, and persistence
path.

## Maintain local data

```bash
orbit backup create          # chats, memory, commands, skills, and plans
orbit backup inspect <file>  # validate version, paths, sizes, and checksums
orbit backup restore <file>  # refuses existing files without --force
orbit clean --project        # preview project-owned cleanup
orbit clean --user           # preview user-owned cleanup
orbit sessions retention --older-than 30 --max-bytes 1073741824 # preview session retention
npm uninstall --global @orbit-build/cli
```

Cleanup never removes source files, `ORBIT.md`, or `orbit.config.yaml`.
Interactive deletion requires `DELETE`; automation requires `--yes`. Backups
exclude credentials, generated indexes, caches, evaluations, temporary state,
and prior exports.

Session retention is a narrower, reviewable cleanup surface. It only considers
`.orbit/sessions`, protects active sessions by default, supports age/count/byte
limits, emits a JSON dry-run, and rechecks session identity and size before
deleting. Use `--yes` for automation and `--include-active` only when an active
run has been deliberately stopped and reviewed.

## Learn more

- [Product overview](https://github.com/Hephaestus-DevKit/Orbit#readme)
- [Task-oriented user guide](https://github.com/Hephaestus-DevKit/Orbit/blob/main/docs/USER_GUIDE.md)
- [Security policy](https://github.com/Hephaestus-DevKit/Orbit/blob/main/SECURITY.md)
- [Changelog](https://github.com/Hephaestus-DevKit/Orbit/blob/main/CHANGELOG.md)

Use `orbit --help` or `orbit <command> --help` for the exact options installed
on your machine.

## License

Orbit is available under the [Apache License 2.0](LICENSE). Third-party
components retain their own terms; see the [third-party
notices](THIRD_PARTY_NOTICES.md).
