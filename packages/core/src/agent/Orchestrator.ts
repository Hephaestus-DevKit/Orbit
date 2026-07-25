import fs from "fs";
import path from "path";
import { existsSync, statSync } from "fs";
import { z } from "zod";
import type { OrbitConfig } from "@orbit-build/config";
import type { ModelProvider } from "@orbit-build/model-providers";
import { WorktreeManager, type WorktreeSession } from "@orbit-build/sandbox";
import { generateId, redactSecrets } from "@orbit-build/shared";
import { eventBus } from "../events/EventBus.js";
import {
  AgentLoop,
  type AgentLoopRunOutcome,
  type UserInteraction,
} from "./AgentLoop.js";
import { AgentTaskScheduler } from "./AgentTaskScheduler.js";
import type { DurableAgentState } from "@orbit-build/session";
import { AgentRunTracker } from "./AgentRunTracker.js";

const ReviewVerdictSchema = z.object({
  verdict: z.enum(["approved", "rejected"]),
  feedback: z.string().default(""),
});

type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

export class Orchestrator {
  private readonly activeLoops = new Map<string, AgentLoop>();
  private activeTaskScheduler: AgentTaskScheduler | undefined;
  private readonly agentRunTracker: AgentRunTracker;
  private aborted = false;

  constructor(
    private cwd: string,
    private config: OrbitConfig,
    private provider: ModelProvider,
    private task: string,
    private interaction: UserInteraction,
  ) {
    this.agentRunTracker = new AgentRunTracker(
      cwd,
      task,
      config.budgetLimit,
      (message) => this.interaction.showText(`  ⚠️ ${message}`),
    );
  }

  public abort(mode: "prompt" | "immediate" = "prompt"): void {
    this.aborted = true;
    this.activeTaskScheduler?.abort("Orchestration was interrupted.");
    for (const loop of this.activeLoops.values()) loop.abort(mode);
  }

  /** Cancel one active child without discarding unrelated agent state. */
  public abortAgent(agentId: string): boolean {
    const loop = this.activeLoops.get(agentId);
    if (!loop) return false;
    loop.abort("immediate");
    return true;
  }

  public async run(): Promise<AgentLoopRunOutcome> {
    if (this.aborted) {
      return this.abortedOutcome(
        0,
        "Orchestration was aborted before it started.",
      );
    }

    eventBus.emitEvent("agent_start", {
      taskId: "multi-agent-session",
      task: this.task,
    });
    this.agentRunTracker.initialize();
    this.interaction.showText("\n● Starting Multi-Agent Orchestration Flow...");

    const planner = await this.runPlanner();
    if (planner.outcome.status !== "completed") {
      return this.finalizeOutcome(planner.outcome);
    }
    if (this.aborted) {
      return this.finalizeOutcome(
        this.abortedOutcome(0, "Orchestration was interrupted."),
      );
    }
    const planText = planner.plan;
    this.persistPlan(planText);

    const worktrees = new WorktreeManager(this.cwd);
    let worktree: WorktreeSession | undefined;
    let agentCwd = this.cwd;
    let mergeFailed = false;
    let mergeFailureMessage = "";
    let completed = false;
    let completedAttempts = 0;

    if (worktrees.isGitRepo()) {
      try {
        const worktreeId = generateId("wt").slice(0, 12);
        worktree = worktrees.createWorktree(worktreeId, {
          snapshotWorkingTree: true,
        });
        if (
          !existsSync(worktree.path) ||
          !statSync(worktree.path).isDirectory()
        ) {
          throw new Error(
            `Worktree manager returned a missing directory: ${worktree.path}`,
          );
        }
        agentCwd = worktree.path;
        this.interaction.showText(
          `  ● Running Coder and Reviewer in isolated git worktree: ${agentCwd}`,
        );
      } catch (error: unknown) {
        if (worktree) {
          try {
            worktrees.discardWorktree(worktree);
          } catch {
            // Best-effort cleanup before falling back to the main workspace.
          }
          worktree = undefined;
        }
        agentCwd = this.cwd;
        this.interaction.showText(
          `  ⚠️ Worktree unavailable; falling back to the main workspace: ${errorMessage(error)}`,
        );
      }
    } else {
      this.interaction.showText(
        "  ⚠️ Git is unavailable; Coder and Reviewer will use the main workspace.",
      );
    }

    let feedback = "";
    const maxAttempts = 3;
    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (this.aborted) break;
        const coderOutcome = await this.runCoder(
          agentCwd,
          planText,
          feedback,
          attempt,
          maxAttempts,
        );
        if (coderOutcome.status !== "completed") {
          return this.finalizeOutcome(coderOutcome);
        }
        if (this.aborted) break;

        const review = await this.runReviewer(agentCwd, attempt, maxAttempts);
        if (review.outcome.status !== "completed") {
          return this.finalizeOutcome(review.outcome);
        }
        if (review.verdict !== "approved") {
          feedback = review.feedback || "Reviewer rejected the implementation.";
          this.interaction.showText(
            `\n✖ Review rejected attempt ${attempt}/${maxAttempts}: ${feedback}`,
          );
          continue;
        }

        if (worktree) {
          this.interaction.showText(
            "  ● Review approved. Merging verified changes into the main workspace...",
          );
          const mergeResult = worktrees.mergeAndCleanup(worktree);
          if (!mergeResult.success) {
            mergeFailed = true;
            mergeFailureMessage =
              mergeResult.error ||
              mergeResult.conflictFiles?.join(", ") ||
              "unknown merge error";
            this.interaction.showText(
              `  ✖ Merge failed; worktree was preserved at ${worktree.path}: ${errorMessage(mergeFailureMessage)}`,
            );
            break;
          }
          worktree = undefined;
        }

        completed = true;
        completedAttempts = attempt;
        this.interaction.showText(
          "\n✔ Review and merge gates passed. Multi-agent task completed successfully.",
        );
        break;
      }
    } finally {
      this.activeLoops.clear();
      if (worktree && !mergeFailed) {
        try {
          worktrees.discardWorktree(worktree);
        } catch (error: unknown) {
          this.interaction.showText(
            `  ⚠️ Failed to clean temporary worktree: ${errorMessage(error)}`,
          );
        }
      }
    }

    if (!completed && !mergeFailed && !this.aborted) {
      this.interaction.showText(
        `\n✖ Orchestration stopped after ${maxAttempts} rejected attempts; no isolated changes were merged.`,
      );
    }

    if (completed) {
      return this.finalizeOutcome({
        status: "completed",
        sessionId: "multi-agent-session",
        attempts: completedAttempts,
      });
    }
    if (this.aborted) {
      return this.finalizeOutcome(
        this.abortedOutcome(
          completedAttempts,
          "Orchestration was interrupted.",
        ),
      );
    }
    return this.finalizeOutcome(
      this.failedOutcome(
        completedAttempts || maxAttempts,
        mergeFailed
          ? `Failed to merge the reviewed worktree: ${errorMessage(mergeFailureMessage)}`
          : `Orchestration stopped after ${maxAttempts} rejected review attempts.`,
      ),
    );
  }

  private async runPlanner(): Promise<{
    plan: string;
    outcome: AgentLoopRunOutcome;
  }> {
    this.interaction.showText(
      "\n[Phase 1: Planning] Initializing Planner Agent...",
    );
    const tracked = this.addTrackedAgent(
      "planner",
      `Plan: ${this.task}`,
      this.config.models.planner,
      0.15,
      "read",
      ["workspace"],
    );
    const loop = AgentLoop.initialize(
      this.cwd,
      this.config,
      this.provider,
      `Create a detailed implementation plan for: ${this.task}`,
      this.interaction,
      {
        modelOverride: this.config.models.planner,
        systemPromptOverride: `You are the Orbit Planner Agent.
Analyze the codebase and produce a detailed implementation plan.
Do not modify files. Return the plan as plain text.`,
        allowedTools: [
          "read_file",
          "list_files",
          "glob",
          "grep",
          "git_status",
          "git_diff",
          "detect_project",
          "inspect_project",
        ],
        disableMcp: true,
      },
    );
    const activeId = tracked?.id || "planner";
    this.activeLoops.set(activeId, loop);
    this.markAgentRunning(tracked);
    let outcome: AgentLoopRunOutcome | undefined;
    try {
      outcome = await loop.run();
      return {
        plan: lastAssistantText(loop) || "No plan generated.",
        outcome,
      };
    } catch (error: unknown) {
      this.markAgentFailed(tracked, loop, error);
      throw error;
    } finally {
      if (outcome) this.markAgentFinished(tracked, loop, outcome);
      this.activeLoops.delete(activeId);
    }
  }

  private async runCoder(
    cwd: string,
    plan: string,
    feedback: string,
    attempt: number,
    maxAttempts: number,
  ): Promise<AgentLoopRunOutcome> {
    this.interaction.showText(
      `\n[Phase 2: Coding ${attempt}/${maxAttempts}] Initializing Coder Agent...`,
    );
    const prompt = feedback
      ? `Repair the implementation using this reviewer feedback:\n${feedback}\n\nOriginal plan:\n${plan}`
      : `Implement the following plan:\n${plan}`;
    const tracked = this.addTrackedAgent(
      `coder:${attempt}`,
      prompt,
      this.config.models.coder,
      0.45 / maxAttempts,
      "write",
      ["workspace"],
    );
    const loop = AgentLoop.initialize(
      cwd,
      this.config,
      this.provider,
      prompt,
      this.interaction,
      {
        modelOverride: this.config.models.coder,
        systemPromptOverride: `You are the Orbit Coder Agent.
Make precise changes in the current isolated workspace. Do not commit or merge.`,
        allowedTools: [
          "read_file",
          "write_file",
          "edit_file",
          "list_files",
          "glob",
          "grep",
          "git_status",
          "git_diff",
        ],
        disableMcp: true,
      },
    );
    const activeId = tracked?.id || `coder-${attempt}`;
    this.activeLoops.set(activeId, loop);
    this.markAgentRunning(tracked);
    let outcome: AgentLoopRunOutcome | undefined;
    try {
      outcome = await loop.run();
      return outcome;
    } catch (error: unknown) {
      this.markAgentFailed(tracked, loop, error);
      throw error;
    } finally {
      if (outcome) this.markAgentFinished(tracked, loop, outcome);
      this.activeLoops.delete(activeId);
    }
  }

  private async runReviewer(
    cwd: string,
    attempt: number,
    maxAttempts: number,
  ): Promise<ReviewVerdict & { outcome: AgentLoopRunOutcome }> {
    this.interaction.showText(
      `\n[Phase 3: Review ${attempt}/${maxAttempts}] Running correctness and security reviewers in parallel...`,
    );
    const scheduler = new AgentTaskScheduler({ maxConcurrency: 2 });
    this.activeTaskScheduler = scheduler;
    const timeoutMs = this.reviewerTimeoutMs();
    const taskAccess = { mode: "read" as const, scopes: ["workspace"] };
    const scheduled = await (async () => {
      try {
        return await scheduler.run([
          {
            id: `correctness-${attempt}`,
            timeoutMs,
            access: taskAccess,
            run: (signal) =>
              this.runReviewerPerspective(
                cwd,
                "correctness",
                "Review correctness, regressions, tests, and verification evidence.",
                maxAttempts,
                signal,
              ),
          },
          {
            id: `security-${attempt}`,
            timeoutMs,
            access: taskAccess,
            run: (signal) =>
              this.runReviewerPerspective(
                cwd,
                "security",
                "Review security, workspace boundaries, credential handling, and destructive edge cases.",
                maxAttempts,
                signal,
              ),
          },
        ]);
      } finally {
        if (this.activeTaskScheduler === scheduler) {
          this.activeTaskScheduler = undefined;
        }
      }
    })();
    const schedulingFailure = scheduled.find(
      (result) => result.status !== "completed",
    );
    if (schedulingFailure) {
      return {
        verdict: "rejected",
        feedback: schedulingFailure.error.message,
        outcome:
          schedulingFailure.status === "aborted"
            ? this.abortedOutcome(attempt, schedulingFailure.error.message)
            : this.failedOutcome(attempt, schedulingFailure.error.message),
      };
    }
    const reviews = scheduled.flatMap((result) =>
      result.status === "completed" ? [result.value] : [],
    );
    const failedRun = reviews.find(
      (review) => review.outcome.status !== "completed",
    );
    if (failedRun) return failedRun;

    const rejected = reviews.filter((review) => review.verdict === "rejected");
    return {
      verdict: rejected.length === 0 ? "approved" : "rejected",
      feedback: rejected
        .map((review) => review.feedback)
        .filter(Boolean)
        .join(" | "),
      outcome: reviews[0].outcome,
    };
  }

  private reviewerTimeoutMs(): number {
    const provider = this.config.providers[this.config.provider.default];
    const requestTimeout = provider?.requestTimeoutMs ?? 120_000;
    return Math.max(
      30_000,
      Math.min(
        600_000,
        requestTimeout * Math.min(3, this.config.agent.maxIterations),
      ),
    );
  }

  private async runReviewerPerspective(
    cwd: string,
    perspective: "correctness" | "security",
    instruction: string,
    maxAttempts: number,
    signal?: AbortSignal,
  ): Promise<ReviewVerdict & { outcome: AgentLoopRunOutcome }> {
    const tracked = this.addTrackedAgent(
      `reviewer:${perspective}`,
      instruction,
      this.config.models.reviewer,
      0.2 / maxAttempts,
      "read",
      ["workspace"],
    );
    const childId = tracked?.id || generateId(`review-${perspective}`);
    eventBus.emitEvent("agent_spawn", {
      parentId: "multi-agent-session",
      childId,
      role: `reviewer:${perspective}`,
      task: instruction,
    });
    const loop = AgentLoop.initialize(
      cwd,
      this.config,
      this.provider,
      `${instruction} Inspect the current worktree diff and run only relevant read-only verification tasks.`,
      this.interaction,
      {
        modelOverride: this.config.models.reviewer,
        systemPromptOverride: `You are the Orbit Reviewer Agent.
Your assigned perspective is ${perspective}. ${instruction}
Review the current workspace diff and run tests when useful. Do not edit files.
Your final response must be one JSON object with this exact shape:
{"verdict":"approved"|"rejected","feedback":"concise explanation"}`,
        allowedTools: [
          "read_file",
          "list_files",
          "glob",
          "grep",
          "git_status",
          "git_diff",
          ...(perspective === "correctness" ? ["run_tests", "bash"] : []),
        ],
        disableMcp: true,
      },
    );
    const abortLoop = () => loop.abort("immediate");
    if (signal?.aborted) abortLoop();
    signal?.addEventListener("abort", abortLoop, { once: true });
    this.activeLoops.set(childId, loop);
    this.markAgentRunning(tracked);
    let outcome: AgentLoopRunOutcome | undefined;
    try {
      outcome = await loop.run();
      eventBus.emitEvent("agent_completed", {
        taskId: childId,
        success: outcome.status === "completed",
        result: { perspective, status: outcome.status },
      });
      return { ...parseReviewVerdict(lastAssistantText(loop)), outcome };
    } catch (error: unknown) {
      this.markAgentFailed(tracked, loop, error);
      eventBus.emitEvent("agent_completed", {
        taskId: childId,
        success: false,
        error: errorMessage(error),
      });
      throw error;
    } finally {
      if (outcome) this.markAgentFinished(tracked, loop, outcome);
      signal?.removeEventListener("abort", abortLoop);
      this.activeLoops.delete(childId);
    }
  }

  private addTrackedAgent(
    role: string,
    task: string,
    model: string,
    budgetFraction: number,
    mode: "read" | "write",
    scopes: string[],
  ): DurableAgentState | undefined {
    return this.agentRunTracker.add({
      role,
      task,
      model,
      budgetFraction,
      mode,
      scopes,
    });
  }

  private markAgentRunning(agent: DurableAgentState | undefined): void {
    this.agentRunTracker.markRunning(agent);
  }

  private markAgentFinished(
    agent: DurableAgentState | undefined,
    loop: AgentLoop,
    outcome: AgentLoopRunOutcome,
  ): void {
    this.agentRunTracker.markFinished(agent, loop.getSessionCost(), outcome);
  }

  private markAgentFailed(
    agent: DurableAgentState | undefined,
    loop: AgentLoop,
    error: unknown,
  ): void {
    this.agentRunTracker.markFailed(agent, loop.getSessionCost(), error);
  }

  private finalizeOutcome(outcome: AgentLoopRunOutcome): AgentLoopRunOutcome {
    this.agentRunTracker.finish(outcome);
    return outcome;
  }

  private abortedOutcome(
    attempts: number,
    message: string,
  ): AgentLoopRunOutcome {
    return {
      status: "aborted",
      sessionId: "multi-agent-session",
      attempts,
      reason: "interrupted",
      message,
    };
  }

  private failedOutcome(
    attempts: number,
    message: string,
  ): AgentLoopRunOutcome {
    return {
      status: "failed",
      sessionId: "multi-agent-session",
      attempts,
      error: {
        code: "execution_error",
        message: errorMessage(message),
      },
    };
  }

  private persistPlan(plan: string): void {
    try {
      const planPath = path.join(this.cwd, ".orbit", "task.md");
      fs.mkdirSync(path.dirname(planPath), { recursive: true });
      fs.writeFileSync(planPath, plan, "utf8");
      this.interaction.showText("  ✔ Plan saved to .orbit/task.md");
    } catch (error: unknown) {
      this.interaction.showText(
        `  ⚠️ Failed to persist plan: ${errorMessage(error)}`,
      );
    }
  }
}

function lastAssistantText(loop: AgentLoop): string {
  const history = loop.getHistory();
  const message = [...history]
    .reverse()
    .find((item) => item.role === "assistant");
  return (
    message?.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim() || ""
  );
}

function parseReviewVerdict(text: string): ReviewVerdict {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return {
      verdict: "rejected",
      feedback: "Reviewer did not return a structured verdict.",
    };
  }
  try {
    const parsed = ReviewVerdictSchema.safeParse(JSON.parse(match[0]));
    return parsed.success
      ? parsed.data
      : {
          verdict: "rejected",
          feedback: `Invalid reviewer verdict: ${parsed.error.message}`,
        };
  } catch (error: unknown) {
    return {
      verdict: "rejected",
      feedback: `Invalid reviewer JSON: ${errorMessage(error)}`,
    };
  }
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redactSecrets(raw)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}
