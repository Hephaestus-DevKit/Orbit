# Orbit user guide

This guide is organized around tasks. Start with the first workflow, then use
the section links as needed; exhaustive option lists stay in `orbit --help`.

## First five minutes

Install Orbit with Node.js 20 or newer. The standard installers from
[nodejs.org](https://nodejs.org/) include npm on Windows, macOS, and Linux. If
neither command exists, install a current Node.js LTS release, open a new
terminal, and verify the runtime before installing Orbit:

```bash
node --version
npm --version
npm install --global @orbit-build/cli
orbit --version
orbit login
```

Open a codebase and start the interactive full-screen terminal:

```bash
cd path/to/project
orbit init
orbit
```

`orbit init` is the recommended first project action. It never replaces an
existing file and normally creates:

- `ORBIT.md`, the Agent execution and safety contract;
- `.orbit/verification.json`, when known package scripts or Rust, Go, or Python
  checks can be inferred;
- `.orbit/commands/implement.md` and `.orbit/commands/review.md`, starter
  outcome and audit workflows.

Run `orbit init --json` for a machine-readable list of created/existing files
and detected checks. `orbit init --minimal` creates only `ORBIT.md`. Generated
commands are candidates, not implicit trust: review them, then explicitly set
`security.trustProjectExecutables: true` before Orbit may run a project-owned
verification contract.

Describe the outcome you want. Orbit can inspect the workspace, propose and
apply edits, run commands and tests, and report verification. Use `Ctrl+C` to
cancel an active operation; use it again from an idle prompt to exit cleanly.

Run `orbit doctor` if setup does not work. `orbit doctor --probe --deepseek`
adds a live provider probe, and `orbit doctor --json --strict` produces a
versioned, secret-safe support snapshot with a non-zero status for warnings or
errors.

## Projects, chats, and the Web UI

Orbit treats one folder as one project. Each project can contain multiple
persistent chats, and every chat retains its own history, active model, goal,
plan, metrics, and checkpoints.

- `/chat` lists, creates, switches, and deletes chats from the terminal.
- `/webui` starts the authenticated browser workspace for the current process
  and places its clickable URL beside the terminal `completed` message. It does
  not open a browser automatically.
- The Web UI sidebar creates, resumes, archives, restores, and deletes chats.
- The sidebar **Tasks** entry opens Mission Control: a compact view of the
  active chat, durable goal, recoverable plan progress, delegated agents,
  model, and current cost. Running agents can be steered or stopped
  individually without interrupting unrelated work. Agent steering enters the
  selected child at its next safe model/tool boundary. If the owning Orbit
  process exits, Mission Control marks the interrupted child recoverable and
  can resume its persisted session after confirming the original provider is
  active; live runs and successfully completed children cannot be taken over.
  When parallel agents
  request permission at the same time, Orbit presents the requests in order
  and labels each approval with its requesting role. **Build a plan** creates
  recoverable steps with the regular agent; **Parallel improve** runs the
  planner/coder/reviewer flow, uses Git worktree isolation when available, and
  merges only reviewed changes. Use the read-only presets under **Changes**
  when you want findings without edits.
- The composer accepts up to four PNG, JPEG, GIF, or WebP images for models
  whose catalog capability declares vision support. Paste or drag an image, or
  use the attachment button. Text-only DeepSeek models reject images clearly.
- While a turn runs, `Enter` in the TUI safely steers the active agent without
  cancelling its model request or tool call; `Ctrl+C` remains an explicit
  stop. In the Web UI, `Enter` adds an ordered follow-up and `Ctrl+Enter`
  safely steers the current turn.
- Follow-ups are stored in the active Session rather than browser storage, so
  the TUI, Web UI, reconnects, and crash recovery see one authoritative queue.
  Images are retained with the queued item under bounded snapshot limits. The
  Web UI queue can edit, move, remove, or promote an item to steering without
  returning text to the composer.
- The Changes view shows bounded redacted diffs, verification results, and
  checkpoints, with explicit per-file rollback and rewind actions.
- The Activity view keeps a bounded tool timeline with risk, approval decision,
  completion state, start time, and duration; tool inputs and raw output stay
  out of this browser summary.
- Accepted prompts are persisted before provider work starts. If Orbit or the
  machine stops unexpectedly, resuming the chat seals any unfinished tool
  protocol without replaying side effects, returns in-progress plan items to
  pending, and reports the repair once in both the terminal and Web UI.
- Add project opens one explicit Open or create flow. Browse folders uses the
  native platform picker to fill the editable path without launching anything.
  An existing directory is safely registered and opened without changing its
  contents; an unused absolute path creates only its final directory and still
  requires an existing parent.
- A successful project handoff opens a separate browser tab backed by an
  isolated Orbit instance for the selected folder, so its own chats,
  configuration, and workspace state load without mixing project data. The
  previous browser-only process exits after the secure local handoff completes.
- While the isolated instance starts, Orbit keeps the project dialog in a
  locked progress state and shows a themed handoff page in the new tab. A
  failure closes that tab, preserves the entered path for correction, and uses
  a localized, actionable message; linked filesystem roots are always refused.

The terminal owns the local agent and Web UI server. Keep it open while using
the browser. Both interfaces share turns, streamed output, model changes,
approvals, cancellation, and context telemetry. A bounded event replay window
recovers missed events after a short browser disconnect; do not open a stale
saved Web UI URL after the owning process exits.

Type `/` in the Web UI composer for command suggestions. Use arrow keys and
Enter to select, or `Ctrl+K` for the broader action palette.

The terminal exposes the same queue through `/queue`. Use `/queue` to list
bounded previews, `/queue edit 2 <text>` to revise an item, `/queue up 2` or
`/queue down 2` to reorder it, `/queue next 2` to make it the first follow-up,
and `/queue steer 2` during a running single-agent task to apply it at the next
safe boundary. `/queue remove 2` and `/queue clear` discard queued work without
changing conversation history.

## Providers and models

Run `orbit login` to add a profile, `orbit login --list` to inspect saved
profiles, or `orbit login --delete <provider>` to remove one. Credentials are
redacted from output and encrypted through native OS storage when available.

When configuring an OpenAI-compatible provider, enter its exact base URL. If it
requires `/v1`, include `/v1`; Orbit intentionally does not append or probe
alternative suffixes. After login, Orbit requests the provider's model catalog
and exposes returned models in `/model` and the Web UI selector.

The Ollama profile scans the local Ollama API for installed models. If the
service is stopped, start Ollama and refresh the selection rather than expecting
Orbit to invent a catalog.

The official DeepSeek profile refreshes `/models` after login and presents
three stable choices: `Auto`, `deepseek-v4-flash`, and `deepseek-v4-pro`.
Provider build identifiers
`DeepSeek-V4-Flash-0731` and `DeepSeek-V4-Pro-0813` remain diagnostic metadata rather than user-facing
selections, so a backend rollout does not invalidate saved preferences. Its
default `deepSeekApiFormat: auto` setting keeps Chat Completions as the
continuity path and selects Responses for schema-constrained output. Set
`responses`, `chat-completions`, or `anthropic` to pin one official wire format;
the Anthropic selection is a protocol choice, not a separate DeepSeek product.

Both official lanes expose a 1,000,000-token advertised context window,
384,000-token maximum output, JSON, tools, and low/high/max reasoning. Orbit's
Auto policy uses low for simple Flash turns, high for complex work, and max for
repair turns; an explicit `--thinking` value wins within the native range.

Orbit recalculates context from the selected model's discovered or configured
capabilities on every switch. This also applies within TokenDance: a 64K model
and a 256K model receive different budgets. A model with no trustworthy limit
uses a conservative 128K fallback rather than borrowing another model's value.

```yaml
providers:
  my-deepseek-gateway:
    type: openai-compatible
    baseUrl: https://gateway.example/v1
    deepSeekApiFormat: auto
    models: [deepseek-v4-flash, deepseek-v4-pro]
```

Use `/model` to inspect or switch the active provider/model. A switch applies to
the next turn, preserves the current chat, and recalculates its context budget.
If the new model has a smaller window, Orbit compacts older dialogue while
keeping recent instructions and a stable summary.

Useful provider checks:

```bash
orbit config
orbit doctor --deepseek
orbit doctor --probe --deepseek
orbit bench --model deepseek-v4-pro --thinking high --repeat 3 --max-tokens 4096
```

## Daily controls

Run `/help` for the live, localized command catalog. These are the controls most
useful in longer tasks:

| Command                     | Purpose                                                    |
| --------------------------- | ---------------------------------------------------------- |
| `/goal [text\|clear]`       | show, set, or clear the chat's durable objective           |
| `/plan [action]`            | manage recoverable steps and their status                  |
| `/model [name]`             | show or switch the active model                            |
| `/language [en\|zh\|zh-TW]` | switch English, Simplified Chinese, or Traditional Chinese |
| `/skills`                   | list reusable Skills and their `$skill-name` invocation    |
| `/mode [mode]`              | switch `strict`, `normal`, `auto`, or `plan` permissions   |
| `/add <path>`               | add a file or directory to active context                  |
| `/drop <path>`              | remove a file or pattern from active context               |
| `/compact`                  | compact older dialogue for the active model window         |
| `/memory [action]`          | review or manage explicit project memory                   |
| `/metrics`                  | inspect local routing, tool, file, and compaction metrics  |
| `/timeline`                 | list persisted file checkpoints                            |
| `/rewind <id\|number>`      | restore a selected checkpoint                              |
| `/rollback`                 | restore the latest file modification checkpoint            |
| `/run <command>` or `!cmd`  | run a native command after permission checks               |
| `/update`                   | check/update Orbit itself through npm                      |

`/clear` resets dialogue history; it is not the same as deleting or archiving a
chat. Project memory is opt-in, secret-redacted, and never populated
automatically from chat or web content.

## Context, tools, and safety

Orbit builds a bounded context pack from selected files, symbols, references,
repository maps, retrieval, project instructions, recent dialogue, and explicit
memory. The context indicator is measured against the active model's automatic
compaction threshold, not just a fixed global token count.

Repository retrieval runs automatically for implementation, debugging,
review, architecture, and source-file questions. The symbol graph covers
TypeScript, JavaScript, and Python, with Python imports contributing to the
landmark ranking and reference search. Use `@codebase` to force retrieval for
an otherwise ambiguous prompt, or `@no-codebase` to disable it for one turn.
Set `context.autoCodebaseRetrieval: false` in `orbit.config.yaml` when a
workspace should remain explicit-only.

The model can receive validated tools for workspace files, search, symbols,
shell commands, tests, Git, project inspection, live web search, source fetches,
and task plans. Connected MCP tools retain the server's JSON Schema. Inputs are
validated before approval or execution; output is bounded and redacted before
it re-enters model context.

Permission modes balance interruption and control:

- `strict` asks before consequential operations.
- `normal` allows routine safe work and asks for higher-risk actions.
- `auto` is unrestricted Full Access. Every tool risk is approved without a
  prompt, including dangerous operations, protected files, opaque interpreters,
  paths outside the workspace, and local or private network targets. Filesystem
  tools and commands can act anywhere permitted by your operating-system
  account. Child commands inherit the Orbit process environment, including
  credential variables, while credential values remain redacted from logs and
  model-visible output. A child process that is already running retains its
  inherited environment and operating-system authority until it is stopped,
  even if the session later leaves Full Access. Full Access also skips
  post-write acceptance, dependency-install, auto-repair, and failed
  pre-commit permission prompts. Outside-workspace changes are not covered by
  Orbit checkpoints or rollback. Input validation, bounded output,
  cancellation, timeouts, project hooks, verification contracts, and periodic
  cost/runaway checkpoints remain active because they are workflow/runtime
  controls rather than permission guards. Do not use Full Access for unknown
  repositories or untrusted scripts.
- `plan` keeps work read-only while the approach is developed.

Strict, Normal, and Plan continue to confine built-in filesystem tools to the
workspace or explicitly activated read-only Skill roots. Full Access removes
that permission boundary and resolves filesystem paths against the host.
Context indexing, checkpoints, rollback, project memory, and Git operations
remain workspace-scoped by their function; use filesystem or shell tools when
Full Access work intentionally targets host paths outside the active project.

Choose **Full access** from the WebUI composer or Settings and confirm the
elevation summary, run `/mode auto` in the terminal, or start a one-shot task
with `orbit --yes`. Interactive choices are remembered per workspace in
`.orbit/state.json`; an administrator-managed policy can still require
approvals and cannot be bypassed.

## Multi-agent teams

The isolated planner/coder/reviewer flow uses a reusable provider-neutral team
recipe. `balanced` is the default correctness + security gate, `fast` uses one
correctness reviewer, and `thorough` adds dedicated testing and performance
reviewers. Configure a user default in `~/.orbit/config.yaml`, or use a trusted
project configuration:

```yaml
agent:
  teamPreset: thorough
  maxReviewAttempts: 3
  maxReviewConcurrency: 3
```

All values are schema-bounded. Reviewer budgets are divided from one fixed
review pool, so choosing `thorough` does not multiply the configured run budget
per reviewer. `orbit doctor` reports the effective preset, attempt limit, and
concurrency after global, project, CLI, and managed-policy merging.

Each child has a separate durable Session under `.orbit/agent-sessions` and a
validated Session ID in its `.orbit/agent-runs` record. Those files stay outside
temporary Git worktrees, survive cleanup, and are included in project backups.
They are not mixed into the ordinary chat list. Mission Control currently uses
them for durable identity and steering telemetry; explicit post-run resume
controls will build on the same stored thread rather than replaying a prompt.

Write ownership uses normalized workspace-relative scopes. `workspace` and `*`
mean the whole workspace, nested scopes cannot write concurrently, disjoint
scopes may run in parallel, and absolute or traversing scopes are rejected
before any child starts.

## Background commands

Orbit can keep long builds, development servers, and file watchers running
without blocking the agent turn. The model starts these through the normal
`bash` approval boundary, receives a task ID immediately, and can wait for
bounded output, list recent tasks, or terminate the complete process tree.
Completion is reported to the TUI, WebUI, JSONL stream, and the next model
iteration. Orbit never relies on shell `&` syntax or unbounded output capture.

Tune the shared runtime in `orbit.config.yaml` when a larger workspace needs
more parallel services or retained output:

```yaml
tools:
  backgroundTasks:
    maxConcurrentTasks: 8
    maxRetainedTasks: 64
    maxOutputBytes: 1048576
    terminateGraceMs: 2000
    awaitOnCompletion: true
    completionWaitMs: 30000
```

With `awaitOnCompletion` enabled, Orbit does not announce completion while
background verification or builds remain unaccounted for. The bounded wait is
interruptible from the UI; set it to `false` only for intentional fire-and-
forget tasks.

The runtime is scoped to the active Orbit process. Switching chats keeps
background tasks alive and Mission Control shows metadata across the workspace,
while model tools can still access only tasks owned by their Session. Deleting
the owning chat or exiting Orbit reaps its process trees. Completed task
metadata is recorded in the original session trace; command output stays
bounded in memory and is not written to durable logs.

MCP supports local stdio servers and Streamable HTTP servers. HTTP responses,
SSE messages, tool schemas, and results are bounded and validated. Bearer tokens
come from environment variables; OAuth client-credentials profiles name their
client ID and secret environment variables rather than storing secret values:

```yaml
tools:
  mcp:
    enabled: true
mcpServers:
  docs:
    transport: streamable-http
    url: https://docs.example.com/mcp
    bearerTokenEnv: DOCS_MCP_TOKEN
  migrator:
    transport: stdio
    command: node
    args: [./scripts/migration-server.js]
    requestTimeoutMs: 300000 # long-running MCP operations (default 30000)
```

`requestTimeoutMs` (1,000–600,000) raises or lowers the per-request timeout
for one server, so long MCP operations such as builds or migrations are not
cut off at the 30-second default.

Orbit negotiates the stateless MCP `2026-07-28` protocol while retaining a
dual-era fallback for supported session-oriented 2024/2025 servers. Modern
requests carry the required per-request client metadata and mirrored HTTP
method/name headers; legacy servers continue through `initialize`, session
recovery, pagination restart, and explicit session termination. Tool, resource,
resource-template, and prompt catalogs follow every opaque cursor page with
cycle and total-size bounds. Modern tool schemas may also declare safe mirrored
parameter headers and structured output schemas, both of which Orbit validates
at the trust boundary.

Beyond tools, Orbit consumes two more MCP surfaces when a server advertises
them:

- **Resources** become one read-only `mcp__<server>__read_resource` tool that
  lists discovered URIs and URI templates in its description; disable per
  server with `resources: { enabled: false }`.
- **Prompts** become slash commands: `/mcp__<server>__<prompt>` appears in
  autocomplete, takes `key=value` pairs or free text for declared arguments,
  and expands through `prompts/get` before the turn starts; disable per
  server with `prompts: { enabled: false }`.

MCP connections belong to the active Agent loop rather than one turn. REPL
startup discovers prompt commands before the first input, later turns reuse the
same server processes, and session disposal is the single cleanup boundary.

For servers requiring a user-consent OAuth flow, configure the
authorization-code mode and log in once:

```yaml
mcpServers:
  jira:
    transport: streamable-http
    url: https://jira.example.com/mcp
    oauth:
      mode: authorization_code
      authorizationUrl: https://auth.example.com/authorize
      tokenUrl: https://auth.example.com/token
      clientIdEnv: JIRA_MCP_CLIENT_ID # public PKCE client: no secret needed
      scope: mcp offline_access
```

```bash
orbit mcp login jira
```

The login runs the PKCE flow against a loopback redirect, prints the URL to
authorize in your browser, and stores only the refresh token — encrypted via
DPAPI on Windows or the keychain/secret-service elsewhere. The runtime then
refreshes access tokens silently; no tokens ever appear in configuration
files. The `client_credentials` mode (machine-to-machine, `clientSecretEnv`
required) continues to work unchanged.

Teams can set `ORBIT_MANAGED_POLICY` to an administrator-owned YAML/JSON policy,
or place it at `~/.orbit/policy.yaml`. Policy is applied after user, project,
environment, and CLI settings, so lower-precedence configuration cannot weaken
allowed provider/model lists, minimum permission mode, approvals, network-tool
disablement, budgets, iteration caps, or protected paths.

## Reusable project instructions

Use `ORBIT.md` for durable, human-reviewed project guidance. Keep it specific:
build commands, architecture boundaries, coding standards, and required
verification are more useful than broad prose.

Create custom slash commands as Markdown:

- Project: `.orbit/commands/*.md`
- User: `~/.orbit/commands/*.md`

Example `.orbit/commands/review.md`:

```markdown
---
description: Review a target for correctness, security, and missing tests
argumentHint: <path-or-scope>
---

Review $ARGUMENTS. Prioritize concrete bugs, regressions, and missing verification.
```

Invoke it as `/review packages/core`. Templates support `$ARGUMENTS`, `{{args}}`,
and `$1` through `$9`. Project commands override user commands; built-ins cannot
be shadowed.

Create reusable skills as focused folders:

- Versioned project: `.agents/skills/<skill-name>/SKILL.md`
- Local project: `.orbit/skills/<skill-name>/SKILL.md`
- User: `~/.orbit/skills/<skill-name>/SKILL.md`

Use lowercase hyphenated names and YAML frontmatter with `name` and
`description`. Keep the main instructions concise; place detailed domain
material in `references/`, deterministic helpers in `scripts/`, and output
templates in `assets/`. Invoke a skill explicitly with `$skill-name`,
`skill:skill-name`, or `技能:skill-name`.

When an active Skill needs a bundled file, use its collision-free resource
address: `skill://<skill-name>/<relative-path>`. The read, list, glob, and grep
tools all understand these addresses while preserving the Skill directory
boundary. Run `orbit skills validate --deep` to validate linked resources,
presentation icons, bundle limits, and symlink/junction safety in addition to
the normal `SKILL.md` checks.

Add optional `agents/openai.yaml` metadata to provide a polished display name,
short description, default prompt, and explicit-only policy:

```yaml
interface:
  display_name: "Release Readiness"
  short_description: "Prepare a safe GitHub and npm release"
  default_prompt: "Use $release-readiness to prepare this version."
policy:
  allow_implicit_invocation: true
```

The Web UI **Settings → Skills** center shows every valid skill and any loading
diagnostics. It can enable or disable the feature, choose automatic or explicit
activation, limit the number of simultaneously active skills, disable
individual skills, refresh the inventory after files change, and place a
Skill's default prompt into the composer with **Use skill**. The same surface
can create a local or versioned project Skill, including its `agents/`,
`references/`, `scripts/`, and `assets/` directories, or a thin Workflow
command without editing frontmatter by hand; newly created workflows appear in
`/` completion immediately. These controls apply to the running Orbit process; use
`orbit.config.yaml` for durable project defaults:

```yaml
skills:
  enabled: true
  activation: auto
  maxActive: 3
  disabled:
    - legacy-review
```

Combine a command with a skill for a reliable lightweight workflow. For
example, a `/release` command can include `Use $orbit-release to process
$ARGUMENTS.` Commands provide the user-facing entry point while the skill owns
the reusable procedure and references.

`orbit extension <manifest> [--json]` validates a versioned, workspace-bound
extension contract. `orbit extension-install`, `extension-list`, and
`extension-remove` manage local installations; privileged contributions require
`--trust`. See the [extension manifest reference](EXTENSIONS.md) for activation
and integrity rules.

## Automation

Use `orbit exec` for scripts and CI:

```bash
orbit exec "Run the verification contract and fix the failure" --jsonl
orbit exec "Continue the saved task" --resume <session-id> --jsonl
```

JSONL mode never opens an interactive approval menu. Policy-approved operations
continue; operations that still require approval fail safely. The final event
contains the structured outcome.

|  Code | Meaning                      |
| ----: | ---------------------------- |
|   `0` | completed                    |
|   `2` | task or verification failure |
|   `4` | provider startup failure     |
| `130` | aborted                      |

Use `orbit exec --help` for the complete automation contract.

## Updates, backup, cleanup, and uninstall

Orbit checks for a newer npm release once per interactive process without
blocking startup or installing anything. A blinking cat heart indicates an
available update.

```bash
orbit update --check
orbit update                 # asks before installation
orbit update --yes           # explicit non-interactive installation
orbit update --channel beta --check
```

The terminal `/update` flow can install after confirmation and verifies the
version exposed by npm. The Web UI flow is check-only so the running local
server never replaces itself. After a successful installation, the current TUI
and Web UI deliberately keep showing their immutable running version; exit and
relaunch `orbit`, then run `/webui` again. A green blinking heart means the
package is installed but this process still needs that restart.

Back up durable project state before moving a codebase or clearing Orbit data:

```bash
orbit backup create
orbit backup create --output ../my-project.orbit-backup.json
orbit backup inspect ../my-project.orbit-backup.json
orbit backup restore ../my-project.orbit-backup.json
```

The bundle contains project chats, explicit memory, custom commands and skills,
task plans, and verification configuration. It excludes credentials,
regenerable search indexes, caches, temporary runtime state, evaluations, and
old exports. Every file is size-bounded and SHA-256 verified before restore.
Restore refuses existing files by default; use `--force` only after inspection.

Preview Orbit-owned data before deletion:

```bash
orbit clean --project
orbit clean --user
orbit clean --all
orbit clean --all --yes --json
```

Cleanup never removes project source, `ORBIT.md`, or `orbit.config.yaml`.
Interactive cleanup requires the exact confirmation `DELETE`; non-interactive
cleanup requires `--yes`. Remove the executable separately:

```bash
npm uninstall --global @orbit-build/cli
```

## Troubleshooting

| Symptom                            | Check                                                              |
| ---------------------------------- | ------------------------------------------------------------------ |
| `node` or `npm` is not found       | install current Node.js LTS from nodejs.org, then open a new shell |
| `orbit` is not found               | verify npm works; confirm npm's global binary path is on `PATH`    |
| provider is unavailable            | run `orbit doctor --probe` and verify the saved login              |
| expected models are missing        | verify the exact base URL or start Ollama, then refresh            |
| Web UI is disconnected             | return to the owning terminal and run `/webui` again               |
| context is close to its limit      | use `/compact`; Orbit also compacts automatically                  |
| a file edit should be reverted     | inspect `/timeline`, then use `/rewind` or `/rollback`             |
| configuration appears inconsistent | run `orbit config`, then `orbit doctor --json`                     |

For every command and flag, use `orbit --help` or
`orbit <command> --help`. Report security issues through the
[security policy](../SECURITY.md); include the redacted doctor snapshot for
ordinary support issues.
