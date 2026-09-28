import { describe, it, expect } from "vitest";
import { MessageBuilder } from "./MessageBuilder.js";
import { createInitialState } from "./AgentState.js";
import type { ContextPack } from "@orbit-build/context-engine";
import type { OrbitMessage } from "@orbit-build/model-providers";

function createProjectIndex(): ContextPack["projectIndex"] {
  return {
    root: "/workspace",
    detectedLanguages: ["typescript"],
    frameworks: ["vitest"],
    entrypoints: [],
    packageManager: "pnpm",
    testCommands: [],
    lintCommands: [],
    buildCommands: [],
    importantFiles: [],
    ignoredFiles: [],
    generatedAt: "2026-06-29T00:00:00.000Z",
  };
}

function textAt(message: OrbitMessage, blockIndex = 0): string {
  const block = message.content[blockIndex];
  if (!block || block.type !== "text") {
    throw new Error(`Expected text content block at index ${blockIndex}.`);
  }
  return block.text;
}

describe("MessageBuilder prompt caching", () => {
  it("builds a persisted user turn without embedding browser routing in visible text", () => {
    const message = MessageBuilder.userTurn("Inspect this page", [], {
      browserAttached: true,
    });
    expect(message.role).toBe("user");
    expect(textAt(message)).toBe("Inspect this page");
    expect(message.metadata).toEqual({ browserAttached: true });
  });
  it("keeps a browser attachment in hidden model context instead of user text", () => {
    const state = createInitialState(
      "session-browser",
      "What is on this page?",
    );
    state.history = [
      {
        id: "browser-request",
        role: "user",
        createdAt: new Date().toISOString(),
        content: [{ type: "text", text: "What is on this page?" }],
        metadata: { browserAttached: true },
      },
    ];
    const context: ContextPack = {
      projectIndex: createProjectIndex(),
      projectInstructions: "",
      relevantFiles: [],
      recentChanges: "",
      currentDiff: "",
      previousErrors: "",
      tokenBudget: { max: 2000, usedEstimate: 100 },
    };
    const built = MessageBuilder.build("System", state, context);
    expect(textAt(built.messages[0])).toContain("Attached Browser Page");
    expect(textAt(built.messages[0])).toContain("browser_preview");
    expect(built.messages[0].metadata?.kind).toBe("orbit_volatile_context");
    expect(textAt(built.messages[1])).toBe("What is on this page?");
    expect(built.messages[1].metadata?.browserAttached).toBe(true);
    state.history = built.messages;
    expect(MessageBuilder.build("System", state, context).messages).toEqual(
      built.messages,
    );
  });
  it("places a full-read requirement outside a truncated Skill excerpt", () => {
    const state = createInitialState("skill-test", "$review");
    state.history = [
      {
        id: "skill-request",
        role: "user",
        createdAt: new Date().toISOString(),
        content: [{ type: "text", text: "$review" }],
      },
    ];
    const context: ContextPack = {
      projectIndex: createProjectIndex(),
      projectInstructions: "",
      relevantFiles: [],
      recentChanges: "",
      currentDiff: "",
      previousErrors: "",
      tokenBudget: { max: 2000, usedEstimate: 100 },
      activeSkills: [
        {
          name: "review",
          description: "Review",
          path: "/review/SKILL.md",
          rootDir: "/review",
          content: "Partial procedure",
          activation: "explicit",
          loadedBytes: 17,
          truncated: true,
        },
      ],
    };
    const result = MessageBuilder.build("System", state, context);
    const text = result.messages
      .map((message) =>
        message.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n"),
      )
      .join("\n");
    expect(text).toContain(
      "INCOMPLETE SKILL: Read skill://review/SKILL.md completely",
    );
    expect(text.indexOf("INCOMPLETE SKILL")).toBeLessThan(
      text.indexOf("Partial procedure"),
    );
  });
  it("keeps the system stable and inserts volatile context before the current user request", () => {
    const state = createInitialState("session-123", "杭州今天天气");
    state.history = [
      {
        id: "msg-1",
        role: "user",
        createdAt: new Date().toISOString(),
        content: [{ type: "text", text: "杭州今天天气" }],
      },
    ];

    const context: ContextPack = {
      projectIndex: createProjectIndex(),
      projectInstructions: "Use spaces.",
      relevantFiles: [
        {
          path: "src/index.ts",
          reason: "entrypoint",
          summary: "entry point file",
          excerpt: "console.log('hello');",
        },
      ],
      recentChanges: "",
      currentDiff: "",
      previousErrors: "",
      codebaseContext: "RAG context A",
      tokenBudget: { max: 128000, usedEstimate: 100 },
    };

    const build = MessageBuilder.build("System Prompt Base", state, context, {
      now: new Date(2026, 5, 29, 10, 30, 5),
      repoMapText: "src/index.ts -> main",
    });

    expect(build.system).toBe("System Prompt Base");
    expect(build.system).not.toContain("RAG context A");
    expect(build.messages).toHaveLength(2);

    const contextMessage = build.messages[0];
    const contextText = textAt(contextMessage);
    expect(contextMessage.metadata).toMatchObject({
      kind: "orbit_volatile_context",
      forMessageId: "msg-1",
    });
    expect(contextText).toContain("### Runtime Context");
    expect(contextText).toContain("Current local date: 2026-06-29");
    expect(contextText).toContain("Current local time: 10:30:05");
    expect(contextText).toContain(
      "Resolve relative dates such as today, tomorrow, yesterday",
    );
    expect(contextText).toContain(
      "trust live results over model training memory",
    );
    expect(contextText).toContain(
      "If every lookup fails or reports low confidence",
    );
    expect(contextText).toContain(
      "never infer that nothing happened, that sources have not updated",
    );
    expect(contextText).toContain("RAG context A");
    expect(contextText).toContain("### Repository Map");
    expect(contextText).toContain("src/index.ts -> main");
    expect(contextText).toContain("console.log('hello');");
    expect(contextText).not.toContain("Use spaces.");
    expect(contextText.indexOf("### Runtime Context")).toBeGreaterThan(
      contextText.indexOf("### Relevant Files Excerpts"),
    );
    expect(contextText.indexOf("File: src/index.ts")).toBeLessThan(
      contextText.indexOf("### Codebase Context"),
    );

    const lastMsgText = textAt(build.messages[1]);
    expect(lastMsgText).toBe("杭州今天天气");
    expect(build.contextMessageAdded).toBe(true);
  });

  it("keeps non-time-sensitive volatile context date-only for cache reuse", () => {
    const state = createInitialState("session-123", "fix the bug");
    state.history = [
      {
        id: "msg-fix",
        role: "user",
        createdAt: new Date().toISOString(),
        content: [{ type: "text", text: "fix the bug" }],
      },
    ];
    const context: ContextPack = {
      projectIndex: createProjectIndex(),
      projectInstructions: "",
      relevantFiles: [],
      recentChanges: "",
      currentDiff: "",
      previousErrors: "",
      codebaseContext: "",
      tokenBudget: { max: 128000, usedEstimate: 100 },
    };

    const build = MessageBuilder.build("System Prompt Base", state, context, {
      now: new Date(2026, 5, 29, 10, 30, 5),
    });

    const contextText = textAt(build.messages[0]);
    expect(build.system).toBe("System Prompt Base");
    expect(contextText).toContain("Current local date: 2026-06-29");
    expect(contextText).not.toContain("Current local time:");
    expect(contextText).not.toContain("Current ISO time:");
  });

  it("should keep messages stable across multiple turns and steps", () => {
    const state = createInitialState("session-123", "run tests");
    state.history = [
      {
        id: "msg-1",
        role: "user",
        createdAt: new Date().toISOString(),
        content: [{ type: "text", text: "decorated user message from Turn 1" }],
      },
      {
        id: "msg-2",
        role: "assistant",
        createdAt: new Date().toISOString(),
        content: [{ type: "text", text: "done" }],
      },
      {
        id: "msg-3",
        role: "user",
        createdAt: new Date().toISOString(),
        content: [{ type: "text", text: "run tests" }],
      },
    ];

    const context: ContextPack = {
      projectIndex: createProjectIndex(),
      projectInstructions: "",
      relevantFiles: [],
      recentChanges: "",
      currentDiff: "",
      previousErrors: "",
      codebaseContext: "RAG context B",
      tokenBudget: { max: 128000, usedEstimate: 100 },
    };

    const build = MessageBuilder.build("System Prompt Base", state, context);

    expect(build.system).toBe("System Prompt Base");
    expect(build.system).not.toContain("RAG context B");
    expect(build.messages.length).toBe(4);
    expect(textAt(build.messages[0])).toBe(
      "decorated user message from Turn 1",
    );
    expect(textAt(build.messages[1])).toBe("done");
    expect(textAt(build.messages[2])).toContain("RAG context B");
    expect(textAt(build.messages[3])).toBe("run tests");

    state.history = build.messages;
    const repeated = MessageBuilder.build("System Prompt Base", state, context);
    expect(repeated.messages).toHaveLength(4);
    expect(repeated.contextMessageAdded).toBe(false);
    expect(repeated.messages).toEqual(build.messages);
  });
});
