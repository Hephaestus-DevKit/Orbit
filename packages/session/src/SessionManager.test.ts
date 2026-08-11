import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { SessionManager } from "./SessionManager.js";
import { ToolCallRecordSchema } from "./types.js";

const StoredToolInputSchema = z.object({
  id: z.string(),
  arguments: z.string(),
  authorization: z.string(),
  self: z.string(),
});

const StoredToolOutputSchema = z.object({
  password: z.string(),
  apiKey: z.string(),
  outputTokens: z.number(),
  rawKey: z.string(),
});

describe("SessionManager audit persistence", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "orbit-session-manager-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("persists the chat goal and title across resume", () => {
    const manager = new SessionManager(tempDir);
    const session = manager.startNewSession("deepseek", "deepseek-v4-flash");

    manager.setGoal("Prepare the commercial release");
    manager.setTitle("Release readiness");

    const resumed = new SessionManager(tempDir);
    expect(resumed.resumeSession(session.id)).toMatchObject({
      goal: "Prepare the commercial release",
      title: "Release readiness",
    });
  });

  it("does not report the previous active session when resume fails", () => {
    const manager = new SessionManager(tempDir);
    const active = manager.startNewSession("deepseek", "deepseek-v4-flash");

    expect(manager.resumeSession("sess_missing-session-123")).toBeUndefined();
    expect(manager.getActiveSession()).toEqual(active);
  });

  it("marks an unfinished run as interrupted when the session resumes", () => {
    const manager = new SessionManager(tempDir);
    const session = manager.startNewSession("deepseek", "deepseek-v4-pro");
    const startedAt = new Date().toISOString();
    manager.saveHistory([
      {
        id: "msg-user-recovery",
        role: "user",
        createdAt: startedAt,
        content: [{ type: "text", text: "edit the project" }],
      },
      {
        id: "msg-assistant-recovery",
        role: "assistant",
        createdAt: startedAt,
        content: [
          {
            type: "tool_call",
            toolCall: {
              id: "tc-shell",
              name: "bash",
              arguments: '{"command":"build"}',
            },
          },
        ],
      },
    ]);
    manager.saveTaskPlan([
      {
        id: "step_running",
        text: "Run the build",
        status: "in_progress",
        createdAt: startedAt,
        updatedAt: startedAt,
      },
    ]);
    manager.setRunState("awaiting_approval", "tool:bash", {
      attempt: 3,
      activeToolCallId: "tc-shell",
    });

    const resumed = new SessionManager(tempDir);
    resumed.resumeSession(session.id);

    expect(resumed.getRunJournal()).toMatchObject({
      state: "interrupted",
      attempt: 3,
      recoveryCount: 1,
    });
    expect(resumed.getRunJournal()?.activeToolCallId).toBeUndefined();
    expect(resumed.getRunJournal()?.phase).toContain("tool:bash");
    expect(resumed.getRecoveryReport()).toMatchObject({
      previousState: "awaiting_approval",
      previousPhase: "tool:bash",
      repairedToolCalls: 1,
      resetPlanItems: 1,
    });
    expect(resumed.getTaskPlan()?.items[0]?.status).toBe("pending");
    const recoveryMessage = resumed.getHistory().at(-1);
    expect(recoveryMessage).toMatchObject({
      role: "tool",
      metadata: { kind: "crash_recovery" },
    });
    expect(recoveryMessage?.content[0]).toMatchObject({
      type: "tool_result",
      toolResult: {
        toolCallId: "tc-shell",
        name: "bash",
        isError: true,
      },
    });
  });

  it("does not duplicate completed tool results during recovery", () => {
    const manager = new SessionManager(tempDir);
    const session = manager.startNewSession("deepseek", "deepseek-v4-pro");
    const createdAt = new Date().toISOString();
    manager.saveHistory([
      {
        id: "msg-assistant-complete",
        role: "assistant",
        createdAt,
        content: [
          {
            type: "tool_call",
            toolCall: { id: "tc-read", name: "read_file", arguments: "{}" },
          },
        ],
      },
      {
        id: "msg-tool-complete",
        role: "tool",
        createdAt,
        content: [
          {
            type: "tool_result",
            toolResult: {
              toolCallId: "tc-read",
              name: "read_file",
              content: "done",
            },
          },
        ],
      },
    ]);
    manager.setRunState("running", "model_request", { attempt: 2 });

    const resumed = new SessionManager(tempDir);
    resumed.resumeSession(session.id);

    expect(resumed.getRecoveryReport()?.repairedToolCalls).toBe(0);
    expect(resumed.getHistory()).toHaveLength(2);
  });

  it("keeps each chat task plan isolated and recoverable", () => {
    const manager = new SessionManager(tempDir);
    const first = manager.startNewSession("deepseek", "deepseek-v4-flash");
    const now = new Date().toISOString();
    manager.saveTaskPlan([
      {
        id: "step_verify",
        text: "Verify the release",
        status: "in_progress",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const second = manager.startNewSession("deepseek", "deepseek-v4-flash");
    expect(manager.getTaskPlan()).toBeUndefined();

    const resumed = new SessionManager(tempDir);
    resumed.resumeSession(first.id);
    expect(resumed.getTaskPlan()?.items[0]).toMatchObject({
      id: "step_verify",
      status: "in_progress",
    });
    resumed.resumeSession(second.id);
    expect(resumed.getTaskPlan()).toBeUndefined();
  });

  it("updates runtime metadata without replacing the session history", () => {
    const manager = new SessionManager(tempDir);
    const session = manager.startNewSession("tokendance", "deepseek-v4-pro");
    const history = [
      {
        id: "msg-1",
        role: "user",
        createdAt: new Date().toISOString(),
        content: [{ type: "text", text: "keep this context" }],
      },
    ];
    manager.saveHistory(history);

    manager.setRuntime("ollama", "qwen2.5-coder:7b");

    expect(manager.getActiveSession()).toMatchObject({
      id: session.id,
      provider: "ollama",
      model: "qwen2.5-coder:7b",
    });
    expect(manager.getHistory()).toEqual(history);
    expect(manager.getSessionStore().getSession(session.id)).toMatchObject({
      provider: "ollama",
      model: "qwen2.5-coder:7b",
    });
  });

  it("redacts structured, nested, and free-form credentials", () => {
    const manager = new SessionManager(tempDir);
    const session = manager.startNewSession("deepseek", "deepseek-v4-flash");
    const standardKey = `sk-${"a".repeat(32)}`;
    const input: Record<string, unknown> = {
      id: "tc_safe",
      arguments: JSON.stringify({
        apiKey: "plain-nested-key",
        maxTokens: 64,
      }),
      authorization: "Bearer top-secret-token",
    };
    input.self = input;

    manager.recordToolExecution(
      "shell",
      input,
      {
        password: "plain-password",
        apiKey: "plain-api-key",
        outputTokens: 42,
        rawKey: standardKey,
      },
      "write",
      "allow",
      "success",
      {
        startedAt: "2026-07-22T00:00:00.000Z",
        endedAt: "2026-07-22T00:00:01.250Z",
      },
    );
    manager.recordFileModification(
      "src/config.ts",
      `+ API_KEY=plain-file-key\n+ key=${standardKey}`,
    );
    manager.logEvent("credential_test", {
      password: "plain-event-password",
      inputTokens: 12,
    });

    const sessionDir = join(tempDir, ".orbit", "sessions", session.id);
    const toolLog = readFileSync(join(sessionDir, "tool_calls.jsonl"), "utf8");
    expect(toolLog).not.toContain("plain-nested-key");
    expect(toolLog).not.toContain("top-secret-token");
    expect(toolLog).not.toContain("plain-password");
    expect(toolLog).not.toContain("plain-api-key");
    expect(toolLog).not.toContain(standardKey);

    const record = ToolCallRecordSchema.parse(
      JSON.parse(toolLog.trim()) as unknown,
    );
    expect(record.id).toBe("tc_safe");
    expect(record.startedAt).toBe("2026-07-22T00:00:00.000Z");
    expect(record.endedAt).toBe("2026-07-22T00:00:01.250Z");
    const storedInput = StoredToolInputSchema.parse(
      JSON.parse(record.inputJson) as unknown,
    );
    expect(storedInput.authorization).toBe("[REDACTED]");
    expect(storedInput.self).toBe("[Circular]");
    expect(
      z
        .object({ apiKey: z.string(), maxTokens: z.number() })
        .parse(JSON.parse(storedInput.arguments) as unknown),
    ).toEqual({ apiKey: "[REDACTED]", maxTokens: 64 });

    const storedOutput = StoredToolOutputSchema.parse(
      JSON.parse(record.outputJson ?? "null") as unknown,
    );
    expect(storedOutput).toEqual({
      password: "[REDACTED]",
      apiKey: "[REDACTED]",
      outputTokens: 42,
      rawKey: "sk-***REDACTED***",
    });

    const fileLog = readFileSync(
      join(sessionDir, "file_changes.jsonl"),
      "utf8",
    );
    expect(fileLog).not.toContain("plain-file-key");
    expect(fileLog).not.toContain(standardKey);
    expect(fileLog).toContain("[REDACTED]");

    const credentialEvent = manager
      .getSessionStore()
      .getEvents(session.id)
      .find((event) => event.type === "credential_test");
    expect(credentialEvent?.payload).toEqual({
      password: "[REDACTED]",
      inputTokens: 12,
    });
  });

  it("handles hostile tool inputs without losing the audit record", () => {
    const manager = new SessionManager(tempDir);
    const session = manager.startNewSession("deepseek", "deepseek-v4-flash");
    const hostileInput = new Proxy(
      {},
      {
        has: () => {
          throw new Error("hostile proxy");
        },
        ownKeys: () => {
          throw new Error("hostile proxy");
        },
      },
    );

    expect(() =>
      manager.recordToolExecution(
        "shell",
        hostileInput,
        undefined,
        "read",
        "allow",
        "success",
      ),
    ).not.toThrow();

    const toolLog = readFileSync(
      join(tempDir, ".orbit", "sessions", session.id, "tool_calls.jsonl"),
      "utf8",
    );
    const record = ToolCallRecordSchema.parse(
      JSON.parse(toolLog.trim()) as unknown,
    );
    expect(record.id).toBe("tc_unknown");
    expect(JSON.parse(record.inputJson) as unknown).toBe(
      "[Unserializable object]",
    );
    expect(JSON.parse(record.outputJson ?? "null") as unknown).toBe(
      "[Undefined]",
    );
  });

  it("persists terminal status and reactivates a resumed session", () => {
    const manager = new SessionManager(tempDir);
    const session = manager.startNewSession("deepseek", "deepseek-v4-flash");

    manager.setStatus("completed");
    expect(manager.getSessionStore().getSession(session.id)?.status).toBe(
      "completed",
    );

    const resumedManager = new SessionManager(tempDir);
    expect(resumedManager.resumeSession(session.id)?.status).toBe("active");
    expect(
      resumedManager.getSessionStore().getSession(session.id)?.status,
    ).toBe("active");
  });

  it("queues, edits, reorders, consumes, removes, and clears user inputs durably", () => {
    const manager = new SessionManager(tempDir);
    const session = manager.startNewSession("deepseek", "deepseek-v4-flash");
    const createdAt = new Date().toISOString();
    manager.enqueueAgentInput({
      id: "input_steer_1",
      mode: "steer",
      source: "terminal",
      text: "Do not change the public API.",
      attachments: [],
      createdAt,
    });
    manager.enqueueAgentInput({
      id: "input_follow_up_1",
      mode: "follow_up",
      source: "web",
      text: "Run the whole test suite.",
      attachments: [],
      createdAt,
    });

    const resumed = new SessionManager(tempDir);
    resumed.resumeSession(session.id);
    expect(resumed.getAgentInputQueue()?.items).toHaveLength(2);
    expect(
      resumed.updateAgentInput("input_follow_up_1", {
        text: "Run focused tests first.",
        mode: "steer",
      }),
    ).toMatchObject({
      text: "Run focused tests first.",
      mode: "steer",
      source: "web",
    });
    expect(resumed.moveAgentInput("input_follow_up_1", "up")).toMatchObject({
      fromIndex: 1,
      toIndex: 0,
    });
    expect(resumed.getAgentInputQueue()?.items.map((item) => item.id)).toEqual([
      "input_follow_up_1",
      "input_steer_1",
    ]);
    expect(resumed.moveAgentInput("input_follow_up_1", "up")).toBeUndefined();
    expect(() =>
      resumed.updateAgentInput("input_follow_up_1", { text: "   " }),
    ).toThrow();
    expect(resumed.takeAgentInput("steer")?.id).toBe("input_follow_up_1");
    expect(resumed.removeAgentInput("input_steer_1")).toBe(true);
    expect(resumed.clearAgentInputQueue()).toBe(0);
    expect(resumed.getAgentInputQueue()?.items).toEqual([]);
  });

  it("honors a workspace-safe custom session root", () => {
    const manager = new SessionManager(tempDir, ".orbit/custom-sessions");
    const session = manager.startNewSession("deepseek", "deepseek-v4-flash");

    expect(
      existsSync(
        join(tempDir, ".orbit", "custom-sessions", session.id, "session.json"),
      ),
    ).toBe(true);
  });
});
