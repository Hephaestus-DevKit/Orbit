import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "@orbit-build/session";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  listSessions: vi.fn(),
  probeAgent: vi.fn(),
  runPrompt: vi.fn(),
  closeSession: vi.fn(),
  loadHistory: vi.fn(),
  loadRegistry: vi.fn(),
  fetchRegistry: vi.fn(),
}));

vi.mock("@orbit-build/config", () => ({
  ConfigLoader: { loadSync: mocks.loadConfig },
}));

vi.mock("@orbit-build/acp", () => ({
  listAcpAgentSessions: mocks.listSessions,
  probeAcpAgent: mocks.probeAgent,
  runAcpAgentPrompt: mocks.runPrompt,
  closeAcpAgentSession: mocks.closeSession,
  loadAcpAgentSessionHistory: mocks.loadHistory,
  loadAcpRegistry: mocks.loadRegistry,
  fetchAcpRegistry: mocks.fetchRegistry,
  AcpRegistryFileSchema: {
    safeParse: (value: unknown) => ({ success: true, data: value }),
  },
}));

vi.mock("@orbit-build/tui", () => ({
  Prompt: { askSelect: vi.fn() },
}));

import {
  mapAcpHistoryToOrbit,
  runAcpCommand,
  runAcpRegistryCommand,
  runAcpRegistryFetchCommand,
} from "./acp.js";

describe("runAcpCommand", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    mocks.loadConfig.mockReturnValue({
      externalAgents: {
        fixture: {
          command: "fixture-agent",
          args: [],
          enabled: true,
          permissionPolicy: "deny",
          requestTimeoutMs: 10_000,
        },
      },
      security: { extensionTrustRoots: {} },
    });
  });

  it("forwards durable session restore policy to an ACP prompt", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.runPrompt.mockResolvedValue({
      sessionId: "session-1",
      stopReason: "end_turn",
      text: "done",
      capabilities: {},
      updateCount: 0,
      updates: [],
      stderr: "",
      stderrTruncated: false,
      restoredSession: { strategy: "load", replayedUpdateCount: 3 },
    });

    await expect(
      runAcpCommand("run", "fixture", "continue", {
        cwd: "C:/workspace",
        json: true,
        sessionId: "session-1",
        sessionRestore: "load",
      }),
    ).resolves.toBe(0);
    expect(mocks.runPrompt).toHaveBeenCalledWith(
      "continue",
      expect.objectContaining({
        cwd: "C:/workspace",
        sessionId: "session-1",
        sessionRestore: "load",
      }),
    );
    expect(output).toHaveBeenCalledWith(expect.stringContaining("session-1"));
  });

  it("closes only the explicitly selected external session", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.closeSession.mockResolvedValue({
      action: "close",
      sessionId: "session-2",
      capabilities: { sessionClose: true },
    });

    await expect(
      runAcpCommand("close", "fixture", "session-2", {
        cwd: "C:/workspace",
        json: true,
      }),
    ).resolves.toBe(0);
    expect(mocks.closeSession).toHaveBeenCalledWith(
      "session-2",
      expect.objectContaining({ cwd: "C:/workspace" }),
    );
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"close"'));
  });

  it("fails closed when managed policy disables external agents", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.loadConfig.mockReturnValue({
      externalAgents: {},
      managedPolicy: { disableExternalAgents: true },
    });

    await expect(
      runAcpCommand("probe", "fixture", undefined, { json: true }),
    ).resolves.toBe(1);
    expect(mocks.probeAgent).not.toHaveBeenCalled();
    expect(output).toHaveBeenCalledWith(
      expect.stringContaining("Managed policy disables"),
    );
  });

  it("validates ACP registry diagnostics without spawning an agent", () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.loadRegistry.mockReturnValue({
      schemaVersion: 1,
      entries: [],
      diagnostics: [
        {
          scope: "project",
          path: "registry.json",
          ok: false,
          error: "bad schema",
        },
      ],
    });
    expect(
      runAcpRegistryCommand("validate", { cwd: "C:/workspace", json: true }),
    ).toBe(1);
    expect(mocks.loadRegistry).toHaveBeenCalledWith(
      "C:/workspace",
      undefined,
      expect.objectContaining({
        trustRoots: {},
        requireSignature: false,
      }),
    );
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"ok": false'));
  });

  it("propagates the configured trust roots and required-signature policy", () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.loadConfig.mockReturnValue({
      externalAgents: {},
      security: {
        acpRegistryTrustRoots: { release: "public-key" },
        requireSignedAcpRegistry: true,
      },
    });
    mocks.loadRegistry.mockReturnValue({
      schemaVersion: 1,
      entries: [],
      diagnostics: [],
    });
    expect(
      runAcpRegistryCommand("validate", {
        cwd: "C:/workspace",
        json: true,
        requireSignature: false,
      }),
    ).toBe(0);
    expect(mocks.loadRegistry).toHaveBeenCalledWith("C:/workspace", undefined, {
      trustRoots: { release: "public-key" },
      requireSignature: true,
    });
    expect(output).toHaveBeenCalledWith(
      expect.stringContaining('"requireSignature": true'),
    );
  });

  it("fetches a verified hosted registry and atomically pins it inside the workspace", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-acp-fetch-"));
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.loadConfig.mockReturnValue({
      externalAgents: {},
      security: { acpRegistryTrustRoots: {}, requireSignedAcpRegistry: true },
    });
    const file = {
      schemaVersion: 1,
      metadata: {
        registryId: "official",
        owner: "Orbit Team",
        revision: 3,
        issuedAt: "2026-08-16T00:00:00.000Z",
      },
      agents: [],
      signature: { algorithm: "ed25519", keyId: "release", value: "signed" },
    };
    mocks.fetchRegistry.mockResolvedValue({
      url: "https://registry.example.test/acp.json",
      file,
      metadata: file.metadata,
      digest: "a".repeat(64),
      signatureStatus: "valid",
      notModified: false,
    });
    try {
      await expect(
        runAcpRegistryFetchCommand({
          cwd,
          json: true,
          url: "https://registry.example.test/acp.json",
          registryId: "official",
          owner: "Orbit Team",
        }),
      ).resolves.toBe(0);
      const registryPath = join(cwd, ".orbit", "acp", "registry.json");
      expect(JSON.parse(readFileSync(registryPath, "utf8"))).toEqual(file);
      expect(mocks.fetchRegistry).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedRegistryId: "official",
          expectedOwner: "Orbit Team",
          requireSignature: true,
        }),
      );
      expect(output).toHaveBeenCalledWith(
        expect.stringContaining('"revision": 3'),
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("refuses a hosted registry rollback without explicit force", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-acp-fetch-rollback-"));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.loadConfig.mockReturnValue({
      externalAgents: {},
      security: { acpRegistryTrustRoots: {} },
    });
    const existing = {
      schemaVersion: 1,
      metadata: {
        registryId: "official",
        owner: "Orbit Team",
        revision: 9,
        issuedAt: "2026-08-16T00:00:00.000Z",
      },
      agents: [],
    };
    const outputPath = join(cwd, ".orbit", "acp", "registry.json");
    mkdirSync(join(cwd, ".orbit", "acp"), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(existing));
    mocks.fetchRegistry.mockResolvedValue({
      url: "https://registry.example.test/acp.json",
      file: {
        ...existing,
        metadata: { ...existing.metadata, revision: 8 },
      },
      metadata: { ...existing.metadata, revision: 8 },
      digest: "b".repeat(64),
      signatureStatus: "valid",
      notModified: false,
    });
    try {
      await expect(
        runAcpRegistryFetchCommand({
          cwd,
          url: "https://registry.example.test/acp.json",
        }),
      ).resolves.toBe(1);
      expect(JSON.parse(readFileSync(outputPath, "utf8"))).toEqual(existing);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("imports an ACP replay as inert native history and deduplicates its digest", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-acp-import-"));
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const replay = (receivedAt: string) => ({
      sessionId: "external-session",
      capabilities: { loadSession: true },
      updateCount: 3,
      truncated: false,
      updates: [
        {
          sessionId: "external-session",
          sessionUpdate: "user_message_chunk",
          receivedAt,
          data: {
            sessionUpdate: "user_message_chunk",
            messageId: "user-1",
            content: { type: "text", text: "question" },
          },
        },
        {
          sessionId: "external-session",
          sessionUpdate: "agent_message_chunk",
          receivedAt,
          data: {
            sessionUpdate: "agent_message_chunk",
            messageId: "agent-1",
            content: { type: "text", text: "answer" },
          },
        },
        {
          sessionId: "external-session",
          sessionUpdate: "tool_call",
          receivedAt,
          data: {
            sessionUpdate: "tool_call",
            toolCallId: "tool-1",
            title: "read file",
          },
        },
      ],
    });
    mocks.loadHistory
      .mockResolvedValueOnce(replay("2026-08-16T00:00:00.000Z"))
      .mockResolvedValueOnce(replay("2026-08-16T00:01:00.000Z"));
    try {
      await expect(
        runAcpCommand("import", "fixture", "external-session", {
          cwd,
          json: true,
        }),
      ).resolves.toBe(0);
      const store = new SessionStore(cwd);
      const sessions = store.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        status: "completed",
        provider: "acp:fixture",
        model: "external-history",
      });
      const history = store.getHistory(sessions[0].id);
      expect(history.map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "assistant",
      ]);
      expect(history[2].content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("inert import"),
      });
      expect(history[2].metadata).toMatchObject({
        source: "acp-import",
        nonExecutable: true,
      });

      await expect(
        runAcpCommand("import", "fixture", "external-session", {
          cwd,
          json: true,
        }),
      ).resolves.toBe(0);
      expect(store.listSessions()).toHaveLength(1);
      expect(String(output.mock.calls.at(-1)?.[0])).toContain(
        '"existing": true',
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("rejects truncated ACP history unless explicitly accepted", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-acp-import-truncated-"));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.loadHistory.mockResolvedValue({
      sessionId: "external-session",
      capabilities: { loadSession: true },
      updateCount: 2_001,
      truncated: true,
      updates: [],
    });
    try {
      await expect(
        runAcpCommand("import", "fixture", "external-session", {
          cwd,
          json: true,
        }),
      ).resolves.toBe(1);
      expect(new SessionStore(cwd).listSessions()).toHaveLength(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("groups message chunks and omits binary ACP content", () => {
    const updates = [
      {
        sessionId: "external",
        sessionUpdate: "agent_message_chunk",
        receivedAt: "2026-08-16T00:00:00.000Z",
        data: {
          sessionUpdate: "agent_message_chunk",
          messageId: "message-1",
          content: { type: "text", text: "hello " },
        },
      },
      {
        sessionId: "external",
        sessionUpdate: "agent_message_chunk",
        receivedAt: "2026-08-16T00:00:00.001Z",
        data: {
          sessionUpdate: "agent_message_chunk",
          messageId: "message-1",
          content: { type: "image", data: "not-persisted" },
        },
      },
    ];
    const history = mapAcpHistoryToOrbit("fixture", "external", updates);
    expect(history).toHaveLength(1);
    expect(history[0].content[0]).toMatchObject({
      type: "text",
      text: "hello [ACP image content omitted from imported history]",
    });
  });
});
