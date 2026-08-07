import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureWorkspaceMutationSnapshot,
  compareWorkspaceMutationSnapshots,
} from "./WorkspaceMutationTracker.js";

describe("WorkspaceMutationTracker", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-mutation-tracker-"));
    execFileSync("git", ["init"], { cwd, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "orbit@example.invalid"], {
      cwd,
    });
    execFileSync("git", ["config", "user.name", "Orbit Test"], { cwd });
    writeFileSync(join(cwd, "tracked.txt"), "before\n", "utf8");
    execFileSync("git", ["add", "tracked.txt"], { cwd });
    execFileSync("git", ["commit", "-m", "initial"], { cwd, stdio: "ignore" });
  });

  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it("detects a further change to an already dirty tracked file", async () => {
    writeFileSync(join(cwd, "tracked.txt"), "first dirty state\n", "utf8");
    const before = await captureWorkspaceMutationSnapshot(cwd);

    writeFileSync(join(cwd, "tracked.txt"), "second dirty state\n", "utf8");
    const after = await captureWorkspaceMutationSnapshot(cwd);

    expect(compareWorkspaceMutationSnapshots(before, after)).toMatchObject({
      paths: ["tracked.txt"],
    });
  });

  it("does not attribute unchanged user-dirty files to the current command", async () => {
    writeFileSync(join(cwd, "user-tracked.txt"), "clean\n", "utf8");
    execFileSync("git", ["add", "user-tracked.txt"], { cwd });
    execFileSync("git", ["commit", "-m", "add user file"], {
      cwd,
      stdio: "ignore",
    });
    writeFileSync(join(cwd, "user-tracked.txt"), "leave me alone\n", "utf8");
    writeFileSync(join(cwd, "tracked.txt"), "first dirty state\n", "utf8");
    const before = await captureWorkspaceMutationSnapshot(cwd);

    writeFileSync(join(cwd, "tracked.txt"), "second dirty state\n", "utf8");
    const after = await captureWorkspaceMutationSnapshot(cwd);

    expect(compareWorkspaceMutationSnapshots(before, after)?.paths).toEqual([
      "tracked.txt",
    ]);
  });

  it("detects index-only changes when the worktree content is unchanged", async () => {
    writeFileSync(join(cwd, "tracked.txt"), "first staged state\n", "utf8");
    execFileSync("git", ["add", "tracked.txt"], { cwd });
    writeFileSync(join(cwd, "tracked.txt"), "second staged state\n", "utf8");
    const before = await captureWorkspaceMutationSnapshot(cwd);

    execFileSync("git", ["add", "tracked.txt"], { cwd });
    const after = await captureWorkspaceMutationSnapshot(cwd);

    expect(compareWorkspaceMutationSnapshots(before, after)?.paths).toEqual([
      "tracked.txt",
    ]);
  });

  it("detects untracked content changes and clean restorations", async () => {
    const before = await captureWorkspaceMutationSnapshot(cwd);
    writeFileSync(join(cwd, "created.txt"), "created\n", "utf8");
    const created = await captureWorkspaceMutationSnapshot(cwd);
    expect(compareWorkspaceMutationSnapshots(before, created)?.paths).toEqual([
      "created.txt",
    ]);

    rmSync(join(cwd, "created.txt"));
    const restored = await captureWorkspaceMutationSnapshot(cwd);
    expect(compareWorkspaceMutationSnapshots(created, restored)?.paths).toEqual(
      ["created.txt"],
    );
  });

  it("returns no delta when the workspace is unchanged", async () => {
    const before = await captureWorkspaceMutationSnapshot(cwd);
    const after = await captureWorkspaceMutationSnapshot(cwd);
    expect(compareWorkspaceMutationSnapshots(before, after)).toBeUndefined();
  });
});
