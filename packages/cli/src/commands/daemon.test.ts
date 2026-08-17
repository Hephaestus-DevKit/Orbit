import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = {
  health: vi.fn(),
  listTasks: vi.fn(),
  startTask: vi.fn(),
  getTask: vi.fn(),
  cancelTask: vi.fn(),
  resumeTask: vi.fn(),
  removeTask: vi.fn(),
  shutdown: vi.fn(),
  readEvents: vi.fn(),
  followEvents: vi.fn(),
};

vi.mock("@orbit-build/daemon", () => ({
  DaemonClient: vi.fn(function MockDaemonClient() {
    return client;
  }),
  DaemonServer: vi.fn(),
  DaemonStore: vi.fn(),
  DaemonTokenStore: vi.fn(),
  DaemonTaskIdSchema: { parse: (value: string) => value },
}));

import { runDaemonCommand } from "./daemon.js";

describe("remote daemon CLI controls", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("ORBIT_DAEMON_TOKEN", "remote-token");
    client.health.mockResolvedValue({
      schemaVersion: 1,
      ok: true,
      protocolVersion: 1,
      instanceId: "daemon_1234567890abcdef12345678",
      accepting: true,
      activeTasks: 0,
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("uses the typed client for remote health and never local metadata", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await expect(
      runDaemonCommand("status", {
        remoteUrl: "https://daemon.example",
        json: true,
      }),
    ).resolves.toBe(0);
    expect(client.health).toHaveBeenCalledOnce();
    expect(output).toHaveBeenCalledWith(
      expect.stringContaining('"instanceId"'),
    );
  });

  it("replays remote events through the same typed bounded client", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    client.readEvents.mockResolvedValue({
      events: [
        {
          schemaVersion: 1,
          taskId: "task_1234567890abcdef12345678",
          sequence: 1,
          timestamp: "2026-08-16T00:00:00.000Z",
          type: "task_started",
          payload: {},
        },
      ],
      resyncRequired: false,
    });
    await expect(
      runDaemonCommand("events", {
        remoteUrl: "https://daemon.example",
        taskId: "task_1234567890abcdef12345678",
        json: true,
      }),
    ).resolves.toBe(0);
    expect(client.readEvents).toHaveBeenCalledWith(
      "task_1234567890abcdef12345678",
      { after: 0, limit: 200 },
    );
    expect(output).toHaveBeenCalledWith(
      expect.stringContaining("task_started"),
    );
  });

  it("rejects remote plaintext HTTP except loopback", async () => {
    await expect(
      runDaemonCommand("status", {
        remoteUrl: "http://daemon.example",
      }),
    ).rejects.toThrow("HTTPS");
  });

  it("requires an explicitly remote-visible workspace for handoff", async () => {
    await expect(
      runDaemonCommand("submit", {
        remoteUrl: "https://daemon.example",
        prompt: "run remotely",
      }),
    ).rejects.toThrow("remote-visible");
    client.startTask.mockResolvedValue({ id: "task_1234567890abcdef12345678" });
    await expect(
      runDaemonCommand("submit", {
        remoteUrl: "https://daemon.example",
        prompt: "run remotely",
        taskCwd: "/srv/orbit/project",
        json: true,
      }),
    ).resolves.toBe(0);
    expect(client.startTask).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/srv/orbit/project" }),
    );
  });
});
