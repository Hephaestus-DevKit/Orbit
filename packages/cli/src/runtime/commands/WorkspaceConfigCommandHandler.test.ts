import { DEFAULT_CONFIG } from "@orbit-build/config";
import type { PromptOption } from "@orbit-build/tui";
import { describe, expect, it, mockTools as vi } from "../../../../../scripts/testing/support.mjs";
import { handleWorkspaceConfigCommand } from "./WorkspaceConfigCommandHandler.js";

describe("handleWorkspaceConfigCommand", () => {
  it("parses and validates a direct configuration update", async () => {
    const config = structuredClone(DEFAULT_CONFIG);
    const printOutput = vi.fn();
    const result = await handleWorkspaceConfigCommand(
      "tools.webSearch.maxResults=12",
      { getConfig: () => config, printOutput },
    );

    expect(result.processed).toBe(true);
    expect(config.tools.webSearch.maxResults).toBe(12);
    expect(printOutput).toHaveBeenCalledWith(
      expect.stringContaining("Updated"),
    );
  });

  it("rejects invalid typed and unknown values without mutating config", async () => {
    const config = structuredClone(DEFAULT_CONFIG);
    const printOutput = vi.fn();
    await handleWorkspaceConfigCommand("autoCommit=maybe", {
      getConfig: () => config,
      printOutput,
    });
    await handleWorkspaceConfigCommand("__proto__.polluted=true", {
      getConfig: () => config,
      printOutput,
    });

    expect(config.autoCommit).toBe(false);
    expect(
      (Object.prototype as Record<string, unknown>).polluted,
    ).toBeUndefined();
    expect(printOutput).toHaveBeenCalledWith(
      expect.stringContaining("expects a boolean"),
    );
    expect(printOutput).toHaveBeenCalledWith(
      expect.stringContaining("Unknown configuration key"),
    );
  });

  it("supports an interactive update and exits cleanly", async () => {
    const config = structuredClone(DEFAULT_CONFIG);
    const askSelect = vi.fn(
      async (
        _question: string,
        _options: PromptOption[],
      ): Promise<string | null> => null,
    );
    askSelect
      .mockResolvedValueOnce("autoCommit")
      .mockResolvedValueOnce("true")
      .mockResolvedValueOnce("exit");
    const prompt = {
      askSelect,
      askText: vi.fn(async () => null),
    };
    await handleWorkspaceConfigCommand("", {
      getConfig: () => config,
      printOutput: vi.fn(),
      prompt,
    });
    expect(config.autoCommit).toBe(true);
  });
});
