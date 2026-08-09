import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Checkpoint } from "@orbit-build/sandbox";
import { AgentLoop } from "./AgentLoop.js";

const temporaryDirectories: string[] = [];

function temporaryWorkspace(): string {
  const directory = mkdtempSync(join(tmpdir(), "orbit-loop-rollback-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("AgentLoop checkpoint file rollback", () => {
  it("selects the latest backup for every path and restores them together", () => {
    const cwd = temporaryWorkspace();
    const checkpoints: Checkpoint[] = [
      checkpoint("older", [
        { path: "first.ts", originalContent: "first original" },
        { path: "second.ts", originalContent: "second original" },
      ]),
      checkpoint("newer", [
        { path: "first.ts", originalContent: "first intermediate" },
      ]),
    ];
    const rollbackMany = vi.fn(() => ({
      success: true,
      restored: ["first.ts", "second.ts"],
    }));
    const loop = {
      cwd,
      sessionReviewCache: { expiresAt: 1, value: {} },
      checkpointManager: { getCheckpoints: () => checkpoints.slice() },
      rollbackManager: { rollbackMany },
    } as unknown as AgentLoop;

    const result = AgentLoop.prototype.rollbackFilesToCheckpoints.call(loop, [
      "first.ts",
      "second.ts",
      "missing.ts",
      "first.ts",
    ]);

    expect(result).toEqual({
      success: true,
      restored: ["first.ts", "second.ts"],
      unresolved: ["missing.ts"],
    });
    expect(rollbackMany).toHaveBeenCalledOnce();
    expect(
      rollbackMany.mock.calls[0][0].map((value) => ({
        id: value.id,
        backups: value.backups,
      })),
    ).toEqual([
      {
        id: "newer",
        backups: [{ path: "first.ts", originalContent: "first intermediate" }],
      },
      {
        id: "older",
        backups: [{ path: "second.ts", originalContent: "second original" }],
      },
    ]);
  });

  it("does not report files as restored when the batch transaction fails", () => {
    const cwd = temporaryWorkspace();
    const loop = {
      cwd,
      sessionReviewCache: undefined,
      checkpointManager: {
        getCheckpoints: () => [
          checkpoint("checkpoint", [
            { path: "first.ts", originalContent: "original" },
          ]),
        ],
      },
      rollbackManager: {
        rollbackMany: () => ({
          success: false,
          restored: ["first.ts"],
          error: "write failed; compensation succeeded",
        }),
      },
    } as unknown as AgentLoop;

    expect(
      AgentLoop.prototype.rollbackFilesToCheckpoints.call(loop, ["first.ts"]),
    ).toEqual({
      success: false,
      restored: [],
      unresolved: [],
      error: "write failed; compensation succeeded",
    });
  });
});

function checkpoint(id: string, backups: Checkpoint["backups"]): Checkpoint {
  return {
    id,
    sessionId: "session",
    timestamp: "2026-08-09T00:00:00.000Z",
    toolCallId: `tool-${id}`,
    backups,
  };
}
