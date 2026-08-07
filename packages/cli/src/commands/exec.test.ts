import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exitCodeForOutcome, runAgent } from "./run.js";
import { eventBus } from "@orbit-build/core";
import { ConfigLoader } from "@orbit-build/config";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { ProjectRegistry } from "@orbit-build/session";

// Mock AgentLoop to avoid actual provider calls
vi.mock("@orbit-build/core", async () => {
  const actual =
    await vi.importActual<typeof import("@orbit-build/core")>(
      "@orbit-build/core",
    );

  class MockAgentLoop {
    static initialize(
      cwd: string,
      config: any,
      provider: any,
      task: string,
      interaction: any,
    ) {
      return new MockAgentLoop(cwd, config, provider, task, interaction);
    }

    constructor(
      private cwd: string,
      private config: any,
      private provider: any,
      private task: string,
      private interaction: any,
    ) {}

    async run() {
      // Simulate calling interaction.askApproval to test non-interactive auto-deny
      const approved = await this.interaction.askApproval(
        "Should write file?",
        "some-args",
      );
      this.interaction.showText(`Approved: ${approved}`);

      // Simulate emitting an event
      eventBus.emitEvent("info", { message: "Test info message" });
      eventBus.emitEvent("model_request", {
        model: "test-model",
        messages: [
          { role: "user", content: "sk-secret-value-that-must-not-log" },
        ],
      });
      return {
        status: "completed" as const,
        sessionId: "sess_test-test-001",
        attempts: 1,
      };
    }

    async dispose() {}
  }

  return {
    ...actual,
    AgentLoop: MockAgentLoop,
  };
});

describe("non-interactive orbit exec tests", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = path.join(tmpdir(), `orbit-exec-test-${Date.now()}`);
    fs.mkdirSync(cwd, { recursive: true });
    vi.spyOn(ProjectRegistry.prototype, "register").mockReturnValue(
      {} as never,
    );

    vi.spyOn(ConfigLoader, "loadSync").mockReturnValue({
      name: "test",
      provider: { default: "test-provider" },
      models: { default: "test-model" },
      providers: { "test-provider": { type: "openai", apiKey: "test-key" } },
      permissions: { mode: "interactive" },
      tools: {
        bash: { enabled: false },
        webSearch: { enabled: false },
        mcp: { enabled: false },
      },
      mcpServers: {},
      hooks: {},
      session: { store: "jsonl" },
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(cwd)) {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("should auto-deny approvals and write to stderr in non-interactive mode", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await runAgent(cwd, "test task", {}, false, { nonInteractive: true });

    // Expect showText and askApproval logs to go to stderr
    expect(consoleErrorSpy).toHaveBeenCalled();
    const calls = consoleErrorSpy.mock.calls.map((c) => c.join(" "));
    expect(calls.some((c) => c.includes("Automatically denying action"))).toBe(
      true,
    );
    expect(calls.some((c) => c.includes("Approved: false"))).toBe(true);
  });

  it("should stream events as JSONL to stdout in jsonl mode", async () => {
    const logOutput: string[] = [];
    const origLog = console.log;
    const origError = console.error;

    // We capture stdout log calls
    console.log = (msg: string) => {
      logOutput.push(msg);
    };
    console.error = () => {};
    const listenerCountBefore = eventBus.listenerCount("*");

    try {
      await runAgent(cwd, "test task", {}, false, {
        nonInteractive: true,
        jsonl: true,
      });
    } finally {
      console.log = origLog;
      console.error = origError;
    }

    // Check if the JSONL event was printed to stdout
    expect(logOutput.length).toBeGreaterThan(0);
    const parsedEvents = logOutput.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    });

    const infoEvent = parsedEvents.find((e) => e && e.type === "info");
    expect(infoEvent).toBeDefined();
    expect(infoEvent.schemaVersion).toBe(1);
    expect(infoEvent.sequence).toBeGreaterThan(0);
    expect(infoEvent.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(infoEvent.eventId).toEqual(expect.any(String));
    expect(infoEvent.payload.message).toBe("Test info message");
    const modelRequest = parsedEvents.find(
      (event) => event?.type === "model_request",
    );
    expect(modelRequest.payload).toEqual({ model: "test-model" });
    expect(modelRequest.eventId).toEqual(expect.any(String));
    expect(eventBus.listenerCount("*")).toBe(listenerCountBefore);
  });

  it("maps structured outcomes to stable process exit codes", () => {
    expect(exitCodeForOutcome(undefined)).toBe(0);
    expect(
      exitCodeForOutcome({
        status: "completed",
        sessionId: "sess_test-test-001",
        attempts: 1,
      }),
    ).toBe(0);
    expect(
      exitCodeForOutcome({
        status: "failed",
        sessionId: "",
        attempts: 0,
        error: { code: "provider_error", message: "Unavailable" },
      }),
    ).toBe(4);
    expect(
      exitCodeForOutcome({
        status: "failed",
        sessionId: "sess_test-test-001",
        attempts: 1,
        error: { code: "verification_failed", message: "Tests failed" },
      }),
    ).toBe(2);
    expect(
      exitCodeForOutcome({
        status: "aborted",
        sessionId: "sess_test-test-001",
        attempts: 1,
        reason: "interrupted",
        message: "Stopped",
      }),
    ).toBe(130);
    expect(
      exitCodeForOutcome({
        status: "aborted",
        sessionId: "sess_test-test-001",
        attempts: 64,
        reason: "iteration_limit",
        message: "Paused",
      }),
    ).toBe(130);
  });
});
