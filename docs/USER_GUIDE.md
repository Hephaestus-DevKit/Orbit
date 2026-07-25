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
orbit
```

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
- The composer accepts up to four PNG, JPEG, GIF, or WebP images for models
  whose catalog capability declares vision support. Paste or drag an image, or
  use the attachment button. Text-only DeepSeek models reject images clearly.
- While a turn runs, add follow-ups to the local browser queue; Orbit submits
  them in order after successful completion.
- The Changes view shows bounded redacted diffs, verification results, and
  checkpoints, with explicit per-file rollback and rewind actions.
- The Activity view keeps a bounded tool timeline with risk, approval decision,
  completion state, start time, and duration; tool inputs and raw output stay
  out of this browser summary.
- Accepted prompts are persisted before provider work starts. If Orbit or the
  machine stops unexpectedly, resuming the chat seals any unfinished tool
  protocol without replaying side effects, returns in-progress plan items to
  pending, and reports the repair once in both the terminal and Web UI.
- Project selection uses a native folder picker when the platform supports it,
  with a validated path field as the fallback.

The terminal owns the local agent and Web UI server. Keep it open while using
the browser. Both interfaces share turns, streamed output, model changes,
approvals, cancellation, and context telemetry. A bounded event replay window
recovers missed events after a short browser disconnect; do not open a stale
saved Web UI URL after the owning process exits.

Type `/` in the Web UI composer for command suggestions. Use arrow keys and
Enter to select, or `Ctrl+K` for the broader action palette.

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

| Command                    | Purpose                                                   |
| -------------------------- | --------------------------------------------------------- |
| `/goal [text\|clear]`      | show, set, or clear the chat's durable objective          |
| `/plan [action]`           | manage recoverable steps and their status                 |
| `/model [name]`            | show or switch the active model                           |
| `/mode [mode]`             | switch `strict`, `normal`, `auto`, or `plan` permissions  |
| `/add <path>`              | add a file or directory to active context                 |
| `/drop <path>`             | remove a file or pattern from active context              |
| `/compact`                 | compact older dialogue for the active model window        |
| `/memory [action]`         | review or manage explicit project memory                  |
| `/metrics`                 | inspect local routing, tool, file, and compaction metrics |
| `/timeline`                | list persisted file checkpoints                           |
| `/rewind <id\|number>`     | restore a selected checkpoint                             |
| `/rollback`                | restore the latest file modification checkpoint           |
| `/run <command>` or `!cmd` | run a native command after permission checks              |
| `/update`                  | check/update Orbit itself through npm                     |

`/clear` resets dialogue history; it is not the same as deleting or archiving a
chat. Project memory is opt-in, secret-redacted, and never populated
automatically from chat or web content.

## Context, tools, and safety

Orbit builds a bounded context pack from selected files, symbols, references,
repository maps, retrieval, project instructions, recent dialogue, and explicit
memory. The context indicator is measured against the active model's automatic
compaction threshold, not just a fixed global token count.

The model can receive validated tools for workspace files, search, symbols,
shell commands, tests, Git, project inspection, live web search, source fetches,
and task plans. Connected MCP tools retain the server's JSON Schema. Inputs are
validated before approval or execution; output is bounded and redacted before
it re-enters model context.

Permission modes balance interruption and control:

- `strict` asks before consequential operations.
- `normal` allows routine safe work and asks for higher-risk actions.
- `auto` minimizes prompts within configured policy boundaries.
- `plan` keeps work read-only while the approach is developed.

Path verification still confines file operations to the workspace. A mode
change does not grant permission outside configured boundaries.

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
```

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
