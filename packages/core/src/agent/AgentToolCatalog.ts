import type { OrbitConfig } from "@orbit-build/config";
import type { ToolRegistry } from "@orbit-build/tools";
import type { OrbitTool } from "@orbit-build/tools";

interface ToolPolicy {
  allowedTools?: readonly string[];
  disallowedTools?: readonly string[];
  finalResponseOnly: boolean;
}

/** Snapshot the tools admitted to one request and enforce the same catalog at execution. */
export class AgentToolCatalog {
  private readonly admitted;
  public readonly definitions;

  constructor(
    private readonly registry: ToolRegistry,
    config: OrbitConfig,
    policy: ToolPolicy,
  ) {
    const denied = new Set(policy.disallowedTools);
    if (!config.tools.webSearch.enabled) {
      denied.add("web_search");
      denied.add("web_fetch");
    }
    if (!config.tools.bash.enabled) {
      for (const name of [
        "bash",
        "run_tests",
        "get_background_task_output",
        "kill_background_task",
        "list_background_tasks",
      ])
        denied.add(name);
    }
    this.admitted = new Map(
      registry
        .list()
        .filter(
          (tool) =>
            !policy.finalResponseOnly
            && !denied.has(tool.name)
            && (policy.allowedTools === undefined
              || policy.allowedTools.includes(tool.name)),
        )
        .map((tool) => [tool.name, tool]),
    );
    this.definitions = [...this.admitted.values()]
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        inputJsonSchema: tool.inputJsonSchema,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Reject calls outside this request's policy, including tools replaced during generation. */
  public rejection(name: string): string | undefined {
    const tool = this.admitted.get(name);
    if (!tool)
      return `Tool "${name}" is not enabled for this request. Select a tool from the provided catalog.`;
    if (this.registry.get(name) !== tool)
      return `Tool "${name}" changed after this request started. Request its current definition before retrying.`;
    return undefined;
  }

  /** Bind execution to the admitted implementation across later approval waits. */
  public get(name: string): OrbitTool | undefined {
    return this.admitted.get(name);
  }
}
