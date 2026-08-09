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
orbit
```

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
orbit update --check                         # check without installing
```

Orbit exits automation with `0` for completion, `2` for task or verification
failure, `4` for provider startup failure, and `130` for abort.

## What is included

- Project-scoped chats with model-aware context compaction and conservative
  crash recovery.
- Validated file, search, symbol, shell, test, Git, web, fetch, plan, and MCP
  tools with bounded, redacted results.
- Workspace isolation, approval policy, checkpoints, timeline, rewind,
  rollback, Changes review, verification contracts, and trace export.
- Browser image input, project switching, queued follow-ups, task and delegated
  agent visibility, paginated long-chat history, responsive layouts, and
  English/简体中文/繁體中文 controls.
- Guided Skills and workflows with localized inline validation, activation
  visibility, failed-save recovery, invocation preview, editable input hints,
  enable/disable controls, and portable catalog export.
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

Credentials use native OS protection when available and are redacted from
configuration, diagnostics, events, sessions, and exported traces.

## Maintain local data

```bash
orbit backup create          # chats, memory, commands, skills, and plans
orbit backup inspect <file>  # validate version, paths, sizes, and checksums
orbit backup restore <file>  # refuses existing files without --force
orbit clean --project        # preview project-owned cleanup
orbit clean --user           # preview user-owned cleanup
npm uninstall --global @orbit-build/cli
```

Cleanup never removes source files, `ORBIT.md`, or `orbit.config.yaml`.
Interactive deletion requires `DELETE`; automation requires `--yes`. Backups
exclude credentials, generated indexes, caches, evaluations, temporary state,
and prior exports.

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
