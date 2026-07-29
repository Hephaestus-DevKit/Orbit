import { describe, expect, it } from "vitest";
import { RunTestsTool } from "./runTests.js";
import { PROCESS_OUTPUT_MAX_BYTES } from "./processLimits.js";

describe("RunTestsTool", () => {
  it("fails safely when test output exceeds the process capture limit", async () => {
    const result = await new RunTestsTool().execute(
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

  it("does not report an aborted test command as successful", async () => {
    const controller = new AbortController();
    const pending = new RunTestsTool().execute(
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
