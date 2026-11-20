import {
  mockModule,
  describe,
  it,
  expect,
  mockTools as vi,
  beforeEach,
  afterEach,
} from "../../../../scripts/testing/support.mjs";

const preparedTurns: string[] = [];
const runLimits: number[] = [];

// Mock AgentLoop to avoid actual provider calls
await mockModule(import.meta.resolve("@orbit-build/core"), async (importOriginal) => {
  const actual = await importOriginal<typeof import("@orbit-build/core")>();

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

    prepareUserTurn(prompt: string) {
      preparedTurns.push(prompt);
    }

    async run() {
      runLimits.push(this.config.agent.maxIterations);
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

const { exitCodeForOutcome, runAgent } = await import("./run.js");
const { eventBus } = await import("@orbit-build/core");
const { ConfigLoader } = await import("@orbit-build/config");
const { default: fs } = await import("fs");
const { default: path } = await import("path");
const { tmpdir } = await import("os");
const { ProjectRegistry } = await import("@orbit-build/session");

describe("non-interactive orbit exec tests", () => {
  let cwd: string;

  beforeEach(() => {
    preparedTurns.length = 0;
    runLimits.length = 0;
    cwd = path.join(tmpdir(), `orbit-exec-test-${Date.now()}`);
    fs.mkdirSync(cwd, { recursive: true });
    vi.spyOn(ProjectRegistry.prototype, "register").mockReturnValue(
      {} as never,
    );

    vi.spyOn(ConfigLoader, "loadSync").mockImplementation(() => ({
      name: "test",
      agent: { maxIterations: 4 },
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
    } as any));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(cwd)) {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("adds the requested follow-up to restored history and honors the stricter run limit", async () => {
    for (const maxTurns of [2, 8]) {
      const result = await runAgent(cwd, "new instruction", {}, false, {
        nonInteractive: true,
        resumeSessionId: "sess_test-test-001",
        maxTurns,
      });
      expect(result?.status).toBe("completed");
    }
    expect(preparedTurns).toEqual(["new instruction", "new instruction"]);
    expect(runLimits).toEqual([2, 4]);
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
