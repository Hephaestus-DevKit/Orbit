import { redactSecrets } from "@orbit-build/shared";

export interface SearchReplaceBlock {
  filePath: string;
  oldText: string;
  newText: string;
}

export function safeHookOutput(value: unknown): string {
  return redactSecrets(String(value ?? ""))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, " ")
    .trim()
    .slice(0, 4000);
}

export function hookErrorOutput(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error);
  const record = error as Record<string, unknown>;
  const output = `${typeof record.stdout === "string" ? record.stdout : ""}${
    typeof record.stderr === "string" ? record.stderr : ""
  }`;
  if (output.trim()) return output;
  return typeof record.message === "string" ? record.message : String(error);
}

export function extractFilePathFromLine(line: string): string {
  const windowsAbsolutePath = line.match(/([a-zA-Z]:[\\/][^`*\":#\s]+)/);
  if (windowsAbsolutePath) return windowsAbsolutePath[1];

  const unixAbsolutePath = line.match(/(?:^|\s)(\/[^`*\":#\s]+)/);
  if (unixAbsolutePath) return unixAbsolutePath[1];

  const relativePath = line.match(/([.\w\-+]+[\\/][^`*\":#\s]+)/);
  if (relativePath) return relativePath[1];

  return line.replace(/[`*:*#\-+]/g, "").trim();
}

export function parseSearchReplaceBlocks(text: string): SearchReplaceBlock[] {
  const blocks: SearchReplaceBlock[] = [];
  const blockPattern =
    /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>>/g;

  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(text)) !== null) {
    const linesBeforeBlock = text.slice(0, match.index).split(/\r?\n/);
    const filePath = linesBeforeBlock
      .reverse()
      .map((line) => extractFilePathFromLine(line.trim()))
      .find(
        (candidate) =>
          candidate.includes("/") ||
          candidate.includes("\\") ||
          /\.(?:js|ts|txt)$/.test(candidate),
      );

    if (filePath) {
      blocks.push({ filePath, oldText: match[1], newText: match[2] });
    }
  }
  return blocks;
}

export function cleanAndTruncateTestLog(log: string): string {
  const lines = log
    .replace(/\u001b\[\d+(;\d+)*m/g, "")
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "")
    .split(/\r?\n/);
  const filteredLines: string[] = [];
  let skippedFrames = 0;

  const flushSkippedFrames = (): void => {
    if (skippedFrames === 0) return;
    filteredLines.push(
      `    ... skipped ${skippedFrames} internal/library stack frames ...`,
    );
    skippedFrames = 0;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("at ") &&
      (trimmed.includes("node_modules") ||
        trimmed.includes("node:internal") ||
        trimmed.includes("node:events"))
    ) {
      skippedFrames++;
      continue;
    }
    flushSkippedFrames();
    filteredLines.push(line);
  }
  flushSkippedFrames();

  if (filteredLines.length <= 200) return filteredLines.join("\n");
  return [
    ...filteredLines.slice(0, 80),
    "\n[... WARNING: Log output truncated by Orbit for Token Optimization ...]\n",
    ...filteredLines.slice(-120),
  ].join("\n");
}
