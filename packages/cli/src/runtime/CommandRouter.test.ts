import { afterEach, describe, it, expect, vi } from "vitest";
import { BUILTIN_SLASH_COMMANDS, CommandRouter } from "./CommandRouter.js";
import { Prompt } from "@orbit-build/tui";
import type { AgentLoopRunOutcome } from "@orbit-build/core";
import { ConfigSchema } from "@orbit-build/config";
import { runUpdate } from "../commands/update.js";

describe("CommandRouter Unit Tests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockConfig = {
    language: "en",
    permissions: { mode: "strict" },
    models: { default: "gpt-4" },
  };

  const mockProvider = {
    id: "openai",
    chat: vi.fn(),
  };

  const mockLoop = {
    getConfig: () => mockConfig,
    getModelOverride: () => undefined,
    getHistory: () => [],
    getCheckpoints: () => [],
    getRelevantFiles: () => [],
    addRelevantFilePublic: vi.fn(),
    setUserInteraction: vi.fn(),
  };

  const mockTui = {
    isActive: true,
    addSystemMessage: vi.fn(),
    addLog: vi.fn(),
    addUserMessage: vi.fn(),
    abortActiveRunnable: vi.fn(() => false),
    syncFromLoop: vi.fn(),
    setCandidates: vi.fn(),
  };

  const mockInteraction = {
    askApproval: vi.fn(),
    showText: vi.fn(),
    showDiff: vi.fn(),
  };

  const localState = { lastSessionId: "123", lastModel: "gpt-4" };

  it("includes the Orbit Web UI command in built-in slash commands", () => {
    expect(BUILTIN_SLASH_COMMANDS).toContain("/webui");
    expect(BUILTIN_SLASH_COMMANDS).toContain("/language");
  });

  it("switches and persists the project language from /language", async () => {
    const config = { ...mockConfig, language: "en" };
    const saveState = vi.fn();
    const router = new CommandRouter(
      process.cwd(),
      config,
      mockProvider,
      vi.fn(),
      { ...mockLoop, getConfig: () => config } as any,
      mockTui as any,
      true,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      saveState,
      mockInteraction as any,
      false,
    );

    await expect(router.route("/language zh-Hant")).resolves.toEqual({
      shouldExit: false,
      processed: true,
    });
    expect(config.language).toBe("zh-TW");
    expect(saveState).toHaveBeenCalledWith({ language: "zh-TW" });
    expect(mockTui.addSystemMessage).toHaveBeenCalledWith(
      expect.stringContaining("繁體中文"),
      false,
    );
  });

  it("routes /update to the Orbit CLI updater", async () => {
    const updateOrbit = vi.fn(
      async (
        ...args: Parameters<typeof runUpdate>
      ): Promise<Awaited<ReturnType<typeof runUpdate>>> => {
        args[2]?.beforeInstall?.();
        args[2]?.afterInstall?.();
        return {
          check: {
            currentVersion: args[0],
            latestVersion: "0.2.0",
            updateAvailable: true,
          },
          installed: true,
          restartRequired: true,
          channel: "stable",
        };
      },
    );
    const tui = {
      ...mockTui,
      stop: vi.fn(),
      start: vi.fn(),
      setOrbitUpdateAvailable: vi.fn(),
      setOrbitRestartRequired: vi.fn(),
    };
    const router = new CommandRouter(
      process.cwd(),
      mockConfig,
      mockProvider,
      vi.fn(),
      mockLoop as any,
      tui as any,
      true,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as any,
      false,
      updateOrbit,
    );

    await expect(router.route("/update")).resolves.toMatchObject({
      processed: true,
    });

    expect(updateOrbit).toHaveBeenCalledOnce();
    expect(tui.stop).toHaveBeenCalledOnce();
    expect(tui.start).toHaveBeenCalledOnce();
    expect(tui.setOrbitUpdateAvailable).toHaveBeenCalledWith(false);
    expect(tui.setOrbitRestartRequired).toHaveBeenCalledWith(true);
  });

  it("keeps Web UI /update non-blocking and check-only", async () => {
    const updateOrbit = vi.fn(
      async (
        ...args: Parameters<typeof runUpdate>
      ): Promise<Awaited<ReturnType<typeof runUpdate>>> => ({
        check: {
          currentVersion: args[0],
          latestVersion: "0.2.0",
          updateAvailable: true,
        },
        installed: false,
        restartRequired: false,
        channel: "stable",
      }),
    );
    const router = new CommandRouter(
      process.cwd(),
      mockConfig,
      mockProvider,
      vi.fn(),
      mockLoop as any,
      { ...mockTui, hasActiveRunnable: vi.fn(() => false) } as any,
      true,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as any,
      false,
      updateOrbit,
    );
    const submitWebPrompt = (
      router as unknown as {
        submitWebPrompt(prompt: string): Promise<{ ok: boolean }>;
      }
    ).submitWebPrompt.bind(router);

    await expect(submitWebPrompt("/update")).resolves.toEqual({ ok: true });
    expect(updateOrbit).toHaveBeenCalledWith(
      expect.any(String),
      { check: true },
      expect.any(Object),
    );
  });

  it("maps Mission Control recipes to fixed single and multi-agent modes", async () => {
    const router = new CommandRouter(
      process.cwd(),
      mockConfig,
      mockProvider,
      vi.fn(),
      mockLoop as any,
      { ...mockTui, hasActiveRunnable: vi.fn(() => false) } as any,
      true,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as any,
      false,
    );
    const submitWebPrompt = vi.fn(async () => ({ ok: true }));
    const taskBridge = router as unknown as {
      submitWebPrompt: typeof submitWebPrompt;
      startWebUiTask(action: {
        action: "plan" | "parallel-improve";
      }): Promise<{ ok: boolean }>;
    };
    taskBridge.submitWebPrompt = submitWebPrompt;

    await expect(
      taskBridge.startWebUiTask({ action: "plan" }),
    ).resolves.toEqual({ ok: true });
    await expect(
      taskBridge.startWebUiTask({ action: "parallel-improve" }),
    ).resolves.toEqual({ ok: true });

    expect(submitWebPrompt).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("recoverable execution plan"),
      [],
      "single",
    );
    expect(submitWebPrompt).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("isolated multi-agent"),
      [],
      "multi",
    );
  });

  it("creates and resumes sessions through the Web UI bridge", async () => {
    const history = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
    const loop = {
      ...mockLoop,
      getSessionId: vi.fn(() => "session-existing"),
      startNewSession: vi.fn(() => "session-new"),
      resumeSession: vi.fn(() => true),
      getHistory: vi.fn(() => history),
    };
    const tui = {
      ...mockTui,
      hasActiveRunnable: vi.fn(() => false),
      loadHistory: vi.fn(),
    };
    const saveState = vi.fn();
    const router = new CommandRouter(
      process.cwd(),
      mockConfig,
      mockProvider,
      vi.fn(),
      loop as any,
      tui as any,
      true,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      saveState,
      mockInteraction as any,
      false,
    );
    const updateSession = (
      router as unknown as {
        updateWebUiSession(action: {
          action: "new" | "resume";
          sessionId?: string;
        }): Promise<{ ok: boolean }>;
      }
    ).updateWebUiSession.bind(router);

    await expect(updateSession({ action: "new" })).resolves.toEqual({
      ok: true,
    });
    await expect(
      updateSession({ action: "resume", sessionId: "session-existing" }),
    ).resolves.toEqual({ ok: true });

    expect(loop.startNewSession).toHaveBeenCalledWith("openai", "gpt-4");
    expect(loop.resumeSession).toHaveBeenCalledWith("session-existing");
    expect(tui.loadHistory).toHaveBeenNthCalledWith(1, []);
    expect(tui.loadHistory).toHaveBeenNthCalledWith(2, history);
    expect(saveState).toHaveBeenCalledWith({
      lastSessionId: "session-new",
      lastModel: "gpt-4",
    });
  });

  it("archives, restores, and deletes inactive Web UI sessions", async () => {
    const setSessionArchived = vi.fn(() => true);
    const deleteSession = vi.fn();
    const loop = {
      ...mockLoop,
      getSessionId: vi.fn(() => "session-active"),
      getSessions: vi.fn(() => [{ id: "session-other" }]),
      setSessionArchived,
      deleteSession,
    };
    const tui = {
      ...mockTui,
      hasActiveRunnable: vi.fn(() => false),
      loadHistory: vi.fn(),
    };
    const router = new CommandRouter(
      process.cwd(),
      mockConfig,
      mockProvider,
      vi.fn(),
      loop as any,
      tui as any,
      true,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as any,
      false,
    );
    const updateSession = (
      router as unknown as {
        updateWebUiSession(action: {
          action: "archive" | "restore" | "delete";
          sessionId: string;
        }): Promise<{ ok: boolean }>;
      }
    ).updateWebUiSession.bind(router);

    await expect(
      updateSession({ action: "archive", sessionId: "session-other" }),
    ).resolves.toEqual({ ok: true });
    await expect(
      updateSession({ action: "restore", sessionId: "session-other" }),
    ).resolves.toEqual({ ok: true });
    await expect(
      updateSession({ action: "delete", sessionId: "session-other" }),
    ).resolves.toEqual({ ok: true });
    await expect(
      updateSession({ action: "archive", sessionId: "session-active" }),
    ).resolves.toMatchObject({ ok: false });

    expect(setSessionArchived).toHaveBeenNthCalledWith(
      1,
      "session-other",
      true,
    );
    expect(setSessionArchived).toHaveBeenNthCalledWith(
      2,
      "session-other",
      false,
    );
    expect(deleteSession).toHaveBeenCalledWith("session-other");
  });

  it("serializes terminal turns while a Web UI turn owns the agent loop", async () => {
    let finishWebRun: (() => void) | undefined;
    const loop = {
      ...mockLoop,
      prepareUserTurn: vi.fn(),
      getSessionId: () => "session-web",
      run: vi.fn(
        () =>
          new Promise<AgentLoopRunOutcome>((resolve) => {
            finishWebRun = () =>
              resolve({
                status: "completed",
                sessionId: "session-web",
                attempts: 1,
              });
          }),
      ),
    };
    const tui = {
      ...mockTui,
      hasActiveRunnable: vi.fn(() => false),
      setActiveRunnable: vi.fn(),
      finishAttempt: vi.fn(),
    };
    const router = new CommandRouter(
      "/dummy/cwd",
      mockConfig,
      mockProvider,
      vi.fn(),
      loop as any,
      tui as any,
      true,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as any,
      false,
    );
    const submitWebPrompt = (
      router as unknown as {
        submitWebPrompt(prompt: string): Promise<{ ok: boolean }>;
      }
    ).submitWebPrompt.bind(router);

    const pendingWebTurn = submitWebPrompt("long browser task");
    await vi.waitFor(() => expect(loop.run).toHaveBeenCalledOnce());

    expect(router.isWebUiBusy()).toBe(true);
    expect(router.beginTerminalRun()).toBeUndefined();
    expect(tui.addUserMessage).toHaveBeenCalledWith("long browser task");

    finishWebRun?.();
    await expect(pendingWebTurn).resolves.toEqual({ ok: true });

    const releaseTerminalRun = router.beginTerminalRun();
    expect(releaseTerminalRun).toBeTypeOf("function");
    releaseTerminalRun?.();
  });

  it("returns structured agent failures to the Web UI", async () => {
    const loop = {
      ...mockLoop,
      prepareUserTurn: vi.fn(),
      getSessionId: () => "session-failed",
      run: vi.fn(
        async (): Promise<AgentLoopRunOutcome> => ({
          status: "failed",
          sessionId: "session-failed",
          attempts: 1,
          error: {
            code: "provider_error",
            message: "Provider rejected the request.",
          },
        }),
      ),
    };
    const tui = {
      ...mockTui,
      hasActiveRunnable: vi.fn(() => false),
      setActiveRunnable: vi.fn(),
      finishAttempt: vi.fn(),
    };
    const router = new CommandRouter(
      "/dummy/cwd",
      mockConfig,
      mockProvider,
      vi.fn(),
      loop as any,
      tui as any,
      true,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as any,
      false,
    );
    const result = await (
      router as unknown as {
        submitWebPrompt(prompt: string): Promise<{
          ok: boolean;
          message?: string;
        }>;
      }
    ).submitWebPrompt("request with a bad credential");

    expect(result).toEqual({
      ok: false,
      message: "Provider rejected the request.",
    });
    expect(router.isWebUiBusy()).toBe(false);
  });

  it("lets the Web UI stop a turn started in the terminal", () => {
    const tui = {
      ...mockTui,
      abortActiveRunnable: vi.fn(() => true),
    };
    const router = new CommandRouter(
      "/dummy/cwd",
      mockConfig,
      mockProvider,
      vi.fn(),
      mockLoop as any,
      tui as any,
      true,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as any,
      false,
    );
    const release = router.beginTerminalRun();
    const result = (
      router as unknown as {
        cancelWebPrompt(): { ok: boolean; message?: string };
      }
    ).cancelWebPrompt();

    expect(result).toEqual({ ok: true });
    expect(tui.abortActiveRunnable).toHaveBeenCalledWith("immediate");
    release?.();
  });

  it.each([
    ["glm-5", "glm-5"],
    ["happyhorse-1.0-r2v", "deepseek-v4-flash"],
  ])(
    "selects a safe Web UI model when switching provider (%s -> %s)",
    async (requestedModel, expectedModel) => {
      const config = ConfigSchema.parse({
        provider: { default: "deepseek-openai" },
        providers: {
          "deepseek-openai": {
            type: "openai-compatible",
            apiKey: "test-key",
            disablePreheat: true,
            models: ["deepseek-v4-flash"],
          },
          tokendance: {
            type: "openai-compatible",
            apiKey: "test-key",
            disablePreheat: true,
            models: ["deepseek-v4-flash", "glm-5", "happyhorse-1.0-r2v"],
          },
        },
        models: {
          default: "deepseek-v4-flash",
        },
      });
      const setModelOverride = vi.fn();
      const loop = {
        ...mockLoop,
        getConfig: () => config,
        getModelOverride: () => "deepseek-v4-flash",
        setProvider: vi.fn(),
        setModelOverride,
      };
      const router = new CommandRouter(
        "/dummy/cwd",
        config,
        { ...mockProvider, id: "deepseek-openai" },
        vi.fn(),
        loop as any,
        mockTui as any,
        true,
        () => ({ commands: [], files: [], symbols: [], sessions: [] }),
        vi.fn(),
        () => localState,
        vi.fn(),
        mockInteraction as any,
        false,
      );
      const updateSettings = (
        router as unknown as {
          updateWebUiSettings(patch: {
            provider?: string;
            model?: string;
          }): Promise<{ ok: boolean }>;
        }
      ).updateWebUiSettings.bind(router);

      await expect(
        updateSettings({
          provider: "tokendance",
          model: requestedModel,
        }),
      ).resolves.toEqual({ ok: true });

      expect(config.provider.default).toBe("tokendance");
      expect(setModelOverride).toHaveBeenCalledWith(expectedModel);
      expect(setModelOverride).toHaveBeenCalledTimes(1);
    },
  );

  it("commits provider and model together after the model prompt", async () => {
    const config = ConfigSchema.parse({
      provider: { default: "provider-a" },
      providers: {
        "provider-a": {
          type: "openai-compatible",
          apiKey: "test-key",
          disablePreheat: true,
          models: ["model-a"],
        },
        "provider-b": {
          type: "openai-compatible",
          apiKey: "test-key",
          disablePreheat: true,
          models: ["model-b"],
        },
      },
      models: { default: "model-a" },
    });
    let activeModel = "model-a";
    const loop = {
      ...mockLoop,
      getConfig: () => config,
      getModelOverride: () => activeModel,
      setModelOverride: vi.fn((model: string) => {
        activeModel = model;
      }),
      clearModelOverride: vi.fn(),
      setProvider: vi.fn(),
    };
    const tui = { ...mockTui, syncFromLoop: vi.fn() };
    let resolveModel: ((value: string) => void) | undefined;
    const askSelect = vi
      .spyOn(Prompt, "askSelect")
      .mockResolvedValueOnce("provider-b")
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveModel = resolve;
          }),
      );
    const router = new CommandRouter(
      process.cwd(),
      config,
      { ...mockProvider, id: "provider-a" },
      vi.fn(),
      loop as any,
      tui as any,
      true,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as any,
      false,
    );

    const switching = router.route("/model");
    await vi.waitFor(() => expect(askSelect).toHaveBeenCalledTimes(2));
    expect(config.provider.default).toBe("provider-a");
    expect(loop.setProvider).not.toHaveBeenCalled();

    resolveModel?.("model-b");
    await expect(switching).resolves.toMatchObject({ processed: true });
    expect(config.provider.default).toBe("provider-b");
    expect(loop.setProvider).toHaveBeenCalledOnce();
    expect(loop.setModelOverride).toHaveBeenCalledWith("model-b");
    expect(tui.syncFromLoop).toHaveBeenCalledOnce();
  });

  it("updates the TUI immediately after a direct model command", async () => {
    const setModelOverride = vi.fn();
    const loop = {
      ...mockLoop,
      getConfig: () => ({ ...mockConfig, providers: {} }),
      setModelOverride,
    };
    const tui = { ...mockTui, syncFromLoop: vi.fn() };
    const router = new CommandRouter(
      process.cwd(),
      { ...mockConfig, providers: {} },
      mockProvider,
      vi.fn(),
      loop as any,
      tui as any,
      true,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as any,
      false,
    );

    await router.route("/model model-next");

    expect(setModelOverride).toHaveBeenCalledWith("model-next");
    expect(tui.syncFromLoop).toHaveBeenCalledWith(loop);
  });

  it("unlocks automatic routing from the Web UI model selector", async () => {
    const config = ConfigSchema.parse({
      provider: { default: "deepseek-openai" },
      providers: {
        "deepseek-openai": {
          type: "openai-compatible",
          apiKey: "test-key",
          disablePreheat: true,
          models: ["deepseek-v4-flash", "deepseek-v4-pro"],
        },
      },
      models: { default: "deepseek-v4-flash" },
    });
    const clearModelOverride = vi.fn();
    const loop = {
      ...mockLoop,
      getConfig: () => config,
      clearModelOverride,
      setModelOverride: vi.fn(),
    };
    const router = new CommandRouter(
      process.cwd(),
      config,
      { ...mockProvider, id: "deepseek-openai" },
      vi.fn(),
      loop as any,
      mockTui as any,
      false,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as any,
      false,
    );
    const updateSettings = (
      router as unknown as {
        updateWebUiSettings(patch: {
          model?: string;
        }): Promise<{ ok: boolean }>;
      }
    ).updateWebUiSettings.bind(router);

    await expect(updateSettings({ model: "__auto__" })).resolves.toEqual({
      ok: true,
    });
    expect(clearModelOverride).toHaveBeenCalledOnce();
    expect(loop.setModelOverride).not.toHaveBeenCalled();
  });

  it("rejects Web UI settings that weaken managed policy", async () => {
    const config = ConfigSchema.parse({
      permissions: { mode: "strict" },
      tools: { webSearch: { enabled: false } },
      managedPolicy: {
        allowedModels: ["deepseek-v4-pro"],
        minimumPermissionMode: "strict",
        disableWebSearch: true,
      },
    });
    const loop = { ...mockLoop, getConfig: () => config };
    const router = new CommandRouter(
      process.cwd(),
      config,
      mockProvider,
      vi.fn(),
      loop as any,
      mockTui as any,
      false,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as any,
      false,
    );
    const updateSettings = (
      router as unknown as {
        updateWebUiSettings(patch: {
          model?: string;
          permissionMode?: "auto";
          webSearchEnabled?: boolean;
        }): Promise<{ ok: boolean; message?: string }>;
      }
    ).updateWebUiSettings.bind(router);

    await expect(
      updateSettings({ permissionMode: "auto" }),
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("strict"),
    });
    await expect(
      updateSettings({ model: "unapproved-model" }),
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("model"),
    });
    await expect(
      updateSettings({ webSearchEnabled: true }),
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("web search"),
    });
    expect(config.permissions.mode).toBe("strict");
    expect(config.tools.webSearch.enabled).toBe(false);
  });

  it("should output help message when /help is executed", async () => {
    const router = new CommandRouter(
      "/dummy/cwd",
      mockConfig,
      mockProvider,
      vi.fn(),
      mockLoop as any,
      mockTui as any,
      false,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as any,
      false,
    );

    const result = await router.route("/help");
    expect(result.processed).toBe(true);
    expect(result.shouldExit).toBe(false);
    // useFullscreenTui=false → printOutput → console.log (TUI not active)
    expect(result.processed).toBe(true);
  });

  it("should return processed: false for non-slash command inputs", async () => {
    const router = new CommandRouter(
      "/dummy/cwd",
      mockConfig,
      mockProvider,
      vi.fn(),
      mockLoop as any,
      mockTui as any,
      false,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as any,
      false,
    );

    const result = await router.route("create a login page");
    expect(result.processed).toBe(false);
    expect(result.shouldExit).toBe(false);
  });

  it("should output error message for unknown command", async () => {
    const router = new CommandRouter(
      "/dummy/cwd",
      mockConfig,
      mockProvider,
      vi.fn(),
      mockLoop as any,
      mockTui as any,
      false,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as any,
      false,
    );

    const result = await router.route("/invalidcommand");
    expect(result.processed).toBe(true);
    expect(result.shouldExit).toBe(false);
  });

  it("routes command output through fullscreen TUI when active", async () => {
    const addSystemMessage = vi.fn();
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const tui = {
      ...mockTui,
      isActive: true,
      addSystemMessage,
    };
    const router = new CommandRouter(
      "/dummy/cwd",
      mockConfig,
      mockProvider,
      vi.fn(),
      mockLoop as any,
      tui as any,
      true,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as any,
      false,
    );

    const result = await router.route("/exit");

    expect(result).toEqual({ shouldExit: true, processed: true });
    expect(addSystemMessage).toHaveBeenCalledWith(
      expect.stringContaining("Exiting"),
      false,
    );
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it("keeps the /chat picker open after deleting a session", async () => {
    let sessions = [
      {
        id: "session-1",
        title: "First",
        createdAt: "2026-06-28T01:00:00.000Z",
        model: "deepseek-v4-flash",
      },
      {
        id: "session-2",
        title: "Second",
        createdAt: "2026-06-28T02:00:00.000Z",
        model: "deepseek-v4-flash",
      },
    ];
    const deleteSession = vi.fn((id: string) => {
      sessions = sessions.filter((session) => session.id !== id);
    });
    const askSelectWithDelete = vi
      .spyOn(Prompt, "askSelectWithDelete")
      .mockResolvedValueOnce({ action: "delete", value: "session-1" })
      .mockResolvedValueOnce({ action: "delete", value: "session-2" });
    vi.spyOn(console, "log").mockImplementation(() => {});

    const loop = {
      ...mockLoop,
      state: { sessionId: "active-session" },
      sessionManager: {
        getActiveSession: () => ({ id: "active-session" }),
      },
      getSessions: vi.fn(() => sessions),
      getSessionId: vi.fn(() => "active-session"),
      deleteSession,
      startNewSession: vi.fn(),
      resumeSession: vi.fn(),
    };
    const tui = {
      ...mockTui,
      isActive: false,
      loadHistory: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const router = new CommandRouter(
      "/dummy/cwd",
      mockConfig,
      mockProvider,
      vi.fn(),
      loop as any,
      tui as any,
      false,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as any,
      false,
    );

    const result = await router.route("/chat");

    expect(result).toEqual({ shouldExit: false, processed: true });
    expect(deleteSession).toHaveBeenCalledTimes(2);
    expect(deleteSession).toHaveBeenNthCalledWith(1, "session-1");
    expect(deleteSession).toHaveBeenNthCalledWith(2, "session-2");
    expect(askSelectWithDelete).toHaveBeenCalledTimes(2);
    expect(askSelectWithDelete.mock.calls[0][1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "session-1" }),
        expect.objectContaining({ value: "session-2" }),
      ]),
    );
    expect(askSelectWithDelete.mock.calls[1][1]).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: "session-2" })]),
    );
    expect(askSelectWithDelete.mock.calls[1][1]).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ value: "session-1" })]),
    );
    expect(askSelectWithDelete.mock.calls[1][2]).toEqual(
      expect.objectContaining({ initialSelectedValue: "session-2" }),
    );
  });

  it("silently reloads history after deleting the active session in fullscreen", async () => {
    let sessions = [
      {
        id: "session-1",
        title: "First",
        createdAt: "2026-06-28T01:00:00.000Z",
        model: "deepseek-v4-flash",
      },
      {
        id: "session-2",
        title: "Second",
        createdAt: "2026-06-28T02:00:00.000Z",
        model: "deepseek-v4-flash",
      },
    ];
    const reloadedHistory = [
      {
        role: "user",
        content: [{ type: "text", text: "still here" }],
      },
    ];
    const deleteSession = vi.fn((id: string) => {
      sessions = sessions.filter((session) => session.id !== id);
    });
    const askSelectWithDelete = vi
      .spyOn(Prompt, "askSelectWithDelete")
      .mockResolvedValueOnce({ action: "delete", value: "session-1" })
      .mockResolvedValueOnce({ action: "cancel" });
    const sessionState = { sessionId: "session-1" };
    const loop = {
      ...mockLoop,
      state: sessionState,
      sessionManager: {
        getActiveSession: () => ({ id: "session-1" }),
      },
      getSessions: vi.fn(() => sessions),
      getSessionId: vi.fn(() => sessionState.sessionId),
      getHistory: vi.fn(() => reloadedHistory),
      deleteSession,
      startNewSession: vi.fn(),
      resumeSession: vi.fn((id: string) => {
        sessionState.sessionId = id;
        return true;
      }),
    };
    const tui = {
      ...mockTui,
      isActive: true,
      loadHistory: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const router = new CommandRouter(
      "/dummy/cwd",
      mockConfig,
      mockProvider,
      vi.fn(),
      loop as any,
      tui as any,
      true,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as any,
      false,
    );

    const result = await router.route("/chat");

    expect(result).toEqual({ shouldExit: false, processed: true });
    expect(deleteSession).toHaveBeenCalledWith("session-1");
    expect(loop.resumeSession).toHaveBeenCalledWith("session-2");
    expect(tui.loadHistory).toHaveBeenCalledWith(reloadedHistory, {
      silent: true,
    });
    expect(askSelectWithDelete.mock.calls[0][2]).toEqual(
      expect.objectContaining({ suppressCloseRenderOnDelete: true }),
    );
  });
});
