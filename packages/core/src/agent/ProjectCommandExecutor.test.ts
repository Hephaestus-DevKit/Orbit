import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "@orbit-build/config";
import { PermissionEngine } from "@orbit-build/permissions";
import {
  BackgroundTaskRuntime,
  type BackgroundTaskSnapshot,
} from "@orbit-build/tools";
import { executeProjectCommand } from "./ProjectCommandExecutor.js";

const finished: BackgroundTaskSnapshot = {
  id: "bg_test",
  sessionId: "session-test",
  command: "npm test",
  cwd: process.cwd(),
  status: "completed",
  startedAt: new Date().toISOString(),
  durationMs: 0,
  exitCode: 0,
  stdout: "checked",
  stderr: "",
  outputBytes: 7,
  droppedOutputBytes: 0,
  outputTruncated: false,
};

function setup() {
  const config = structuredClone(DEFAULT_CONFIG);
  config.security.trustProjectExecutables = true;
  const runtime = new BackgroundTaskRuntime({ workspaceRoot: process.cwd() });
  const start = vi.spyOn(runtime, "startCommand").mockResolvedValue(finished);
  const kill = vi
    .spyOn(runtime, "killTask")
    .mockResolvedValue({ ...finished, status: "killed" });
  const interaction = { askApproval: vi.fn(async () => true) };
  return {
    config,
    runtime,
    start,
    kill,
    interaction,
    context: {
      cwd: process.cwd(),
      sessionId: "session-test",
      config,
      runtime,
      interaction,
      permissions: new PermissionEngine(config, process.cwd()),
    },
  };
}

describe("project command execution policy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not execute untrusted project code or ask an unrelated write approval", async () => {
    const { config, context, start, interaction } = setup();
    config.security.trustProjectExecutables = false;
    await expect(
      executeProjectCommand(context, { command: "npm test" }),
    ).rejects.toThrow("trust");
    expect(start).not.toHaveBeenCalled();
    expect(interaction.askApproval).not.toHaveBeenCalled();
  });

  it("requires execution approval and carries sandbox and environment policy", async () => {
    const { context, config, start, interaction } = setup();
    config.tools.bash.sandbox = "required";
    config.tools.bash.network = "deny";
    await expect(
      executeProjectCommand(context, { command: "npm test" }),
    ).resolves.toEqual({ stdout: "checked", stderr: "" });
    expect(interaction.askApproval).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-test",
        notifyOnCompletion: false,
        timeoutMs: config.tools.bash.timeoutMs,
        sandbox: expect.objectContaining({ mode: "required", network: "deny" }),
      }),
    );
  });

  it("does not bypass a disabled shell tool", async () => {
    const { context, config, start, interaction } = setup();
    config.tools.bash.enabled = false;
    await expect(
      executeProjectCommand(context, { command: "npm test" }),
    ).rejects.toThrow("disabled");
    expect(start).not.toHaveBeenCalled();
    expect(interaction.askApproval).not.toHaveBeenCalled();
  });

  it("does not start a process after rejected approval", async () => {
    const { context, start, interaction } = setup();
    interaction.askApproval.mockResolvedValue(false);
    await expect(
      executeProjectCommand(context, { command: "npm test" }),
    ).rejects.toThrow("not approved");
    expect(start).not.toHaveBeenCalled();
  });

  it("honors cancellation while awaiting approval", async () => {
    const { context, start, interaction } = setup();
    const controller = new AbortController();
    interaction.askApproval.mockImplementation(async () => {
      controller.abort();
      return true;
    });
    await expect(
      executeProjectCommand(
        { ...context, signal: controller.signal },
        { command: "npm test" },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(start).not.toHaveBeenCalled();
  });

  it("waits for process-tree termination before reporting cancellation", async () => {
    const { context, start, kill, runtime } = setup();
    const controller = new AbortController();
    start.mockResolvedValue({ ...finished, status: "running", exitCode: null });
    vi.spyOn(runtime, "getTasks").mockImplementation(async () => {
      controller.abort();
      return [{ ...finished, status: "running", exitCode: null }];
    });
    await expect(
      executeProjectCommand(
        { ...context, signal: controller.signal },
        { command: "npm test" },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(kill).toHaveBeenCalledWith("session-test", "bg_test");
  });

  it("never treats timeout as verification success", async () => {
    const { context, start } = setup();
    start.mockResolvedValue({
      ...finished,
      status: "timed_out",
      exitCode: null,
    });
    await expect(
      executeProjectCommand(context, { command: "npm test" }),
    ).rejects.toThrow("timed_out");
  });
});
