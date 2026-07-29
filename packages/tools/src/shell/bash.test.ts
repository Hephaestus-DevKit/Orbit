import { describe, expect, it } from "vitest";
import { BashTool } from "./bash.js";
import { PROCESS_OUTPUT_MAX_BYTES } from "./processLimits.js";

describe("BashTool", () => {
  it("reports a non-zero exit code as a failed tool result", async () => {
    const result = await new BashTool().execute(
      { command: 'node -e "process.exit(7)"' },
      { cwd: process.cwd(), sessionId: "test-session" },
    );

    expect(result.ok).toBe(false);
    expect(result.data?.exitCode).toBe(7);
    expect(result.error).toContain("non-zero status 7");
  });

  it("does not retain unbounded command output in tool data", async () => {
    const result = await new BashTool().execute(
      { command: `node -e "process.stdout.write('x'.repeat(25000))"` },
      { cwd: process.cwd(), sessionId: "test-session" },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.stdout.length).toBeLessThan(25_000);
    expect(result.metadata).toMatchObject({
      truncated: true,
      stdoutChars: 25_000,
    });
  });

  it("fails safely when command output exceeds the process capture limit", async () => {
    const result = await new BashTool().execute(
      {
        command: `node -e "process.stdout.write('x'.repeat(${PROCESS_OUTPUT_MAX_BYTES + 1024}))"`,
      },
      { cwd: process.cwd(), sessionId: "test-session" },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("capture limit");
    expect(result.data?.stdout.length).toBeLessThan(25_000);
    expect(result.metadata).toMatchObject({
      truncated: true,
      outputLimitExceeded: true,
    });
  });

  it("does not report an aborted command as successful", async () => {
    const controller = new AbortController();
    const pending = new BashTool().execute(
      { command: `node -e "setTimeout(() => {}, 10000)"` },
      {
        cwd: process.cwd(),
        sessionId: "test-session",
        abortSignal: controller.signal,
      },
    );

    setTimeout(() => controller.abort(), 50);
    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("interrupted"),
    });
  });
});
