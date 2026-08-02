import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StepRunner } from "./StepRunner.js";
import { toolRegistry } from "@orbit-build/tools";

describe("StepRunner Subprocess Timestamps & Limits", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
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

    expect(result).toEqual({
      ok: false,
      error: "Tool execution was cancelled before it started.",
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
