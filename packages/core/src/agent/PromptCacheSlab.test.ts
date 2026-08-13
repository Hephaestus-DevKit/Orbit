import { describe, expect, it, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { PromptCacheSlabBuilder } from "./PromptCacheSlab.js";
import type { ContextPack } from "@orbit-build/context-engine";
import { z } from "zod";

function createProjectIndex(
  overrides: Partial<ContextPack["projectIndex"]> = {},
): ContextPack["projectIndex"] {
  return {
    root: "/workspace",
    detectedLanguages: ["typescript"],
    frameworks: ["vitest"],
    entrypoints: ["src/index.ts"],
    packageManager: "pnpm",
    testCommands: [],
    lintCommands: [],
    buildCommands: [],
    importantFiles: [],
    ignoredFiles: [],
    generatedAt: "2026-06-30T00:00:00.000Z",
    ...overrides,
  };
}

describe("PromptCacheSlabBuilder", () => {
  const cwd = path.resolve(process.cwd(), "cache-slab-test-temp");

  afterEach(() => {
    if (fs.existsSync(cwd)) {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  function makeContext(
    codebaseContext: string,
    overrides: Partial<ContextPack> = {},
  ): ContextPack {
    return {
      projectIndex: createProjectIndex(),
      projectInstructions: "Always preserve workspace boundaries.",
      skillsIndex: [
        {
          name: "api-tuning",
          description: "Optimize provider throughput",
          path: ".orbit/skills/api-tuning/SKILL.md",
        },
      ],
      activeSkills: [
        {
          name: "api-tuning",
          description: "Optimize provider throughput",
          path: ".orbit/skills/api-tuning/SKILL.md",
          content: "Volatile skill body for this turn",
          activation: "auto",
          loadedBytes: 34,
          truncated: false,
        },
      ],
      relevantFiles: [
        {
          path: "src/dynamic.ts",
          reason: "selected by current turn",
          summary: "dynamic file",
          excerpt: "console.log(Date.now())",
        },
      ],
      recentChanges: "",
      currentDiff: "",
      previousErrors: "",
      codebaseContext,
      tokenBudget: { max: 128000, usedEstimate: 100 },
      ...overrides,
    };
  }

  it("keeps the stable slab independent from volatile RAG and file excerpts", () => {
    const first = PromptCacheSlabBuilder.build({
      cwd,
      provider: "deepseek",
      model: "deepseek-v4-flash",
      baseSystemPrompt: "Base rules",
      toolsPrompt: "Tool schema A",
      repoMapText: "Repo map A",
      contextPack: makeContext("RAG result one"),
    });
    const second = PromptCacheSlabBuilder.build({
      cwd,
      provider: "deepseek",
      model: "deepseek-v4-flash",
      baseSystemPrompt: "Base rules",
      toolsPrompt: "Tool schema A",
      repoMapText: "Repo map A",
      contextPack: makeContext("RAG result two"),
    });

    expect(first.hash).toBe(second.hash);
    expect(first.text).toContain("Always preserve workspace boundaries.");
    expect(first.text).toContain("api-tuning - Optimize provider throughput");
    expect(first.text).not.toContain("Volatile skill body");
    expect(first.text).not.toContain("Repo map A");
    expect(first.text).not.toContain("<!-- VOLATILE_CONTEXT -->");
    expect(first.text).not.toContain("### Runtime Context");
    expect(first.text).not.toContain("Current local date");
    expect(first.text).not.toContain("RAG result one");
    expect(first.text).not.toContain("console.log(Date.now())");
    // Building the in-memory slab is intentionally side-effect free. Metadata is
    // persisted only when real cache telemetry is available.
    expect(fs.existsSync(first.path)).toBe(false);
  });

  it("keeps the cache key stable for reordered stable project metadata", () => {
    const first = PromptCacheSlabBuilder.build({
      cwd,
      provider: "deepseek",
      model: "deepseek-v4-flash",
      baseSystemPrompt: "Base rules",
      toolsPrompt: "Tool schema A",
      repoMapText: "Repo map A",
      contextPack: makeContext("RAG result one", {
        projectIndex: createProjectIndex({
          detectedLanguages: ["typescript", "javascript"],
          frameworks: ["vitest", "react"],
          entrypoints: ["src/index.ts", "src/cli.ts"],
        }),
      }),
    });
    const second = PromptCacheSlabBuilder.build({
      cwd,
      provider: "deepseek",
      model: "deepseek-v4-flash",
      baseSystemPrompt: "Base rules",
      toolsPrompt: "Tool schema A",
      repoMapText: "Repo map A",
      contextPack: makeContext("RAG result two", {
        projectIndex: createProjectIndex({
          detectedLanguages: ["javascript", "typescript"],
          frameworks: ["react", "vitest"],
          entrypoints: ["src/cli.ts", "src/index.ts"],
        }),
      }),
    });

    expect(first.hash).toBe(second.hash);
    expect(first.text).toContain("Language profile: javascript, typescript");
    expect(first.text).toContain("Framework profile: react, vitest");
    expect(first.text).toContain("Entrypoints: src/cli.ts, src/index.ts");
  });

  it("fingerprints the complete canonical native-tool catalog", () => {
    const readTool = {
      name: "read_file",
      description: "Read one file",
      inputSchema: z.object({ path: z.string(), limit: z.number().optional() }),
      inputJsonSchema: {
        required: ["path"],
        properties: {
          path: { type: "string" },
          limit: { type: "number" },
        },
        type: "object",
      },
    };
    const searchTool = {
      name: "search",
      description: "Search files",
      inputSchema: z.object({ query: z.string() }),
    };
    const base = {
      cwd,
      provider: "deepseek",
      model: "deepseek-v4-flash",
      baseSystemPrompt: "Base rules",
      toolsPrompt: "Stable native tool guidance",
      repoMapText: "Repo map A",
      contextPack: makeContext("RAG result one"),
    };
    const first = PromptCacheSlabBuilder.build({
      ...base,
      tools: [searchTool, readTool],
    });
    const reordered = PromptCacheSlabBuilder.build({
      ...base,
      tools: [
        {
          ...readTool,
          inputJsonSchema: {
            type: "object",
            properties: {
              limit: { type: "number" },
              path: { type: "string" },
            },
            required: ["path"],
          },
        },
        searchTool,
      ],
    });
    const changed = PromptCacheSlabBuilder.build({
      ...base,
      tools: [
        { ...readTool, description: "Read a workspace file" },
        searchTool,
      ],
    });
    const otherProvider = PromptCacheSlabBuilder.build({
      ...base,
      provider: "tokendance",
      tools: [searchTool, readTool],
    });

    expect(first.hash).toBe(reordered.hash);
    expect(first.toolSchemaHash).toBe(reordered.toolSchemaHash);
    expect(first.systemHash).toBe(reordered.systemHash);
    expect(changed.hash).not.toBe(first.hash);
    expect(changed.toolSchemaHash).not.toBe(first.toolSchemaHash);
    expect(changed.systemHash).toBe(first.systemHash);
    expect(otherProvider.hash).not.toBe(first.hash);
    expect(otherProvider.systemHash).toBe(first.systemHash);
    expect(otherProvider.toolSchemaHash).toBe(first.toolSchemaHash);
  });

  it("records cache telemetry and builds diagnostics", () => {
    const slab = PromptCacheSlabBuilder.build({
      cwd,
      provider: "deepseek",
      model: "deepseek-v4-flash",
      baseSystemPrompt: "Base rules",
      toolsPrompt: "Tool schema A",
      repoMapText: "Repo map A",
      contextPack: makeContext("RAG result one"),
    });

    expect(PromptCacheSlabBuilder.hasTelemetry(slab)).toBe(false);

    PromptCacheSlabBuilder.recordTelemetry(
      slab,
      {
        inputTokens: 1000,
        hitTokens: 900,
        missTokens: 100,
        hitRate: 0.9,
        degraded: false,
      },
      new Date("2026-06-30T00:00:00Z"),
    );

    expect(PromptCacheSlabBuilder.hasTelemetry(slab)).toBe(true);

    const diagnostics = PromptCacheSlabBuilder.buildDiagnostics(cwd);

    expect(diagnostics).toContain("Cache diagnostics:");
    expect(diagnostics).toContain(slab.hash.slice(0, 8));
    expect(diagnostics).toContain("recent hit=90%");
    expect(diagnostics).toContain("trend samples=1");
  });

  it("ignores malformed external cache metadata", () => {
    const cacheDir = path.join(cwd, ".orbit", "cache-slabs");
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir, "invalid.json"),
      JSON.stringify({ hash: "bad", telemetry: "not-an-array" }),
      "utf8",
    );

    expect(PromptCacheSlabBuilder.buildDiagnostics(cwd)).toBe(
      "Cache diagnostics:\n- No readable cache slab metadata found.",
    );
  });
});
