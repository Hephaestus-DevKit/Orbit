import { describe, expect, it, mockTools as vi } from "../../../../../scripts/testing/support.mjs";
import { handleSessionMetadataCommand } from "./SessionMetadataCommandHandler.js";

describe("handleSessionMetadataCommand", () => {
  it("sets, reports, and clears a persistent goal", () => {
    let goal: string | undefined;
    const printOutput = vi.fn();
    const loop = {
      getGoal: () => goal,
      setGoal: (next?: string) => {
        goal = next;
      },
      setSessionTitle: vi.fn(),
    };
    const dependencies = { loop, isZh: false, printOutput };

    expect(
      handleSessionMetadataCommand(
        "/goal",
        "Ship project support",
        dependencies,
      ),
    ).toBe(true);
    expect(goal).toBe("Ship project support");

    handleSessionMetadataCommand("/goal", "", dependencies);
    expect(printOutput).toHaveBeenLastCalledWith(
      expect.stringContaining("Ship project support"),
    );

    handleSessionMetadataCommand("/goal", "clear", dependencies);
    expect(goal).toBeUndefined();
  });

  it("renames the current chat and rejects empty titles", () => {
    const setSessionTitle = vi.fn();
    const printOutput = vi.fn();
    const dependencies = {
      loop: {
        getGoal: () => undefined,
        setGoal: vi.fn(),
        setSessionTitle,
      },
      isZh: false,
      printOutput,
    };

    handleSessionMetadataCommand("/rename", "Commercial launch", dependencies);
    expect(setSessionTitle).toHaveBeenCalledWith("Commercial launch");

    handleSessionMetadataCommand("/rename", "", dependencies);
    expect(setSessionTitle).toHaveBeenCalledOnce();
    expect(printOutput).toHaveBeenLastCalledWith(
      expect.stringContaining("Usage"),
    );
  });
});
