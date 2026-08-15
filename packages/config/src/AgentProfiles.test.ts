import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "./defaults.js";
import {
  AgentProfileSchema,
  discoverAgentProfiles,
  resolveAgentProfile,
} from "./AgentProfiles.js";

describe("Agent Profiles", () => {
  it("validates bounded tool and permission declarations", () => {
    expect(
      AgentProfileSchema.safeParse({
        name: "reviewer",
        allowedTools: ["read_file", "git_diff"],
        disallowedTools: ["bash"],
        permissionMode: "strict",
        maxTurns: 40,
        effort: "high",
      }).success,
    ).toBe(true);
    expect(
      AgentProfileSchema.safeParse({
        name: "bad",
        allowedTools: ["bash"],
        disallowedTools: ["bash"],
      }).success,
    ).toBe(false);
  });

  it("discovers project profiles with first-directory-wins precedence", () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-agent-profiles-"));
    const project = join(cwd, ".agents", "agents");
    const fallback = join(cwd, ".orbit", "agents");
    mkdirSync(project, { recursive: true });
    mkdirSync(fallback, { recursive: true });
    writeFileSync(
      join(project, "reviewer.yaml"),
      "name: reviewer\ndescription: project profile\n",
    );
    writeFileSync(
      join(fallback, "reviewer.yml"),
      "name: reviewer\ndescription: fallback profile\n",
    );
    writeFileSync(join(project, "broken.yaml"), "name: BAD NAME\n");

    const catalog = discoverAgentProfiles(cwd, {
      ...DEFAULT_CONFIG.agents,
      directories: [".agents/agents", ".orbit/agents"],
    });
    expect(catalog.profiles).toHaveLength(1);
    expect(catalog.profiles[0]).toMatchObject({
      name: "reviewer",
      description: "project profile",
      source: "project",
    });
    expect(catalog.diagnostics.map((item) => item.code)).toContain(
      "duplicate-profile",
    );
    expect(catalog.diagnostics.map((item) => item.code)).toContain(
      "invalid-profile",
    );
  });

  it("keeps profiles from weakening the active managed policy", () => {
    const profile = AgentProfileSchema.parse({
      name: "unsafe",
      permissionMode: "auto",
    });
    const catalog = {
      profiles: [
        {
          ...profile,
          path: ".agents/agents/unsafe.yaml",
          source: "project" as const,
        },
      ],
      diagnostics: [],
      directories: [],
    };
    expect(() =>
      resolveAgentProfile(catalog, "unsafe", DEFAULT_CONFIG),
    ).toThrow(/requests auto mode/);
  });

  it("resolves inherited defaults while preserving explicit child overrides", () => {
    const profile = AgentProfileSchema.parse({
      name: "child",
      extends: "base",
      model: "deepseek-v4-pro",
      effort: "max",
    });
    const base = AgentProfileSchema.parse({
      name: "base",
      description: "shared reviewer",
      allowedTools: ["read_file", "git_diff"],
      maxTurns: 80,
      memory: "none",
    });
    const catalog = {
      profiles: [
        {
          ...base,
          path: ".agents/agents/base.yaml",
          source: "project" as const,
          declaredFields: [
            "name",
            "description",
            "allowedTools",
            "maxTurns",
            "memory",
          ],
        },
        {
          ...profile,
          path: ".agents/agents/child.yaml",
          source: "project" as const,
          declaredFields: ["name", "extends", "model", "effort"],
        },
      ],
      diagnostics: [],
      directories: [],
    };

    expect(resolveAgentProfile(catalog, "child", DEFAULT_CONFIG)).toMatchObject(
      {
        name: "child",
        description: "shared reviewer",
        allowedTools: ["read_file", "git_diff"],
        maxTurns: 80,
        memory: "none",
        model: "deepseek-v4-pro",
        effort: "max",
      },
    );
  });

  it("rejects inheritance cycles before runtime execution", () => {
    const a = AgentProfileSchema.parse({ name: "a", extends: "b" });
    const b = AgentProfileSchema.parse({ name: "b", extends: "a" });
    const catalog = {
      profiles: [
        { ...a, path: "a.yaml", source: "project" as const },
        { ...b, path: "b.yaml", source: "project" as const },
      ],
      diagnostics: [],
      directories: [],
    };
    expect(() => resolveAgentProfile(catalog, "a", DEFAULT_CONFIG)).toThrow(
      /inheritance cycle detected/,
    );
  });
});
