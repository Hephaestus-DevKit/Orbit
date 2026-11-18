import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, relative } from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mockTools as vi,
} from "../../../../../scripts/testing/support.mjs";
import { handleContextCommand } from "./ContextCommandHandler.js";

function createLoop() {
  const files: Array<{ path: string; reason: string; readOnly?: boolean }> = [];
  return {
    files,
    getRelevantFiles: () => files,
    addRelevantFilePublic: vi.fn((path: string, reason: string) => {
      files.push({ path, reason });
    }),
    addReadOnlyFilePublic: vi.fn((path: string, reason: string) => {
      files.push({ path, reason, readOnly: true });
    }),
    removeRelevantFilePublic: vi.fn((path: string) => {
      const index = files.findIndex((file) => file.path === path);
      if (index >= 0) files.splice(index, 1);
    }),
    clearRelevantFilesPublic: vi.fn(() => files.splice(0)),
    clearHistoryPublic: vi.fn(),
    compactHistoryPublic: vi.fn(async () => ({
      model: "test-model",
      maxContextTokens: 128_000,
      compactAtTokens: 96_000,
      beforeTokens: 20_000,
      afterTokens: 8_000,
      truncatedToolResults: 2,
      truncatedContextMessages: 0,
      droppedMessages: 12,
      changed: true,
    })),
  };
}

describe("handleContextCommand workspace boundary", () => {
  let parent: string;
  let cwd: string;
  let outside: string;

  beforeEach(() => {
    parent = mkdtempSync(join(tmpdir(), "orbit-context-"));
    cwd = join(parent, "workspace");
    outside = join(parent, "outside");
    mkdirSync(cwd);
    mkdirSync(outside);
    writeFileSync(join(cwd, "inside.ts"), "export {};\n");
    writeFileSync(join(outside, "secret.txt"), "secret\n");
  });

  afterEach(() => {
    rmSync(parent, { recursive: true, force: true });
  });

  function dependencies(loop = createLoop()) {
    return {
      cwd,
      language: "en" as const,
      candidates: { files: ["inside.ts"] },
      loop,
      tui: { syncFromLoop: vi.fn(), clearHistoryView: vi.fn() },
      useFullscreenTui: true,
      printOutput: vi.fn(),
    };
  }

  it("adds an in-workspace file", async () => {
    const deps = dependencies();
    await handleContextCommand("/add", "inside.ts", deps);
    expect(deps.loop.addRelevantFilePublic).toHaveBeenCalledWith(
      "inside.ts",
      expect.any(String),
    );
  });

  it("manually compacts history and reports the model-aware result", async () => {
    const deps = dependencies();
    const result = await handleContextCommand("/compact", "", deps);

    expect(result).toEqual({ shouldExit: false, processed: true });
    expect(deps.loop.compactHistoryPublic).toHaveBeenCalledOnce();
    expect(deps.printOutput).toHaveBeenCalledWith(
      expect.stringContaining("20,000 → 8,000"),
    );
    expect(deps.tui.syncFromLoop).toHaveBeenCalledWith(deps.loop);
  });

  it("rejects parent traversal and outside absolute paths", async () => {
    const deps = dependencies();
    await handleContextCommand(
      "/add",
      relative(cwd, join(outside, "secret.txt")),
      deps,
    );
    await handleContextCommand("/add", join(outside, "secret.txt"), deps);
    expect(deps.loop.addRelevantFilePublic).not.toHaveBeenCalled();
    expect(deps.printOutput).toHaveBeenCalledWith(
      expect.stringContaining("outside workspace boundary"),
    );
  });

  it("rejects a symlink or junction that resolves outside the workspace", async () => {
    const link = join(cwd, "external-link");
    symlinkSync(
      outside,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
    const deps = dependencies();
    await handleContextCommand("/add", "external-link/secret.txt", deps);
    expect(deps.loop.addRelevantFilePublic).not.toHaveBeenCalled();
    expect(deps.printOutput).toHaveBeenCalledWith(
      expect.stringContaining("outside workspace boundary"),
    );
    expect(dirname(link)).toBe(cwd);
  });
});
