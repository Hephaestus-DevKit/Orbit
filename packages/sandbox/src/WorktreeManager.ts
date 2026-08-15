import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import {
  generateId,
  HIDDEN_CHILD_PROCESS_OPTIONS,
  resolveSafePath,
} from "@orbit-build/shared";

const SUBAGENT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const WORKTREE_BRANCH_PATTERN = /^orbit-wt-[a-zA-Z0-9_-]+$/;
const SENSITIVE_SNAPSHOT_DIRECTORIES = new Set([
  ".aws",
  ".azure",
  ".docker",
  ".gem",
  ".gnupg",
  ".kube",
  ".ssh",
  ".terraform.d",
]);
const SENSITIVE_SNAPSHOT_NAMES = new Set([
  ".git-credentials",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".sentryclirc",
  "_netrc",
  "client_secret.json",
  "credentials.json",
  "credentials.tfrc.json",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
]);

export interface WorktreeSession {
  path: string;
  branchName: string;
  /** Commit from which this managed branch was created. */
  baseCommit?: string;
  /** Optional committed snapshot of the user's dirty workspace. */
  baselineCommit?: string;
}

export interface CreateWorktreeOptions {
  snapshotWorkingTree?: boolean;
}

export interface WorktreeMergeResult {
  success: boolean;
  conflictFiles?: string[];
  error?: string;
  preserved?: boolean;
}

export interface WorktreeIntegrationResult extends WorktreeMergeResult {
  integratedCount?: number;
}

export class WorktreeManager {
  private readonly worktreeRoot: string;

  constructor(private cwd: string) {
    this.worktreeRoot = path.join(cwd, ".orbit", "worktrees");
  }

  public isGitRepo(): boolean {
    try {
      return this.git(["rev-parse", "--is-inside-work-tree"]).trim() === "true";
    } catch {
      return false;
    }
  }

  public createWorktree(
    subagentId: string,
    options: CreateWorktreeOptions = {},
  ): WorktreeSession {
    if (!this.isGitRepo()) {
      throw new Error(
        "Cannot create git worktree: directory is not a git repository.",
      );
    }
    if (!SUBAGENT_ID_PATTERN.test(subagentId)) {
      throw new Error(`Invalid subagent id: ${subagentId}`);
    }

    const branchName = `orbit-wt-${subagentId}-${generateId("lbl").slice(0, 8)}`;
    fs.mkdirSync(this.worktreeRoot, { recursive: true });
    const worktreePath = resolveSafePath(this.worktreeRoot, subagentId);

    if (fs.existsSync(worktreePath)) {
      try {
        this.git(["worktree", "remove", "--force", worktreePath]);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Existing worktree could not be removed safely: ${message}`,
        );
      }
    }

    const baseCommit = this.git(["rev-parse", "HEAD"]).trim();
    this.git(["worktree", "add", "-b", branchName, worktreePath, "HEAD"]);
    const session: WorktreeSession = {
      path: worktreePath,
      branchName,
      baseCommit,
    };
    if (options.snapshotWorkingTree) {
      try {
        session.baselineCommit = this.snapshotWorkingTree(worktreePath);
      } catch (error: unknown) {
        try {
          this.discardWorktree(session);
        } catch {
          // Preserve the snapshot error; cleanup is best effort.
        }
        throw new Error(
          `Failed to snapshot the current workspace: ${toErrorMessage(error)}`,
        );
      }
    }
    return session;
  }

  public mergeAndCleanup(session: WorktreeSession): WorktreeMergeResult {
    try {
      this.assertManagedSession(session);
    } catch (error: unknown) {
      return { success: false, error: toErrorMessage(error), preserved: true };
    }
    if (!this.isGitRepo()) {
      return {
        success: false,
        error: "Main workspace is not a git repository.",
        preserved: true,
      };
    }

    try {
      this.commitWorktreeChanges(session);
    } catch (error: unknown) {
      return {
        success: false,
        error: `Failed to commit worktree changes: ${toErrorMessage(error)}`,
        preserved: true,
      };
    }

    try {
      if (session.baselineCommit) {
        this.applyAgentDelta(session);
      } else {
        this.git(["merge", "--no-edit", session.branchName]);
      }
    } catch (error: unknown) {
      const conflictFiles = this.getConflictFiles();
      try {
        this.git(["merge", "--abort"]);
      } catch {
        // Preserve Git's conflict state if abort is not possible.
      }
      return {
        success: false,
        conflictFiles,
        error: `Failed to merge worktree branch: ${toErrorMessage(error)}`,
        preserved: true,
      };
    }

    try {
      this.git(["worktree", "remove", session.path]);
      this.git([
        "branch",
        session.baselineCommit ? "-D" : "-d",
        session.branchName,
      ]);
    } catch (error: unknown) {
      return {
        success: true,
        error: `Changes were merged, but cleanup is incomplete: ${toErrorMessage(error)}`,
        preserved: true,
      };
    }

    return { success: true };
  }

  /**
   * Combine independent writer deltas inside another managed worktree. The
   * main workspace remains untouched until the integration worktree passes
   * review and is merged with `mergeAndCleanup`.
   */
  public integrateWorktrees(
    sources: WorktreeSession[],
    target: WorktreeSession,
  ): WorktreeIntegrationResult {
    try {
      this.assertManagedSession(target);
      for (const source of sources) {
        this.assertManagedSession(source);
        if (
          path.resolve(source.path) === path.resolve(target.path) ||
          source.branchName === target.branchName
        ) {
          throw new Error("A writer worktree cannot integrate into itself.");
        }
      }
    } catch (error: unknown) {
      return { success: false, error: toErrorMessage(error), preserved: true };
    }

    let integratedCount = 0;
    try {
      for (const source of sources) {
        this.commitWorktreeChanges(source);
        const baseline = source.baselineCommit || source.baseCommit;
        if (!baseline) {
          throw new Error(
            `Writer worktree has no trusted baseline: ${source.branchName}`,
          );
        }
        const delta = this.gitBuffer(
          ["diff", "--binary", baseline, source.branchName],
          source.path,
        );
        if (delta.length > 0) {
          execFileSync("git", ["apply", "--whitespace=nowarn", "-"], {
            ...HIDDEN_CHILD_PROCESS_OPTIONS,
            cwd: target.path,
            input: delta,
            stdio: ["pipe", "pipe", "pipe"],
            maxBuffer: 64 * 1024 * 1024,
          });
        }
        integratedCount += 1;
      }
    } catch (error: unknown) {
      try {
        this.git(["reset", "--hard", "HEAD"], target.path);
        this.git(["clean", "-fd"], target.path);
      } catch {
        // Preserve every managed worktree when integration cleanup is unsure.
      }
      return {
        success: false,
        integratedCount,
        error: `Failed to integrate writer changes: ${toErrorMessage(error)}`,
        preserved: true,
      };
    }

    const cleanupErrors: string[] = [];
    for (const source of sources) {
      try {
        this.discardWorktree(source);
      } catch (error: unknown) {
        cleanupErrors.push(`${source.branchName}: ${toErrorMessage(error)}`);
      }
    }
    return {
      success: true,
      integratedCount,
      ...(cleanupErrors.length
        ? {
            preserved: true,
            error: `Writer changes were integrated, but cleanup is incomplete: ${cleanupErrors.join(" | ")}`,
          }
        : {}),
    };
  }

  /** List the complete writer delta before integration or review. */
  public listChangedFiles(session: WorktreeSession): string[] {
    this.assertManagedSession(session);
    const baseline = session.baselineCommit || session.baseCommit;
    if (!baseline) {
      throw new Error(
        `Managed worktree has no trusted baseline: ${session.branchName}`,
      );
    }
    const tracked = this.git(
      ["diff", "--name-only", "-z", baseline],
      session.path,
    )
      .split("\0")
      .filter(Boolean);
    const untracked = this.git(
      ["ls-files", "--others", "--exclude-standard", "-z"],
      session.path,
    )
      .split("\0")
      .filter(Boolean);
    return Array.from(new Set([...tracked, ...untracked]))
      .map((file) => file.replace(/\\/g, "/"))
      .filter((file) => file !== ".orbit" && !file.startsWith(".orbit/"))
      .sort();
  }

  public discardWorktree(session: WorktreeSession): void {
    this.assertManagedSession(session);
    if (fs.existsSync(session.path)) {
      this.git(["worktree", "remove", "--force", session.path]);
    }
    try {
      this.git(["branch", "-D", session.branchName]);
    } catch {
      // The branch may not have been created or may already be gone.
    }
  }

  private assertManagedSession(session: WorktreeSession): void {
    if (!WORKTREE_BRANCH_PATTERN.test(session.branchName)) {
      throw new Error(`Invalid managed worktree branch: ${session.branchName}`);
    }
    const expectedRoot = path.resolve(this.worktreeRoot);
    const sessionPath = path.resolve(session.path);
    const relativePath = path.relative(expectedRoot, sessionPath);
    if (
      !relativePath ||
      relativePath.startsWith("..") ||
      path.isAbsolute(relativePath) ||
      relativePath.includes(path.sep)
    ) {
      throw new Error(
        `Worktree path is outside the managed root: ${session.path}`,
      );
    }
  }

  private getConflictFiles(): string[] {
    try {
      return this.git(["diff", "--name-only", "--diff-filter=U"])
        .split(/\r?\n/)
        .map((file) => file.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  private commitWorktreeChanges(session: WorktreeSession): void {
    this.git(["add", "-A"], session.path);
    if (!this.git(["status", "--porcelain"], session.path).trim()) return;
    this.git(
      [
        "commit",
        "--no-verify",
        "--no-gpg-sign",
        "-m",
        "subagent automatic worktree commit",
      ],
      session.path,
    );
  }

  /** Copy the user's tracked and safe untracked state into the isolated branch. */
  private snapshotWorkingTree(worktreePath: string): string | undefined {
    const patch = this.gitBuffer(["diff", "HEAD", "--binary", "--no-ext-diff"]);
    if (patch.length > 0) {
      execFileSync("git", ["apply", "--whitespace=nowarn", "-"], {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        cwd: worktreePath,
        input: patch,
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      });
    }

    const untracked = this.git([
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    ])
      .split("\0")
      .filter(Boolean);
    for (const relativePath of untracked) {
      if (isSensitiveSnapshotPath(relativePath)) continue;
      const sourcePath = resolveSafePath(this.cwd, relativePath);
      const targetPath = resolveSafePath(worktreePath, relativePath);
      const stats = fs.lstatSync(sourcePath);
      if (stats.isSymbolicLink() || !stats.isFile()) continue;
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
    }

    this.git(["add", "-A"], worktreePath);
    if (!this.git(["status", "--porcelain"], worktreePath).trim()) {
      return undefined;
    }
    this.git(
      [
        "-c",
        "user.name=Orbit Agent",
        "-c",
        "user.email=agent@orbit.local",
        "commit",
        "--no-verify",
        "--no-gpg-sign",
        "-m",
        "orbit workspace snapshot",
      ],
      worktreePath,
    );
    return this.git(["rev-parse", "HEAD"], worktreePath).trim();
  }

  /** Apply only the agent's delta, leaving the user's original dirty tree intact. */
  private applyAgentDelta(session: WorktreeSession): void {
    const delta = this.gitBuffer(
      ["diff", "--binary", session.baselineCommit!, session.branchName],
      session.path,
    );
    if (delta.length === 0) return;
    execFileSync("git", ["apply", "--whitespace=nowarn", "-"], {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      cwd: this.cwd,
      input: delta,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  }

  private git(args: string[], cwd = this.cwd): string {
    return execFileSync("git", args, {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  private gitBuffer(args: string[], cwd = this.cwd): Buffer {
    return execFileSync("git", args, {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      cwd,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  }
}

function isSensitiveSnapshotPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const name = path.basename(normalized);
  const segments = normalized.split("/");
  return (
    normalized === ".orbit" ||
    normalized.startsWith(".orbit/") ||
    segments.some((segment) => SENSITIVE_SNAPSHOT_DIRECTORIES.has(segment)) ||
    SENSITIVE_SNAPSHOT_NAMES.has(name) ||
    name === ".env" ||
    name.startsWith(".env.") ||
    name.startsWith("client_secret_") ||
    /\.(?:jks|key|p12|pfx|pem)$/.test(name)
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
