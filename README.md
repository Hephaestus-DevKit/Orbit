<div align="center">

# Orbit

**A local-first AI coding workspace for the terminal, browser, and editor.**

Inspect, build, verify, and recover real codebase work with one synchronized
agent runtime.

[![npm](https://img.shields.io/npm/v/@orbit-build/cli?label=npm&color=426b63)](https://www.npmjs.com/package/@orbit-build/cli)
[![CI](https://github.com/Hephaestus-DevKit/Orbit/actions/workflows/ci.yml/badge.svg)](https://github.com/Hephaestus-DevKit/Orbit/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-43853d)](https://nodejs.org/)

Windows · macOS · Linux · English · 简体中文 · 繁體中文

</div>

Orbit works inside your repository instead of treating every prompt as an
isolated chat. It can read and edit files, search symbols, run commands and
tests, review diffs, preserve checkpoints, and resume project-scoped
conversations. The full-screen TUI and authenticated local Web UI share the
same model, history, approval state, live task, and cancellation flow.

## Get started

Install Node.js 20 or newer, then:

```bash
npm install --global @orbit-build/cli
orbit login
cd path/to/project
orbit
```

`orbit login` guides you through DeepSeek, TokenDance, OpenAI, Anthropic,
OpenAI-compatible services, or local Ollama. Credentials are stored through
native OS protection when available and are redacted from configuration,
diagnostics, events, and sessions.

Inside Orbit, describe the outcome you want or type `/` to discover controls:

```text
Find the cause of the failing tests, fix it, and verify the change.
/model                  Switch provider or model without losing the chat
/goal ship this safely  Keep a durable objective across a long task
/plan                   Inspect or update the recoverable task plan
/webui                  Start the synchronized browser workspace
```

## Choose your surface

| Surface    | Start with               | Best for                                                |
| ---------- | ------------------------ | ------------------------------------------------------- |
| TUI        | `orbit`                  | focused interactive work without leaving the terminal   |
| Web UI     | `/webui`                 | projects, chats, images, Skills, tasks, and diff review |
| One task   | `orbit "…"`              | entering Orbit with an immediate objective              |
| Automation | `orbit exec "…" --jsonl` | CI, scripts, schemas, and deterministic exit codes      |
| Editor     | VS Code extension        | diagnostics and editor-adjacent completion              |

Orbit does not open a browser automatically. `/webui` leaves an authenticated,
clickable local URL beside the terminal's completed message. Keep the owning
terminal open while using the browser workspace.

## Built for complete coding tasks

- **Context that stays relevant.** Repository maps, symbols, references, BM25
  and vector retrieval, selected files, project instructions, and opt-in memory
  are assembled into a bounded context pack instead of dumping the repository.
- **Changes you can trust.** Workspace path isolation, approval policies,
  checkpoints, `/timeline`, `/rewind`, per-file rollback, a Changes workbench,
  verification contracts, and redacted traces keep edits inspectable.
- **Long sessions that survive reality.** Accepted prompts use durable atomic
  snapshots. Automatic compaction respects the active model's context window,
  and crash recovery never silently replays unfinished side effects.
- **Observable execution.** Tasks, tools, permissions, timing, cost, cache
  usage, warnings, and delegated agents remain visible without exposing raw
  secrets or flooding the interface with process logs.
- **Provider choice without chat loss.** Change model or provider mid-chat;
  Orbit recalculates the available context while preserving the conversation.
- **One interaction model.** Terminal completion, `/help`, and the Web UI slash
  picker use the same localized command catalog and argument hints.

## Projects, chats, and workflows

One Orbit project maps to one codebase folder and can own multiple independent
chats. The Web UI can switch projects, resume or archive conversations, and
launch an isolated local runtime without flashing an extra terminal window on
Windows. Responsive layouts keep the same workflow usable on wide monitors,
laptops, tablets, and narrow browser windows.

Reusable expertise belongs in a Skill; repeatable user-triggered procedures
belong in a workflow or custom slash command. The Web UI provides guided
templates, validation, enable/disable controls, an editable invocation preview,
typed input hints, and portable catalog export. Long conversations load in
bounded pages and preserve the reader's position while earlier messages are
revealed. Advanced users can maintain the same files directly:

```text
.orbit/skills/<name>/SKILL.md       Project Skill
~/.orbit/skills/<name>/SKILL.md     User Skill
.orbit/commands/<name>.md           Project slash command
~/.orbit/commands/<name>.md         User slash command
```

This makes specialized flows—such as code review, research synthesis, or the
included PDF/CSV mathematical-modeling template—discoverable with a click
while remaining transparent and versionable.

## Providers

For an OpenAI-compatible service, enter the exact base URL it requires,
including `/v1` when applicable. Orbit does not guess URL suffixes.
Authenticated model catalogs and the local Ollama API populate the selector
with models that are actually available.

Orbit is optimized for DeepSeek V4:

| Model               | Best for                     | Default thinking | Context   |
| ------------------- | ---------------------------- | ---------------- | --------- |
| `deepseek-v4-flash` | fast work and summarization  | disabled         | 1,000,000 |
| `deepseek-v4-pro`   | planning, coding, and review | high             | 1,000,000 |

Reusable request prefixes remain stable and provider-supplied cache hit/miss
usage is reported without synthetic cache primers or fixed hit-rate claims.

```bash
orbit doctor --probe --deepseek
orbit bench --model deepseek-v4-flash --thinking disabled --repeat 3 --max-tokens 256
```

## Operations

```bash
orbit doctor                 # local configuration and runtime checks
orbit update --check         # check npm without installing
orbit update                 # confirm before installing an update
orbit backup create          # portable chats, memory, commands, and skills
orbit backup inspect <file>  # validate paths, sizes, and SHA-256 integrity
orbit clean --project        # preview project-owned Orbit data cleanup
orbit clean --user           # preview user-owned Orbit data cleanup
```

Cleanup never removes project source, `ORBIT.md`, or `orbit.config.yaml`.
Interactive deletion requires the exact confirmation `DELETE`; automation must
pass `--yes`. Backups exclude credentials, indexes, caches, temporary state,
and prior exports.

## Documentation

| I want to…                             | Go to                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| configure and use Orbit                | [User guide](docs/USER_GUIDE.md)                                                       |
| find an exact CLI option               | `orbit --help` or `orbit <command> --help`                                             |
| understand security or report an issue | [Security policy](SECURITY.md)                                                         |
| review user-visible changes            | [Changelog](CHANGELOG.md)                                                              |
| contribute or understand the internals | [Documentation index](docs/README.md) and [maintainer guide](docs/MAINTAINER_GUIDE.md) |
| build extensions, Skills, or workflows | [Extension manifest](docs/EXTENSIONS.md) and [user guide](docs/USER_GUIDE.md)          |

## Repository architecture

Orbit keeps interfaces, runtime policy, storage, and provider protocols
separate:

| Layer           | Packages                                      | Owns                                                             |
| --------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| Interfaces      | `cli`, `tui`, `editors/vscode`                | commands, TUI, Web UI, LSP, editor integration                   |
| Agent runtime   | `core`, `context-engine`                      | planning, execution, memory, compaction, retrieval, verification |
| Model and tools | `model-providers`, `tools`, `mcp`             | providers, built-in tools, connected tools                       |
| Trust and state | `permissions`, `sandbox`, `session`, `config` | approvals, isolation, checkpoints, recovery, credentials, policy |
| Foundations     | `shared`                                      | paths, redaction, IDs, tokens, and bounded utilities             |

Generated `dist`, `coverage`, `test-results`, `node_modules`, scratch
workspaces, and runtime `.orbit` data are not source ownership boundaries.
Detailed dependency direction and change locations live in the
[maintainer guide](docs/MAINTAINER_GUIDE.md).

## Develop

Orbit is a strict TypeScript/ESM pnpm monorepo:

```bash
git clone https://github.com/Hephaestus-DevKit/Orbit.git
cd Orbit
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

Release candidates must pass `pnpm verify:release`, which covers formatting,
linting, workspace builds, unit tests, critical coverage, Web UI browser tests,
installed CLI smoke tests, documentation links, package contents, notices, and
the production dependency audit. See [CONTRIBUTING.md](CONTRIBUTING.md) before
submitting a change.

## License

License terms have not yet been finalized. Do not infer permission to use,
modify, or redistribute the source from repository visibility alone. A license
must be selected before commercial distribution.
