import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { WorktreeManager } from "./WorktreeManager.js";
import { execSync } from "child_process";

describe("WorktreeManager Tests", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = path.join(tmpdir(), `orbit-wt-test-${Date.now()}`);
    fs.mkdirSync(cwd, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(cwd)) {
      try {
        // Clean up any remaining worktrees
        execSync("git worktree prune", { cwd, stdio: "ignore" });
      } catch {}
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("should throw error if not a git repository", () => {
    const manager = new WorktreeManager(cwd);
    expect(() => manager.createWorktree("sub-1")).toThrow(
      "not a git repository",
    );
  });

  it("should create worktree, commit file, merge back, and prune successfully", () => {
    // 1. Initialize git repo in cwd
    try {
      execSync("git init", { cwd, stdio: "ignore" });
      execSync("git config user.name test", { cwd, stdio: "ignore" });
      execSync("git config user.email test@example.com", {
        cwd,
        stdio: "ignore",
      });

      // Git needs at least one commit before we can create worktree off HEAD
      fs.writeFileSync(path.join(cwd, "README.md"), "hello", "utf8");
      execSync("git add README.md", { cwd, stdio: "ignore" });
      execSync('git commit -m "initial commit"', { cwd, stdio: "ignore" });
    } catch {
      // Git command failed (e.g. git not installed on windows test system)
      // Skip test gracefully
      return;
    }

    const manager = new WorktreeManager(cwd);

    // 2. Create worktree
    const session = manager.createWorktree("sub-1");
    expect(fs.existsSync(session.path)).toBe(true);
    expect(fs.existsSync(path.join(session.path, "README.md"))).toBe(true);

    // 3. Write new file inside worktree
    const newFilePath = path.join(session.path, "sub-file.txt");
    fs.writeFileSync(newFilePath, "subagent edit", "utf8");

    // 4. Merge and clean up
    const mergeRes = manager.mergeAndCleanup(session);
    expect(mergeRes.success).toBe(true);

    // 5. Verify the file is now in the main workspace and worktree directory is cleaned up
    expect(fs.existsSync(path.join(cwd, "sub-file.txt"))).toBe(true);
    expect(fs.readFileSync(path.join(cwd, "sub-file.txt"), "utf8")).toBe(
      "subagent edit",
    );
    expect(fs.existsSync(session.path)).toBe(false);
  });

  it("rejects traversal subagent ids", () => {
    initializeRepository(cwd);
    const manager = new WorktreeManager(cwd);

    expect(() => manager.createWorktree("../../outside")).toThrow(
      "Invalid subagent id",
    );
  });

  it("preserves a dirty baseline and applies only the agent delta", () => {
    initializeRepository(cwd);
    fs.writeFileSync(path.join(cwd, "README.md"), "user draft", "utf8");
    fs.writeFileSync(path.join(cwd, "notes.txt"), "untracked context", "utf8");
    fs.writeFileSync(path.join(cwd, ".env"), "SECRET=hidden", "utf8");
    fs.mkdirSync(path.join(cwd, ".aws"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, ".aws", "credentials"),
      "aws_secret_access_key=hidden",
      "utf8",
    );
    fs.mkdirSync(path.join(cwd, "certs"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, "certs", "client.key"),
      "private key",
      "utf8",
    );
    fs.writeFileSync(
      path.join(cwd, "client_secret_local.json"),
      "oauth secret",
      "utf8",
    );
    const manager = new WorktreeManager(cwd);

    const session = manager.createWorktree("dirty-baseline", {
      snapshotWorkingTree: true,
    });
    expect(fs.readFileSync(path.join(session.path, "README.md"), "utf8")).toBe(
      "user draft",
    );
    expect(fs.readFileSync(path.join(session.path, "notes.txt"), "utf8")).toBe(
      "untracked context",
    );
    expect(fs.existsSync(path.join(session.path, ".env"))).toBe(false);
    expect(fs.existsSync(path.join(session.path, ".aws", "credentials"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(session.path, "certs", "client.key"))).toBe(
      false,
    );
    expect(
      fs.existsSync(path.join(session.path, "client_secret_local.json")),
    ).toBe(false);
    fs.writeFileSync(
      path.join(session.path, "agent.txt"),
      "agent delta",
      "utf8",
    );

    expect(manager.mergeAndCleanup(session).success).toBe(true);
    expect(fs.readFileSync(path.join(cwd, "README.md"), "utf8")).toBe(
      "user draft",
    );
    expect(fs.readFileSync(path.join(cwd, "notes.txt"), "utf8")).toBe(
      "untracked context",
    );
    expect(fs.readFileSync(path.join(cwd, "agent.txt"), "utf8")).toBe(
      "agent delta",
    );
  });

  it("preserves the worktree when committing changes fails", () => {
    initializeRepository(cwd);
    const manager = new WorktreeManager(cwd);
    const session = manager.createWorktree("commit-failure");
    fs.writeFileSync(
      path.join(session.path, "important.txt"),
      "keep me",
      "utf8",
    );
    const rawGitDir = execSync("git rev-parse --git-dir", {
      cwd: session.path,
      encoding: "utf8",
    }).trim();
    const gitDir = path.isAbsolute(rawGitDir)
      ? rawGitDir
      : path.resolve(session.path, rawGitDir);
    fs.writeFileSync(path.join(gitDir, "index.lock"), "locked", "utf8");

    const result = manager.mergeAndCleanup(session);

    expect(result.success).toBe(false);
    expect(result.preserved).toBe(true);
    expect(
      fs.readFileSync(path.join(session.path, "important.txt"), "utf8"),
    ).toBe("keep me");
    fs.rmSync(path.join(gitDir, "index.lock"), { force: true });
    manager.discardWorktree(session);
  });
});

function initializeRepository(cwd: string): void {
  execSync("git init", { cwd, stdio: "ignore" });
  execSync("git config user.name test", { cwd, stdio: "ignore" });
  execSync("git config user.email test@example.com", { cwd, stdio: "ignore" });
  fs.writeFileSync(path.join(cwd, "README.md"), "hello", "utf8");
  execSync("git add README.md", { cwd, stdio: "ignore" });
  execSync('git commit -m "initial commit"', { cwd, stdio: "ignore" });
}
