import { z } from "zod";
import { findMatchingPaths } from "@orbit-build/shared";
import { OrbitTool, ToolContext, ToolResult } from "../types.js";

export const InspectProjectInputSchema = z.object({});
export type InspectProjectInput = z.infer<typeof InspectProjectInputSchema>;

export class InspectProjectTool implements OrbitTool<
  InspectProjectInput,
  string
> {
  name = "inspect_project";
  description =
    "Inspect project directory structure, returning a tree summary of top-level folders and files.";
  inputSchema = InspectProjectInputSchema;
  risk = "read" as const;

  async execute(
    _input: InspectProjectInput,
    ctx: ToolContext,
  ): Promise<ToolResult<string>> {
    try {
      const files = await findMatchingPaths("**/*", {
        cwd: ctx.cwd,

        deep: 2,
        ignore: [
          "**/node_modules/**",
          "**/.git/**",
          "**/dist/**",
          "**/build/**",
        ],
        includeDirectories: true,
        dot: false,
      });

      const treeLines: string[] = [];
      const sorted = files.sort();

      for (const item of sorted) {
        const parts = item.split("/");
        const indent = "  ".repeat(parts.length - 1);
        const name = parts[parts.length - 1];
        treeLines.push(`${indent}- ${name}`);
      }

      const display = `Project directory structure (excluding ignored items):\n\n${treeLines.slice(0, 200).join("\n")}${treeLines.length > 200 ? "\n... [TRUNCATED] ..." : ""}`;

      return {
        ok: true,
        data: display,
        display,
      };
    } catch (error: unknown) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
