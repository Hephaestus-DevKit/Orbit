<div align="center">

# Orbit

### Local-first AI coding, with the work left visible.

Orbit is one agent runtime for your terminal, browser, and editor. It can inspect
a repository, make changes, run verification, recover checkpoints, and keep the
entire task understandable while it works.

[![npm](https://img.shields.io/npm/v/@orbit-build/cli?label=npm&color=276a5f)](https://www.npmjs.com/package/@orbit-build/cli)
[![CI](https://github.com/Hephaestus-DevKit/Orbit/actions/workflows/ci.yml/badge.svg)](https://github.com/Hephaestus-DevKit/Orbit/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-43853d)](https://nodejs.org/)

Windows · macOS · Linux · English · 简体中文 · 繁體中文

</div>

![Orbit WebUI showing a code review, approval diff, project navigation, and prompt composer](docs/assets/orbit-webui.png)

## Start in 60 seconds

Install Node.js 20 or newer, then:

```bash
npm install --global @orbit-build/cli
orbit login
cd path/to/your/project
orbit
```

Describe the outcome you want:

```text
Find the cause of the failing tests, fix it, and verify the change.
```

Or use `/` to discover controls:

```text
/model                  Switch provider or model without losing the chat
/goal ship this safely  Keep a durable objective across a long task
/plan                   Inspect or update the recoverable task plan
/webui                  Open the synchronized browser workspace
```

`orbit login` supports DeepSeek, TokenDance, OpenAI, Anthropic,
OpenAI-compatible services, and local Ollama. Credentials use native OS
protection when available and are redacted from configuration, diagnostics,
events, and sessions.

## One runtime, three ways to work

| Surface     | Start with               | Use it for                                                   |
| ----------- | ------------------------ | ------------------------------------------------------------ |
| Terminal UI | `orbit`                  | focused, keyboard-first interactive work                     |
| Web UI      | `/webui`                 | chats, projects, images, Skills, tasks, approvals, and diffs |
| Automation  | `orbit exec "…" --jsonl` | CI, scripts, schemas, and deterministic exit codes           |
| Editor      | VS Code extension        | diagnostics and editor-adjacent completion                   |

The TUI and authenticated local Web UI share the same model, history, active
task, approval state, and cancellation flow. `/webui` prints a local,
authenticated URL before any optional remote model refresh, so a slow provider
cannot delay local startup. Keep its owning terminal open while you use it.

## Why Orbit feels different

### Context stays deliberate

Orbit combines repository maps, symbols, references, BM25 and vector retrieval,
selected files, project instructions, and opt-in memory into a bounded context
pack. It does not solve relevance by dumping the repository into every prompt.

### Changes stay reviewable

File writes remain inside the authorized workspace. Approval policies,
checkpoints, `/timeline`, `/rewind`, per-file restore, the Changes workbench,
verification contracts, and redacted traces keep consequential work visible and
recoverable.

### Long tasks survive reality

Accepted prompts use durable atomic snapshots. Automatic compaction respects
the active model's context window, and crash recovery does not silently replay
unfinished side effects.

### Execution stays observable

Plans, tools, permissions, timing, cost, cache usage, warnings, and delegated
agents are shown as structured state instead of disappearing into raw logs.
Failed web searches and low-confidence results are never presented as confirmed
facts.

### Provider choice does not reset the conversation

Switch provider or model mid-chat. Orbit recalculates available context while
preserving the project conversation and task state.

## Projects, Skills, and workflows

One Orbit project maps to one codebase folder and can contain multiple
independent chats. The Web UI can switch projects, resume or archive
conversations, and launch an isolated local runtime without flashing an extra
terminal window on Windows.

Reusable expertise belongs in a Skill. Repeatable, user-triggered procedures
belong in a workflow or custom slash command:

```text
.agents/skills/<name>/SKILL.md      Versioned project Skill
.orbit/skills/<name>/SKILL.md       Local project Skill
~/.orbit/skills/<name>/SKILL.md     User Skill
.orbit/commands/<name>.md           Project command
~/.orbit/commands/<name>.md         User command
```

The Web UI provides guided templates, inline validation, enable/disable
controls with failed-save recovery, explicit activation labels, typed input
hints, an editable invocation preview, and portable catalog export. Workflows
may compose up to eight existing Skills; missing or malformed dependencies are
rejected before files are written. The underlying files stay transparent and
versionable. New Skills include `agents/`, `references/`, `scripts/`, and
`assets/`, and can be stored locally or with the repository. Active bundled resources use
`skill://<skill-name>/<relative-path>` addresses, and
`orbit skills validate --deep` checks their links, sizes, and filesystem
safety.

## Providers

For an OpenAI-compatible service, enter its exact base URL, including `/v1`
when required. Orbit does not guess URL suffixes. Authenticated provider
catalogs and the local Ollama API populate the model selector with models that
are actually available.

Orbit includes first-class DeepSeek V4 profiles. The stable Flash name resolves
to `DeepSeek-V4-Flash-0731`; the official OpenAI-compatible profile uses the
native Responses API automatically for Flash and keeps Chat Completions for Pro
and compatible gateways. DeepSeek semantics are selected by model ID rather
than hostname, so TokenDance and future gateways receive the same reasoning,
tool-history, context, and validation behavior. Other model families stay on
the generic compatible path. Set provider `deepSeekApiFormat` to `auto` or
`responses` only when that gateway exposes Responses; otherwise use
`chat-completions`.

| Model               | Best for                     | Agent thinking | Context   |
| ------------------- | ---------------------------- | -------------- | --------- |
| `deepseek-v4-flash` | fast work and summarization  | low/high/max   | 1,048,576 |
| `deepseek-v4-pro`   | planning, coding, and review | high/max       | 1,048,576 |

```bash
orbit doctor --probe --deepseek
orbit bench --model deepseek-v4-flash --thinking low --repeat 3 --max-tokens 1024
```

Provider-supplied cache hit and miss usage is reported without synthetic cache
primers or fixed hit-rate claims.

## Operate with confidence

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
and previous exports.

## Documentation

| I want to…                             | Go to                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| configure and use Orbit                | [User guide](docs/USER_GUIDE.md)                                                       |
| find an exact CLI option               | `orbit --help` or `orbit <command> --help`                                             |
| understand security or report an issue | [Security policy](SECURITY.md)                                                         |
| review user-visible changes            | [Changelog](CHANGELOG.md)                                                              |
| contribute or understand internals     | [Documentation index](docs/README.md) and [maintainer guide](docs/MAINTAINER_GUIDE.md) |
| build extensions, Skills, or workflows | [Extension manifest](docs/EXTENSIONS.md) and [user guide](docs/USER_GUIDE.md)          |

## Architecture

Orbit keeps interfaces, runtime policy, state, and provider protocols separate:

| Layer            | Packages                                      | Owns                                                             |
| ---------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| Interfaces       | `cli`, `tui`, `editors/vscode`                | commands, TUI, Web UI, LSP, editor integration                   |
| Agent runtime    | `core`, `context-engine`                      | planning, execution, memory, compaction, retrieval, verification |
| Models and tools | `model-providers`, `tools`, `mcp`             | providers, built-in tools, connected tools                       |
| Trust and state  | `permissions`, `sandbox`, `session`, `config` | approvals, isolation, checkpoints, recovery, credentials, policy |
| Foundations      | `shared`                                      | paths, redaction, IDs, tokens, and bounded utilities             |

Generated `dist`, `coverage`, `test-results`, `node_modules`, scratch
workspaces, and runtime `.orbit` data are not source ownership boundaries. See
the [maintainer guide](docs/MAINTAINER_GUIDE.md) for dependency direction and
change locations.

## Develop

Orbit is a strict TypeScript/ESM pnpm monorepo:

```bash
git clone https://github.com/Hephaestus-DevKit/Orbit.git
cd Orbit
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm verify
```

Using `corepack pnpm` guarantees the repository's pinned pnpm version even when
another global pnpm is earlier on `PATH`. Release candidates must pass
`corepack pnpm verify:release`. The gate covers formatting,
linting, every workspace build, the full Vitest suite, critical coverage,
browser tests, installed CLI smoke tests, documentation links, package
contents, third-party notices, and the production dependency audit.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change.

## License

License terms have not yet been finalized. Do not infer permission to use,
modify, or redistribute the source from repository visibility alone. A license
must be selected before commercial distribution.
