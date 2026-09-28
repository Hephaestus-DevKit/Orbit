import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ConfigSchema } from "@orbit-build/config";
import type { AgentLoopRunOutcome } from "@orbit-build/core";
import type { CustomCommand } from "../../commands/customCommands.js";
import { runStructuredWorkflow } from "./WorkflowRunner.js";
import { WorkflowStagesSchema } from "./WorkflowSchema.js";
import { WorkflowStore } from "./WorkflowStore.js";

describe("structured workflow gates and recovery", () => {
  let cwd: string;
  const command: CustomCommand = {
    name: "inspect",
    description: "Inspect",
    template: "Task: $ARGUMENTS",
    source: "project",
    filePath: "inspect.md",
    stages: WorkflowStagesSchema.parse([
      {
        id: "inspect",
        title: "Inspect",
        prompt: "Inspect only",
        artifacts: ["analysis.md"],
      },
      {
        id: "review",
        title: "Review",
        prompt: "Review only",
        artifacts: ["review.md"],
      },
    ]),
  };
  const completed: AgentLoopRunOutcome = {
    status: "completed",
    sessionId: "session",
    attempts: 1,
  };
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-stages-"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(cwd, { recursive: true, force: true });
  });
  const options = () => ({
    cwd,
    command,
    config: ConfigSchema.parse({}).skills,
    sessionId: "session",
    signal: new AbortController().signal,
  });

  it("persists failure, skips completed stages on resume and verifies artifacts", async () => {
    const execute = vi.fn(async (_prompt, stage) => {
      if (stage.id === "inspect")
        writeFileSync(join(cwd, "analysis.md"), "evidence");
      return completed;
    });
    const run = await runStructuredWorkflow({ ...options(), execute });
    expect(run.status).toBe("failed");
    expect(run.stages.map((stage) => stage.status)).toEqual([
      "completed",
      "failed",
    ]);
    expect(new WorkflowStore(cwd).read(run.id)).toEqual(run);
    execute.mockImplementation(async (_prompt, stage) => {
      expect(stage.id).toBe("review");
      const persisted = new WorkflowStore(cwd).read(run.id);
      expect(persisted.stages[1].status).toBe("running");
      writeFileSync(join(cwd, "review.md"), "review evidence");
      return completed;
    });
    expect(
      (await runStructuredWorkflow({ ...options(), resumeId: run.id, execute }))
        .status,
    ).toBe("completed");
    expect(execute).toHaveBeenCalledTimes(3);
    writeFileSync(join(cwd, "analysis.md"), "changed");
    await expect(
      runStructuredWorkflow({ ...options(), resumeId: run.id, execute }),
    ).rejects.toThrow("artifact changed");
    expect(execute).toHaveBeenCalledTimes(3);
  });
  it("does not trust a model completion without a passing verification receipt", async () => {
    const execute = vi.fn(async () => completed);
    const run = await runStructuredWorkflow({
      ...options(),
      command: {
        ...command,
        stages: WorkflowStagesSchema.parse([
          { id: "verify", title: "Verify", prompt: "Test", verification: true },
        ]),
      },
      execute,
    });
    expect(run.status).toBe("failed");
    expect(run.stages[0].error).toContain("passing verification evidence");
  });
  it("never advances after abort, even when the model returns completion", async () => {
    const abort = new AbortController();
    const execute = vi.fn(async () => {
      abort.abort();
      return completed;
    });
    const run = await runStructuredWorkflow({
      ...options(),
      signal: abort.signal,
      execute,
    });
    expect(run.status).toBe("interrupted");
    expect(run.stages[1].status).toBe("pending");
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("rejects changed definitions, sessions and cancellation without invoking the model", async () => {
    const execute = vi.fn(async () => completed);
    const run = await runStructuredWorkflow({ ...options(), execute });
    execute.mockClear();
    await expect(
      runStructuredWorkflow({
        ...options(),
        resumeId: run.id,
        sessionId: "other",
        execute,
      }),
    ).rejects.toThrow("original session");
    await expect(
      runStructuredWorkflow({
        ...options(),
        resumeId: run.id,
        command: { ...command, template: "changed" },
        execute,
      }),
    ).rejects.toThrow("definition changed");
    run.status = "cancelled";
    new WorkflowStore(cwd).save(run);
    await expect(
      runStructuredWorkflow({ ...options(), resumeId: run.id, execute }),
    ).rejects.toThrow("cancelled");
    expect(execute).not.toHaveBeenCalled();
  });
  it("blocks missing stage dependencies before executing", async () => {
    const execute = vi.fn(async () => completed);
    const stages = command.stages!.map((stage) => ({
      ...stage,
      skills: ["missing-skill"],
    }));
    const run = await runStructuredWorkflow({
      ...options(),
      command: { ...command, stages },
      execute,
    });
    expect(run.status).toBe("failed");
    expect(run.stages[0].error).toContain("Missing Skills");
    expect(execute).not.toHaveBeenCalled();
  });
  it("serializes owners and releases locks after model exceptions", async () => {
    const store = new WorkflowStore(cwd);
    const release = store.acquire(false);
    expect(() => store.acquire(true)).toThrow("owner");
    release();
    const run = await runStructuredWorkflow({
      ...options(),
      execute: async () => {
        throw new Error("provider unavailable");
      },
    });
    expect(run.status).toBe("failed");
    store.acquire(false)();
  });
  it("recovers a dead owner only with explicit recovery", () => {
    const store = new WorkflowStore(cwd);
    store.acquire(false)();
    writeFileSync(
      join(cwd, ".orbit/workflow-runs/owner.json"),
      JSON.stringify({
        pid: 999999,
        token: ["4f9dc5ed", "b5f8", "407b", "9b58", "a6e43dbe06ca"].join("-"),
      }),
    );
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("dead"), { code: "ESRCH" });
    });
    expect(() => store.acquire(false)).toThrow("owner");
    store.acquire(true)();
    store.acquire(false)();
  });
  it.each([
    ".git./config",
    "CON.txt",
    "a /b",
    "../escape",
    "/absolute",
    "C:/escape",
    ".orbit/state",
    "a/../../escape",
    "a\\b",
    ".git/config",
  ])("rejects unsafe artifact %s", (path) => {
    expect(
      WorkflowStagesSchema.safeParse([
        { id: "a", title: "A", prompt: "A", artifacts: [path] },
      ]).success,
    ).toBe(false);
  });
  it("rejects duplicate stages, reused artifacts and ungated stages", () => {
    const stage = { id: "a", title: "A", prompt: "A", artifacts: ["a.md"] };
    expect(WorkflowStagesSchema.safeParse([stage, stage]).success).toBe(false);
    expect(
      WorkflowStagesSchema.safeParse([stage, { ...stage, id: "b" }]).success,
    ).toBe(false);
    expect(
      WorkflowStagesSchema.safeParse([{ ...stage, artifacts: [] }]).success,
    ).toBe(false);
    expect(() => new WorkflowStore(cwd).read("../../outside")).toThrow();
  });
  it("stops during asynchronous preflight without starting the model", async () => {
    const abort = new AbortController();
    const execute = vi.fn(async () => completed);
    const pending = runStructuredWorkflow({
      ...options(),
      signal: abort.signal,
      execute,
    });
    abort.abort();
    expect((await pending).status).toBe("interrupted");
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects junction escapes for runtime state and artifacts", async () => {
    const outside = mkdtempSync(join(tmpdir(), "orbit-outside-"));
    try {
      symlinkSync(outside, join(cwd, ".orbit"), "junction");
      expect(() => new WorkflowStore(cwd).acquire(false)).toThrow();
      rmSync(join(cwd, ".orbit"));
      mkdirSync(join(outside, "reports"));
      writeFileSync(join(outside, "reports", "analysis.md"), "external");
      symlinkSync(join(outside, "reports"), join(cwd, "reports"), "junction");
      const run = await runStructuredWorkflow({
        ...options(),
        command: {
          ...command,
          stages: WorkflowStagesSchema.parse([
            {
              id: "a",
              title: "A",
              prompt: "A",
              artifacts: ["reports/analysis.md"],
            },
          ]),
        },
        execute: async () => completed,
      });
      expect(run.status).toBe("failed");
    } finally {
      rmSync(join(cwd, "reports"), { force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
  it("rejects malformed state and locks without deleting their evidence", () => {
    const store = new WorkflowStore(cwd);
    store.acquire(false)();
    writeFileSync(join(cwd, ".orbit/workflow-runs/owner.json"), "{}");
    expect(() => store.acquire(true)).toThrow("unreadable");
    expect(() => store.acquire(true)).toThrow("unreadable");
    const id = "wf_4f9dc5ed-b5f8-407b-9b58-a6e43dbe06ca";
    writeFileSync(join(cwd, `.orbit/workflow-runs/${id}.json`), "{}");
    expect(() => store.read(id)).toThrow();
  });
});
