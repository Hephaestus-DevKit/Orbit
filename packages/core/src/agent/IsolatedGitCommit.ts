import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, unlinkSync } from "fs";
import path from "path";
import {
  HIDDEN_CHILD_PROCESS_OPTIONS,
  resolveSafePath,
} from "@orbit-build/shared";

export interface PreparedIsolatedGitCommit {
  diff: string;
  commit(message: string): void;
  dispose(): void;
}

/**
 * Prepare an automatic commit in a temporary Git index. The user's real index
 * is never used for the commit, and overlapping pre-staged paths fail closed.
 */
export function prepareIsolatedGitCommit(
  cwd: string,
  requestedPaths: string[],
): PreparedIsolatedGitCommit {
  const paths = Array.from(
    new Set(
      requestedPaths.map((filePath) =>
        normalizePath(path.relative(cwd, resolveSafePath(cwd, filePath))),
      ),
    ),
  ).filter(Boolean);
  if (paths.length === 0) throw new Error("No files were selected for commit.");
  const literalPathspecs = paths.map((filePath) => `:(literal)${filePath}`);

  const stagedPaths = readNullSeparatedGitPaths(cwd, [
    "diff",
    "--cached",
    "--name-only",
    "-z",
  ]);
  const stagedSet = new Set(stagedPaths.map(normalizePath));
  const overlaps = paths.filter((filePath) => stagedSet.has(filePath));
  if (overlaps.length > 0) {
    throw new Error(
      `Auto-commit stopped because user-staged changes overlap Orbit files: ${overlaps.join(", ")}`,
    );
  }

  const gitIndexPath = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-path", "index"],
    {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      cwd,
      encoding: "utf8",
    },
  ).trim();
  const temporaryIndexPath = path.join(
    path.dirname(gitIndexPath),
    `orbit-index-${randomUUID()}`,
  );
  const isolatedEnvironment = {
    ...process.env,
    GIT_INDEX_FILE: temporaryIndexPath,
  };
  let disposed = false;

  try {
    try {
      execFileSync("git", ["read-tree", "HEAD"], {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        cwd,
        env: isolatedEnvironment,
      });
    } catch {
      execFileSync("git", ["read-tree", "--empty"], {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        cwd,
        env: isolatedEnvironment,
      });
    }
    execFileSync("git", ["add", "--", ...literalPathspecs], {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      cwd,
      env: isolatedEnvironment,
    });
    const diff = execFileSync("git", ["diff", "--cached", "--binary"], {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      cwd,
      env: isolatedEnvironment,
      encoding: "utf8",
    }).trim();

    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      if (existsSync(temporaryIndexPath)) unlinkSync(temporaryIndexPath);
    };

    return {
      diff,
      commit(message: string): void {
        if (disposed) throw new Error("The isolated Git index is closed.");
        execFileSync("git", ["commit", "--no-verify", "-m", message], {
          ...HIDDEN_CHILD_PROCESS_OPTIONS,
          cwd,
          env: isolatedEnvironment,
        });
        // Advance only Orbit-owned entries in the real index to the new HEAD.
        // Unrelated user-staged entries remain byte-for-byte staged.
        execFileSync(
          "git",
          ["reset", "-q", "HEAD", "--", ...literalPathspecs],
          {
            ...HIDDEN_CHILD_PROCESS_OPTIONS,
            cwd,
          },
        );
      },
      dispose,
    };
  } catch (error) {
    if (existsSync(temporaryIndexPath)) unlinkSync(temporaryIndexPath);
    throw error;
  }
}

function readNullSeparatedGitPaths(cwd: string, args: string[]): string[] {
  return execFileSync("git", args, {
    ...HIDDEN_CHILD_PROCESS_OPTIONS,
    cwd,
  })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}
