import { applyPermissionModePreset, ConfigSchema } from "@orbit-build/config";
import { describe, expect, it } from "vitest";
import {
  collectWebUiApproval,
  collectWebUiMessagePage,
  collectWebUiMessages,
  collectWebUiSettings,
  collectWebUiStatus,
  filterWebUiCompletionFiles,
  summarizeWebUiBackgroundTasks,
  summarizeWebUiReview,
  summarizeWebUiContextFiles,
} from "./WebUiData.js";

describe("WebUiData", () => {
  it("reports the effective unrestricted Full Access state", () => {
    const config = ConfigSchema.parse({});
    applyPermissionModePreset(config, "auto");

    expect(
      collectWebUiStatus({ cwd: "D:/repo", config }, undefined).permissions,
    ).toEqual({
      mode: "auto",
      fullAccess: true,
      writeApproval: false,
      commandApproval: false,
      dangerousCommandsBlocked: false,
      secretsProtected: false,
      workspaceBoundary: false,
    });
  });

  it("does not label auto mode as Full Access when reads are disabled", () => {
    const config = ConfigSchema.parse({
      permissions: {
        mode: "auto",
        allowRead: false,
        requireApprovalForWrite: false,
        requireApprovalForBash: false,
      },
    });

    expect(
      collectWebUiStatus({ cwd: "D:/repo", config }, undefined).permissions
        .fullAccess,
    ).toBe(false);
  });

  it("reports the effective bounded agent-team recipe", () => {
    const status = collectWebUiStatus(
      {
        cwd: "D:/repo",
        config: ConfigSchema.parse({
          agent: {
            teamPreset: "thorough",
            maxReviewAttempts: 2,
            maxReviewConcurrency: 3,
          },
        }),
      },
      undefined,
    );

    expect(status.agentTeam).toEqual({
      preset: "thorough",
      maxReviewAttempts: 2,
      maxReviewConcurrency: 3,
    });
  });

  it("reports the effective long-task iteration limit", () => {
    const config = ConfigSchema.parse({
      agent: { maxIterations: 500 },
    });

    expect(
      collectWebUiStatus({ cwd: "D:/repo", config }, undefined).agent,
    ).toEqual({ maxIterations: 500 });
    expect(collectWebUiSettings({ cwd: "D:/repo", config })).toMatchObject({
      agentMaxIterations: 500,
    });
  });

  it("marks session cost unknown when the active model has no pricing", () => {
    const status = collectWebUiStatus(
      {
        cwd: "D:/repo",
        config: ConfigSchema.parse({}),
        loop: {
          getSessionCost: () => 0,
          isSessionCostKnown: () => false,
        },
      },
      undefined,
    );

    expect(status.session).toMatchObject({ cost: 0, costKnown: false });
  });

  it("bounds background task metadata without forwarding process details", () => {
    const tasks = summarizeWebUiBackgroundTasks(
      Array.from({ length: 70 }, (_, index) => ({
        id: `bg_${String(index).padStart(16, "0")}`,
        status: index === 0 ? "running" : "completed",
        startedAt: "2026-08-03T10:00:00.000Z",
        durationMs: 12,
        exitCode: index === 0 ? null : 0,
        outputTruncated: false,
        command: "Bearer private-command-token",
        cwd: "C:/private/workspace",
        stdout: "private output",
      })),
    );

    expect(tasks).toHaveLength(64);
    expect(tasks[0]).toMatchObject({ status: "running", durationMs: 12 });
    expect(JSON.stringify(tasks)).not.toContain("private");
  });

  it("redacts and bounds pending browser approvals", () => {
    expect(
      collectWebUiApproval({
        id: "approval-123",
        kind: "change",
        title: "Review src/index.ts",
        reason: "Bearer private-token-value",
        preview: "+ token=private-token-value\n- old line",
        agentId: "agent_security-1",
        agentRole: "reviewer:security Bearer private-token-value",
        requestedAt: "2026-07-17T00:00:00.000Z",
      }),
    ).toMatchObject({
      id: "approval-123",
      kind: "change",
      reason: "Bearer ***REDACTED***",
      agentId: "agent_security-1",
      agentRole: "reviewer:security Bearer ***REDACTED***",
    });
    expect(
      collectWebUiApproval({ id: "bad", kind: "invalid" }),
    ).toBeUndefined();
  });

  it("ranks safe workspace file completions and rejects traversal paths", () => {
    expect(
      filterWebUiCompletionFiles(
        [
          "packages/cli/src/index.ts",
          "src/index.ts",
          "README.md",
          "../outside.txt",
          "C:/outside.txt",
          "src\\runtime\\indexer.ts",
          "src/index.ts",
        ],
        "index",
      ),
    ).toEqual([
      "src/index.ts",
      "src/runtime/indexer.ts",
      "packages/cli/src/index.ts",
    ]);

    expect(
      filterWebUiCompletionFiles(["src/deep/file.ts", "README.md"], ""),
    ).toEqual(["README.md", "src/deep/file.ts"]);
  });

  it("summarizes active context without exposing unsafe or duplicate paths", () => {
    expect(
      summarizeWebUiContextFiles(
        [
          { path: "src\\index.ts", readOnly: false },
          { path: "./docs/README.md", readOnly: true },
          { path: "src/index.ts", readOnly: true },
          { path: "../outside.txt" },
          { path: "C:/outside.txt" },
          { path: "bad\ncommand.ts" },
        ],
        1,
      ),
    ).toEqual({
      files: [{ path: "src/index.ts", readOnly: false }],
      total: 2,
      truncated: true,
    });
  });

  it("filters internal context and narrows message blocks", () => {
    const messages = collectWebUiMessages({
      getHistory: () => [
        { role: "system", content: "private system prompt" },
        {
          role: "user",
          metadata: { kind: "orbit_volatile_context" },
          content: "private context",
        },
        {
          id: "visible",
          role: "assistant",
          metadata: { model: "deepseek-v4-pro" },
          content: [
            { type: "thinking", text: "checking" },
            { type: "text", text: "done" },
            {
              type: "tool_result",
              toolResult: { name: "read_file", isError: false },
            },
          ],
        },
      ],
    });

    expect(messages).toEqual([
      {
        id: "visible",
        role: "assistant",
        createdAt: undefined,
        model: "deepseek-v4-pro",
        text: "done",
        blocks: [
          { type: "thinking", text: "checking" },
          { type: "text", text: "done" },
          {
            type: "tool",
            id: "",
            name: "read_file",
            status: "success",
          },
        ],
      },
    ]);
  });

  it("paginates long conversations from the newest messages with stable positions", () => {
    const history = Array.from({ length: 145 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      createdAt: new Date(Date.UTC(2026, 6, 1, 0, index)).toISOString(),
      content: `message ${index}`,
    }));
    const loop = {
      getSessionId: () => "session-long",
      getHistory: () => history,
    };

    const latest = collectWebUiMessagePage(loop);
    expect(latest.page).toEqual({
      sessionId: "session-long",
      total: 145,
      start: 85,
      end: 145,
      hasEarlier: true,
      nextBefore: 85,
    });
    expect(latest.messages[0]).toMatchObject({
      id: "message-85",
      position: 85,
    });
    expect(latest.messages.at(-1)).toMatchObject({
      id: "message-144",
      position: 144,
    });

    const earlier = collectWebUiMessagePage(loop, {
      before: latest.page.nextBefore,
      limit: 40,
    });
    expect(earlier.page).toMatchObject({
      start: 45,
      end: 85,
      hasEarlier: true,
      nextBefore: 45,
    });
    expect(earlier.messages).toHaveLength(40);
  });

  it("reports image metadata without exposing base64 payloads", () => {
    const messages = collectWebUiMessages({
      getHistory: () => [
        {
          id: "image-message",
          role: "user",
          content: [
            { type: "text", text: "Explain this screenshot" },
            {
              type: "image",
              name: "error.png",
              mediaType: "image/png",
              data: "private-base64-payload",
            },
          ],
        },
      ],
    });

    expect(messages).toEqual([
      expect.objectContaining({
        text: "Explain this screenshot",
        blocks: [
          { type: "text", text: "Explain this screenshot" },
          { type: "image", name: "error.png", mediaType: "image/png" },
        ],
      }),
    ]);
    expect(JSON.stringify(messages)).not.toContain("private-base64-payload");
  });

  it("bounds and sanitizes change review data", () => {
    const review = summarizeWebUiReview({
      fileChanges: [
        {
          id: "change-1",
          path: "src\\index.ts",
          diff: "+ Authorization: Bearer private-token",
          createdAt: "2026-07-22T00:00:00.000Z",
        },
        { id: "escape", path: "../secret.txt", diff: "private" },
      ],
      checkpoints: [
        {
          id: "checkpoint-1",
          timestamp: "2026-07-22T00:00:00.000Z",
          toolCallId: "tool-1",
          files: ["src/index.ts", "../secret.txt"],
        },
      ],
      toolCalls: [
        {
          id: "tool-1",
          toolName: "bash",
          inputJson: '{"authorization":"Bearer private-token"}',
          outputJson: "private output",
          risk: "execute",
          permissionDecision: "ask",
          status: "success",
          startedAt: "2026-07-22T00:00:00.000Z",
          endedAt: "2026-07-22T00:00:01.250Z",
        },
      ],
      verification: [{ success: false, detail: "Bearer private-token" }],
    });

    expect(review.fileChanges).toEqual([
      expect.objectContaining({
        id: "change-1",
        path: "src/index.ts",
        diff: "+ Authorization: Bearer ***REDACTED***",
      }),
    ]);
    expect(review.checkpoints[0]?.files).toEqual(["src/index.ts"]);
    expect(review.toolCalls).toEqual([
      {
        id: "tool-1",
        name: "bash",
        risk: "execute",
        decision: "ask",
        status: "success",
        startedAt: "2026-07-22T00:00:00.000Z",
        endedAt: "2026-07-22T00:00:01.250Z",
        durationMs: 1250,
      },
    ]);
    expect(JSON.stringify(review)).not.toContain("private output");
    expect(review.verification[0]?.detail).toBe("Bearer ***REDACTED***");
  });

  it("merges tool results into credential-safe invocation summaries", () => {
    const messages = collectWebUiMessages({
      getHistory: () => [
        {
          id: "assistant-tool",
          role: "assistant",
          content: [
            {
              type: "tool_call",
              toolCall: {
                id: "tool-1",
                name: "read_file",
                arguments: JSON.stringify({
                  path: "src/index.ts",
                  content: "must not be exposed",
                  apiKey: "private-token",
                }),
              },
            },
          ],
        },
        {
          id: "tool-result",
          role: "tool",
          content: [
            {
              type: "tool_result",
              toolResult: {
                toolCallId: "tool-1",
                name: "read_file",
                content: "private file contents",
                isError: false,
              },
            },
          ],
        },
        {
          id: "assistant-final",
          role: "assistant",
          content: [{ type: "text", text: "done" }],
        },
      ],
    });

    expect(messages).toEqual([
      expect.objectContaining({
        id: "assistant-tool",
        blocks: [
          {
            type: "tool",
            id: "tool-1",
            name: "read_file",
            status: "success",
            detail: "path: src/index.ts",
          },
          { type: "text", text: "done" },
        ],
        text: "done",
      }),
    ]);
    expect(JSON.stringify(messages)).not.toMatch(
      /must not be exposed|private-token|private file contents/,
    );
  });

  it("keeps a bounded web-search quality summary without exposing results", () => {
    const messages = collectWebUiMessages({
      getHistory: () => [
        {
          id: "assistant-search",
          role: "assistant",
          content: [
            {
              type: "tool_call",
              toolCall: {
                id: "search-1",
                name: "web_search",
                arguments: JSON.stringify({ query: "今日科技新闻" }),
              },
            },
          ],
        },
        {
          id: "search-result",
          role: "tool",
          content: [
            {
              type: "tool_result",
              toolResult: {
                toolCallId: "search-1",
                name: "web_search",
                content:
                  "web_search result: Web search returned 5 results via Google News RSS (quality: high, score=0.88).\n[1] private result body",
                isError: false,
              },
            },
          ],
        },
      ],
    });

    expect(messages[0]?.blocks).toEqual([
      {
        type: "tool",
        id: "search-1",
        name: "web_search",
        status: "success",
        detail: "query: 今日科技新闻",
        summary:
          "Web search returned 5 results via Google News RSS (quality: high, score=0.88).",
      },
    ]);
    expect(JSON.stringify(messages)).not.toContain("private result body");
  });

  it("places the live model override first and removes duplicates", () => {
    const config = ConfigSchema.parse({
      provider: { default: "deepseek-openai" },
      providers: {
        "deepseek-openai": {
          type: "openai-compatible",
          models: ["deepseek-v4-pro", "deepseek-v4-flash"],
        },
      },
    });
    const settings = collectWebUiSettings({
      cwd: "D:/repo",
      config,
      loop: { getModelOverride: () => "deepseek-v4-pro" },
    });

    expect(settings.model).toBe("deepseek-v4-pro");
    expect(settings.modelOptions[0]?.id).toBe("deepseek-v4-pro");
    expect(
      settings.modelOptions.filter(({ id }) => id === "deepseek-v4-pro"),
    ).toHaveLength(1);
    expect(settings.modelOptions.map(({ id }) => id)).toEqual([
      "deepseek-v4-pro",
      "__auto__",
      "deepseek-v4-flash",
    ]);
    expect(settings.modelOptions.map(({ label }) => label)).toEqual([
      "deepseek-v4-pro",
      "Auto · deepseek-v4-flash / deepseek-v4-pro",
      "deepseek-v4-flash",
    ]);
  });

  it("does not mix global role models into the active provider picker", () => {
    const config = ConfigSchema.parse({
      provider: { default: "deepseek" },
      providers: {
        deepseek: {
          type: "openai-compatible",
          baseUrl: "https://api.deepseek.com",
          models: ["deepseek-v4-flash", "deepseek-v4-pro"],
        },
      },
      models: {
        default: "stale-default-model",
        planner: "stale-planner-model",
        coder: "stale-coder-model",
      },
    });

    const settings = collectWebUiSettings({ cwd: "D:/repo", config });

    expect(settings.modelOptions).toEqual([
      {
        id: "__auto__",
        label: "Auto · deepseek-v4-flash / deepseek-v4-pro",
      },
      { id: "deepseek-v4-flash", label: "deepseek-v4-flash" },
      { id: "deepseek-v4-pro", label: "deepseek-v4-pro" },
    ]);
  });

  it("exposes provider choices with catalog sizes but never credentials", () => {
    const config = ConfigSchema.parse({
      provider: { default: "tokendance" },
      providers: {
        tokendance: {
          type: "openai-compatible",
          baseUrl: "https://tokendance.space/gateway/v1",
          apiKey: "must-not-reach-the-browser",
          models: ["deepseek-v4-flash", "deepseek-v4-pro"],
        },
        ollama: {
          type: "ollama",
          baseUrl: "http://127.0.0.1:11434",
          models: ["qwen3"],
        },
      },
    });
    const status = collectWebUiStatus(
      {
        cwd: "D:/repo",
        config,
        loop: { getModelOverride: () => "deepseek-v4-pro" },
      },
      undefined,
    );

    expect(status.provider).toMatchObject({
      id: "tokendance",
      options: expect.arrayContaining([
        expect.objectContaining({ id: "tokendance", modelCount: 2 }),
        expect.objectContaining({ id: "ollama", modelCount: 1 }),
      ]),
    });
    expect(JSON.stringify(status)).not.toContain("must-not-reach-the-browser");
  });

  it("reports model-aware context usage without exposing prompt data", () => {
    const config = ConfigSchema.parse({
      provider: { default: "deepseek-openai" },
      providers: { "deepseek-openai": { type: "openai-compatible" } },
    });
    const status = collectWebUiStatus(
      {
        cwd: "D:/repo",
        config,
        loop: {
          getContextWindowStatus: () => ({
            model: "deepseek-v4-pro",
            maxContextTokens: 128_000,
            compactAtTokens: 96_000,
            estimatedHistoryTokens: 24_000,
            utilization: 0.1875,
          }),
        },
      },
      undefined,
    );

    expect(status.context).toMatchObject({
      model: "deepseek-v4-pro",
      maxContextTokens: 128_000,
      compactAtTokens: 96_000,
      estimatedHistoryTokens: 24_000,
      utilization: 0.1875,
    });
  });

  it("reports the shared input queue without exposing attachment bodies", () => {
    const config = ConfigSchema.parse({});
    const status = collectWebUiStatus(
      {
        cwd: "D:/repo",
        config,
        loop: {
          getQueuedInputs: () => [
            {
              id: "input_web_1",
              mode: "steer",
              source: "web",
              text: "Keep Bearer private-queue-secret out of the UI.",
              attachments: [
                {
                  type: "image",
                  mediaType: "image/png",
                  data: "private-image-body",
                },
              ],
              createdAt: "2026-08-03T01:00:00.000Z",
            },
          ],
        },
      },
      undefined,
    );

    expect(status.inputQueue).toEqual([
      {
        id: "input_web_1",
        mode: "steer",
        source: "web",
        text: "Keep Bearer ***REDACTED*** out of the UI.",
        attachmentCount: 1,
        createdAt: "2026-08-03T01:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(status.inputQueue)).not.toContain(
      "private-image-body",
    );
  });

  it("reports a bounded crash-recovery summary", () => {
    const config = ConfigSchema.parse({});
    const status = collectWebUiStatus(
      {
        cwd: "D:/repo",
        config,
        loop: {
          getRecoveryReport: () => ({
            sessionId: "sess_recovered",
            previousState: "awaiting_approval",
            previousPhase: "tool:bash",
            attempt: 4,
            recoveryCount: 2,
            repairedToolCalls: 1,
            resetPlanItems: 3,
            recoveredAt: "2026-07-22T06:00:00.000Z",
          }),
        },
      },
      undefined,
    );

    expect(status.session.recovery).toEqual({
      sessionId: "sess_recovered",
      previousState: "awaiting_approval",
      previousPhase: "tool:bash",
      attempt: 4,
      recoveryCount: 2,
      repairedToolCalls: 1,
      resetPlanItems: 3,
      recoveredAt: "2026-07-22T06:00:00.000Z",
    });
  });

  it("exposes a bounded credential-safe project registry", () => {
    const config = ConfigSchema.parse({});
    const status = collectWebUiStatus(
      {
        cwd: "D:/repo",
        config,
        getProjects: () => [
          {
            id: "project-1",
            path: "D:/work/Bearer private-project-token",
            name: "Bearer private-project-token",
            lastOpenedAt: "2026-07-18T10:00:00.000Z",
            available: true,
          },
          ...Array.from({ length: 30 }, (_, index) => ({
            id: `project-${index + 2}`,
            path: `D:/work/project-${index + 2}`,
            name: `Project ${index + 2}`,
            lastOpenedAt: "2026-07-18T09:00:00.000Z",
            available: false,
          })),
        ],
      },
      undefined,
    );

    expect(status.projects).toHaveLength(20);
    expect(status.projects[0]).toEqual({
      id: "project-1",
      path: "D:/work/Bearer ***REDACTED***",
      name: "Bearer ***REDACTED***",
      lastOpenedAt: "2026-07-18T10:00:00.000Z",
      available: true,
    });
    expect(JSON.stringify(status.projects)).not.toContain(
      "private-project-token",
    );
  });

  it("returns every project chat with the active chat first", () => {
    const config = ConfigSchema.parse({
      provider: { default: "deepseek-openai" },
      providers: { "deepseek-openai": { type: "openai-compatible" } },
    });
    const status = collectWebUiStatus(
      {
        cwd: "D:/repo",
        config,
        loop: {
          getSessionId: () => "sess-active",
          getSessions: () => [
            ...Array.from({ length: 40 }, (_, index) => ({
              id: `sess-history-${index}`,
              title: `Historical chat ${index}`,
              model: "deepseek-v4-flash",
              updatedAt: `2026-07-${String(14 - Math.floor(index / 24)).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
            })),
            {
              id: "sess-older",
              title: "Older task",
              model: "deepseek-v4-flash",
              updatedAt: "2026-07-15T12:00:00.000Z",
            },
            {
              id: "sess-archived",
              title: "Archived task",
              model: "deepseek-v4-flash",
              updatedAt: "2026-07-15T13:00:00.000Z",
              archivedAt: "2026-07-15T14:00:00.000Z",
            },
            {
              id: "sess-active",
              title: "Fix Bearer private-secret-value",
              model: "deepseek-v4-pro",
              updatedAt: "2026-07-15T11:00:00.000Z",
            },
          ],
        },
      },
      undefined,
    );

    expect(status.session.recent).toHaveLength(42);
    expect(status.session.recent[0]).toEqual(
      expect.objectContaining({
        id: "sess-active",
        active: true,
        title: "Fix Bearer ***REDACTED***",
      }),
    );
    expect(status.session.recent.map((session) => session.id)).toEqual(
      expect.arrayContaining([
        "sess-older",
        "sess-history-0",
        "sess-history-39",
      ]),
    );
    expect(status.session.archived).toEqual([
      expect.objectContaining({
        id: "sess-archived",
        active: false,
        archived: true,
      }),
    ]);
  });
});
