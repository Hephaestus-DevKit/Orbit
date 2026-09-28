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

Initialization preserves existing files and preflights all planned paths before
writing, reporting directories or unsafe links occupying file targets. Node.js
verification honors a versioned `packageManager` declaration in `package.json`,
then an unambiguous lockfile, and otherwise defaults to npm. Conflicting
lockfiles without a declaration, unsupported package managers, and malformed
manifests produce warnings instead of guessed commands. `verificationSuites`
in JSON output lists inferred candidates; an existing verification file is not
merged or replaced.

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

### Built-in desktop browser

Open `/webui`, then choose **Browser** in the sidebar. Enter an HTTP(S) website,
a development URL such as `localhost:5173`, or search terms. Bing is the default;
**Browser settings & privacy** lets you choose Google, Baidu, or DuckDuckGo.
The preference stays in this WebUI, and queries are only sent when submitted,
never automatically retried with a different provider. Search services may require
manual verification or be unavailable on your network. This is a real
isolated Chromium session with live page frames: click links, type or paste text,
use Chinese input, scroll, navigate back/forward, reload, manage up to eight tabs,
and respond to website dialogs directly inside Orbit.

The resizable desktop dock sits alongside chat; focus mode gives the page more
room. Its website viewport follows the available space. Drag the divider or use
its arrow keys; double-click or press Home to restore the default split. Click
the page to type, or focus the page region and press Enter. Escape returns to
the address bar, Ctrl/Cmd+L focuses it, and Alt+Left/Right navigates history.
There is no separate phone-oriented Orbit interface.

Use **Page actions → Read page outline** for an on-demand, redacted text view
and keyboard-accessible page controls. In a wide, expanded workbench it docks
beside a readable live page preview; hold Shift while scrolling to pan the
preview horizontally. In a smaller dock, the outline covers the page temporarily.
Direct page input marks the outline stale and revokes its control shortcuts
until you choose **Refresh outline**. Opening or closing the outline does not
resize the website viewport or discard page input.

**Use browser in question** attaches the current page beside your draft without
submitting or changing its text. The attachment can be removed, and switching
tabs or navigating before submission requires attaching the intended page again.
The `browser_preview` tool stays on the attached tab for that turn and uses
normal tool permissions. It reads page structure, observed controls, console
errors and layout evidence; its result does not include image vision. Manual
page input pauses during an active Agent task, while closing the browser and
answering website dialogs remain available.

Orbit starts an installed Chrome/Edge or Playwright Chromium with an independent
temporary profile. It does not download an engine or read your personal browser
cookies. A missing engine produces a recoverable message without affecting chat.
Public requests use a DNS-validated, pinned proxy. Local development services
must be explicitly opened as HTTP on IPv4 loopback (`localhost` is normalized
to `127.0.0.1`) above port 1023. Other private-network destinations and Orbit's
control port remain blocked. Same-origin local redirects and WebSocket hot reload
work; a public page cannot borrow a local tab's grant. HTTPS local certificates,
IPv6-only development servers, extensions, audio,
service workers, and remote-selection clipboard copy are not supported yet.
When a website opens a file chooser, Orbit shows a separate confirmation panel.
Only files selected there and explicitly applied reach that website: at most eight
files and 32 MB total per request. The request expires after two minutes and is
revoked on navigation, tab changes, or browser close. Orbit does not accept a
filesystem path from the website or save uploaded bytes in the workspace.
Website downloads are held briefly behind an explicit WebUI confirmation (one
pending file, 64 MB maximum, two-minute expiry). Confirmed bytes are sent to
your own browser's save flow, not to an Orbit workspace path. Dismissal,
navigation, tab changes, and browser close revoke the pending download.
Some websites may reject automated browsers or require unsupported features.

**Close browser** clears its pages and cookies. Hiding the dock keeps the session
available. Session/project changes, WebUI shutdown, cancellation during a browser
tool action, and 30 minutes without browser actions also close it. URLs are not
saved to local storage. Website content and frames may contain private data;
review the active page before asking the Agent to read it. These network controls
are not an OS sandbox or a restriction on a local server's own outgoing requests.
Development-server startup and shutdown remain under your control.

## Reusable prompt workflows

Store local slash commands in `.orbit/commands/<name>.md`. A workflow can
declare up to eight required Skills in frontmatter:

```markdown
---
description: Review a target and verify findings
argument-hint: <target path>
skills: [code-review, verify-findings]
---

Inspect $ARGUMENTS and report evidence-backed findings.
```

Orbit explicitly invokes declared Skills and checks their availability on each
launch, in both terminal and WebUI sessions. Missing or disabled dependencies
block execution with recovery guidance. Existing creator-generated `Use $name.`
prefixes remain supported; other legacy commands can add `skills` explicitly.
Commands without dependencies still work when Skills are disabled.

`$ARGUMENTS` and `{{args}}` preserve the complete trimmed input. Positional
arguments use `$1` through `$9`, or `$0` through `$9` when `$0` appears in the
template. Wrap arguments containing spaces in single or double quotes;
backslashes remain literal, including in Windows paths. Unclosed positional
quotes are rejected. Replacement text is never expanded a second time.
Argument hints accept up to 160 characters in both creation and loading.

New Skill and workflow names use 1–48 lowercase letters, digits, or hyphens,
starting and ending with a letter or digit. Windows device names such as `con`,
`nul`, and `com1` are rejected on every platform to keep generated bundles
portable. Failed capability writes clean up their partial files so creation can
be retried; existing capabilities are never overwritten.

Commands without `stages` remain ordinary prompt workflows. Optional `stages`
enable sequential, checkpointed execution while retaining the same permissions:

```yaml
stages:
  - id: inspect
    title: Inspect
    prompt: Inspect the requested scope and write findings to analysis.md.
    artifacts: [analysis.md]
  - id: verify
    title: Verify
    prompt: Implement the approved change and run project checks.
    verification: true
```

Every stage needs at least one nonempty artifact or a passing verification
receipt. Stage `skills` augment command dependencies. Completed artifacts cannot
be modified by later stages. The WebUI creator accepts this structure as an
optional JSON array under **Advanced: stages**. The bundled `/verified-change`
command demonstrates inspection, implementation and final review.

Use `/workflow run <name> [input]` (or `/<name>`), `/workflow status <run-id>`,
`/workflow resume <run-id>` and `/workflow cancel <run-id>`. Stop/Esc interrupts
an active run; cancel marks an inactive run permanently cancelled. Resume in the
original session after inspecting the error. Definitions and completed artifact
hashes must still match. A failed stage may have partial side effects: inspect
them before explicitly retrying; completed stages are not replayed. Workflows
currently accept text only and use the single AgentLoop, not parallel agents.
State is local to `.orbit/workflow-runs`. Malformed ownership records require
manual inspection; never remove a live owner's lock. No automatic rollback,
publishing or installation is implied. See [execution contract](../../docs/workflow-skill-design.md).

### Skill visibility and exported drafts

Use `orbit skills explain "<request>"` or `/skills explain <request>` to inspect
selection and non-selection reasons without invoking a model. Explicit opt-outs,
fenced examples and quoted lines do not activate Skills. These are conservative
lexical rules, not a semantic intent classifier; test your descriptions against
both expected triggers and counterexamples.

Skill activation events explain explicit invocation, name matching, or metadata
matching (with a term count, not the user's raw query). Truncation warnings
distinguish the Skill byte limit, automatic-load byte limit, and shared context
budget. The model is instructed to read the complete `skill://<name>/SKILL.md`
before using clipped instructions, or stop if it cannot. This is a prompt-level
requirement, not a guarantee that the model has read every resource.

`/workflow export <name> [local|versioned]` now creates a draft with
`policy.review_status: draft` and `allow_implicit_invocation: false` in
`agents/openai.yaml`. Drafts remain visible in the catalog but cannot be invoked
or used as workflow dependencies. Review the generated checklist and complete
Skill file, check source failures, remove private or task-specific information,
and validate the intended procedure. Then manually set `review_status: approved`
and refresh Skills (restart the CLI or use the WebUI refresh control).
Approval is an author-maintained declaration, not an independent certification.
Leave automatic invocation off until positive and negative trigger examples pass.

Existing Skills without a review status keep their previous behavior. An invalid
or unreadable sidecar is quarantined until repaired. Exports include completed
plan items only; verification counts do not imply that verification succeeded.

## Other entry points

```bash
orbit "Fix the failing tests"               # immediate interactive task
orbit exec "Review src" --jsonl             # automation-friendly JSONL
orbit doctor --probe --deepseek              # configuration + live probe
orbit bench --model deepseek-flash --thinking high
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
the selector stable as `Auto`, `deepseek-flash`, and `deepseek-v4-pro`;
dated backend build names are
shown only in diagnostics (`DeepSeek-V4.1-Flash` and `Pro-0813`). Both official lanes
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
