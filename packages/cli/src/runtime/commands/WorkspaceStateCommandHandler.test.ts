import { describe, expect, it, mockTools as vi } from "../../../../../scripts/testing/support.mjs";
import { handleWorkspaceStateCommand } from "./WorkspaceStateCommandHandler.js";

function createLoop() {
  const memory = {
    enabled: true,
    entries: [{ id: "mem_one", text: "Use pnpm" }],
  };
  const plan = {
    items: [{ id: "step_one", text: "Inspect", status: "pending" as const }],
  };
  return {
    getProjectMemory: vi.fn(() => memory),
    addProjectMemory: vi.fn((text: string) => ({ id: "mem_two", text })),
    removeProjectMemory: vi.fn(() => true),
    clearProjectMemory: vi.fn(),
    setProjectMemoryEnabled: vi.fn((enabled: boolean) => ({ enabled })),
    getTaskPlan: vi.fn(() => plan),
    addTaskPlanItem: vi.fn(),
    updateTaskPlanItem: vi.fn(() => plan),
    removeTaskPlanItem: vi.fn(() => true),
    clearTaskPlan: vi.fn(),
    getSessionMetrics: vi.fn(() => ({
      eventCount: 8,
      toolRuns: 3,
      toolFailures: 1,
      deniedTools: 0,
      filesChanged: 2,
      modelSwitches: 1,
      routingDecisions: 3,
      fastRoutes: 2,
      qualityRoutes: 1,
      compactions: 1,
      resumedCount: 0,
    })),
  };
}

describe("handleWorkspaceStateCommand", () => {
  it("manages project memory by stable list index", () => {
    const loop = createLoop();
    const printOutput = vi.fn();
    expect(
      handleWorkspaceStateCommand("/memory", "remove 1", {
        loop,
        isZh: false,
        printOutput,
      }),
    ).toBeDefined();
    expect(loop.removeProjectMemory).toHaveBeenCalledWith("mem_one");
  });

  it("updates a durable plan and prints metrics", () => {
    const loop = createLoop();
    const printOutput = vi.fn();
    handleWorkspaceStateCommand("/plan", "done 1", {
      loop,
      isZh: true,
      printOutput,
    });
    expect(loop.updateTaskPlanItem).toHaveBeenCalledWith(
      "step_one",
      "completed",
    );
    handleWorkspaceStateCommand("/metrics", "", {
      loop,
      isZh: true,
      printOutput,
    });
    expect(printOutput.mock.calls.at(-1)?.[0]).toContain("3 / 1 / 0");
  });
});
