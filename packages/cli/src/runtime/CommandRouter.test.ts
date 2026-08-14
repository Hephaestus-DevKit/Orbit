import { afterEach, describe, it, expect, vi } from "vitest";
import { BUILTIN_SLASH_COMMANDS, CommandRouter } from "./CommandRouter.js";
import { Prompt } from "@orbit-build/tui";
import { AgentLoop, type AgentLoopRunOutcome } from "@orbit-build/core";
import { applyPermissionModePreset, ConfigSchema } from "@orbit-build/config";
import { runUpdate } from "../commands/update.js";
import { stopOrbitWebUi } from "./webui/index.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execFileSync } from "child_process";
import { AgentRunStore, SessionManager } from "@orbit-build/session";

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
    hasActiveRunnable: vi.fn(() => false),
    syncFromLoop: vi.fn(),
    setPermissionsMode: vi.fn(),
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

  it("prints the Web UI URL without waiting for remote model discovery", async () => {
    const config = ConfigSchema.parse({
      provider: { default: "gateway" },
      providers: {
        gateway: {
          type: "openai-compatible",
          baseUrl: "https://gateway.example/v1",
          apiKey: "test-key",
          disablePreheat: true,
          models: ["model-a"],
        },
      },
      models: { default: "model-a" },
    });
    const tui = { ...mockTui, addSystemMessage: vi.fn() };
    const router = new CommandRouter(
      process.cwd(),
      config,
      { ...mockProvider, id: "gateway" },
      vi.fn(),
      { ...mockLoop, getConfig: () => config } as any,
      tui as any,
      true,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as any,
      false,
    );
    const refresh = vi
      .spyOn(router as any, "refreshProviderModels")
      .mockReturnValue(new Promise<boolean>(() => {}));

    try {
      await expect(router.route("/webui 0")).resolves.toMatchObject({
        processed: true,
      });
      expect(tui.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Orbit Web UI started"),
        false,
        expect.objectContaining({
          label: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/$/),
          url: expect.stringContaining("#token="),
        }),
      );
      expect(refresh).toHaveBeenCalledWith("gateway", { timeoutMs: 2500 });
    } finally {
      await stopOrbitWebUi();
    }
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
      lastProvider: "openai",
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

  it("resumes a persisted child session and closes its durable lifecycle", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-web-resume-"));
    let finishRun: ((outcome: AgentLoopRunOutcome) => void) | undefined;
    const child = {
      prepareUserTurn: vi.fn(),
      run: vi.fn(
        () =>
          new Promise<AgentLoopRunOutcome>((resolve) => {
            finishRun = resolve;
          }),
      ),
      getSessionCost: vi.fn(() => 0.2),
      dispose: vi.fn(async () => undefined),
      abort: vi.fn(),
      enqueueUserInput: vi.fn(),
    };
    vi.spyOn(AgentLoop, "initialize").mockReturnValue(child as never);
    const store = new AgentRunStore(cwd);
    store.initialize();
    const persistedSession = new SessionManager(
      cwd,
      ".orbit/agent-sessions",
    ).startNewSession("openai", "coder-model");
    const run = store.createRun({
      task: "Recover delegated work",
      budgetUsd: 2,
    });
    const agent = store.addAgent(run.id, {
      role: "coder:1",
      task: "Finish the implementation",
      model: "coder-model",
      budgetUsd: 1,
      access: { mode: "write", scopes: ["workspace"] },
    });
    store.updateAgent(run.id, agent.id, {
      status: "failed",
      sessionId: persistedSession.id,
      error: "Previous process exited.",
    });
    store.finishRun(run.id, "failed");
    const tui = {
      ...mockTui,
      hasActiveRunnable: vi.fn(() => false),
      setActiveRunnable: vi.fn(),
      finishAttempt: vi.fn(),
    };
    const router = new CommandRouter(
      cwd,
      mockConfig,
      mockProvider,
      vi.fn(),
      mockLoop as never,
      tui as never,
      true,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as never,
      false,
    );
    const resume = (
      router as unknown as {
        resumeWebUiAgent(
          runId: string,
          agentId: string,
        ): { ok: boolean; message?: string };
      }
    ).resumeWebUiAgent.bind(router);

    try {
      expect(resume(run.id, agent.id)).toEqual({
        ok: true,
        message: "Persisted agent resume started.",
      });
      expect(child.prepareUserTurn).toHaveBeenCalledWith(
        expect.stringContaining("Finish the implementation"),
      );
      expect(router.isWebUiBusy()).toBe(true);
      finishRun?.({
        status: "completed",
        sessionId: persistedSession.id,
        attempts: 1,
      });
      await vi.waitFor(() => {
        expect(store.getRun(run.id)).toMatchObject({
          status: "completed",
          agents: [
            expect.objectContaining({ status: "completed", costUsd: 0.2 }),
          ],
        });
        expect(router.isWebUiBusy()).toBe(false);
      });
      expect(child.dispose).toHaveBeenCalledOnce();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
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
    const refresh = vi
      .spyOn(router as any, "refreshProviderModels")
      .mockReturnValue(new Promise<boolean>(() => {}));

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
    expect(refresh).not.toHaveBeenCalled();
    expect(askSelect.mock.calls[0]?.[2]).toBeUndefined();
  });

  it("switches provider with automatic routing without an implicit refresh", async () => {
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
    const loop = {
      ...mockLoop,
      getConfig: () => config,
      getModelOverride: () => "model-a",
      clearModelOverride: vi.fn(),
      setModelOverride: vi.fn(),
      setProvider: vi.fn(),
    };
    vi.spyOn(Prompt, "askSelect")
      .mockResolvedValueOnce("provider-b")
      .mockResolvedValueOnce("auto");
    const router = new CommandRouter(
      process.cwd(),
      config,
      { ...mockProvider, id: "provider-a" },
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
    const refresh = vi
      .spyOn(router as any, "refreshProviderModels")
      .mockReturnValue(new Promise<boolean>(() => {}));

    await expect(router.route("/model")).resolves.toMatchObject({
      processed: true,
    });

    expect(refresh).not.toHaveBeenCalled();
    expect(config.provider.default).toBe("provider-b");
    expect(loop.clearModelOverride).toHaveBeenCalledOnce();
  });

  it("clears an old model pin when automatic routing switches to an uncatalogued provider", async () => {
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
          models: [],
        },
      },
      models: { default: "model-a" },
    });
    const clearModelOverride = vi.fn();
    const saveState = vi.fn();
    const loop = {
      ...mockLoop,
      getConfig: () => config,
      getModelOverride: () => "model-a",
      clearModelOverride,
      setModelOverride: vi.fn(),
      setProvider: vi.fn(),
    };
    const router = new CommandRouter(
      process.cwd(),
      config,
      { ...mockProvider, id: "provider-a" },
      vi.fn(),
      loop as any,
      mockTui as any,
      true,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      saveState,
      mockInteraction as any,
      false,
    );
    const switchProvider = (
      router as unknown as {
        switchProvider(
          providerId: string,
          model: string,
          options: { refreshCatalog: boolean },
        ): Promise<{ ok: boolean }>;
      }
    ).switchProvider.bind(router);

    await expect(
      switchProvider("provider-b", "__auto__", { refreshCatalog: false }),
    ).resolves.toEqual({ ok: true });

    expect(config.provider.default).toBe("provider-b");
    expect(clearModelOverride).toHaveBeenCalledOnce();
    expect(saveState).toHaveBeenCalledWith({
      lastProvider: "provider-b",
      lastModel: "",
    });
  });

  it("rolls back every provider surface when committing a switch fails", async () => {
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
    const previousProvider = { ...mockProvider, id: "provider-a" };
    const setProviderInstance = vi.fn();
    const setProvider = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("Simulated loop provider failure");
      })
      .mockImplementationOnce(() => {});
    const setModelOverride = vi.fn();
    const loop = {
      ...mockLoop,
      getConfig: () => config,
      getModelOverride: () => "model-a",
      clearModelOverride: vi.fn(),
      setModelOverride,
      setProvider,
    };
    const router = new CommandRouter(
      process.cwd(),
      config,
      previousProvider,
      setProviderInstance,
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
    const switchProvider = (
      router as unknown as {
        switchProvider(
          providerId: string,
          model: string,
          options: { refreshCatalog: boolean },
        ): Promise<{ ok: boolean; message?: string }>;
      }
    ).switchProvider.bind(router);

    await expect(
      switchProvider("provider-b", "model-b", { refreshCatalog: false }),
    ).resolves.toMatchObject({
      ok: false,
      message: "Simulated loop provider failure",
    });

    expect(config.provider.default).toBe("provider-a");
    expect(setProvider).toHaveBeenCalledTimes(2);
    expect(setProvider).toHaveBeenLastCalledWith(previousProvider);
    expect(setProviderInstance).toHaveBeenLastCalledWith(previousProvider);
    expect(setModelOverride).toHaveBeenLastCalledWith("model-a");
  });

  it.each([
    [true, "Model catalog refreshed"],
    [false, "using the cached catalog"],
  ])(
    "refreshes the model catalog only when explicitly requested (success=%s)",
    async (refreshResult, expectedMessage) => {
      const config = ConfigSchema.parse({
        provider: { default: "provider-a" },
        providers: {
          "provider-a": {
            type: "openai-compatible",
            apiKey: "test-key",
            disablePreheat: true,
            models: ["model-a"],
          },
        },
        models: { default: "model-a" },
      });
      const askSelect = vi
        .spyOn(Prompt, "askSelect")
        .mockResolvedValueOnce("provider-a")
        .mockResolvedValueOnce("refresh")
        .mockResolvedValueOnce("cancel");
      const router = new CommandRouter(
        process.cwd(),
        config,
        { ...mockProvider, id: "provider-a" },
        vi.fn(),
        { ...mockLoop, getConfig: () => config } as any,
        mockTui as any,
        true,
        () => ({ commands: [], files: [], symbols: [], sessions: [] }),
        vi.fn(),
        () => localState,
        vi.fn(),
        mockInteraction as any,
        false,
      );
      const refresh = vi
        .spyOn(router as any, "refreshProviderModels")
        .mockResolvedValue(refreshResult);

      await expect(router.route("/model")).resolves.toMatchObject({
        processed: true,
      });

      expect(refresh).toHaveBeenCalledOnce();
      expect(refresh).toHaveBeenCalledWith("provider-a", { timeoutMs: 5000 });
      expect(askSelect.mock.calls[1]?.[1]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: "refresh" }),
          expect.objectContaining({ value: "custom" }),
        ]),
      );
      expect(mockTui.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining(expectedMessage),
        false,
      );
    },
  );

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

  it("applies a combined same-provider model update from the Web UI", async () => {
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
    const setModelOverride = vi.fn();
    const saveState = vi.fn();
    const loop = {
      ...mockLoop,
      getConfig: () => config,
      setModelOverride,
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
      saveState,
      mockInteraction as any,
      false,
    );
    const updateSettings = (
      router as unknown as {
        updateWebUiSettings(patch: {
          provider: string;
          model: string;
        }): Promise<{ ok: boolean }>;
      }
    ).updateWebUiSettings.bind(router);

    await expect(
      updateSettings({
        provider: "deepseek-openai",
        model: "deepseek-v4-pro",
      }),
    ).resolves.toEqual({ ok: true });

    expect(setModelOverride).toHaveBeenCalledWith("deepseek-v4-pro");
    expect(saveState).toHaveBeenCalledWith({
      lastProvider: "deepseek-openai",
      lastModel: "deepseek-v4-pro",
    });
  });

  it("does not partially apply language when a combined provider update is invalid", async () => {
    const config = ConfigSchema.parse({
      language: "en",
      provider: { default: "deepseek-openai" },
      providers: {
        "deepseek-openai": {
          type: "openai-compatible",
          apiKey: "test-key",
          disablePreheat: true,
          models: ["deepseek-v4-flash"],
        },
      },
      models: { default: "deepseek-v4-flash" },
    });
    const saveState = vi.fn();
    const router = new CommandRouter(
      process.cwd(),
      config,
      { ...mockProvider, id: "deepseek-openai" },
      vi.fn(),
      { ...mockLoop, getConfig: () => config } as any,
      mockTui as any,
      false,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      saveState,
      mockInteraction as any,
      false,
    );
    const updateSettings = (
      router as unknown as {
        updateWebUiSettings(patch: {
          language: "zh";
          provider: string;
        }): Promise<{ ok: boolean }>;
      }
    ).updateWebUiSettings.bind(router);

    await expect(
      updateSettings({ language: "zh", provider: "missing-provider" }),
    ).resolves.toMatchObject({ ok: false });

    expect(config.language).toBe("en");
    expect(saveState).not.toHaveBeenCalledWith({ language: "zh" });
  });

  it("rejects Web UI settings while a terminal run owns the runtime", async () => {
    const config = ConfigSchema.parse({
      language: "en",
      provider: { default: "deepseek-openai" },
      providers: {
        "deepseek-openai": {
          type: "openai-compatible",
          apiKey: "test-key",
          disablePreheat: true,
          models: ["deepseek-v4-flash"],
        },
      },
      models: { default: "deepseek-v4-flash" },
    });
    const setModelOverride = vi.fn();
    const saveState = vi.fn();
    const router = new CommandRouter(
      process.cwd(),
      config,
      { ...mockProvider, id: "deepseek-openai" },
      vi.fn(),
      {
        ...mockLoop,
        getConfig: () => config,
        setModelOverride,
      } as any,
      mockTui as any,
      false,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      saveState,
      mockInteraction as any,
      false,
    );
    const releaseRun = router.beginTerminalRun();
    expect(releaseRun).toBeTypeOf("function");
    const updateSettings = (
      router as unknown as {
        updateWebUiSettings(patch: {
          language: "zh";
          model: string;
        }): Promise<{ ok: boolean; message?: string }>;
      }
    ).updateWebUiSettings.bind(router);

    await expect(
      updateSettings({ language: "zh", model: "deepseek-v4-flash" }),
    ).resolves.toEqual({
      ok: false,
      message: "Wait for the active task to finish before changing settings.",
    });

    expect(config.language).toBe("en");
    expect(setModelOverride).not.toHaveBeenCalled();
    expect(saveState).not.toHaveBeenCalled();
    releaseRun?.();
  });

  it("rejects a Web UI model override outside the active provider catalog", async () => {
    const config = ConfigSchema.parse({
      provider: { default: "deepseek" },
      providers: {
        deepseek: {
          type: "openai-compatible",
          baseUrl: "https://api.deepseek.com",
          apiKey: "test-key",
          disablePreheat: true,
          models: ["deepseek-v4-flash", "deepseek-v4-pro"],
        },
      },
      models: { default: "deepseek-v4-flash" },
    });
    const setModelOverride = vi.fn();
    const loop = {
      ...mockLoop,
      getConfig: () => config,
      getModelOverride: () => "DeepSeek-V4-Flash-0731",
      setModelOverride,
    };
    const router = new CommandRouter(
      process.cwd(),
      config,
      { ...mockProvider, id: "deepseek" },
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
          model: string;
        }): Promise<{ ok: boolean; message?: string }>;
      }
    ).updateWebUiSettings.bind(router);

    await expect(
      updateSettings({ model: "DeepSeek-V4-Flash-0731" }),
    ).resolves.toEqual({
      ok: false,
      message:
        "Model is not available for provider deepseek: DeepSeek-V4-Flash-0731",
    });
    expect(setModelOverride).not.toHaveBeenCalled();
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

  it("applies and remembers unrestricted Full Access from the Web UI", async () => {
    const config = ConfigSchema.parse({});
    const saveState = vi.fn();
    const tui = { ...mockTui, setPermissionsMode: vi.fn() };
    const router = new CommandRouter(
      process.cwd(),
      config,
      mockProvider,
      vi.fn(),
      { ...mockLoop, getConfig: () => config } as any,
      tui as any,
      false,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      saveState,
      mockInteraction as any,
      false,
    );
    const updateSettings = (
      router as unknown as {
        updateWebUiSettings(patch: {
          permissionMode: "auto";
        }): Promise<{ ok: boolean; message?: string }>;
      }
    ).updateWebUiSettings.bind(router);

    await expect(updateSettings({ permissionMode: "auto" })).resolves.toEqual({
      ok: true,
    });
    expect(config.permissions).toMatchObject({
      mode: "auto",
      requireApprovalForWrite: false,
      requireApprovalForBash: false,
      blockDangerousCommands: false,
      protectSecrets: false,
    });
    expect(tui.setPermissionsMode).toHaveBeenCalledWith("auto");
    expect(saveState).toHaveBeenCalledWith({ permissionMode: "auto" });
  });

  it("applies and remembers unrestricted Full Access from /mode", async () => {
    const config = ConfigSchema.parse({});
    const saveState = vi.fn();
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
      saveState,
      mockInteraction as any,
      false,
    );

    await expect(router.route("/mode auto")).resolves.toMatchObject({
      processed: true,
    });
    expect(config.permissions).toMatchObject({
      mode: "auto",
      requireApprovalForWrite: false,
      requireApprovalForBash: false,
      blockDangerousCommands: false,
      protectSecrets: false,
    });
    expect(saveState).toHaveBeenCalledWith({ permissionMode: "auto" });
    expect(mockTui.syncFromLoop).toHaveBeenCalledWith(loop);
  });

  it("creates an explicit /commit without a secondary staging prompt in Full Access", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-full-access-commit-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd });
      execFileSync("git", ["config", "user.email", "orbit@example.invalid"], {
        cwd,
      });
      execFileSync("git", ["config", "user.name", "Orbit Test"], { cwd });
      execFileSync("git", ["config", "commit.gpgSign", "false"], { cwd });
      execFileSync("git", ["config", "core.hooksPath", ".git/no-hooks"], {
        cwd,
      });
      writeFileSync(join(cwd, "change.txt"), "ready\n", "utf8");

      const config = ConfigSchema.parse({});
      expect(applyPermissionModePreset(config, "auto")).toEqual({ ok: true });
      const askApproval = vi
        .spyOn(Prompt, "askApproval")
        .mockRejectedValue(new Error("Full Access must not prompt."));
      const router = new CommandRouter(
        cwd,
        config,
        mockProvider,
        vi.fn(),
        { ...mockLoop, getConfig: () => config } as any,
        mockTui as any,
        false,
        () => ({ commands: [], files: [], symbols: [], sessions: [] }),
        vi.fn(),
        () => localState,
        vi.fn(),
        mockInteraction as any,
        false,
      );

      await expect(router.route("/commit test: full access")).resolves.toEqual({
        shouldExit: false,
        processed: true,
      });
      expect(askApproval).not.toHaveBeenCalled();
      expect(
        execFileSync("git", ["show", "-s", "--format=%s", "HEAD"], {
          cwd,
          encoding: "utf8",
        }).trim(),
      ).toBe("test: full access");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
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
    expect(result.input).toBe("create a login page");
  });

  it("returns expanded custom-command text to the agent caller", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-command-router-"));
    try {
      mkdirSync(join(cwd, ".orbit", "commands"), { recursive: true });
      writeFileSync(
        join(cwd, ".orbit", "commands", "math-draft.md"),
        "Use $cumcm-draft to process $ARGUMENTS.",
        "utf8",
      );
      const router = new CommandRouter(
        cwd,
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

      await expect(router.route("/math-draft paper/main.tex")).resolves.toEqual(
        {
          shouldExit: false,
          processed: false,
          input: "Use $cumcm-draft to process paper/main.tex.",
        },
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
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
