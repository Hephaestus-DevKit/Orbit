import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Orchestrator } from "./Orchestrator.js";
import { DEFAULT_CONFIG, type OrbitConfig } from "@orbit-build/config";
import { ModelProvider } from "@orbit-build/model-providers";
import fs from "fs";
import path from "path";
import os from "os";
import { WorktreeManager } from "@orbit-build/sandbox";
import { McpRuntimeManager } from "./McpRuntimeManager.js";

// Worktree and process setup can slow down substantially while the full
// Windows suite is running many filesystem-heavy workers in parallel.
const ORCHESTRATOR_TEST_TIMEOUT_MS = 30_000;

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
              try {
                await new Promise((resolve) => setTimeout(resolve, 20));
                yield {
                  type: "text_delta" as const,
                  text: '{"verdict":"approved","feedback":""}',
                };
              } finally {
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
    },
    ORCHESTRATOR_TEST_TIMEOUT_MS,
  );

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
        dummyConfig,
        mockProvider,
        "Test review gate",
        dummyInteraction,
      ).run();

      expect(reviewerCalls).toBe(6);
      expect(merge).not.toHaveBeenCalled();
      expect(discard).toHaveBeenCalledOnce();
    },
    ORCHESTRATOR_TEST_TIMEOUT_MS,
  );
});
