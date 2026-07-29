import { readBoundedRegularFile, resolveSafePath } from "@orbit-build/shared";

const MAX_SUMMARIZED_FILE_BYTES = 2 * 1024 * 1024;

export class FileSummarizer {
  constructor(private cwd: string) {}

  public async summarize(
    filePath: string,
    maxLines = 100,
  ): Promise<{ summary: string; excerpt: string }> {
    try {
      const safePath = resolveSafePath(this.cwd, filePath);
      const content = readBoundedRegularFile(
        safePath,
        MAX_SUMMARIZED_FILE_BYTES,
      );
      if (content === undefined) {
        return { summary: "File not found", excerpt: "" };
      }

      const lines = content.split("\n");

      const summary = `File size: ${content.length} bytes, total lines: ${lines.length}`;
      const excerpt =
        lines.slice(0, maxLines).join("\n") +
        (lines.length > maxLines ? "\n... [TRUNCATED] ..." : "");

      return { summary, excerpt };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { summary: `Error reading file: ${message}`, excerpt: "" };
    }
  }
}
