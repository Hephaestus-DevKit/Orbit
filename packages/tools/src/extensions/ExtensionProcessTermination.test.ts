import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import { signalProcessTree } from "../runtime/BackgroundTaskRuntime.js";
import { ExtensionProcessTool } from "./ExtensionProcessTool.js";

vi.mock("child_process", () => ({ spawn: vi.fn() }));
vi.mock("../runtime/BackgroundTaskRuntime.js", () => ({
  signalProcessTree: vi.fn(async () => undefined),
}));
vi.mock("@orbit-build/sandbox", () => ({
  sandboxInvocation: (invocation: unknown) => invocation,
}));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("keeps execution pending past the termination deadline until actual process exit", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "orbit-extension-termination-"));
  writeFileSync(join(cwd, "tool.mjs"), "");
  const child = Object.assign(new EventEmitter(), {
    pid: 12345,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
  vi.useFakeTimers();
  const controller = new AbortController();
  const tool = new ExtensionProcessTool({
    extensionId: "test.ext",
    extensionRoot: cwd,
    contributionName: "test",
    runtimeName: "ext_test",
    risk: "read",
    filesystem: [],
    definition: {
      schemaVersion: 1,
      description: "test",
      runtime: "node",
      entrypoint: "tool.mjs",
      args: [],
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      timeoutMs: 1000,
      maxOutputBytes: 4096,
    },
  });
  let settled = false;
  const result = tool
    .execute({}, { cwd, sessionId: "test", abortSignal: controller.signal })
    .then((value) => {
      settled = true;
      return value;
    });
  try {
    controller.abort();
    await vi.advanceTimersByTimeAsync(6000);
    expect(signalProcessTree).toHaveBeenCalledWith(child, true);
    expect(settled).toBe(false);
    child.emit("close", null, "SIGKILL");
    await expect(result).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("cancelled"),
    });
  } finally {
    child.emit("close", null, "SIGKILL");
    await result;
    rmSync(cwd, { recursive: true, force: true });
  }
});
