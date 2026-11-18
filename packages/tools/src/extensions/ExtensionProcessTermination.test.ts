import { mockModule,  afterEach, expect, it, mockTools as vi } from "../../../../scripts/testing/support.mjs";






import type { ChildProcess } from "child_process";



await mockModule(import.meta.resolve("child_process"), async (loadOriginal) => ({
  ...(await loadOriginal()), spawn: vi.fn() }));
await mockModule(import.meta.resolve("../runtime/BackgroundTaskRuntime.js"), async (loadOriginal) => ({
  ...(await loadOriginal()),
  signalProcessTree: vi.fn(async () => undefined),
}));
await mockModule(import.meta.resolve("@orbit-build/sandbox"), async (loadOriginal) => ({
  ...(await loadOriginal()),
  sandboxInvocation: (invocation: unknown) => invocation,
}));

const { EventEmitter } = await import("events");
const { PassThrough } = await import("stream");
const { mkdtempSync, writeFileSync, rmSync } = await import("fs");
const { join } = await import("path");
const { tmpdir } = await import("os");
const { spawn } = await import("child_process");
const { signalProcessTree } = await import("../runtime/BackgroundTaskRuntime.js");
const { ExtensionProcessTool } = await import("./ExtensionProcessTool.js");
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
