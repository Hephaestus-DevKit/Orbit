import { existsSync, mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@orbit-build/config";
import type { ModelProvider } from "@orbit-build/model-providers";
import type { BackgroundTaskRuntime } from "@orbit-build/tools";
import { AgentLoop } from "./AgentLoop.js";
import { initializeAgentSession } from "./AgentSessionBootstrap.js";
import { ORCHESTRATED_AGENT_SESSION_PATH } from "./AgentSessionBootstrap.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("initializeAgentSession background-task ownership", () => {
  it("records a late completion against the task's original session", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "orbit-bg-session-"));
    workspaces.push(cwd);
    const bootstrap = initializeAgentSession(
      cwd,
      {
        ...DEFAULT_CONFIG,
        security: {
          ...DEFAULT_CONFIG.security,
          encryptCheckpoints: false,
        },
        session: { store: "jsonl", path: ".orbit/test-sessions" },
      },
      provider(),
      "test",
    );
    const originalSessionId = bootstrap.state.sessionId;
    const task = await bootstrap.backgroundTasks.startCommand({
      command: nodeCommand("setInterval(() => {}, 1000)"),
      cwd,
      sessionId: originalSessionId,
    });

    const nextSession = bootstrap.sessionManager.startNewSession(
      "test-provider",
      "test-model",
    );
    await bootstrap.backgroundTasks.killTask(originalSessionId, task.id);

    const store = bootstrap.sessionManager.getSessionStore();
    expect(
      store
        .getEvents(originalSessionId)
        .some((event) => event.type === "background_task_completed"),
    ).toBe(true);
    expect(
      store
        .getEvents(nextSession.id)
        .some((event) => event.type === "background_task_completed"),
    ).toBe(false);
    await bootstrap.backgroundTasks.dispose();
  });

  it("keeps workspace background tasks alive across session switches", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "orbit-bg-switch-"));
    workspaces.push(cwd);
    const config = {
      ...DEFAULT_CONFIG,
      security: {
        ...DEFAULT_CONFIG.security,
        encryptCheckpoints: false,
      },
      session: { store: "jsonl" as const, path: ".orbit/test-sessions" },
    };
    const loop = AgentLoop.initialize(cwd, config, provider(), "test", {
      askApproval: async () => true,
      showText: () => undefined,
      showDiff: () => undefined,
    });
    const runtime = (
      loop as unknown as { backgroundTasks: BackgroundTaskRuntime }
    ).backgroundTasks;
    const originalSessionId = loop.getSessionId();
    const task = await runtime.startCommand({
      command: nodeCommand("setInterval(() => {}, 1000)"),
      cwd,
      sessionId: originalSessionId,
    });

    try {
      const nextSessionId = loop.startNewSession("test-provider", "test-model");
      expect(nextSessionId).not.toBe(originalSessionId);
      expect(runtime.listTasks(originalSessionId)[0]).toMatchObject({
        id: task.id,
        status: "running",
      });
      expect(loop.getBackgroundTasks()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: task.id,
            sessionId: originalSessionId,
            status: "running",
          }),
        ]),
      );
      expect(loop.resumeSession(originalSessionId)).toBe(true);
      await runtime.killTask(originalSessionId, task.id);
    } finally {
      await loop.dispose();
    }
  });

  it("persists an isolated child thread outside its temporary worktree", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "orbit-agent-thread-root-"));
    workspaces.push(cwd);
    const worktree = path.join(cwd, ".orbit", "worktrees", "child");
    mkdirSync(worktree, { recursive: true });
    const loop = AgentLoop.initialize(
      worktree,
      {
        ...DEFAULT_CONFIG,
        security: {
          ...DEFAULT_CONFIG.security,
          encryptCheckpoints: false,
        },
        session: { store: "jsonl", path: ".orbit/chat-sessions" },
      },
      provider(),
      "review the isolated diff",
      {
        askApproval: async () => true,
        showText: () => undefined,
        showDiff: () => undefined,
      },
      {
        agent: { id: "agent_thread-test", role: "reviewer:test" },
        sessionStorage: {
          workspaceRoot: cwd,
          path: ORCHESTRATED_AGENT_SESSION_PATH,
        },
      },
    );

    try {
      const sessionId = loop.getSessionId();
      expect(
        existsSync(path.join(cwd, ORCHESTRATED_AGENT_SESSION_PATH, sessionId)),
      ).toBe(true);
      expect(
        existsSync(path.join(worktree, ".orbit", "chat-sessions", sessionId)),
      ).toBe(false);
      expect(
        existsSync(path.join(cwd, ".orbit", "chat-sessions", sessionId)),
      ).toBe(false);
    } finally {
      await loop.dispose();
    }
  });
});

function provider(): ModelProvider {
  return {
    id: "test-provider",
    type: "openai-compatible",
    capabilities: {
      streaming: true,
      toolCalls: true,
      jsonMode: true,
      thinking: false,
      vision: false,
      promptCaching: false,
    },
    async *chat() {
      yield { type: "done" };
    },
  };
}

function nodeCommand(script: string): string {
  const encoded = Buffer.from(script, "utf8").toString("base64");
  return `"${process.execPath}" -e "eval(Buffer.from('${encoded}','base64').toString())"`;
}
