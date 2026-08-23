const ENABLE_ALT_SCREEN = "\x1b[?1049h";
const DISABLE_ALT_SCREEN = "\x1b[?1049l";
const ENABLE_MOUSE = "\x1b[?1000h\x1b[?1006h";
const DISABLE_MOUSE = "\x1b[?1006l\x1b[?1000l";
const HIDE_CURSOR = "\x1b[?25l";
const RESET_AND_SHOW_CURSOR = "\x1b[0m\x1b[?25h";

/** Enter the alternate screen using one cursor and buffer lifecycle. */
export function enterFullscreenTerminal(
  mouseEnabled: boolean,
  stdout: NodeJS.WriteStream = process.stdout,
): void {
  const mouseMode = mouseEnabled ? ENABLE_MOUSE : "";
  stdout.write(`${ENABLE_ALT_SCREEN}${mouseMode}${HIDE_CURSOR}`);
}

/** Restore the main screen before returning stdin to cooked input mode. */
export function leaveFullscreenTerminal(
  stdin: NodeJS.ReadStream = process.stdin,
  stdout: NodeJS.WriteStream = process.stdout,
): void {
  // DECSET 1049 owns both the main-screen cursor and alternate-screen state.
  // Mixing it with ESC 7/8 can address different buffers on Windows ConPTY.
  stdout.write(`${DISABLE_MOUSE}${DISABLE_ALT_SCREEN}${RESET_AND_SHOW_CURSOR}`);
  // Restoring cooked mode after the screen transition prevents a confirmed
  // Ctrl+C from being echoed into the final TUI frame as a literal `^C`.
  if (stdin.setRawMode) stdin.setRawMode(false);
}
