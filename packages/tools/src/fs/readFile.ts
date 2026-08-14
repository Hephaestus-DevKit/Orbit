import { z } from "zod";
import { readBoundedRegularFile } from "@orbit-build/shared";
import { OrbitTool, ToolContext, ToolResult } from "../types.js";
import { MAX_TOOL_FILE_BYTES } from "./fileLimits.js";
import { resolveReadableFile } from "./skillPaths.js";
import { hasFullHostAccess } from "./toolPaths.js";

export const ReadFileInputSchema = z.object({
  path: z.string().min(1).max(4096),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
});

export type ReadFileInput = z.infer<typeof ReadFileInputSchema>;

export class ReadFileTool implements OrbitTool<ReadFileInput, string> {
  name = "read_file";
  description =
    "Read a project file, any host file when unrestricted Full Access is active, or an active Skill resource addressed as skill://<skill-name>/<path>. Defaults to at most 400 lines and bounds oversized output for the model context.";
  inputSchema = ReadFileInputSchema;
  risk = "read" as const;

  async execute(
    input: ReadFileInput,
    ctx: ToolContext,
  ): Promise<ToolResult<string>> {
    try {
      const safePath = resolveReadableFile(ctx, input.path);
      const content = readBoundedRegularFile(safePath, MAX_TOOL_FILE_BYTES, {
        allowSymbolicLink: hasFullHostAccess(ctx),
      });
      if (content === undefined) {
        throw new Error(`File not found: ${input.path}`);
      }

      const lines = content.split("\n");
      const start =
        input.startLine !== undefined ? Math.max(1, input.startLine) : 1;
      const end =
        input.endLine !== undefined
          ? Math.min(lines.length, input.endLine)
          : Math.min(lines.length, start + 399);

      const slicedLines = lines.slice(start - 1, end);
      const rawDisplayContent = slicedLines.join("\n");
      const displayContent =
        rawDisplayContent.length > 120_000
          ? `${rawDisplayContent.slice(0, 119_940)}\n... [truncated by read_file]`
          : rawDisplayContent;

      return {
        ok: true,
        data: displayContent,
        display: `Read lines ${start}-${end} of ${input.path}`,
      };
    } catch (error: unknown) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
