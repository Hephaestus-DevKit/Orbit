import { describe, expect, it } from "vitest";
import { createDefaultToolRegistry, toolRegistry } from "./index.js";

const BUILT_IN_MODEL_TOOLS = [
  "bash",
  "detect_project",
  "edit_file",
  "find_symbol_references",
  "get_background_task_output",
  "git_commit",
  "git_diff",
  "git_restore",
  "git_status",
  "glob",
  "grep",
  "inspect_project",
  "kill_background_task",
  "list_background_tasks",
  "list_files",
  "read_file",
  "run_tests",
  "search_symbols",
  "update_plan",
  "web_fetch",
  "web_search",
  "write_file",
] as const;

describe("model tool registry", () => {
  it("exposes every built-in model tool exactly once with a valid contract", () => {
    const definitions = toolRegistry.getDefinitions();
    const names = definitions.map((definition) => definition.name).sort();

    expect(names).toEqual([...BUILT_IN_MODEL_TOOLS].sort());
    expect(new Set(names).size).toBe(names.length);
    for (const definition of definitions) {
      expect(definition.name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      expect(definition.description.trim()).not.toBe("");
      expect(definition.inputSchema.safeParse).toBeTypeOf("function");
    }
  });

  it("can create an isolated default registry without mutating the process registry", () => {
    const isolated = createDefaultToolRegistry();
    const custom = {
      ...isolated.get("read_file")!,
      name: "isolated_read_file",
    };

    isolated.register(custom);

    expect(isolated.get("isolated_read_file")).toBe(custom);
    expect(toolRegistry.get("isolated_read_file")).toBeUndefined();
  });
});
