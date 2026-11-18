import readline from "readline";

/** Displays long text one terminal page at a time. */
export async function pageText(
  text: string,
): Promise<"completed" | "quit" | "interrupted"> {
  const lines = text.split("\n");
  const rows = process.stdout.rows || 24;
  const pageSize = Math.max(1, rows - 2);

  if (lines.length <= pageSize) {
    console.log(text);
    return "completed";
  }

  if (process.stdin.isTTY !== true || !process.stdin.setRawMode) {
    console.log(text);
    return "completed";
  }

  let cursor = 0;
  const wasRaw = Boolean(process.stdin.isRaw);
  const wasPaused = process.stdin.isPaused();
  process.stdin.setRawMode(true);
  process.stdin.resume();
  readline.emitKeypressEvents(process.stdin);

  const waitForKeypress = (): Promise<string> =>
    new Promise((resolve) => {
      const onKeypress = (str: string, key: readline.Key) => {
        process.stdin.removeListener("keypress", onKeypress);
        if (key?.ctrl && key.name === "c") return resolve("interrupt");
        resolve(key?.name || str);
      };
      process.stdin.on("keypress", onKeypress);
    });

  try {
    while (cursor < lines.length) {
      console.log(lines.slice(cursor, cursor + pageSize).join("\n"));
      cursor += pageSize;
      if (cursor >= lines.length) break;

      process.stdout.write(
        `\r\x1b[36m-- More (${
          Math.round((cursor / lines.length) * 100)
        }%) [Space/Enter to continue, q to quit] --\x1b[39m`,
      );
      const key = await waitForKeypress();
      process.stdout.write("\r\x1b[K");
      if (key.toLowerCase() === "q") return "quit";
      if (key === "interrupt") return "interrupted";
      if (key === "return" || key === "enter") {
        cursor = cursor - pageSize + 1;
      }
    }
    return "completed";
  } finally {
    process.stdin.setRawMode(wasRaw);
    if (wasPaused) process.stdin.pause();
  }
}
