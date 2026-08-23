import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Orchestrator } from "./Orchestrator.js";
import { DEFAULT_CONFIG, type OrbitConfig } from "@orbit-build/config";
import { ModelProvider } from "@orbit-build/model-providers";
import fs from "fs";
import path from "path";
import os from "os";
import { WorktreeManager } from "@orbit-build/sandbox";
import { McpRuntimeManager } from "./McpRuntimeManager.js";
import { AgentRunTracker } from "./AgentRunTracker.js";
import { AgentRunStore } from "@orbit-build/session";

// Worktree and process setup can slow down substantially while the full
// Windows suite is running many filesystem-heavy workers in parallel.
const ORCHESTRATOR_TEST_TIMEOUT_MS = 60_000;
const REVIEWER_CONCURRENCY_BARRIER_MS = 15_000;

describe("Orchestrator Multi-Agent Flow", () => {
  let testCwd: string;

  const dummyConfig: OrbitConfig = {
    ...DEFAULT_CONFIG,
    name: "test",
    provider: { default: "openai" },
    models: {
      default: "gpt-4",
      planner: "planner-model",
      coder: "coder-model",
      reviewer: "reviewer-model",
      fast: "fast-model",
      summarizer: "fast-model",
      embedding: "text-embedding-3-small",
    },
    providers: { openai: { type: "openai", apiKey: "test" } },
    permissions: {
      ...DEFAULT_CONFIG.permissions,
      mode: "auto",
      allowRead: true,
      requireApprovalForWrite: false,
      requireApprovalForBash: false,
      blockDangerousCommands: false,
      protectSecrets: false,
      protectedPaths: [],
    },
    context: {
      ...DEFAULT_CONFIG.context,
      maxFilesToIndex: 10,
      maxFileSizeKb: 10,
      ignore: [],
      autoCompact: false,
      compactThreshold: 0.75,
    },
    tools: {
      ...DEFAULT_CONFIG.tools,
      bash: {
        ...DEFAULT_CONFIG.tools.bash,
        enabled: false,
        timeoutMs: 1000,
      },
      webSearch: { ...DEFAULT_CONFIG.tools.webSearch, enabled: false },
      mcp: { ...DEFAULT_CONFIG.tools.mcp, enabled: false },
    },
    mcpServers: {},
    hooks: {},
    session: { store: "jsonl", path: ".orbit/test-sessions" },
  };

  const dummyInteraction = {
    askApproval: async () => true,
    showText: () => {},
    showDiff: () => {},
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    testCwd = path.join(
      os.tmpdir(),
      `orbit-orchestrator-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    fs.mkdirSync(testCwd, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testCwd)) {
      try {
        fs.rmSync(testCwd, { recursive: true, force: true });
      } catch {}
    }
  });

  it(
    "should run the Planner, Coder, and Reviewer flow using Git worktrees when Git is available",
    async () => {
      let plannerCalled = false;
      let coderCalled = false;
      let reviewerCalled = false;
      let activeReviewers = 0;
      let maxActiveReviewers = 0;
      let releaseReviewers: (() => void) | undefined;
      const bothReviewersStarted = new Promise<void>((resolve) => {
        releaseReviewers = resolve;
      });

      const mockProvider: ModelProvider = {
        id: "openai",
        chat: (params: any) => {
          return (async function* () {
            if (params.model === "planner-model") {
              plannerCalled = true;
              yield {
                type: "text_delta" as const,
                text: "Plan: Add a new test file.",
              };
            } else if (params.model === "coder-model") {
              coderCalled = true;
              yield { type: "text_delta" as const, text: "Coder finished." };
            } else if (params.model === "reviewer-model") {
              reviewerCalled = true;
              activeReviewers += 1;
              maxActiveReviewers = Math.max(
                maxActiveReviewers,
                activeReviewers,
              );
              if (activeReviewers === 2) releaseReviewers?.();
              let barrierTimeout: ReturnType<typeof setTimeout> | undefined;
              try {
                await Promise.race([
                  bothReviewersStarted,
                  new Promise<never>(
                    (_resolve, reject) =>
                      (barrierTimeout = setTimeout(
                        () =>
                          reject(
                            new Error(
                              "The second reviewer did not reach the concurrency barrier.",
                            ),
                          ),
                        REVIEWER_CONCURRENCY_BARRIER_MS,
                      )),
                  ),
                ]);
                yield {
                  type: "text_delta" as const,
                  text: '{"verdict":"approved","feedback":""}',
                };
              } finally {
                if (barrierTimeout) clearTimeout(barrierTimeout);
                activeReviewers -= 1;
              }
            }
          })();
        },
      } as any;

      const isGitRepoSpy = vi
        .spyOn(WorktreeManager.prototype, "isGitRepo")
        .mockReturnValue(true);

      const createWorktreeSpy = vi
        .spyOn(WorktreeManager.prototype, "createWorktree")
        .mockImplementation((subagentId) => {
          const worktreePath = path.join(
            testCwd,
            ".orbit",
            "worktrees",
            subagentId,
          );
          fs.mkdirSync(worktreePath, { recursive: true });
          return {
            path: worktreePath,
            branchName: `mock-branch-${subagentId}`,
          };
        });

      const mergeAndCleanupSpy = vi
        .spyOn(WorktreeManager.prototype, "mergeAndCleanup")
        .mockReturnValue({ success: true });
      const mcpStartSpy = vi.spyOn(McpRuntimeManager.prototype, "start");

      const orchestrator = new Orchestrator(
        testCwd,
        {
          ...dummyConfig,
          tools: {
            ...dummyConfig.tools,
            mcp: { enabled: true },
          },
        },
        mockProvider,
        "Test user task",
        dummyInteraction,
      );

      await orchestrator.run();

      expect(plannerCalled).toBe(true);
      expect(coderCalled).toBe(true);
      expect(reviewerCalled).toBe(true);
      expect(maxActiveReviewers).toBe(2);
      expect(mcpStartSpy).not.toHaveBeenCalled();

      // Verify git worktree methods were invoked
      expect(isGitRepoSpy).toHaveBeenCalled();
      expect(createWorktreeSpy).toHaveBeenCalled();
      expect(mergeAndCleanupSpy).toHaveBeenCalled();

      // Verify plan file was written
      const planPath = path.resolve(testCwd, ".orbit", "task.md");
      expect(fs.existsSync(planPath)).toBe(true);
      expect(fs.readFileSync(planPath, "utf8")).toContain(
        "Plan: Add a new test file.",
      );
      const run = new AgentRunStore(testCwd).listRuns(1)[0];
      expect(run?.agents).toHaveLength(4);
      expect(
        run?.agents.map((agent) => ({
          role: agent.role,
          sessionId: agent.sessionId,
        })),
      ).toEqual([
        { role: "planner", sessionId: expect.stringMatching(/^sess_/) },
        { role: "coder:1", sessionId: expect.stringMatching(/^sess_/) },
        {
          role: "reviewer:correctness",
          sessionId: expect.stringMatching(/^sess_/),
        },
        {
          role: "reviewer:security",
          sessionId: expect.stringMatching(/^sess_/),
        },
      ]);
      for (const agent of run?.agents ?? []) {
        expect(
          fs.existsSync(
            path.join(
              testCwd,
              ".orbit",
              "agent-sessions",
              agent.sessionId!,
              "session.json",
            ),
          ),
        ).toBe(true);
      }
      expect(fs.existsSync(path.join(testCwd, ".orbit", "sessions"))).toBe(
        false,
      );
    },
    ORCHESTRATOR_TEST_TIMEOUT_MS,
  );

  it(
    "runs disjoint writers concurrently and reviews one integrated worktree",
    async () => {
      let activeWriters = 0;
      let maxActiveWriters = 0;
      let releaseWriters: (() => void) | undefined;
      const writersStarted = new Promise<void>((resolve) => {
        releaseWriters = resolve;
      });
      const mockProvider: ModelProvider = {
        id: "openai",
        chat: (params: any) =>
          (async function* () {
            if (params.model === "planner-model") {
              yield {
                type: "text_delta" as const,
                text: JSON.stringify({
                  summary: "Implement runtime and documentation independently.",
                  tasks: [
                    {
                      id: "runtime",
                      task: "Implement the runtime change.",
                      scopes: ["src"],
                    },
                    {
                      id: "docs",
                      task: "Document the runtime change.",
                      scopes: ["docs"],
                    },
                  ],
                }),
              };
            } else if (params.model === "coder-model") {
              activeWriters += 1;
              maxActiveWriters = Math.max(maxActiveWriters, activeWriters);
              if (activeWriters === 2) releaseWriters?.();
              try {
                await writersStarted;
                yield {
                  type: "text_delta" as const,
                  text: "Writer completed its isolated assignment.",
                };
              } finally {
                activeWriters -= 1;
              }
            } else if (params.model === "reviewer-model") {
              yield {
                type: "text_delta" as const,
                text: '{"verdict":"approved","feedback":""}',
              };
            }
          })(),
      } as any;
      vi.spyOn(WorktreeManager.prototype, "isGitRepo").mockReturnValue(true);
      vi.spyOn(WorktreeManager.prototype, "createWorktree").mockImplementation(
        (subagentId) => {
          const worktreePath = path.join(
            testCwd,
            ".orbit",
            "worktrees",
            subagentId,
          );
          fs.mkdirSync(worktreePath, { recursive: true });
          return {
            path: worktreePath,
            branchName: `orbit-wt-${subagentId}`,
            baseCommit: "base",
          };
        },
      );
      vi.spyOn(
        WorktreeManager.prototype,
        "listChangedFiles",
      ).mockImplementation((session) =>
        session.path.includes("runtime")
          ? ["src/runtime.ts"]
          : ["docs/runtime.md"],
      );
      const integrate = vi
        .spyOn(WorktreeManager.prototype, "integrateWorktrees")
        .mockReturnValue({ success: true, integratedCount: 2 });
      const merge = vi
        .spyOn(WorktreeManager.prototype, "mergeAndCleanup")
        .mockReturnValue({ success: true });

      const outcome = await new Orchestrator(
        testCwd,
        dummyConfig,
        mockProvider,
        "Implement runtime and documentation",
        dummyInteraction,
      ).run();

      expect(outcome.status).toBe("completed");
      expect(maxActiveWriters).toBe(2);
      expect(integrate).toHaveBeenCalledOnce();
      expect(integrate.mock.calls[0][0]).toHaveLength(2);
      expect(merge).toHaveBeenCalledOnce();
      const roles = new AgentRunStore(testCwd)
        .listRuns(1)[0]
        ?.agents.map((agent) => agent.role);
      expect(roles).toEqual(
        expect.arrayContaining([
          "planner",
          "writer:runtime",
          "writer:docs",
          "reviewer:correctness",
          "reviewer:security",
        ]),
      );
      expect(
        fs.readFileSync(path.join(testCwd, ".orbit", "task.md"), "utf8"),
      ).toContain('"runtime"');
    },
    ORCHESTRATOR_TEST_TIMEOUT_MS,
  );

  it("rejects a parallel writer that escapes its declared ownership", async () => {
    let reviewerCalled = false;
    const mockProvider: ModelProvider = {
      id: "openai",
      chat: (params: any) =>
        (async function* () {
          if (params.model === "planner-model") {
            yield {
              type: "text_delta" as const,
              text: JSON.stringify({
                summary: "Split runtime and docs.",
                tasks: [
                  { id: "runtime", task: "runtime", scopes: ["src"] },
                  { id: "docs", task: "docs", scopes: ["docs"] },
                ],
              }),
            };
          } else if (params.model === "coder-model") {
            yield { type: "text_delta" as const, text: "done" };
          } else if (params.model === "reviewer-model") {
            reviewerCalled = true;
          }
        })(),
    } as any;
    vi.spyOn(WorktreeManager.prototype, "isGitRepo").mockReturnValue(true);
    vi.spyOn(WorktreeManager.prototype, "createWorktree").mockImplementation(
      (subagentId) => {
        const worktreePath = path.join(
          testCwd,
          ".orbit",
          "worktrees",
          subagentId,
        );
        fs.mkdirSync(worktreePath, { recursive: true });
        return {
          path: worktreePath,
          branchName: `orbit-wt-${subagentId}`,
          baseCommit: "base",
        };
      },
    );
    vi.spyOn(WorktreeManager.prototype, "listChangedFiles").mockReturnValue([
      "outside/escape.ts",
    ]);
    const integrate = vi.spyOn(WorktreeManager.prototype, "integrateWorktrees");
    const merge = vi.spyOn(WorktreeManager.prototype, "mergeAndCleanup");
    vi.spyOn(WorktreeManager.prototype, "discardWorktree").mockImplementation(
      () => {},
    );

    const outcome = await new Orchestrator(
      testCwd,
      dummyConfig,
      mockProvider,
      "Test writer scope enforcement",
      dummyInteraction,
    ).run();

    expect(outcome).toMatchObject({
      status: "failed",
      error: { message: expect.stringContaining("outside its ownership") },
    });
    expect(integrate).not.toHaveBeenCalled();
    expect(merge).not.toHaveBeenCalled();
    expect(reviewerCalled).toBe(false);
  });

  it(
    "should fall back to main workspace when Git is not available",
    async () => {
      let plannerCalled = false;
      let coderCalled = false;
      let reviewerCalled = false;

      const mockProvider: ModelProvider = {
        id: "openai",
        chat: (params: any) => {
          return (async function* () {
            if (params.model === "planner-model") {
              plannerCalled = true;
              yield {
                type: "text_delta" as const,
                text: "Plan: Add a new test file.",
              };
            } else if (params.model === "coder-model") {
              coderCalled = true;
              yield { type: "text_delta" as const, text: "Coder finished." };
            } else if (params.model === "reviewer-model") {
              reviewerCalled = true;
              yield {
                type: "text_delta" as const,
                text: '{"verdict":"approved","feedback":""}',
              };
            }
          })();
        },
      } as any;

      const isGitRepoSpy = vi
        .spyOn(WorktreeManager.prototype, "isGitRepo")
        .mockReturnValue(false);

      const createWorktreeSpy = vi.spyOn(
        WorktreeManager.prototype,
        "createWorktree",
      );
      const mergeAndCleanupSpy = vi.spyOn(
        WorktreeManager.prototype,
        "mergeAndCleanup",
      );

      const orchestrator = new Orchestrator(
        testCwd,
        dummyConfig,
        mockProvider,
        "Test user task",
        dummyInteraction,
      );

      await orchestrator.run();

      expect(plannerCalled).toBe(true);
      expect(coderCalled).toBe(true);
      expect(reviewerCalled).toBe(true);

      // Verify isGitRepo checked, but worktrees not used
      expect(isGitRepoSpy).toHaveBeenCalled();
      expect(createWorktreeSpy).not.toHaveBeenCalled();
      expect(mergeAndCleanupSpy).not.toHaveBeenCalled();

      // Verify plan file was written
      const planPath = path.resolve(testCwd, ".orbit", "task.md");
      expect(fs.existsSync(planPath)).toBe(true);
    },
    ORCHESTRATOR_TEST_TIMEOUT_MS,
  );

  it("propagates a coder provider failure without running the reviewer", async () => {
    let reviewerCalled = false;
    const output: string[] = [];
    const mockProvider: ModelProvider = {
      id: "openai",
      chat: (params: any) =>
        (async function* () {
          if (params.model === "planner-model") {
            yield { type: "text_delta" as const, text: "Plan" };
          } else if (params.model === "coder-model") {
            yield {
              type: "error" as const,
              error: new Error("HTTP 401 Bearer orchestration-secret"),
            };
          } else if (params.model === "reviewer-model") {
            reviewerCalled = true;
            yield {
              type: "text_delta" as const,
              text: '{"verdict":"approved","feedback":""}',
            };
          }
        })(),
    } as any;
    vi.spyOn(WorktreeManager.prototype, "isGitRepo").mockReturnValue(false);

    const outcome = await new Orchestrator(
      testCwd,
      dummyConfig,
      mockProvider,
      "Test failed coder outcome",
      {
        ...dummyInteraction,
        showText: (text) => output.push(text),
      },
    ).run();

    expect(outcome).toMatchObject({
      status: "failed",
      error: { code: "provider_error" },
    });
    expect(JSON.stringify(outcome)).not.toContain("orchestration-secret");
    expect(reviewerCalled).toBe(false);
    expect(output.join("\n")).not.toContain(
      "Multi-agent task completed successfully",
    );
  });

  it("steers one active child without cancelling sibling agents", () => {
    const orchestrator = new Orchestrator(
      testCwd,
      dummyConfig,
      { id: "openai" } as ModelProvider,
      "Steer one reviewer",
      dummyInteraction,
    );
    const enqueueUserInput = vi.fn();
    const recordSteering = vi.spyOn(
      AgentRunTracker.prototype,
      "recordSteering",
    );
    (
      orchestrator as unknown as {
        activeLoops: Map<string, { enqueueUserInput: typeof enqueueUserInput }>;
      }
    ).activeLoops.set("agent_steer-test", { enqueueUserInput });

    expect(
      orchestrator.steerAgent(
        "agent_steer-test",
        "Also verify the keyboard flow.",
      ),
    ).toBe(true);
    expect(enqueueUserInput).toHaveBeenCalledWith(
      "Also verify the keyboard flow.",
      { mode: "steer", source: "web" },
    );
    expect(recordSteering).toHaveBeenCalledWith("agent_steer-test");
    expect(orchestrator.steerAgent("agent_missing", "ignored")).toBe(false);
  });

  it(
    "should fall back to main workspace when createWorktree fails",
    async () => {
      let plannerCalled = false;
      let coderCalled = false;
      let reviewerCalled = false;

      const mockProvider: ModelProvider = {
        id: "openai",
        chat: (params: any) => {
          return (async function* () {
            if (params.model === "planner-model") {
              plannerCalled = true;
              yield {
                type: "text_delta" as const,
                text: "Plan: Add a new test file.",
              };
            } else if (params.model === "coder-model") {
              coderCalled = true;
              yield { type: "text_delta" as const, text: "Coder finished." };
            } else if (params.model === "reviewer-model") {
              reviewerCalled = true;
              yield {
                type: "text_delta" as const,
                text: '{"verdict":"approved","feedback":""}',
              };
            }
          })();
        },
      } as any;

      const isGitRepoSpy = vi
        .spyOn(WorktreeManager.prototype, "isGitRepo")
        .mockReturnValue(true);

      const createWorktreeSpy = vi
        .spyOn(WorktreeManager.prototype, "createWorktree")
        .mockImplementation(() => {
          throw new Error("Simulated worktree creation error");
        });

      const mergeAndCleanupSpy = vi.spyOn(
        WorktreeManager.prototype,
        "mergeAndCleanup",
      );

      const orchestrator = new Orchestrator(
        testCwd,
        dummyConfig,
        mockProvider,
        "Test user task",
        dummyInteraction,
      );

      await orchestrator.run();

      expect(plannerCalled).toBe(true);
      expect(coderCalled).toBe(true);
      expect(reviewerCalled).toBe(true);

      // Verify isGitRepo and createWorktree called, but mergeAndCleanup not called due to failure
      expect(isGitRepoSpy).toHaveBeenCalled();
      expect(createWorktreeSpy).toHaveBeenCalled();
      expect(mergeAndCleanupSpy).not.toHaveBeenCalled();

      // Verify plan file was written
      const planPath = path.resolve(testCwd, ".orbit", "task.md");
      expect(fs.existsSync(planPath)).toBe(true);
    },
    ORCHESTRATOR_TEST_TIMEOUT_MS,
  );

  it(
    "does not merge rejected or malformed reviewer verdicts",
    async () => {
      let reviewerCalls = 0;
      const mockProvider: ModelProvider = {
        id: "openai",
        chat: (params: any) =>
          (async function* () {
            if (params.model === "planner-model") {
              yield { type: "text_delta" as const, text: "Plan" };
            } else if (params.model === "coder-model") {
              yield { type: "text_delta" as const, text: "Coder finished" };
            } else if (params.model === "reviewer-model") {
              reviewerCalls++;
              yield {
                type: "text_delta" as const,
                text:
                  reviewerCalls === 1
                    ? "NOT APPROVED"
                    : '{"verdict":"rejected","feedback":"tests failed"}',
              };
            }
          })(),
      } as any;
      vi.spyOn(WorktreeManager.prototype, "isGitRepo").mockReturnValue(true);
      vi.spyOn(WorktreeManager.prototype, "createWorktree").mockImplementation(
        () => {
          const worktreePath = path.join(
            testCwd,
            ".orbit",
            "worktrees",
            "review-gate",
          );
          fs.mkdirSync(worktreePath, { recursive: true });
          return {
            path: worktreePath,
            branchName: "orbit-wt-review-gate-test",
          };
        },
      );
      const merge = vi.spyOn(WorktreeManager.prototype, "mergeAndCleanup");
      const discard = vi
        .spyOn(WorktreeManager.prototype, "discardWorktree")
        .mockImplementation(() => {});

      await new Orchestrator(
        testCwd,
        {
          ...dummyConfig,
          agent: { ...dummyConfig.agent, maxReviewAttempts: 1 },
        },
        mockProvider,
        "Test review gate",
        dummyInteraction,
      ).run();

      expect(reviewerCalls).toBe(2);
      expect(merge).not.toHaveBeenCalled();
      expect(discard).toHaveBeenCalledOnce();
    },
    ORCHESTRATOR_TEST_TIMEOUT_MS,
  );
});
