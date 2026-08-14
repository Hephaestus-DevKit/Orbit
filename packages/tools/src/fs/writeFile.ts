import { z } from "zod";
import { createHash } from "crypto";
import { readBoundedRegularFile } from "@orbit-build/shared";
import { existsSync } from "fs";
import { OrbitTool, ToolContext, ToolResult } from "../types.js";
import { atomicWriteToolFile } from "./atomicWrite.js";
import { MAX_TOOL_FILE_BYTES } from "./fileLimits.js";
import { hasFullHostAccess, resolveToolPath } from "./toolPaths.js";

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
    "Atomically write complete content inside the project, or to any host path when unrestricted Full Access is active. Use intent=create or overwrite when existence matters, and expectedHash to reject concurrent changes.";
  inputSchema = WriteFileInputSchema;
  risk = "write" as const;

  async execute(
    input: WriteFileInput,
    ctx: ToolContext,
  ): Promise<ToolResult<void>> {
    try {
      const safePath = resolveToolPath(ctx, input.path);
      const fullHostAccess = hasFullHostAccess(ctx);
      let current: string | undefined;
      let currentContentKnown = true;
      try {
        current = readBoundedRegularFile(safePath, MAX_TOOL_FILE_BYTES);
      } catch (error: unknown) {
        if (!fullHostAccess) throw error;
        currentContentKnown = false;
      }
      const fileExists = currentContentKnown
        ? current !== undefined
        : existsSync(safePath);
      if (input.intent === "create" && fileExists) {
        return { ok: false, error: `File already exists: ${input.path}` };
      }
      if (input.intent === "overwrite" && !fileExists) {
        return { ok: false, error: `File does not exist: ${input.path}` };
      }
      if (input.expectedHash) {
        if (!currentContentKnown) {
          return {
            ok: false,
            error: `Cannot verify expectedHash because the existing file could not be read within tool bounds: ${input.path}`,
          };
        }
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
      atomicWriteToolFile(
        ctx.cwd,
        input.path,
        input.content,
        currentContentKnown ? (current ?? null) : undefined,
        {
          allowOutsideWorkspace: fullHostAccess,
        },
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
