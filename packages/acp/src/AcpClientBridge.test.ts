import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  AcpExternalAgentConfigSchema,
  closeAcpAgentSession,
  loadAcpAgentSessionHistory,
  listAcpAgentSessions,
  runAcpAgentPrompt,
} from "./AcpClientBridge.js";

const fixture = fileURLToPath(
  new URL("./test-fixtures/acp-agent.mjs", import.meta.url),
);

describe("AcpClientBridge", () => {
  it("validates a bounded external process declaration", () => {
    expect(
      AcpExternalAgentConfigSchema.parse({ command: process.execPath }),
    ).toMatchObject({
      command: process.execPath,
      enabled: true,
      permissionPolicy: "ask",
      requestTimeoutMs: 600_000,
    });
    expect(
      AcpExternalAgentConfigSchema.safeParse({
        command: process.execPath,
        inheritEnv: ["BAD-NAME"],
      }).success,
    ).toBe(false);
  });

  it("negotiates ACP v1, streams updates, and validates permission choices", async () => {
    const onUpdate = vi.fn();
    const result = await runAcpAgentPrompt("check the fixture", {
      cwd: process.cwd(),
      clientVersion: "test",
      config: {
        command: process.execPath,
        args: [fixture],
        env: {},
        inheritEnv: [],
        enabled: true,
        requestTimeoutMs: 10_000,
        permissionPolicy: "ask",
      },
      requestPermission: (request) => {
        expect(request.toolCallId).toBe("fixture-tool");
        return "allow";
      },
      onUpdate,
    });

    expect(result.stopReason).toBe("end_turn");
    expect(result.text).toContain("fixture ready");
    expect(result.text).not.toContain("fixture-secret");
    expect(result.capabilities).toMatchObject({
      protocolVersion: 1,
      name: "fixture-agent",
      loadSession: true,
      promptImage: true,
      promptEmbeddedContext: true,
      sessionResume: true,
      sessionClose: true,
      sessionList: true,
    });
    expect(result.updateCount).toBe(1);
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it("fails closed when permission interaction is absent", async () => {
    const result = await runAcpAgentPrompt("check the fixture", {
      cwd: process.cwd(),
      clientVersion: "test",
      config: AcpExternalAgentConfigSchema.parse({
        command: process.execPath,
        args: [fixture],
        permissionPolicy: "ask",
        requestTimeoutMs: 10_000,
      }),
    });
    expect(result.text).toBe("fixture permission denied");
  });

  it("cancels and reaps an unresponsive external agent", async () => {
    await expect(
      runAcpAgentPrompt("hang", {
        cwd: process.cwd(),
        clientVersion: "test",
        config: AcpExternalAgentConfigSchema.parse({
          command: process.execPath,
          args: [fixture, "hang"],
          requestTimeoutMs: 1_000,
          permissionPolicy: "deny",
        }),
      }),
    ).rejects.toThrow(/timed out/);
  });

  it("lists bounded durable sessions through the ACP control plane", async () => {
    const result = await listAcpAgentSessions({
      cwd: process.cwd(),
      clientVersion: "test",
      config: AcpExternalAgentConfigSchema.parse({
        command: process.execPath,
        args: [fixture, "sessions"],
        requestTimeoutMs: 10_000,
      }),
    });
    expect(result.capabilities.sessionList).toBe(true);
    expect(result.sessions).toEqual([
      expect.objectContaining({
        sessionId: "fixture-existing",
        title: "Fixture persisted session",
      }),
    ]);
  });

  it("continues a durable session through lightweight resume", async () => {
    const result = await runAcpAgentPrompt("continue the fixture", {
      cwd: process.cwd(),
      clientVersion: "test",
      sessionId: "fixture-existing",
      config: AcpExternalAgentConfigSchema.parse({
        command: process.execPath,
        args: [fixture, "sessions"],
        requestTimeoutMs: 10_000,
      }),
      requestPermission: () => "allow",
    });

    expect(result.sessionId).toBe("fixture-existing");
    expect(result.text).toContain("fixture ready");
    expect(result.restoredSession).toEqual({
      strategy: "resume",
      replayedUpdateCount: 0,
    });
  });

  it("loads a durable session without mixing replayed history into turn output", async () => {
    const result = await runAcpAgentPrompt("continue after replay", {
      cwd: process.cwd(),
      clientVersion: "test",
      sessionId: "fixture-existing",
      sessionRestore: "load",
      config: AcpExternalAgentConfigSchema.parse({
        command: process.execPath,
        args: [fixture, "sessions"],
        requestTimeoutMs: 10_000,
      }),
      requestPermission: () => "allow",
    });

    expect(result.text).toContain("fixture ready");
    expect(result.text).not.toContain("replayed history");
    expect(result.restoredSession).toEqual({
      strategy: "load",
      replayedUpdateCount: 2,
    });
  });

  it("loads a bounded history snapshot without sending a prompt", async () => {
    const result = await loadAcpAgentSessionHistory("fixture-existing", {
      cwd: process.cwd(),
      clientVersion: "test",
      config: AcpExternalAgentConfigSchema.parse({
        command: process.execPath,
        args: [fixture, "sessions"],
        requestTimeoutMs: 10_000,
      }),
    });

    expect(result).toMatchObject({
      sessionId: "fixture-existing",
      updateCount: 2,
      truncated: false,
      capabilities: { loadSession: true },
    });
    expect(result.updates).toEqual([
      expect.objectContaining({
        sessionUpdate: "user_message_chunk",
        data: expect.objectContaining({
          content: { type: "text", text: "fixture replayed question" },
        }),
      }),
      expect.objectContaining({
        sessionUpdate: "agent_message_chunk",
        data: expect.objectContaining({
          content: { type: "text", text: "fixture replayed history" },
        }),
      }),
    ]);
  });

  it("marks a history snapshot truncated when its update budget is exceeded", async () => {
    const result = await loadAcpAgentSessionHistory("fixture-existing", {
      cwd: process.cwd(),
      clientVersion: "test",
      maxUpdates: 1,
      config: AcpExternalAgentConfigSchema.parse({
        command: process.execPath,
        args: [fixture, "sessions"],
        requestTimeoutMs: 10_000,
      }),
    });
    expect(result).toMatchObject({ updateCount: 2, truncated: true });
    expect(result.updates).toHaveLength(1);
  });

  it("closes a durable session through the bounded control connection", async () => {
    const result = await closeAcpAgentSession("fixture-existing", {
      cwd: process.cwd(),
      clientVersion: "test",
      config: AcpExternalAgentConfigSchema.parse({
        command: process.execPath,
        args: [fixture, "sessions"],
        requestTimeoutMs: 10_000,
      }),
    });

    expect(result).toMatchObject({
      action: "close",
      sessionId: "fixture-existing",
      capabilities: { sessionClose: true },
    });
  });
});
