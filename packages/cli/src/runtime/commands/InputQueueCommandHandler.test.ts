import { describe, expect, it, vi } from "vitest";

import { handleInputQueueCommand } from "./InputQueueCommandHandler.js";

function createHarness() {
  const items = [
    {
      id: "input_first",
      sessionId: "sess_kind-otter-001",
      mode: "follow_up" as const,
      source: "web" as const,
      text: "Run focused tests",
      attachments: [],
      createdAt: "2026-08-03T00:00:00.000Z",
    },
    {
      id: "input_second",
      sessionId: "sess_kind-otter-001",
      mode: "follow_up" as const,
      source: "terminal" as const,
      text: "Document the result",
      attachments: [],
      createdAt: "2026-08-03T00:00:01.000Z",
    },
  ];
  const loop = {
    getQueuedInputs: vi.fn(() => items),
    removeQueuedInput: vi.fn(() => true),
    clearQueuedInputs: vi.fn(() => items.length),
    updateQueuedInput: vi.fn((id: string, patch: Record<string, string>) => ({
      ...items.find((item) => item.id === id),
      ...patch,
    })),
    moveQueuedInput: vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false),
  };
  const printOutput = vi.fn();
  return { items, loop, printOutput };
}

describe("handleInputQueueCommand", () => {
  it("lists a bounded preview and edits by stable position", () => {
    const { loop, printOutput } = createHarness();
    expect(
      handleInputQueueCommand("/queue", "", {
        loop,
        language: "en",
        canSteer: false,
        printOutput,
      }),
    ).toEqual({ shouldExit: false, processed: true });
    expect(printOutput).toHaveBeenCalledWith(
      expect.stringContaining("Queued inputs (2/12)"),
    );

    handleInputQueueCommand("/queue", "edit 2 Publish the verified result", {
      loop,
      language: "en",
      canSteer: false,
      printOutput,
    });
    expect(loop.updateQueuedInput).toHaveBeenCalledWith("input_second", {
      text: "Publish the verified result",
    });
  });

  it("promotes, prioritizes, and safely rejects unavailable steering", () => {
    const first = createHarness();
    handleInputQueueCommand("/queue", "next 2", {
      loop: first.loop,
      language: "zh",
      canSteer: true,
      printOutput: first.printOutput,
    });
    expect(first.loop.moveQueuedInput).toHaveBeenCalledTimes(2);

    const second = createHarness();
    handleInputQueueCommand("/queue", "steer 1", {
      loop: second.loop,
      language: "en",
      canSteer: false,
      printOutput: second.printOutput,
    });
    expect(second.loop.updateQueuedInput).not.toHaveBeenCalled();
    expect(second.printOutput).toHaveBeenCalledWith(
      expect.stringContaining("requires an active single-agent task"),
    );
  });
});
