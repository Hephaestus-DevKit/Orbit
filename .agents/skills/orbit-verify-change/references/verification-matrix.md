# Verification matrix

Select the smallest row that covers the change, then expand when risk crosses a boundary.

| Change             | Focused checks                           | Wider gate                                    |
| ------------------ | ---------------------------------------- | --------------------------------------------- |
| WebUI              | `pnpm test:webui`                        | `pnpm verify:webui` plus live browser checks  |
| CLI/runtime        | `pnpm test:cli` or targeted Vitest files | `pnpm verify:cli`                             |
| Config/credentials | Config and credential test files         | affected package builds plus full tests       |
| Core agent/events  | Agent and event test directories         | core build plus full tests                    |
| Context/RAG/Skills | Context-engine tests                     | context-engine and CLI builds plus full tests |
| TUI                | TUI package and CLI TUI tests            | CLI verification plus non-TTY fallback check  |
| Release/package    | focused checks first                     | `pnpm verify:release`                         |

Always include:

```powershell
pnpm lint
pnpm format:check
pnpm build
pnpm test
git diff --check
```

Risk-specific additions:

- WebUI: default and narrow viewport, keyboard flow, browser error log.
- Filesystem: traversal, symlink escape, protected roots, Windows paths.
- Credentials: stdout/stderr, URLs, events, sessions, support data, snapshots.
- Cancellation: verify no late writes or false success after abort.
- Lifecycle: repeated start/stop, cleanup after failure, stale async work isolation.
- Compatibility: old config/session/checkpoint data and public JSON schemas.
