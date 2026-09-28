import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SessionStore } from "@orbit-build/session";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runTraceExport } from "./trace.js";

describe("trace export command", () => {
  const roots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes a redacted trace inside the workspace", () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-trace-command-"));
    roots.push(cwd);
    const store = new SessionStore(cwd);
    const session = store.createSession("deepseek", "deepseek-v4-pro");
    store.appendEvent(session.id, "test", {
      path: join(cwd, "src", "index.ts"),
      apiKey: "sk-this-is-a-test-secret",
    });

    const result = runTraceExport(cwd, session.id, {
      out: ".orbit/exports/session.json",
    });
    expect(result).toBe(join(cwd, ".orbit", "exports", "session.json"));
    const content = readFileSync(result!, "utf8");
    expect(content).toContain('"path": "<workspace>"');
    expect(content).not.toContain(cwd);
    expect(content).not.toContain("sk-this-is-a-test-secret");
  });

  it("prints to stdout and excludes message history by default", () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-trace-command-"));
    roots.push(cwd);
    const store = new SessionStore(cwd);
    const session = store.createSession("deepseek", "deepseek-flash");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    runTraceExport(cwd, session.id);

    const output = JSON.parse(String(log.mock.calls[0][0])) as {
      history?: unknown;
    };
    expect(output.history).toBeUndefined();
  });

  it("rejects trace output outside the workspace", () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-trace-command-"));
    roots.push(cwd);
    const session = new SessionStore(cwd).createSession(
      "deepseek",
      "deepseek-v4-pro",
    );

    expect(() =>
      runTraceExport(cwd, session.id, { out: "../trace.json" }),
    ).toThrow(/workspace boundary/);
  });
});
