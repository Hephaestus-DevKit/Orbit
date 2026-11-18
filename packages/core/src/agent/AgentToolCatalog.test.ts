import { describe, expect, it } from "../../../../scripts/testing/support.mjs";
import { z } from "zod";
import { DEFAULT_CONFIG } from "@orbit-build/config";
import { ToolRegistry } from "@orbit-build/tools";
import { AgentToolCatalog } from "./AgentToolCatalog.js";

describe("request tool admission", () => {
  function fixture() {
    const registry = new ToolRegistry();
    for (const name of [
      "bash",
      "run_tests",
      "web_search",
      "web_fetch",
      "read_file",
      "write_file",
    ])
      registry.register({
        name,
        description: "fixture",
        risk: "read",
        inputSchema: z.object({}),
        execute: async () => ({ ok: true }),
      });
    return registry;
  }
  it("applies feature switches and allow/deny policy to execution as well as advertising", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.tools.bash.enabled = false;
    config.tools.webSearch.enabled = false;
    const catalog = new AgentToolCatalog(fixture(), config, {
      allowedTools: ["read_file", "write_file", "bash", "web_search"],
      disallowedTools: ["write_file"],
      finalResponseOnly: false,
    });
    expect(catalog.definitions.map((tool) => tool.name)).toEqual(["read_file"]);
    for (const name of [
      "write_file",
      "bash",
      "web_search",
      "web_fetch",
      "run_tests",
      "missing",
    ])
      expect(catalog.rejection(name)).toContain("not enabled");
    expect(catalog.rejection("read_file")).toBeUndefined();
  });
  it("rejects replacement after admission and does not admit later registrations", () => {
    const registry = fixture();
    const catalog = new AgentToolCatalog(registry, DEFAULT_CONFIG, {
      finalResponseOnly: false,
    });
    registry.register(
      { ...registry.get("read_file")!, description: "replacement" },
      { replace: true },
    );
    registry.register({ ...registry.get("read_file")!, name: "late_tool" });
    expect(catalog.rejection("read_file")).toContain("changed");
    expect(catalog.rejection("late_tool")).toContain("not enabled");
  });
  it("locks all tools after terminal completion", () => {
    const catalog = new AgentToolCatalog(fixture(), DEFAULT_CONFIG, {
      finalResponseOnly: true,
    });
    expect(catalog.definitions).toEqual([]);
    expect(catalog.rejection("read_file")).toContain("not enabled");
  });
});
