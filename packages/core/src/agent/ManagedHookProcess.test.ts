import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BackgroundTaskRuntime,
  type BackgroundTaskSnapshot,
} from "@orbit-build/tools";
import { executeManagedHookProcess } from "./ManagedHookProcess.js";

const request = { command: "hook", cwd: process.cwd(), sessionId: "session" };
const running: BackgroundTaskSnapshot = {
  ...request,
  id: "bg_hook",
  status: "running",
  startedAt: new Date().toISOString(),
  durationMs: 0,
  exitCode: null,
  stdout: "",
  stderr: "",
  outputBytes: 0,
  droppedOutputBytes: 0,
  outputTruncated: false,
};
afterEach(() => {
  vi.restoreAllMocks();
});

describe("managed hook process", () => {
  it("does not start after cancellation during approval", async () => {
    const start = vi.spyOn(BackgroundTaskRuntime.prototype, "startCommand");
    await expect(
      executeManagedHookProcess(request, AbortSignal.abort()),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(start).not.toHaveBeenCalled();
  });
  it("waits for tree cleanup before rejecting an aborted hook", async () => {
    const controller = new AbortController();
    vi.spyOn(BackgroundTaskRuntime.prototype, "startCommand").mockResolvedValue(
      running,
    );
    vi.spyOn(BackgroundTaskRuntime.prototype, "getTasks").mockImplementation(
      async () => {
        controller.abort();
        throw controller.signal.reason;
      },
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const kill = vi
      .spyOn(BackgroundTaskRuntime.prototype, "killTask")
      .mockImplementation(async () => {
        await gate;
        return { ...running, status: "killed" };
      });
    const dispose = vi
      .spyOn(BackgroundTaskRuntime.prototype, "dispose")
      .mockResolvedValue();
    let settled = false;
    const result = executeManagedHookProcess(request, controller.signal).catch(
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    await vi.waitFor(() => expect(kill).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    release();
    expect(await result).toMatchObject({ name: "AbortError" });
    expect(dispose).toHaveBeenCalledOnce();
  });
  it("does not treat timeout as success", async () => {
    vi.spyOn(BackgroundTaskRuntime.prototype, "startCommand").mockResolvedValue(
      { ...running, status: "timed_out" },
    );
    await expect(executeManagedHookProcess(request)).rejects.toThrow(
      "timed_out",
    );
  });
});
