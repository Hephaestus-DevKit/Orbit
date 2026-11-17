import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigSchema } from "@orbit-build/config";
import {
  executeAgentHook,
  type AgentHookExecutionContext,
} from "./AgentHookExecutor.js";
import { executeManagedHookProcess } from "./ManagedHookProcess.js";
vi.mock("./ManagedHookProcess.js", () => ({
  executeManagedHookProcess: vi.fn(),
}));
function context(action: "deny" | "ask" | "allow"): AgentHookExecutionContext {
  return {
    cwd: process.cwd(),
    config: ConfigSchema.parse({ tools: { bash: { sandbox: "off" } } }),
    sessionId: "fixture-session",
    permissionEngine: {
      evaluate: () => ({ action, risk: "execute", reason: "fixture policy" }),
    },
    interaction: { askApproval: vi.fn(async () => false) },
    buildChildEnvironment: (extra) => ({ PATH: process.env.PATH, ...extra }),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
});
describe("Agent hook executor", () => {
  it.each(["deny", "ask"] as const)(
    "never starts an unapproved %s hook",
    async (action) => {
      await expect(
        executeAgentHook(context(action), "echo hello", {}, 1000),
      ).resolves.toMatchObject({ ok: false });
      expect(executeManagedHookProcess).not.toHaveBeenCalled();
    },
  );
  it("rejects interpolation before policy or process execution", async () => {
    const port = context("allow");
    const policy = vi.spyOn(port.permissionEngine, "evaluate");
    await expect(
      executeAgentHook(port, "echo {file}", {}, 1000),
    ).resolves.toMatchObject({ ok: false });
    expect(policy).not.toHaveBeenCalled();
    expect(executeManagedHookProcess).not.toHaveBeenCalled();
  });
  it("passes cancellation and a bounded timeout to its owned process", async () => {
    const port = context("allow");
    port.signal = new AbortController().signal;
    vi.mocked(executeManagedHookProcess).mockResolvedValueOnce({
      stdout: "ok",
      stderr: "",
    });
    await expect(
      executeAgentHook(port, "echo hello", {}, 1_000_000),
    ).resolves.toEqual({ ok: true, output: "ok" });
    expect(executeManagedHookProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        timeoutMs: port.config.tools.bash.timeoutMs,
        sessionId: port.sessionId,
      }),
      port.signal,
    );
  });
});
