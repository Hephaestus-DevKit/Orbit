# CLI full-screen TUI

The TUI is split by state ownership. `FullscreenTui` coordinates the main
conversation screen while focused modules own prompt sessions, terminal text,
history persistence, paging, and theme constants.

## File map

| Module                 | Responsibility                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `FullscreenTui.ts`     | Conversation lifecycle, streaming state, and main-screen render.                                     |
| `TuiPromptSession.ts`  | Prompt state machine, key handling, listeners, and raw mode.                                         |
| `TuiPromptView.ts`     | Pure full-screen prompt rendering.                                                                   |
| `InputHistoryStore.ts` | Validated best-effort command-history persistence.                                                   |
| `TerminalText.ts`      | ANSI-safe width, wrapping, truncation, and cursor layout.                                            |
| `TuiInputHelpers.ts`   | Pure history, Unicode editing, mouse, and completion helpers.                                        |
| `TuiKeymap.ts`         | Pure standard/Vim key mapping and mode labels.                                                       |
| `TextPager.ts`         | Interactive long-text paging with non-TTY fallback.                                                  |
| `TuiTheme.ts`          | Curated named themes (`morandi`, `high-contrast`, `plain`) with `auto`/`always`/`never` color modes. |

The cat mascot and Morandi palette are part of the established terminal
identity. Keep their placement stable when improving layout or behavior.

`config.tui.color` controls color output. `auto` (the default) honors the
standard `NO_COLOR`, `FORCE_COLOR`, and `TERM=dumb` conventions; `always` is
useful for captured output that still needs ANSI styling, and `never` produces
plain text for screen readers, CI logs, and terminals with unreliable color.

`config.tui.theme` persists one of `morandi`, `high-contrast`, or `plain`;
`config.tui.color` still has final control over whether ANSI output is emitted.
`config.tui.keymap` defaults to `standard`. The opt-in `vim` keymap gives the
main task composer explicit INSERT/NORMAL state, `Esc`/`Ctrl+[` mode switching,
`h`/`l`, `b`/`w`, `0`/`^`/`$`, `x`, `d{w|$|d}`, `c{w|$|c}`, `D`, `C`, `u`,
`I`, `A`, `i`, and `a`; operators are bounded to the single-line composer and
`u` restores the most recent edit. Orbit's Ctrl/Meta shortcuts remain available
in either mode. Embedded approval and selection prompts keep their existing
bounded keys so a mode switch cannot change confirmation semantics.

`config.tui.accessibility: screen-reader` bypasses the alternate screen, mouse
capture, dynamic spinner, cursor-addressed redraws, and ANSI-rich output. Orbit
uses its existing line-oriented REPL with a stable plain-text header, prompt,
thinking stream, diff pager, and completion messages. The default remains
`standard`.

## Lifecycle

1. Construction only initializes in-memory state.
2. `initialize()` installs process hooks and loads history idempotently.
3. `start()` enters the alternate screen and begins interaction.
4. `stop()` leaves the alternate screen but allows a later restart.
5. `dispose()` removes listeners, restores process hooks, and releases timers.

Do not import `CommandRouter` from this directory; shared command metadata lives
under `runtime/`. New pure layout or input behavior belongs in a focused module
with direct Vitest coverage rather than another large method on `FullscreenTui`.
