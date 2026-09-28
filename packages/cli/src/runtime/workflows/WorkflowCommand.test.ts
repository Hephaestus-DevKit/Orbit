import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ConfigSchema } from "@orbit-build/config";
import { eventBus } from "@orbit-build/core";
import { createProjectCapability } from "../CapabilityScaffolder.js";
import {
  handleWorkflowCommand,
  type WorkflowCommandContext,
} from "./WorkflowCommand.js";
import { WorkflowStagesSchema } from "./WorkflowSchema.js";

describe("workflow command lifecycle", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-workflow-command-"));
    await createProjectCapability(cwd, {
      kind: "workflow",
      name: "staged-review",
      description: "Review",
      instructions: "Inspect $ARGUMENTS",
      skills: [],
      stages: WorkflowStagesSchema.parse([
        { id: "one", title: "One", prompt: "Inspect", artifacts: ["one.md"] },
        { id: "two", title: "Two", prompt: "Review", artifacts: ["two.md"] },
      ]),
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(cwd, { recursive: true, force: true });
  });
  function fixture() {
    const loop = {
      getSessionId: () => "session",
      invalidateSkillsCache: vi.fn(),
      prepareUserTurn: vi.fn(),
      abort: vi.fn(),
      setUserInteraction: vi.fn(),
      run: vi.fn(async () => ({
        status: "completed",
        sessionId: "session",
        attempts: 1,
      })),
    };
    const tui = {
      hasActiveRunnable: () => false,
      setActiveRunnable: vi.fn(),
      startThinkingInput: vi.fn(),
      stopThinkingInput: vi.fn(),
      syncFromLoop: vi.fn(),
      finishAttempt: vi.fn(),
    };
    const context = {
      cwd,
      config: ConfigSchema.parse({}),
      loop,
      tui,
      source: "web",
      interaction: {},
      restoreInteraction: {},
      print: vi.fn(),
      rememberSession: vi.fn(),
    } as unknown as WorkflowCommandContext;
    return { context, loop, tui };
  }
  it("runs both stages with one UI lifecycle and restores approvals and runnable ownership", async () => {
    const { context, loop, tui } = fixture();
    let stage = 0;
    loop.run.mockImplementation(async () => {
      writeFileSync(join(cwd, ++stage === 1 ? "one.md" : "two.md"), "evidence");
      return { status: "completed", sessionId: "session", attempts: 1 };
    });
    const events = vi.spyOn(eventBus, "emitEvent");
    expect(
      await handleWorkflowCommand("/workflow run staged-review scope", context),
    ).not.toHaveProperty("error");
    expect(loop.run).toHaveBeenCalledTimes(2);
    expect(
      events.mock.calls.filter(([name]) => name === "ui_turn_started"),
    ).toHaveLength(1);
    expect(
      events.mock.calls.filter(([name]) => name === "ui_turn_completed"),
    ).toHaveLength(1);
    expect(tui.setActiveRunnable).toHaveBeenLastCalledWith(null);
    expect(loop.setUserInteraction).toHaveBeenLastCalledWith(
      context.restoreInteraction,
    );
    expect(context.rememberSession).toHaveBeenCalledTimes(2);
    expect(tui.startThinkingInput).not.toHaveBeenCalled();
  });
  it("routes user cancellation to the model and never starts the next stage", async () => {
    const { context, loop, tui } = fixture();
    let active: { abort(): void } | null = null;
    tui.setActiveRunnable.mockImplementation((value) => {
      active = value;
    });
    loop.run.mockImplementation(async () => {
      active?.abort();
      return { status: "completed", sessionId: "session", attempts: 1 };
    });
    const result = await handleWorkflowCommand(
      "/workflow run staged-review",
      context,
    );
    expect(result.error).toContain("interrupted");
    expect(loop.abort).toHaveBeenCalledTimes(1);
    expect(loop.run).toHaveBeenCalledTimes(1);
    expect(active).toBeNull();
  });
  it("returns actionable failures and does not invoke a model for invalid commands", async () => {
    const { context, loop } = fixture();
    expect(
      (await handleWorkflowCommand("/workflow run unknown", context)).error,
    ).toContain("No structured workflow");
    expect(
      (await handleWorkflowCommand("/workflow status ../../escape", context))
        .error,
    ).toBeTruthy();
    expect(loop.run).not.toHaveBeenCalled();
  });
});
