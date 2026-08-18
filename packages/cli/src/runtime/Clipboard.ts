import { execFileSync } from "node:child_process";
import {
  HIDDEN_CHILD_PROCESS_OPTIONS,
  redactSecrets,
} from "@orbit-build/shared";

export type ClipboardExecutor = (
  executable: string,
  args: readonly string[],
  input: string,
) => void;

export interface ClipboardRuntime {
  platform: NodeJS.Platform;
  execute: ClipboardExecutor;
}

const DEFAULT_RUNTIME: ClipboardRuntime = {
  platform: process.platform,
  execute(executable, args, input) {
    execFileSync(executable, [...args], {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      input,
    });
  },
};

/** Copy text without passing either content or executable arguments through a shell. */
export function copyTextToClipboard(
  text: string,
  runtime: ClipboardRuntime = DEFAULT_RUNTIME,
): boolean {
  const candidates = clipboardCandidates(runtime.platform);
  for (const candidate of candidates) {
    try {
      runtime.execute(candidate.executable, candidate.args, text);
      return true;
    } catch (error: unknown) {
      // Clipboard tools are optional. Try the next native adapter without
      // surfacing command paths, environment values, or clipboard content.
      void redactSecrets(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return false;
}

function clipboardCandidates(
  platform: NodeJS.Platform,
): Array<{ executable: string; args: readonly string[] }> {
  if (platform === "win32") return [{ executable: "clip", args: [] }];
  if (platform === "darwin") return [{ executable: "pbcopy", args: [] }];
  return [
    { executable: "xclip", args: ["-selection", "clipboard"] },
    { executable: "xsel", args: ["-ib"] },
    { executable: "wl-copy", args: [] },
  ];
}
