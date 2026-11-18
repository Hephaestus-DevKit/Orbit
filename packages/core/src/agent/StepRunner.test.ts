import {
  describe,
  it,
  expect,
  mockTools as vi,
  beforeEach,
  afterEach,
} from "../../../../scripts/testing/support.mjs";
import { StepRunner } from "./StepRunner.js";
import { toolRegistry } from "@orbit-build/tools";
import { ToolRegistry } from "@orbit-build/tools";
import { z } from "zod";

describe("StepRunner Subprocess Timestamps & Limits", () => {
  it("holds exclusive ownership after timeout until the original execution settles", async () => {
    const registry = new ToolRegistry();
    let finish!: () => void;
    const pending = new Promise<{ ok: boolean }>((resolve) => {
      finish = () => resolve({ ok: true });
    });
    const execute = vi.fn(() => pending);
    registry.register({
      name: "write_file",
      description: "slow mutation",
      risk: "write",
      inputSchema: z.object({}),
      execution: {
        version: 2,
        readOnly: false,
        idempotent: true,
        concurrency: "exclusive",
        cancellation: "boundary",
        timeoutMs: 1000,
      },
      execute,
    });
    const runner = new StepRunner(
      process.cwd(),
      "test",
      undefined,
      undefined,
      registry,
    );
    const call = { id: "slow", name: "write_file", arguments: "{}" };
    const first = runner.run(call);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await first).toMatchObject({
      failure: { code: "timeout", retryable: false },
    });
    expect(await runner.run({ ...call, id: "overlap" })).toMatchObject({
      failure: { code: "unavailable" },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(await runner.run({ ...call, id: "after-settlement" })).toMatchObject(
      { ok: true },
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("allows declared parallel readers but holds mutations until cancelled readers settle", async () => {
    const registry = new ToolRegistry();
    let finish!: () => void;
    const pending = new Promise<{ ok: boolean }>((resolve) => {
      finish = () => resolve({ ok: true });
    });
    const write = vi.fn(async () => ({ ok: true }));
    registry.register({
      name: "read_file",
      description: "slow read",
      risk: "read",
      inputSchema: z.object({}),
      execution: {
        version: 2,
        readOnly: true,
        idempotent: true,
        concurrency: "parallel",
        cancellation: "cooperative",
      },
      execute: () => pending,
    });
    registry.register({
      name: "write_file",
      description: "write",
      risk: "write",
      inputSchema: z.object({}),
      execute: write,
    });
    const runner = new StepRunner(
      process.cwd(),
      "test",
      undefined,
      undefined,
      registry,
    );
    const controller = new AbortController();
    const call = { id: "read", name: "read_file", arguments: "{}" };
    const reads = [
      runner.run(call, controller.signal),
      runner.run({ ...call, id: "second" }, controller.signal),
    ];
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(
      (await Promise.all(reads)).every(
        (result) => result.failure?.code === "cancelled",
      ),
    ).toBe(true);
    expect(
      await runner.run({ id: "write", name: "write_file", arguments: "{}" }),
    ).toMatchObject({ failure: { code: "unavailable" } });
    expect(write).not.toHaveBeenCalled();
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(
      await runner.run({ id: "write", name: "write_file", arguments: "{}" }),
    ).toMatchObject({ ok: true });
  });

  it("rejects a tool replaced after approval", async () => {
    const registry = new ToolRegistry();
    const original = {
      name: "read_file",
      description: "original",
      risk: "read" as const,
      inputSchema: z.object({}),
      execute: vi.fn(async () => ({ ok: true })),
    };
    registry.register(original);
    const execute = vi.fn(async () => ({ ok: true }));
    registry.register({ ...original, execute }, { replace: true });
    const result = await new StepRunner(
      process.cwd(),
      "test",
      undefined,
      undefined,
      registry,
    ).run(
      { id: "changed", name: "read_file", arguments: "{}" },
      undefined,
      original,
    );
    expect(result).toMatchObject({
      failure: { code: "unavailable", retryable: false },
    });
    expect(execute).not.toHaveBeenCalled();
  });
  it("does not execute when cancelled between admission and the first microtask", async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({ ok: true }));
    registry.register({
      name: "write_file",
      description: "fixture",
      risk: "write",
      inputSchema: z.object({}),
      execute,
    });
    const controller = new AbortController();
    const result = new StepRunner(
      process.cwd(),
      "test",
      undefined,
      undefined,
      registry,
    ).run(
      { id: "race", name: "write_file", arguments: "{}" },
      controller.signal,
    );
    controller.abort();
    expect(await result).toMatchObject({
      ok: false,
      failure: { code: "cancelled" },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("preserves unknown billing on cancellation without accepting a late success", async () => {
    const registry = new ToolRegistry();
    const controller = new AbortController();
    registry.register({
      name: "web_search",
      description: "billed fixture",
      risk: "network",
      inputSchema: z.object({}),
      execute: async (_input, ctx) => {
        ctx.reportUsage?.({ externalUsageUnknown: true });
        controller.abort();
        return { ok: true, data: "late response" };
      },
    });
    const result = await new StepRunner(
      process.cwd(),
      "test",
      undefined,
      undefined,
      registry,
    ).run(
      { id: "billed", name: "web_search", arguments: "{}" },
      controller.signal,
    );
    expect(result).toMatchObject({
      ok: false,
      failure: { code: "cancelled", retryable: false },
      metadata: { externalUsageUnknown: true },
    });
  });

  it("does not advertise a timed-out mutation as safe to retry", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "write_file",
      description: "non-idempotent fixture",
      risk: "write",
      inputSchema: z.object({}),
      execution: {
        version: 2,
        readOnly: false,
        idempotent: false,
        cancellation: "boundary",
        concurrency: "exclusive",
        timeoutMs: 1000,
      },
      execute: () => new Promise(() => {}),
    });
    const result = new StepRunner(
      process.cwd(),
      "test",
      undefined,
      undefined,
      registry,
    ).run({ id: "timeout", name: "write_file", arguments: "{}" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({
      failure: { code: "timeout", retryable: false },
    });
  });
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not start a tool when its parent operation is already cancelled", async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    vi.spyOn(toolRegistry, "get").mockReturnValue({
      name: "read_file",
      description: "mock read",
      risk: "read",
      inputSchema: { safeParse: () => ({ success: true, data: {} }) },
      execute,
    } as any);
    const controller = new AbortController();
    controller.abort();

    const result = await new StepRunner(process.cwd(), "test-session").run(
      { id: "call-cancelled", name: "read_file", arguments: "{}" },
      controller.signal,
    );

    expect(result).toMatchObject({
      ok: false,
      error: "Tool execution was cancelled before it started.",
      failure: { code: "cancelled", retryable: false },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("should abort tool execution using the configured command timeout", async () => {
    // Mock the registry get to return a dummy execution tool that hangs
    const mockTool = {
      name: "bash",
      description: "mock bash",
      inputSchema: {
        safeParse: () => ({ success: true, data: {} }),
      },
      execute: async (args: any, ctx: any) => {
        return new Promise((resolve, reject) => {
          ctx.abortSignal.addEventListener("abort", () => {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      },
    };

    vi.spyOn(toolRegistry, "get").mockReturnValue(mockTool as any);

    const runner = new StepRunner(process.cwd(), "test-session", {
      tools: { bash: { timeoutMs: 3000 } },
    } as any);

    const runPromise = runner.run({
      id: "call_1",
      name: "bash",
      arguments: "{}",
    });

    vi.advanceTimersByTime(3000);

    const result = await runPromise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out after 3000ms");
  });

  it("caps requested bash timeout to the configured maximum", async () => {
    const mockTool = {
      name: "bash",
      description: "mock bash",
      inputSchema: {
        safeParse: (args: any) => ({ success: true, data: args }),
      },
      execute: async (_args: any, ctx: any) => {
        return new Promise((resolve, reject) => {
          ctx.abortSignal.addEventListener("abort", () => {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      },
    };

    vi.spyOn(toolRegistry, "get").mockReturnValue(mockTool as any);

    const runner = new StepRunner(process.cwd(), "test-session", {
      tools: { bash: { timeoutMs: 5000 } },
    } as any);

    const runPromise = runner.run({
      id: "call_1",
      name: "bash",
      arguments: JSON.stringify({ command: "sleep", timeoutMs: 60000 }),
    });

    vi.advanceTimersByTime(5000);

    const result = await runPromise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out after 5000ms");
  });

  it("returns at the deadline even when an extension ignores cancellation", async () => {
    const execute = vi.fn(() => new Promise(() => undefined));
    vi.spyOn(toolRegistry, "get").mockReturnValue({
      name: "bash",
      description: "non-cooperative extension",
      risk: "execute",
      inputSchema: { safeParse: () => ({ success: true, data: {} }) },
      execute,
    } as any);
    const runner = new StepRunner(process.cwd(), "test-session", {
      tools: { bash: { timeoutMs: 2500 } },
    } as any);

    const runPromise = runner.run({
      id: "call-stuck",
      name: "bash",
      arguments: "{}",
    });
    await vi.advanceTimersByTimeAsync(2500);

    await expect(runPromise).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("timed out after 2500ms"),
    });
  });

  it("does not accept a late success after the user cancels", async () => {
    let resolveTool: ((value: { ok: true }) => void) | undefined;
    vi.spyOn(toolRegistry, "get").mockReturnValue({
      name: "read_file",
      description: "late extension",
      risk: "read",
      inputSchema: { safeParse: () => ({ success: true, data: {} }) },
      execute: () =>
        new Promise<{ ok: true }>((resolve) => {
          resolveTool = resolve;
        }),
    } as any);
    const controller = new AbortController();
    const runPromise = new StepRunner(process.cwd(), "test-session").run(
      { id: "call-late", name: "read_file", arguments: "{}" },
      controller.signal,
    );
    await Promise.resolve();
    controller.abort();
    resolveTool?.({ ok: true });

    await expect(runPromise).resolves.toMatchObject({
      ok: false,
      error: "Tool execution was cancelled by the user.",
      failure: { code: "cancelled", retryable: false },
    });
  });

  it("rejects a successful result that violates its output contract", async () => {
    vi.spyOn(toolRegistry, "get").mockReturnValue({
      name: "contracted_read",
      description: "contracted read",
      risk: "read",
      inputSchema: { safeParse: () => ({ success: true, data: {} }) },
      execution: {
        version: 2,
        readOnly: true,
        idempotent: true,
        concurrency: "parallel",
        cancellation: "boundary",
        outputSchema: {
          safeParse: () => ({
            success: false,
            error: { issues: [{ path: [], message: "Expected string" }] },
          }),
        },
      },
      execute: async () => ({ ok: true, data: 42 }),
    } as any);

    const result = await new StepRunner(process.cwd(), "test-session").run({
      id: "call-invalid-output",
      name: "contracted_read",
      arguments: "{}",
    });

    expect(result).toMatchObject({
      ok: false,
      failure: { code: "invalid_output", retryable: false },
    });
  });

  it("passes named Skill roots only to read tools", async () => {
    const execute = vi.fn(async (_args: unknown, ctx: any) => ({
      ok: true,
      data: ctx.readRoots,
    }));
    vi.spyOn(toolRegistry, "get").mockReturnValue({
      name: "read_file",
      description: "mock read",
      risk: "read",
      inputSchema: { safeParse: () => ({ success: true, data: {} }) },
      execute,
    } as any);
    const runner = new StepRunner(process.cwd(), "test-session");
    runner.setReadRoots([
      { name: "paper-draft", path: "C:/skills/paper-draft" },
    ]);

    const result = await runner.run({
      id: "call-read",
      name: "read_file",
      arguments: "{}",
    });

    expect(result.data).toEqual([
      { name: "paper-draft", path: "C:/skills/paper-draft" },
    ]);
  });
});
