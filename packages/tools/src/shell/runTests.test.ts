import { describe, expect, it } from "vitest";
import {
  classifyVerificationCommand,
  detectTrustedTerminalSuccess,
  RunTestsTool,
} from "./runTests.js";
import { PROCESS_OUTPUT_MAX_BYTES } from "./processLimits.js";

describe("RunTestsTool", () => {
  it("classifies conventional standalone verification commands", () => {
    expect(classifyVerificationCommand("pnpm test")).toBe("test");
    expect(classifyVerificationCommand("npm run build")).toBe("build");
    expect(classifyVerificationCommand("pnpm test:cli")).toBe("test");
    expect(classifyVerificationCommand("pnpm exec vitest run src")).toBe(
      "test",
    );
    expect(classifyVerificationCommand("python -m pytest -q")).toBe("test");
    expect(classifyVerificationCommand("npx tsc --noEmit")).toBe("typecheck");
    expect(
      classifyVerificationCommand('"C:\\nodejs\\node.exe" --check app.js'),
    ).toBe("syntax");
    expect(
      classifyVerificationCommand("python -m py_compile code/reporting.py"),
    ).toBe("syntax");
    expect(
      classifyVerificationCommand(
        "python code/finalize.py --strict-layout --render-pages",
      ),
    ).toBe("build");
    expect(
      classifyVerificationCommand(
        "python .cumcm/finalize.py --strict-layout --render-pages",
      ),
    ).toBe("build");
  });

  it("does not treat arbitrary or compound shell commands as verification", () => {
    expect(classifyVerificationCommand("echo ok")).toBeUndefined();
    expect(
      classifyVerificationCommand('node -e "process.exit(0)"'),
    ).toBeUndefined();
    expect(classifyVerificationCommand("true || pnpm test")).toBeUndefined();
    expect(classifyVerificationCommand("pnpm test && echo ok")).toBeUndefined();
    expect(classifyVerificationCommand("pnpm test\nexit 0")).toBeUndefined();
    expect(classifyVerificationCommand("pnpm test & exit 0")).toBeUndefined();
    expect(
      classifyVerificationCommand("vitest run --passWithNoTests"),
    ).toBeUndefined();
  });

  it("trusts the terminal marker only from the project-local CUMCM finalizer", () => {
    const marker = "[ORBIT_TERMINAL_SUCCESS] delivery complete";
    expect(
      detectTrustedTerminalSuccess(
        "python .cumcm/finalize.py --strict-layout",
        process.cwd(),
        marker,
        0,
      ),
    ).toBe("cumcm-finalizer");
    expect(
      detectTrustedTerminalSuccess(
        "python code/finalize.py --strict-layout",
        process.cwd(),
        marker,
        0,
      ),
    ).toBe("cumcm-finalizer");
    expect(
      detectTrustedTerminalSuccess(
        "python ../outside/code/finalize.py",
        process.cwd(),
        marker,
        0,
      ),
    ).toBeUndefined();
    expect(
      detectTrustedTerminalSuccess(
        "echo [ORBIT_TERMINAL_SUCCESS]",
        process.cwd(),
        marker,
        0,
      ),
    ).toBeUndefined();
    expect(
      detectTrustedTerminalSuccess(
        "python code/finalize.py; echo unexpected",
        process.cwd(),
        marker,
        0,
      ),
    ).toBeUndefined();
    expect(
      detectTrustedTerminalSuccess(
        "python code/finalize.py",
        process.cwd(),
        marker,
        1,
      ),
    ).toBeUndefined();
  });
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
