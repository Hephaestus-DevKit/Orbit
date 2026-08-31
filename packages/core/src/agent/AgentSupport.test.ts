import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildAuditDiff, isFileMutationTool, sha256 } from "./AgentAudit.js";
import {
  cleanAndTruncateTestLog,
  extractFilePathFromLine,
  hookErrorOutput,
  parseSearchReplaceBlocks,
  safeHookOutput,
} from "./AgentTextTransforms.js";
import {
  generateXMLToolsPrompt,
  parseXMLToolCalls,
} from "./AgentToolProtocol.js";
import { isValidPackageName } from "./LocalPackageBinary.js";

describe("agent support modules", () => {
  it("builds bounded audit records for file mutations", () => {
    expect(isFileMutationTool("edit_file")).toBe(true);
    expect(isFileMutationTool("read_file")).toBe(false);
    expect(sha256("orbit")).toHaveLength(64);
    expect(buildAuditDiff("src/app.ts", "old", "new")).toContain(
      "--- a/src/app.ts\n+++ b/src/app.ts",
    );
  });

  it("parses typed XML tool arguments", () => {
    const [toolCall] = parseXMLToolCalls(`
<tool_call name="write_file">
  <path>src/app.ts</path>
  <overwrite>true</overwrite>
  <lines>3</lines>
</tool_call>`);

    expect(toolCall.name).toBe("write_file");
    expect(JSON.parse(toolCall.arguments)).toEqual({
      path: "src/app.ts",
      overwrite: true,
      lines: 3,
    });
  });

  it("documents Zod fields in the XML fallback prompt", () => {
    const prompt = generateXMLToolsPrompt([
      {
        name: "read_file",
        description: "Read a file",
        inputSchema: z.object({
          path: z.string().describe("Workspace-relative path"),
          limit: z.number().optional(),
        }),
      },
    ]);

    expect(prompt).toContain("`path`: (type: string)");
    expect(prompt).toContain("`limit`: (type: number, optional)");
  });

  it("extracts paths and SEARCH/replace blocks", () => {
    expect(extractFilePathFromLine("File: C:\\work\\src\\app.ts")).toBe(
      "C:\\work\\src\\app.ts",
    );
    expect(
      parseSearchReplaceBlocks(`src/app.ts
<<<<<<< SEARCH
before
=======
after
>>>>>>>`),
    ).toEqual([
      { filePath: "src/app.ts", oldText: "before", newText: "after" },
    ]);
  });

  it("compresses internal stack frames and validates package names", () => {
    const cleaned = cleanAndTruncateTestLog(
      "Error: failed\n    at user (src/app.ts:1:1)\n    at lib (node_modules/pkg/index.js:1:1)\nnext",
    );
    expect(cleaned).toContain("skipped 1 internal/library stack frames");
    expect(isValidPackageName("@orbit-build/core")).toBe(true);
    expect(isValidPackageName("core; rm -rf /")).toBe(false);
  });

  it("normalizes lifecycle process failures without exposing secrets or control bytes", () => {
    expect(
      safeHookOutput("API_KEY=private-hook-key\u0000\u0007 failure"),
    ).not.toContain("private-hook-key");
    expect(
      hookErrorOutput({ stdout: "compile failed\n", stderr: "line 2" }),
    ).toBe("compile failed\nline 2");
    expect(hookErrorOutput({ message: "spawn failed" })).toBe("spawn failed");
  });
});
