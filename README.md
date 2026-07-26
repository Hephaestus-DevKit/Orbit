# Orbit

> A local-first AI coding agent for the terminal, browser, and editor—optimized
> for DeepSeek V4, with OpenAI-compatible providers and local Ollama models.

[![npm](https://img.shields.io/npm/v/@orbit-build/cli?label=npm)](https://www.npmjs.com/package/@orbit-build/cli)
[![CI](https://github.com/Hephaestus-DevKit/Orbit/actions/workflows/ci.yml/badge.svg)](https://github.com/Hephaestus-DevKit/Orbit/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-43853d)](https://nodejs.org/)

Orbit works inside a codebase rather than treating each prompt as an isolated
chat. It can inspect and edit files, search code, run commands and tests, verify
changes, preserve project-scoped conversations, and recover file checkpoints.
Its full-screen TUI and authenticated local Web UI share one agent runtime,
active model, chat history, approval state, and cancellation flow.

## Start in three minutes

Orbit requires Node.js 20 or newer and either a provider API key or a running
[Ollama](https://ollama.com/) instance. If `node` or `npm` is missing, install a
current Node.js LTS release from [nodejs.org](https://nodejs.org/) first; npm is
included with the standard Node.js installers. Then verify both commands:

```bash
node --version
npm --version
npm install --global @orbit-build/cli
orbit login
cd path/to/project
orbit
```

The `orbit` command works in PowerShell, Command Prompt, and POSIX shells. Open
a new terminal if an existing shell has not refreshed npm's global binary path.

Inside Orbit, use natural language for work and `/` commands for control:

```text
Find the cause of the failing tests, fix it, and verify the change.
/model                  Switch provider or model without losing the chat
/goal ship this safely  Give the chat a durable objective
/plan                   Inspect or maintain a recoverable task plan
/webui                  Start the Web UI and show its clickable local URL
```

You can also run a direct task or emit JSONL for automation:

```bash
orbit "Review the authentication flow"
orbit exec "Run the verification contract and fix failures" --jsonl
```

Choose the surface that fits the work; all of them use the same runtime:

| Surface    | Start with               | Best for                                               |
| ---------- | ------------------------ | ------------------------------------------------------ |
| TUI        | `orbit`                  | focused interactive coding in the terminal             |
| Web UI     | `/webui`                 | chats, task/agent control, images, changes, and review |
| One task   | `orbit "…"`              | entering Orbit with an immediate objective             |
| Automation | `orbit exec "…" --jsonl` | CI, scripts, and deterministic exit codes              |
| Editor     | VS Code extension        | diagnostics and editor-adjacent workflows              |

## One project, many conversations

A project maps to one codebase folder and owns independent persisted chats.
Chats can be resumed, archived, or deleted without mixing their history with
another project. The Web UI exposes the same active run as the terminal; keep
the owning terminal open while using `/webui`. Orbit does not open a browser
automatically; use the authenticated URL beside the terminal's `completed`
message.

Model changes preserve the conversation. Orbit recalculates context against the
selected model's window and automatically compacts older turns when necessary,
instead of silently discarding the chat. Goals, plans, metrics, checkpoints,
and explicit project memory remain scoped to that conversation or project.
Accepted prompts use durable atomic snapshots. After an unexpected shutdown,
Orbit resumes conservatively: incomplete tool calls are never replayed
silently, active plan steps return to pending, and the UI summarizes the repair.

## Why Orbit

- **DeepSeek V4-first.** Flash is tuned for latency-sensitive work; Pro is tuned
  for planning, coding, review, and repair. Thinking modes, streaming, native
  tool calls, measured cache telemetry, and bounded output defaults are handled
  explicitly.
- **Useful context, not a repository dump.** Symbols, references, repository
  maps, retrieval, selected files, project instructions, and opt-in memory feed
  a bounded context pack.
- **Safe, observable changes.** Workspace path validation, approval policies,
  a Web UI Changes review, checkpoints, per-file rollback, trace export,
  tool timing and permission history, verification contracts, and concise
  failure summaries protect the working tree.
- **Validated tools.** File, search, symbol, shell, test, Git, web, fetch, plan,
  and connected MCP tools use typed schemas, bounded redacted results,
  cancellation, and permission checks.
- **Consistent interfaces.** Terminal completion, `/help`, and the Web UI `/`
  picker share the same built-in and custom command catalog.
- **Long-task ergonomics.** Browser image attachments, clipboard paste,
  queued follow-ups, reconnect replay, and model-aware context compaction keep
  work moving without splitting the conversation.
- **Local diagnostics.** Provider probes, cache metrics, benchmarks, traces, and
  credential-safe JSON support snapshots make failures diagnosable.

## Providers

`orbit login` creates, lists, and deletes saved provider profiles. Credentials
are encrypted through native OS facilities when available and redacted from
configuration, diagnostics, events, and sessions.

For an OpenAI-compatible service, enter the exact base URL it requires,
including `/v1` when applicable. Orbit does not guess URL suffixes. Authenticated
model catalogs and the local Ollama API populate the selector with models that
are actually available.

The official DeepSeek profile uses `https://api.deepseek.com` and defaults to:

| Model               | Best for                     | Default thinking | Context   |
| ------------------- | ---------------------------- | ---------------- | --------- |
| `deepseek-v4-flash` | fast work and summarization  | disabled         | 1,000,000 |
| `deepseek-v4-pro`   | planning, coding, and review | high             | 1,000,000 |

Orbit keeps reusable request prefixes stable and reports provider-supplied
cache hit/miss usage. It never sends synthetic cache primers or promises a
fixed hit rate.

```bash
orbit doctor --probe --deepseek
orbit bench --model deepseek-v4-flash --thinking disabled --repeat 3 --max-tokens 256
```

## Read only what you need

The repository uses progressive documentation: this page is the product tour,
while the user guide is organized by task rather than by implementation detail.

| I want to…                              | Go to                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| configure Orbit and use it day to day   | [User guide](docs/USER_GUIDE.md)                                                       |
| find every CLI option                   | `orbit --help` or `orbit <command> --help`                                             |
| understand security and report an issue | [Security policy](SECURITY.md)                                                         |
| see release changes                     | [Changelog](CHANGELOG.md)                                                              |
| contribute or change internals          | [Documentation index](docs/README.md) and [maintainer guide](docs/MAINTAINER_GUIDE.md) |
| understand extension manifests          | [Extension manifest v1](docs/EXTENSIONS.md)                                            |
| connect MCP or apply team policy        | [User guide: tools and safety](docs/USER_GUIDE.md#context-tools-and-safety)            |

The [user guide](docs/USER_GUIDE.md) covers projects and chats, providers,
models, Web UI synchronization, slash commands, context and safety modes,
automation, cleanup, troubleshooting, and customization without duplicating
the implementation reference.

## Common maintenance

```bash
orbit doctor                 # local configuration and runtime checks
orbit update --check         # check npm without installing
orbit update                 # confirm before installing an update
orbit backup create          # portable project chats, memory, commands, and skills
orbit clean --project        # preview project-owned Orbit data cleanup
orbit clean --user           # preview user-owned Orbit data cleanup
npm uninstall -g @orbit-build/cli
```

An installed update takes effect after Orbit is restarted; reopen `/webui` so
the terminal, embedded server, and browser assets all come from one runtime.

Cleanup never removes project source, `ORBIT.md`, or `orbit.config.yaml`.
Interactive deletion requires the exact confirmation `DELETE`; automation must
pass `--yes`. Orbit never silently replaces itself during startup.

Project backups are versioned JSON bundles with per-file SHA-256 integrity.
They exclude credentials, indexes, caches, temporary state, and prior exports;
inspect one with `orbit backup inspect <file>` before restoring it.

## How the repository fits together

Orbit keeps protocol, policy, storage, and interface concerns separate:

| Layer           | Packages                                      | Owns                                                             |
| --------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| Interfaces      | `cli`, `tui`, `editors/vscode`                | commands, TUI, Web UI, LSP, editor integration                   |
| Agent runtime   | `core`, `context-engine`                      | planning, execution, memory, compaction, retrieval, verification |
| Model and tools | `model-providers`, `tools`, `mcp`             | DeepSeek/provider protocols, built-in tools, connected tools     |
| Trust and state | `permissions`, `sandbox`, `session`, `config` | approvals, isolation, checkpoints, recovery, credentials, policy |
| Foundations     | `shared`                                      | paths, redaction, IDs, tokens, and bounded utilities             |

The detailed ownership map, dependency direction, change locations, and minimum
verification commands live in the [maintainer guide](docs/MAINTAINER_GUIDE.md).
Generated `dist`, `node_modules`, and runtime `.orbit` data are never source
ownership boundaries.

## Develop from source

Orbit is a strict TypeScript/ESM pnpm monorepo. Package responsibilities and
change locations are documented in the [maintainer guide](docs/MAINTAINER_GUIDE.md).

```bash
git clone https://github.com/Hephaestus-DevKit/Orbit.git
cd Orbit
pnpm install
pnpm build
pnpm install-global
pnpm verify
```

Release candidates must pass `pnpm verify:release`, including lint, formatting,
build, unit tests, critical coverage, Web UI browser tests, installed CLI smoke
tests, package-content checks, notices, and the production dependency audit.

## License

License terms have not yet been finalized. Do not infer permission to use,
modify, or redistribute the source from repository visibility alone. A license
must be selected before commercial distribution.
