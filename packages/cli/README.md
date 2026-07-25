# @orbit-build/cli

Orbit is a local-first AI coding agent for the terminal, browser, and editor. It
is optimized for DeepSeek V4, supports OpenAI-compatible providers and local
Ollama models, and keeps project chats, model state, approvals, and context
synchronized between its TUI and authenticated local Web UI.

## Install and start

Requires Node.js 20 or newer. If `node` or `npm` is missing, install a current
Node.js LTS release from [nodejs.org](https://nodejs.org/); npm is included with
the standard Windows, macOS, and Linux installers.

```bash
node --version
npm --version
npm install --global @orbit-build/cli
orbit login
cd path/to/project
orbit
```

The global command works in PowerShell, Command Prompt, and POSIX shells. Open a
new terminal if an existing shell has not refreshed npm's global binary path.

```bash
orbit "Fix the failing tests"              # direct interactive task
orbit exec "Review src" --jsonl            # automation-friendly JSONL
orbit doctor --probe --deepseek             # configuration + live probe
orbit update --check                        # check without installing
```

Inside the TUI, use `/webui` to start the synchronized browser workspace, then
open the authenticated URL beside its `completed` message. Orbit does not open
a browser automatically. One project maps to one codebase folder and can
contain multiple persisted chats. Type `/` in either interface for the shared
command catalog; use `/goal`, `/plan`, `/model`, `/compact`, `/timeline`,
`/rewind`, and `/rollback` for durable work.

Accepted prompts are persisted before provider work starts. After an unexpected
shutdown, Orbit resumes conservatively without silently replaying unfinished
side-effecting tools. The Web UI Activity view exposes bounded tool timing,
risk, approval, and completion metadata without publishing raw inputs or output.

## Providers and continuity

`orbit login` adds, lists, and deletes saved provider profiles. Enter the exact
base URL required by an OpenAI-compatible provider, including `/v1` when
applicable; Orbit does not guess suffixes. Authenticated catalogs and the local
Ollama API populate the model selector with models that are actually available.

The official DeepSeek profile uses `https://api.deepseek.com` with
`deepseek-v4-flash` for fast work and `deepseek-v4-pro` for planning, coding,
and review. Model changes preserve the chat and recalculate context against the
new window; automatic compaction protects continuity when the window is smaller.

Orbit exposes validated file, search, symbol, shell, test, Git, web, fetch, and
plan tools. Arguments are checked before approval or execution, results are
bounded and redacted, and connected MCP tools retain their declared schemas.

## Update, backup, cleanup, and uninstall

```bash
orbit update --check
orbit update                 # confirm interactively
orbit update --yes           # explicit non-interactive install
orbit backup create          # chats, memory, commands, skills, and plans
orbit backup inspect <file>  # validate version, paths, sizes, and SHA-256
orbit backup restore <file>  # refuses existing files unless --force is used
orbit clean --project        # preview project-owned runtime data
orbit clean --user           # preview user-owned runtime data
npm uninstall --global @orbit-build/cli
```

Orbit never installs an update during startup. Cleanup never removes project
source, `ORBIT.md`, or `orbit.config.yaml`; deletion requires `DELETE`
interactively or `--yes` in automation.

Backups are portable, versioned project-data bundles. Credentials, generated
indexes, caches, evaluations, temporary state, and previous exports are always
excluded. Restore validates the complete bundle before writing anything.

After an update is installed and verified, restart `orbit` and reopen `/webui`.
The active TUI and browser server intentionally retain their true running
version until that restart instead of pretending to hot-update.

## Documentation

- [Product overview](https://github.com/Hephaestus-DevKit/Orbit#readme)
- [Task-oriented user guide](https://github.com/Hephaestus-DevKit/Orbit/blob/main/docs/USER_GUIDE.md)
- [Security policy](https://github.com/Hephaestus-DevKit/Orbit/blob/main/SECURITY.md)
- [Changelog](https://github.com/Hephaestus-DevKit/Orbit/blob/main/CHANGELOG.md)

Use `orbit --help` or `orbit <command> --help` for the exact options installed
on your machine. Automation exits with `0` for completion, `2` for task or
verification failure, `4` for provider startup failure, and `130` for abort.

License terms have not yet been finalized; repository visibility alone does not
grant permission to use, modify, or redistribute the source.
