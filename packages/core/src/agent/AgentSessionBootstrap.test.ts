import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "@orbit-build/config";
import type { ModelProvider } from "@orbit-build/model-providers";
import type { BackgroundTaskRuntime } from "@orbit-build/tools";
import type { CheckpointManager } from "@orbit-build/sandbox";
import type { VerificationContractManager } from "../verification/VerificationContractManager.js";
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
  it("persists a new task as the session goal without replacing a resumed goal", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "orbit-session-goal-"));
    workspaces.push(cwd);
    const config = {
      ...DEFAULT_CONFIG,
      security: {
        ...DEFAULT_CONFIG.security,
        encryptCheckpoints: false,
      },
      session: { store: "jsonl" as const, path: ".orbit/test-sessions" },
    };
    const initial = initializeAgentSession(
      cwd,
      config,
      provider(),
      "  Deliver the release with verification.  ",
    );
    const sessionId = initial.state.sessionId;

    expect(initial.sessionManager.getActiveSession()?.goal).toBe(
      "Deliver the release with verification.",
    );
    initial.sessionManager.setGoal("Preserve this durable objective.");
    await initial.backgroundTasks.dispose();

    const resumed = initializeAgentSession(
      cwd,
      config,
      provider(),
      "This resume prompt must not replace the goal.",
      { sessionId, requireSession: true },
    );
    expect(resumed.sessionManager.getActiveSession()?.goal).toBe(
      "Preserve this durable objective.",
    );
    await resumed.backgroundTasks.dispose();
  });

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
      command: nodeCommand("setTimeout(() => {}, 500)"),
      cwd,
      sessionId: originalSessionId,
    });

    const nextSession = bootstrap.sessionManager.startNewSession(
      "test-provider",
      "test-model",
    );
    const [completed] = await bootstrap.backgroundTasks.getTasks(
      originalSessionId,
      { taskIds: [task.id], waitMs: 5_000, waitFor: "all" },
    );
    expect(completed.status).toBe("completed");

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
      command: nodeCommand("setTimeout(() => {}, 1500)"),
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
      const [completed] = await runtime.getTasks(originalSessionId, {
        taskIds: [task.id],
        waitMs: 5_000,
        waitFor: "all",
      });
      expect(completed.status).toBe("completed");
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

  it("preserves encrypted checkpoint policy across new and resumed sessions", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "orbit-checkpoint-switch-"));
    workspaces.push(cwd);
    const key = Buffer.alloc(32, 19);
    const loop = AgentLoop.initialize(
      cwd,
      {
        ...DEFAULT_CONFIG,
        agent: { maxIterations: 7 },
        security: { ...DEFAULT_CONFIG.security, encryptCheckpoints: true },
        session: { store: "jsonl", path: ".orbit/test-sessions" },
      },
      provider(),
      "test",
      {
        askApproval: async () => true,
        showText: () => undefined,
        showDiff: () => undefined,
      },
      { checkpointKeyProvider: () => key },
    );
    const manager = () =>
      (loop as unknown as { checkpointManager: CheckpointManager })
        .checkpointManager;
    const runtimeState = () =>
      loop as unknown as {
        state: { maxAttempts: number };
        verificationManager: VerificationContractManager & {
          sessionId: string;
          checkpointManager: CheckpointManager;
        };
      };
    const originalSessionId = loop.getSessionId();
    writeFileSync(path.join(cwd, "secret.txt"), "first-secret", "utf8");
    const first = await manager().captureBeforeState(
      "call-first",
      "secret.txt",
    );

    const nextSessionId = loop.startNewSession("test-provider", "test-model");
    expect(runtimeState().state.maxAttempts).toBe(7);
    expect(runtimeState().verificationManager.sessionId).toBe(nextSessionId);
    expect(runtimeState().verificationManager.checkpointManager).toBe(
      manager(),
    );
    writeFileSync(path.join(cwd, "secret.txt"), "second-secret", "utf8");
    const second = await manager().captureBeforeState(
      "call-second",
      "secret.txt",
    );
    expectEncryptedCheckpoint(cwd, originalSessionId, first.id);
    expectEncryptedCheckpoint(cwd, nextSessionId, second.id);

    expect(loop.resumeSession(originalSessionId)).toBe(true);
    expect(runtimeState().state.maxAttempts).toBe(7);
    expect(runtimeState().verificationManager.sessionId).toBe(
      originalSessionId,
    );
    expect(runtimeState().verificationManager.checkpointManager).toBe(
      manager(),
    );
    expect(manager().getCheckpoints()[0]?.backups[0]?.originalContent).toBe(
      "first-secret",
    );
    await loop.dispose();
  });

  it("initializes MCP once for the whole loop lifetime", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "orbit-mcp-lifetime-"));
    workspaces.push(cwd);
    const loop = AgentLoop.initialize(
      cwd,
      {
        ...DEFAULT_CONFIG,
        tools: {
          ...DEFAULT_CONFIG.tools,
          mcp: { enabled: true },
        },
        mcpServers: {
          docs: {
            transport: "stdio",
            command: "unused-in-test",
            args: [],
            env: {},
            inheritEnv: [],
          },
        },
      },
      provider(),
      "test",
      {
        askApproval: async () => true,
        showText: () => undefined,
        showDiff: () => undefined,
      },
    );
    const start = vi.fn(async () => ({
      startedServers: 1,
      registeredTools: 2,
      failures: [],
    }));
    const stop = vi.fn(async () => undefined);
    (
      loop as unknown as {
        mcpRuntimeManager: {
          start: typeof start;
          stop: typeof stop;
        };
      }
    ).mcpRuntimeManager = { start, stop };

    await expect(loop.initializeMcp()).resolves.toMatchObject({
      startedServers: 1,
    });
    await expect(loop.initializeMcp()).resolves.toMatchObject({
      startedServers: 1,
    });
    expect(start).toHaveBeenCalledOnce();
    await loop.dispose();
    expect(stop).toHaveBeenCalledOnce();
  });
});

function expectEncryptedCheckpoint(
  cwd: string,
  sessionId: string,
  checkpointId: string,
): void {
  const files = readdirSync(
    path.join(cwd, ".orbit", "checkpoints", sessionId, checkpointId),
  );
  expect(files).toContain("backup_content.enc");
  expect(files).not.toContain("backup_content.txt");
}

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
