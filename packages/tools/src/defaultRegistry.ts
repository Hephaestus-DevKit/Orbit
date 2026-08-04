import { EditFileTool } from "./fs/editFile.js";
import { GlobTool } from "./fs/glob.js";
import { GrepTool } from "./fs/grep.js";
import { ListFilesTool } from "./fs/listFiles.js";
import { ReadFileTool } from "./fs/readFile.js";
import { WriteFileTool } from "./fs/writeFile.js";
import { GitCommitTool } from "./git/gitCommit.js";
import { GitDiffTool } from "./git/gitDiff.js";
import { GitRestoreTool } from "./git/gitRestore.js";
import { GitStatusTool } from "./git/gitStatus.js";
import { DetectProjectTool } from "./project/detectProject.js";
import { FindSymbolReferencesTool } from "./project/findReferences.js";
import { InspectProjectTool } from "./project/inspectProject.js";
import { SearchSymbolsTool } from "./project/searchSymbols.js";
import { UpdatePlanTool } from "./session/updatePlan.js";
import { BashTool } from "./shell/bash.js";
import { RunTestsTool } from "./shell/runTests.js";
import { WebFetchTool } from "./web/fetch.js";
import { WebSearchTool } from "./web/search.js";
import {
  GetBackgroundTaskOutputTool,
  KillBackgroundTaskTool,
  ListBackgroundTasksTool,
} from "./runtime/backgroundTaskTools.js";
import { toolRegistry, ToolRegistry } from "./registry.js";

/** Register the built-in tools into an explicitly chosen registry. */
export function registerDefaultTools(registry: ToolRegistry): ToolRegistry {
  [
    new ReadFileTool(),
    new WriteFileTool(),
    new EditFileTool(),
    new ListFilesTool(),
    new GlobTool(),
    new GrepTool(),
    new BashTool(),
    new RunTestsTool(),
    new GetBackgroundTaskOutputTool(),
    new KillBackgroundTaskTool(),
    new ListBackgroundTasksTool(),
    new GitDiffTool(),
    new GitStatusTool(),
    new GitCommitTool(),
    new GitRestoreTool(),
    new DetectProjectTool(),
    new InspectProjectTool(),
    new SearchSymbolsTool(),
    new WebSearchTool(),
    new WebFetchTool(),
    new FindSymbolReferencesTool(),
    new UpdatePlanTool(),
  ].forEach((tool) => registry.register(tool));
  return registry;
}

/** Create an isolated built-in registry for tests, plugins, or restricted modes. */
export function createDefaultToolRegistry(): ToolRegistry {
  return registerDefaultTools(new ToolRegistry());
}

/** Backwards-compatible process-wide registry used by the current agent runtime. */
export const defaultToolRegistry = registerDefaultTools(toolRegistry);
