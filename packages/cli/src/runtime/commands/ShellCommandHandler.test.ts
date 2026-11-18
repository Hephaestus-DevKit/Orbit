import { DEFAULT_CONFIG, type OrbitConfig } from "@orbit-build/config";
import { describe, expect, it, mockTools as vi } from "../../../../../scripts/testing/support.mjs";
import { handleShellCommand } from "./ShellCommandHandler.js";

function createConfig(mode: OrbitConfig["permissions"]["mode"]): OrbitConfig {
  const config = structuredClone(DEFAULT_CONFIG);
  config.permissions.mode = mode;
  return config;
}

function createTui() {
  return {
    isActive: true,
    stop: vi.fn(),
    start: vi.fn(),
    syncFromLoop: vi.fn(),
  };
}

describe("handleShellCommand", () => {
  it("returns null for non-shell input", async () => {
    const result = await handleShellCommand("/help", {
      cwd: process.cwd(),
      config: createConfig("normal"),
      loop: {},
      tui: createTui(),
      useFullscreenTui: true,
    });
    expect(result).toBeNull();
  });

  it("shows usage and restores an active TUI for an empty command", async () => {
    const tui = createTui();
    const writeLine = vi.fn();
    const result = await handleShellCommand("/run", {
      cwd: process.cwd(),
      config: createConfig("normal"),
      loop: {},
      tui,
      useFullscreenTui: true,
      writeLine,
    });

    expect(result?.processed).toBe(true);
    expect(writeLine).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    expect(tui.stop).toHaveBeenCalledOnce();
    expect(tui.start).toHaveBeenCalledOnce();
  });

  it("executes an approved command through the injected runner", async () => {
    const tui = createTui();
    const execute = vi.fn(async () => ({ status: 0 }));
    const prompt = {
      askApproval: vi.fn(async () => true),
      askText: vi.fn(async () => ""),
    };
    const result = await handleShellCommand("!echo orbit", {
      cwd: process.cwd(),
      config: createConfig("auto"),
      loop: {},
      tui,
      useFullscreenTui: true,
      execute,
      prompt,
      writeLine: vi.fn(),
    });

    expect(result?.processed).toBe(true);
    expect(execute).toHaveBeenCalledWith("echo orbit", process.cwd());
    expect(prompt.askText).toHaveBeenCalledOnce();
    expect(tui.syncFromLoop).toHaveBeenCalledOnce();
  });
});
