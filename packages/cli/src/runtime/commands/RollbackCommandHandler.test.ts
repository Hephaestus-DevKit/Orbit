import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execFileSync } from "child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stripAnsiCodes } from "../../tui/TerminalText.js";
import {
  handleRollbackCommand,
  parseGitStatusPaths,
} from "./RollbackCommandHandler.js";

const temporaryDirectories: string[] = [];

function temporaryWorkspace(): string {
  const directory = mkdtempSync(join(tmpdir(), "orbit-rollback-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("RollbackCommandHandler", () => {
  it("parses modified, untracked, renamed, and spaced paths", () => {
    expect(
      parseGitStatusPaths(
        " M src/changed.ts\0?? new file.ts\0R  renamed file.ts\0old file.ts\0",
      ),
    ).toEqual(["src/changed.ts", "new file.ts", "renamed file.ts"]);
  });

  it("rejects a status path that escapes the workspace", async () => {
    const cwd = temporaryWorkspace();
    const rollbackLastCheckpoint = vi.fn(async () => {});
    const printOutput = vi.fn();
    const result = await handleRollbackCommand("/rollback", "", {
      cwd,
      language: "en",
      loop: {
        rollbackLastCheckpoint,
        rollbackFileToCheckpoint: vi.fn(() => false),
        getCheckpoints: vi.fn(() => []),
        rewindToCheckpoint: vi.fn(async () => false),
      },
      printOutput,
      git: {
        status: () => "?? ../outside.txt\0",
        reset: vi.fn(),
        checkout: vi.fn(),
      },
    });

    expect(result).toEqual({ shouldExit: false, processed: true });
    expect(rollbackLastCheckpoint).not.toHaveBeenCalled();
    expect(printOutput).toHaveBeenCalledWith(
      expect.stringContaining("outside the workspace"),
    );
  });

  it("rolls back the exact selected path without shell parsing", async () => {
    const cwd = temporaryWorkspace();
    mkdirSync(join(cwd, "src"));
    const rollbackFileToCheckpoint = vi.fn(() => true);
    const checkout = vi.fn();
    await handleRollbackCommand("/rollback", "", {
      cwd,
      language: "en",
      loop: {
        rollbackLastCheckpoint: vi.fn(async () => {}),
        rollbackFileToCheckpoint,
        getCheckpoints: vi.fn(() => []),
        rewindToCheckpoint: vi.fn(async () => false),
      },
      printOutput: vi.fn(),
      prompt: {
        askMultiSelect: vi.fn(async () => ["src/file with spaces.ts"]),
      },
      git: {
        status: () => " M src/file with spaces.ts\0",
        reset: vi.fn(),
        checkout,
      },
    });

    expect(rollbackFileToCheckpoint).toHaveBeenCalledWith(
      "src/file with spaces.ts",
    );
    expect(checkout).not.toHaveBeenCalled();
  });

  it("never deletes a tracked file when Git restoration fails", async () => {
    const cwd = temporaryWorkspace();
    const filePath = join(cwd, "tracked.ts");
    writeFileSync(filePath, "keep me");
    const removePath = vi.fn();
    const printOutput = vi.fn();

    await handleRollbackCommand("/rollback", "", {
      cwd,
      language: "en",
      loop: {
        rollbackLastCheckpoint: vi.fn(async () => {}),
        rollbackFileToCheckpoint: vi.fn(() => false),
        getCheckpoints: vi.fn(() => []),
        rewindToCheckpoint: vi.fn(async () => false),
      },
      printOutput,
      prompt: { askMultiSelect: vi.fn(async () => ["tracked.ts"]) },
      git: {
        status: () => " M tracked.ts\0",
        reset: vi.fn(),
        checkout: vi.fn(() => {
          throw new Error("index is locked");
        }),
      },
      removePath,
    });

    expect(existsSync(filePath)).toBe(true);
    expect(removePath).not.toHaveBeenCalled();
    expect(printOutput).toHaveBeenCalledWith(
      expect.stringContaining("Rollback failed"),
    );
    expect(printOutput).not.toHaveBeenCalledWith(
      expect.stringContaining("Successfully rolled back"),
    );
  });

  it("resets staged paths and restores both sides of a rename", async () => {
    const cwd = temporaryWorkspace();
    const reset = vi.fn();
    const checkout = vi.fn();
    const removePath = vi.fn();

    await handleRollbackCommand("/rollback", "", {
      cwd,
      language: "en",
      loop: {
        rollbackLastCheckpoint: vi.fn(async () => {}),
        rollbackFileToCheckpoint: vi.fn(() => false),
        getCheckpoints: vi.fn(() => []),
        rewindToCheckpoint: vi.fn(async () => false),
      },
      printOutput: vi.fn(),
      prompt: { askMultiSelect: vi.fn(async () => ["renamed.ts"]) },
      git: {
        status: () => "R  renamed.ts\0original.ts\0",
        reset,
        checkout,
      },
      removePath,
    });

    expect(reset).toHaveBeenCalledWith(cwd, ["renamed.ts", "original.ts"]);
    expect(checkout).toHaveBeenCalledWith(cwd, "original.ts");
  });

  it("refuses a selection after its Git status changes", async () => {
    const cwd = temporaryWorkspace();
    const status = vi
      .fn()
      .mockReturnValueOnce(" M tracked.ts\0")
      .mockReturnValueOnce("?? tracked.ts\0");
    const reset = vi.fn();
    const checkout = vi.fn();
    const removePath = vi.fn();
    const printOutput = vi.fn();

    await handleRollbackCommand("/rollback", "", {
      cwd,
      language: "en",
      loop: {
        rollbackLastCheckpoint: vi.fn(async () => {}),
        rollbackFileToCheckpoint: vi.fn(() => false),
        getCheckpoints: vi.fn(() => []),
        rewindToCheckpoint: vi.fn(async () => false),
      },
      printOutput,
      prompt: { askMultiSelect: vi.fn(async () => ["tracked.ts"]) },
      git: { status, reset, checkout },
      removePath,
    });

    expect(reset).not.toHaveBeenCalled();
    expect(checkout).not.toHaveBeenCalled();
    expect(removePath).not.toHaveBeenCalled();
    expect(printOutput).toHaveBeenCalledWith(
      expect.stringContaining("Git status changed"),
    );
  });

  it("refuses unmerged paths that cannot be compensated from an index patch", async () => {
    const cwd = temporaryWorkspace();
    writeFileSync(join(cwd, "conflict.ts"), "conflict markers");
    const reset = vi.fn();
    const printOutput = vi.fn();

    await handleRollbackCommand("/rollback", "", {
      cwd,
      language: "en",
      loop: {
        rollbackLastCheckpoint: vi.fn(async () => {}),
        rollbackFileToCheckpoint: vi.fn(() => false),
        getCheckpoints: vi.fn(() => []),
        rewindToCheckpoint: vi.fn(async () => false),
      },
      printOutput,
      prompt: { askMultiSelect: vi.fn(async () => ["conflict.ts"]) },
      git: {
        status: () => "UU conflict.ts\0",
        reset,
        checkout: vi.fn(),
      },
    });

    expect(reset).not.toHaveBeenCalled();
    expect(printOutput).toHaveBeenCalledWith(
      expect.stringContaining("Resolve merge conflicts"),
    );
  });

  it("cleans staged modifications, additions, and renames in a real repository", async () => {
    const cwd = temporaryWorkspace();
    runGit(cwd, "init", "--quiet");
    runGit(cwd, "config", "user.name", "Orbit Test");
    runGit(cwd, "config", "user.email", "orbit@example.test");
    writeFileSync(join(cwd, "modified.ts"), "original modified");
    writeFileSync(join(cwd, "original.ts"), "original renamed");
    runGit(cwd, "add", "modified.ts", "original.ts");
    runGit(cwd, "commit", "--quiet", "-m", "baseline");

    writeFileSync(join(cwd, "modified.ts"), "staged change");
    writeFileSync(join(cwd, "added.ts"), "staged addition");
    runGit(cwd, "add", "modified.ts", "added.ts");
    runGit(cwd, "mv", "original.ts", "renamed.ts");

    await handleRollbackCommand("/rollback", "", {
      cwd,
      language: "en",
      loop: {
        rollbackLastCheckpoint: vi.fn(async () => {}),
        rollbackFileToCheckpoint: vi.fn(() => false),
        getCheckpoints: vi.fn(() => []),
        rewindToCheckpoint: vi.fn(async () => false),
      },
      printOutput: vi.fn(),
      prompt: {
        askMultiSelect: vi.fn(async () => [
          "modified.ts",
          "added.ts",
          "renamed.ts",
        ]),
      },
    });

    expect(runGit(cwd, "status", "--porcelain")).toBe("");
    expect(readFileSync(join(cwd, "modified.ts"), "utf8")).toBe(
      "original modified",
    );
    expect(readFileSync(join(cwd, "original.ts"), "utf8")).toBe(
      "original renamed",
    );
    expect(existsSync(join(cwd, "added.ts"))).toBe(false);
    expect(existsSync(join(cwd, "renamed.ts"))).toBe(false);
  });

  it("rolls back staged additions before the repository has a first commit", async () => {
    const cwd = temporaryWorkspace();
    runGit(cwd, "init", "--quiet");
    writeFileSync(join(cwd, "first.ts"), "first commit draft");
    runGit(cwd, "add", "first.ts");

    await handleRollbackCommand("/rollback", "", {
      cwd,
      language: "en",
      loop: {
        rollbackLastCheckpoint: vi.fn(async () => {}),
        rollbackFileToCheckpoint: vi.fn(() => false),
        getCheckpoints: vi.fn(() => []),
        rewindToCheckpoint: vi.fn(async () => false),
      },
      printOutput: vi.fn(),
      prompt: { askMultiSelect: vi.fn(async () => ["first.ts"]) },
    });

    expect(runGit(cwd, "status", "--porcelain")).toBe("");
    expect(existsSync(join(cwd, "first.ts"))).toBe(false);
  });

  it("restores checkpoint-backed selections in one batch transaction", async () => {
    const cwd = temporaryWorkspace();
    writeFileSync(join(cwd, "first.ts"), "changed first");
    writeFileSync(join(cwd, "second.ts"), "changed second");
    const rollbackFileToCheckpoint = vi.fn(() => false);
    const rollbackFilesToCheckpoints = vi.fn(() => ({
      success: true,
      restored: ["first.ts", "second.ts"],
      unresolved: [],
    }));

    await handleRollbackCommand("/rollback", "", {
      cwd,
      language: "en",
      loop: {
        rollbackLastCheckpoint: vi.fn(async () => {}),
        rollbackFileToCheckpoint,
        rollbackFilesToCheckpoints,
        getCheckpoints: vi.fn(() => []),
        rewindToCheckpoint: vi.fn(async () => false),
      },
      printOutput: vi.fn(),
      prompt: {
        askMultiSelect: vi.fn(async () => ["first.ts", "second.ts"]),
      },
      git: {
        status: () => " M first.ts\0 M second.ts\0",
        reset: vi.fn(),
        checkout: vi.fn(),
      },
    });

    expect(rollbackFilesToCheckpoints).toHaveBeenCalledWith([
      "first.ts",
      "second.ts",
    ]);
    expect(rollbackFileToCheckpoint).not.toHaveBeenCalled();
  });

  it("compensates the worktree and staged index when checkpoint rollback fails", async () => {
    const cwd = temporaryWorkspace();
    runGit(cwd, "init", "--quiet");
    runGit(cwd, "config", "user.name", "Orbit Test");
    runGit(cwd, "config", "user.email", "orbit@example.test");
    writeFileSync(join(cwd, "tracked.ts"), "baseline");
    runGit(cwd, "add", "tracked.ts");
    runGit(cwd, "commit", "--quiet", "-m", "baseline");
    writeFileSync(join(cwd, "tracked.ts"), "staged user change");
    runGit(cwd, "add", "tracked.ts");
    const printOutput = vi.fn();

    await handleRollbackCommand("/rollback", "", {
      cwd,
      language: "en",
      loop: {
        rollbackLastCheckpoint: vi.fn(async () => {}),
        rollbackFileToCheckpoint: vi.fn(() => false),
        rollbackFilesToCheckpoints: vi.fn(() => ({
          success: false,
          restored: [],
          unresolved: [],
          error: "checkpoint disk failure",
        })),
        getCheckpoints: vi.fn(() => []),
        rewindToCheckpoint: vi.fn(async () => false),
      },
      printOutput,
      prompt: { askMultiSelect: vi.fn(async () => ["tracked.ts"]) },
    });

    expect(readFileSync(join(cwd, "tracked.ts"), "utf8")).toBe(
      "staged user change",
    );
    expect(runGit(cwd, "status", "--porcelain")).toBe("M  tracked.ts");
    expect(printOutput).toHaveBeenCalledWith(
      expect.stringContaining("Previous workspace state was restored"),
    );
  });

  it("compensates earlier checkpoint writes when a later Git restore fails", async () => {
    const cwd = temporaryWorkspace();
    const checkpointPath = join(cwd, "checkpoint.ts");
    const trackedPath = join(cwd, "tracked.ts");
    writeFileSync(checkpointPath, "current checkpoint content");
    writeFileSync(trackedPath, "current tracked content");
    const restoreIndex = vi.fn();
    const printOutput = vi.fn();

    await handleRollbackCommand("/rollback", "", {
      cwd,
      language: "en",
      loop: {
        rollbackLastCheckpoint: vi.fn(async () => {}),
        rollbackFileToCheckpoint: vi.fn(() => false),
        rollbackFilesToCheckpoints: vi.fn(() => {
          writeFileSync(checkpointPath, "checkpoint backup");
          return {
            success: true,
            restored: ["checkpoint.ts"],
            unresolved: ["tracked.ts"],
          };
        }),
        getCheckpoints: vi.fn(() => []),
        rewindToCheckpoint: vi.fn(async () => false),
      },
      printOutput,
      prompt: {
        askMultiSelect: vi.fn(async () => ["checkpoint.ts", "tracked.ts"]),
      },
      git: {
        status: () => " M checkpoint.ts\0 M tracked.ts\0",
        reset: vi.fn(),
        checkout: vi.fn(() => {
          throw new Error("index is locked");
        }),
        snapshotIndex: vi.fn(() => Buffer.from("index patch")),
        restoreIndex,
      },
    });

    expect(readFileSync(checkpointPath, "utf8")).toBe(
      "current checkpoint content",
    );
    expect(readFileSync(trackedPath, "utf8")).toBe("current tracked content");
    expect(restoreIndex).toHaveBeenCalledOnce();
    expect(printOutput).toHaveBeenCalledWith(
      expect.stringContaining("Previous workspace state was restored"),
    );
  });

  it("lists checkpoints newest-first and rewinds by displayed number", async () => {
    const cwd = temporaryWorkspace();
    const checkpoints = [
      {
        id: "checkpoint-old",
        timestamp: "2026-07-19T01:00:00Z",
        toolCallId: "tool-1",
        files: ["src/old.ts"],
      },
      {
        id: "checkpoint-new",
        timestamp: "2026-07-19T02:00:00Z",
        toolCallId: "tool-2",
        files: ["src/new.ts"],
      },
    ];
    const printOutput = vi.fn();
    const rewindToCheckpoint = vi.fn(async () => true);
    const loop = {
      rollbackLastCheckpoint: vi.fn(async () => {}),
      rollbackFileToCheckpoint: vi.fn(() => false),
      getCheckpoints: vi.fn(() => checkpoints),
      rewindToCheckpoint,
    };

    await handleRollbackCommand("/timeline", "", {
      cwd,
      language: "en",
      loop,
      printOutput,
    });
    expect(printOutput).toHaveBeenCalledOnce();
    expect(stripAnsiCodes(printOutput.mock.calls[0][0])).toMatch(
      /1\s+checkpoint-n.*src\/new\.ts/,
    );

    await handleRollbackCommand("/rewind", "1", {
      cwd,
      language: "en",
      loop,
      printOutput,
    });
    expect(rewindToCheckpoint).toHaveBeenCalledWith("checkpoint-new");
  });

  it("rejects ambiguous checkpoint ID prefixes", async () => {
    const cwd = temporaryWorkspace();
    const printOutput = vi.fn();
    const rewindToCheckpoint = vi.fn(async () => true);
    await handleRollbackCommand("/rewind", "checkpoint-", {
      cwd,
      language: "en",
      loop: {
        rollbackLastCheckpoint: vi.fn(async () => {}),
        rollbackFileToCheckpoint: vi.fn(() => false),
        getCheckpoints: vi.fn(() => [
          {
            id: "checkpoint-one",
            timestamp: "now",
            toolCallId: "1",
            files: [],
          },
          {
            id: "checkpoint-two",
            timestamp: "now",
            toolCallId: "2",
            files: [],
          },
        ]),
        rewindToCheckpoint,
      },
      printOutput,
    });

    expect(rewindToCheckpoint).not.toHaveBeenCalled();
    expect(printOutput).toHaveBeenCalledWith(
      expect.stringContaining("matches multiple checkpoints"),
    );
  });
});

function runGit(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}
