import { z } from "zod";
import { createHash } from "crypto";
import { readBoundedRegularFile, resolveSafePath } from "@orbit-build/shared";
import { OrbitTool, ToolContext, ToolResult } from "../types.js";
import { atomicWriteWorkspaceFile } from "./atomicWrite.js";
import { MAX_TOOL_FILE_BYTES } from "./fileLimits.js";

export const WriteFileInputSchema = z.object({
  path: z.string().trim().min(1).max(4096),
  content: z.string().max(5_000_000),
  intent: z.enum(["create", "overwrite", "upsert"]).optional(),
  expectedHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
});

export type WriteFileInput = z.infer<typeof WriteFileInputSchema>;

export class WriteFileTool implements OrbitTool<WriteFileInput, void> {
  name = "write_file";
  description =
    "Atomically write complete content inside the project. Use intent=create or overwrite when existence matters, and expectedHash to reject concurrent changes.";
  inputSchema = WriteFileInputSchema;
  risk = "write" as const;

  async execute(
    input: WriteFileInput,
    ctx: ToolContext,
  ): Promise<ToolResult<void>> {
    try {
      const safePath = resolveSafePath(ctx.cwd, input.path);
      const current = readBoundedRegularFile(safePath, MAX_TOOL_FILE_BYTES);
      if (input.intent === "create" && current !== undefined) {
        return { ok: false, error: `File already exists: ${input.path}` };
      }
      if (input.intent === "overwrite" && current === undefined) {
        return { ok: false, error: `File does not exist: ${input.path}` };
      }
      if (input.expectedHash) {
        if (current === undefined) {
          return {
            ok: false,
            error: `Cannot verify expectedHash because the file does not exist: ${input.path}`,
          };
        }
        const currentHash = createHash("sha256").update(current).digest("hex");
        if (currentHash !== input.expectedHash.toLowerCase()) {
          return {
            ok: false,
            error: `File hash mismatch for ${input.path}; refusing to overwrite concurrent edits.`,
          };
        }
      }
      atomicWriteWorkspaceFile(
        ctx.cwd,
        input.path,
        input.content,
        current ?? null,
      );

      return {
        ok: true,
        display: `Wrote file to ${input.path}`,
      };
    } catch (error: unknown) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
