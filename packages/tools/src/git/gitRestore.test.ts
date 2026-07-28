import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

const execaMock = vi.hoisted(() => vi.fn(async () => ({ stdout: "restored" })));

vi.mock("execa", () => ({ execa: execaMock }));

import { GitRestoreTool } from "./gitRestore.js";

describe("GitRestoreTool", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    execaMock.mockClear();
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses literal pathspecs after validating workspace paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-git-restore-"));
    tempRoots.push(root);
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "--source=HEAD.ts"), "changed", "utf8");

    const result = await new GitRestoreTool().execute(
      { paths: ["src/--source=HEAD.ts"] },
      { cwd: root, sessionId: "test" },
    );

    expect(result.ok).toBe(true);
    expect(execaMock).toHaveBeenCalledWith(
      "git",
      ["--literal-pathspecs", "restore", "--", "src/--source=HEAD.ts"],
      expect.objectContaining({ cwd: root }),
    );
  });

  it("rejects paths outside the workspace before invoking git", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-git-restore-"));
    tempRoots.push(root);

    const result = await new GitRestoreTool().execute(
      { paths: ["../outside.txt"] },
      { cwd: root, sessionId: "test" },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("outside workspace boundary");
    expect(execaMock).not.toHaveBeenCalled();
  });
});
