import { describe, expect, it, mockTools as vi } from "../../../../../scripts/testing/support.mjs";
import { getNextSessionSelection, handleSessionCommand } from "./SessionCommandHandler.js";

const sessions = [
  {
    id: "sess-first-task-001",
    title: "First",
    createdAt: "2026-01-01T00:00:00.000Z",
    model: "deepseek-v4",
  },
  {
    id: "sess-second-task-002",
    title: "Second",
    createdAt: "2026-01-02T00:00:00.000Z",
    model: "deepseek-v4",
  },
];

function createDependencies() {
  let current = sessions[0].id;
  const available = [...sessions];
  const loop = {
    getSessions: vi.fn(() => available),
    getSessionId: vi.fn(() => current),
    getHistory: vi.fn(() => []),
    getModelOverride: vi.fn(() => undefined),
    deleteSession: vi.fn((sessionId: string) => {
      const index = available.findIndex((session) => session.id === sessionId);
      if (index >= 0) available.splice(index, 1);
    }),
    resumeSession: vi.fn((sessionId: string) => {
      current = sessionId;
      return true;
    }),
    startNewSession: vi.fn(() => "sess-new-task-003"),
  };
  return {
    language: "en" as const,
    providerId: "deepseek-openai",
    defaultModel: "deepseek-v4",
    useFullscreenTui: true,
    loop,
    tui: { loadHistory: vi.fn() },
    printOutput: vi.fn(),
    saveLocalState: vi.fn(),
    refreshCandidates: vi.fn(async () => undefined),
  };
}

describe("handleSessionCommand", () => {
  it("lists sessions and marks the active one", async () => {
    const dependencies = createDependencies();
    await handleSessionCommand("list", "", dependencies);
    expect(dependencies.printOutput).toHaveBeenCalledWith(
      expect.stringContaining("(active)"),
    );
    expect(dependencies.refreshCandidates).toHaveBeenCalledOnce();
  });

  it("switches by one-based index", async () => {
    const dependencies = createDependencies();
    await handleSessionCommand("switch", "2", dependencies);
    expect(dependencies.loop.resumeSession).toHaveBeenCalledWith(
      sessions[1].id,
    );
    expect(dependencies.saveLocalState).toHaveBeenCalledWith(
      expect.objectContaining({ lastSessionId: sessions[1].id }),
    );
  });

  it("deleting the active session selects a replacement", async () => {
    const dependencies = createDependencies();
    await handleSessionCommand("delete", "1", dependencies);
    expect(dependencies.loop.deleteSession).toHaveBeenCalledWith(
      sessions[0].id,
    );
    expect(dependencies.loop.resumeSession).toHaveBeenCalledWith(
      sessions[1].id,
    );
  });

  it("chooses the nearest stable selection after deletion", () => {
    expect(getNextSessionSelection(sessions, sessions[0].id)).toBe(
      sessions[1].id,
    );
    expect(getNextSessionSelection([sessions[0]], sessions[0].id, "new")).toBe(
      "new",
    );
  });
});
