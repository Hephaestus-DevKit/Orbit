import { describe, expect, it } from "vitest";
import { BashTool } from "./bash.js";
import { PROCESS_OUTPUT_MAX_BYTES } from "./processLimits.js";
import { BackgroundTaskRuntime } from "../runtime/BackgroundTaskRuntime.js";
import { applyPermissionModePreset, ConfigSchema } from "@orbit-build/config";

describe("BashTool", () => {
  it("supports native-shell command execution on every platform", async () => {
    const result = await new BashTool().execute(
      { command: nodeCommand("console.log('first'); console.log('second')") },
      { cwd: process.cwd(), sessionId: "test-session" },
    );

    expect(result).toMatchObject({
      ok: true,
      data: { stdout: "first\nsecond", exitCode: 0 },
    });
  });

  it("reports a non-zero exit code as a failed tool result", async () => {
    const result = await new BashTool().execute(
      { command: 'node -e "process.exit(7)"' },
      { cwd: process.cwd(), sessionId: "test-session" },
    );

    expect(result.ok).toBe(false);
    expect(result.data?.exitCode).toBe(7);
    expect(result.error).toContain("non-zero status 7");
  });

  it("retains actionable stdout and stderr when a command fails", async () => {
    const result = await new BashTool().execute(
      {
        command: nodeCommand(
          "console.log('preflight'); console.error('assertion failed'); process.exit(3)",
        ),
      },
      { cwd: process.cwd(), sessionId: "test-session" },
    );

    expect(result).toMatchObject({
      ok: false,
      data: {
        stdout: "preflight",
        stderr: "assertion failed",
        exitCode: 3,
      },
    });
    expect(result.display).toContain("Stdout:\npreflight");
    expect(result.display).toContain("Stderr:\nassertion failed");
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

  it("inherits the complete host environment only under Full Access", async () => {
    const variable = "ORBIT_FULL_ACCESS_TEST_API_KEY";
    process.env[variable] = "test-only-secret";
    const command = nodeCommand(
      `console.log(process.env.${variable} ? 'present' : 'missing')`,
    );
    try {
      const normal = await new BashTool().execute(
        { command },
        { cwd: process.cwd(), sessionId: "normal" },
      );
      expect(normal.data?.stdout).toBe("missing");

      const config = ConfigSchema.parse({});
      applyPermissionModePreset(config, "auto");
      const fullAccess = await new BashTool().execute(
        { command },
        { cwd: process.cwd(), sessionId: "full", config },
      );
      expect(fullAccess.data?.stdout).toBe("present");
      expect(fullAccess.metadata).toMatchObject({
        sandboxBackend: "none",
        sandboxDegraded: false,
      });
    } finally {
      delete process.env[variable];
    }
  });

  it("starts an explicit background command through the shared runtime", async () => {
    const runtime = new BackgroundTaskRuntime({
      workspaceRoot: process.cwd(),
    });
    try {
      const result = await new BashTool().execute(
        {
          command: `node -e "setTimeout(() => console.log('done'), 50)"`,
          background: true,
        },
        {
          cwd: process.cwd(),
          sessionId: "test-session",
          services: { backgroundTasks: runtime },
        },
      );

      expect(result).toMatchObject({
        ok: true,
        data: {
          exitCode: null,
          status: "running",
          taskId: expect.stringMatching(/^bg_/),
        },
        metadata: { background: true },
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("preserves Full Access environment semantics for background commands", async () => {
    const variable = "ORBIT_FULL_ACCESS_BACKGROUND_API_KEY";
    process.env[variable] = "test-only-secret";
    const runtime = new BackgroundTaskRuntime({
      workspaceRoot: process.cwd(),
    });
    try {
      const config = ConfigSchema.parse({});
      applyPermissionModePreset(config, "auto");
      const result = await new BashTool().execute(
        {
          command: nodeCommand(
            `console.log(process.env.${variable} ? 'present' : 'missing')`,
          ),
          background: true,
        },
        {
          cwd: process.cwd(),
          sessionId: "full-background",
          config,
          services: { backgroundTasks: runtime },
        },
      );
      const taskId = result.data?.taskId;
      expect(taskId).toMatch(/^bg_/);
      const [completed] = await runtime.getTasks("full-background", {
        taskIds: [taskId!],
        waitMs: 10_000,
      });
      expect(completed).toMatchObject({
        status: "completed",
        stdout: expect.stringContaining("present"),
      });
    } finally {
      delete process.env[variable];
      await runtime.dispose();
    }
  });

  it("fails clearly when background execution is not available", async () => {
    const result = await new BashTool().execute(
      { command: "node --version", background: true },
      { cwd: process.cwd(), sessionId: "test-session" },
    );

    expect(result).toEqual({
      ok: false,
      error: "Background task runtime is unavailable in this execution mode.",
    });
  });
});

function nodeCommand(script: string): string {
  const encoded = Buffer.from(script, "utf8").toString("base64");
  if (process.platform === "win32") {
    const executable = process.execPath.replace(/'/g, "''");
    return `& '${executable}' -e "eval(Buffer.from('${encoded}','base64').toString())"`;
  }
  const escapedExecutable = process.execPath.replace(/"/g, '\\"');
  return `"${escapedExecutable}" -e "eval(Buffer.from('${encoded}','base64').toString())"`;
}
