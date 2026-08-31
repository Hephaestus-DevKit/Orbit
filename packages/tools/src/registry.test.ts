import { describe, expect, it } from "vitest";
import {
  createDefaultToolRegistry,
  isParallelTool,
  ToolRegistry,
  toolRegistry,
} from "./index.js";

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
  "inspect_document",
  "transcribe_audio",
  "inspect_accessibility",
  "inspect_project",
  "capture_screenshot",
  "capture_audio",
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
    const parallelTools = toolRegistry.list().filter(isParallelTool);
    expect(parallelTools.map((tool) => tool.name).sort()).toEqual([
      "git_diff",
      "git_status",
      "glob",
      "grep",
      "list_files",
      "read_file",
    ]);
    for (const tool of parallelTools) {
      expect(tool.execution?.outputSchema?.safeParse).toBeTypeOf("function");
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

  it("fails closed on invalid contracts and accidental replacement", () => {
    const registry = new ToolRegistry();
    const tool = {
      ...toolRegistry.get("read_file")!,
      name: "custom_read",
    };
    registry.register(tool);

    expect(() => registry.register(tool)).toThrow("already registered");
    expect(() =>
      registry.register({ ...tool, name: "invalid.tool" }),
    ).toThrow();
    expect(() => registry.register({ ...tool, description: "   " })).toThrow();
    expect(() =>
      registry.register({
        ...tool,
        name: "unsafe_parallel",
        execution: {
          version: 2,
          readOnly: false,
          idempotent: true,
          concurrency: "parallel",
          cancellation: "boundary",
        },
      }),
    ).toThrow("Parallel tools must declare readOnly");
    expect(() =>
      registry.register({
        ...tool,
        name: "invalid_output_schema",
        execution: {
          version: 2,
          readOnly: true,
          idempotent: true,
          concurrency: "parallel",
          cancellation: "boundary",
          outputSchema: {},
        },
      } as never),
    ).toThrow("outputSchema must expose a safeParse function");
    registry.register(
      { ...tool, description: "replacement" },
      { replace: true },
    );
    expect(registry.get("custom_read")?.description).toBe("replacement");
  });

  it("removes a registration only when ownership still matches", () => {
    const registry = new ToolRegistry();
    const first = {
      ...toolRegistry.get("read_file")!,
      name: "owned_read",
    };
    const replacement = { ...first, description: "replacement" };
    registry.register(first);
    registry.register(replacement, { replace: true });

    expect(registry.unregister("owned_read", first)).toBe(false);
    expect(registry.get("owned_read")).toBe(replacement);
    expect(registry.unregister("owned_read", replacement)).toBe(true);
  });
});
