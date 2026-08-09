import {
  HIDDEN_CHILD_PROCESS_OPTIONS,
  readBoundedRegularFileBuffer,
  resolveSafePath,
} from "@orbit-build/shared";
import { Prompt, type PromptOption } from "@orbit-build/tui";
import { execFileSync } from "child_process";
import { existsSync, lstatSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { dirname } from "path";
import picocolors from "picocolors";
import { z } from "zod";
import {
  HANDLED_COMMAND,
  type CommandHandlerResult,
  type CommandOutput,
} from "./CommandHandlerTypes.js";

const GitStatusCodeSchema = z
  .string()
  .length(2)
  .regex(/^[ MADRCU?!]{2}$/);
const GitStatusPathSchema = z.string().min(1).max(32_768);

interface RollbackLoop {
  rollbackLastCheckpoint(): Promise<void>;
  rollbackFileToCheckpoint(filePath: string): boolean;
  rollbackFilesToCheckpoints?(filePaths: string[]): {
    success: boolean;
    restored: string[];
    unresolved: string[];
    error?: string;
  };
  getCheckpoints(): Array<{
    id: string;
    timestamp: string;
    toolCallId: string;
    files: string[];
  }>;
  rewindToCheckpoint(checkpointId: string): Promise<boolean>;
}

interface RollbackPromptAdapter {
  askMultiSelect(
    question: string,
    options: PromptOption[],
  ): Promise<string[] | null>;
}

interface GitAdapter {
  status(cwd: string): string;
  reset(cwd: string, filePaths: string[]): void;
  checkout(cwd: string, filePath: string): void;
  snapshotIndex?(cwd: string, filePaths: string[]): Buffer;
  restoreIndex?(cwd: string, filePaths: string[], snapshot: Buffer): void;
}

interface GitStatusEntry {
  status: string;
  path: string;
  originalPath?: string;
}

interface WorkspacePathSnapshot {
  path: string;
  content: Buffer | null;
}

const ROLLBACK_SNAPSHOT_FILE_MAX_BYTES = 16 * 1024 * 1024;
const ROLLBACK_SNAPSHOT_TOTAL_MAX_BYTES = 128 * 1024 * 1024;
const ROLLBACK_SNAPSHOT_MAX_PATHS = 10_000;
const GIT_INDEX_PATCH_MAX_BYTES = 64 * 1024 * 1024;

export interface RollbackCommandDependencies {
  cwd: string;
  language: "en" | "zh" | "zh-TW";
  loop: RollbackLoop;
  printOutput: CommandOutput;
  prompt?: RollbackPromptAdapter;
  git?: GitAdapter;
  removePath?: (absolutePath: string) => void;
}

const defaultGitAdapter: GitAdapter = {
  status: (cwd) =>
    execFileSync(
      "git",
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ),
  reset: (cwd, filePaths) => {
    if (filePaths.length === 0) return;
    let hasHead = true;
    try {
      execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        cwd,
        stdio: "ignore",
      });
    } catch {
      hasHead = false;
    }
    const args = hasHead
      ? ["reset", "--quiet", "HEAD", "--", ...filePaths]
      : [
          "rm",
          "--cached",
          "--force",
          "-r",
          "--ignore-unmatch",
          "--",
          ...filePaths,
        ];
    execFileSync("git", args, {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      cwd,
      stdio: "ignore",
    });
  },
  checkout: (cwd, filePath) => {
    execFileSync("git", ["checkout", "HEAD", "--", filePath], {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      cwd,
      stdio: "ignore",
    });
  },
  snapshotIndex: (cwd, filePaths) => {
    if (filePaths.length === 0) return Buffer.alloc(0);
    return execFileSync(
      "git",
      [
        "diff",
        "--cached",
        "--binary",
        "--full-index",
        "--no-ext-diff",
        "--",
        ...filePaths,
      ],
      {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        cwd,
        encoding: "buffer",
        maxBuffer: GIT_INDEX_PATCH_MAX_BYTES,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
  },
  restoreIndex: (cwd, filePaths, snapshot) => {
    if (filePaths.length === 0) return;
    defaultGitAdapter.reset(cwd, filePaths);
    if (snapshot.length === 0) return;
    execFileSync(
      "git",
      ["apply", "--cached", "--whitespace=nowarn", "--recount", "-"],
      {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        cwd,
        input: snapshot,
        maxBuffer: GIT_INDEX_PATCH_MAX_BYTES,
        stdio: ["pipe", "ignore", "ignore"],
      },
    );
  },
};

/** Parse NUL-delimited porcelain v1 output without corrupting path whitespace. */
export function parseGitStatusEntries(output: string): GitStatusEntry[] {
  const fields = output.split("\0");
  const entries: GitStatusEntry[] = [];
  for (let index = 0; index < fields.length; index++) {
    const record = fields[index];
    if (!record) continue;
    if (record.length < 4 || record[2] !== " ") {
      throw new Error("Git returned an invalid status record.");
    }
    const status = GitStatusCodeSchema.parse(record.slice(0, 2));
    const filePath = GitStatusPathSchema.parse(record.slice(3));
    let originalPath: string | undefined;
    if (status.includes("R") || status.includes("C")) {
      originalPath = GitStatusPathSchema.parse(fields[index + 1]);
      index++;
    }
    entries.push({
      status,
      path: filePath,
      ...(originalPath ? { originalPath } : {}),
    });
  }
  return [
    ...new Map(entries.map((entry) => [entry.path, entry] as const)).values(),
  ];
}

/** Return display paths while preserving the historical public helper. */
export function parseGitStatusPaths(output: string): string[] {
  return parseGitStatusEntries(output).map((entry) => entry.path);
}

/** Handle checkpoint history commands and workspace-safe `/rollback`. */
export async function handleRollbackCommand(
  command: string,
  argument: string,
  dependencies: RollbackCommandDependencies,
): Promise<CommandHandlerResult | null> {
  const isZh = dependencies.language !== "en";
  if (command === "/timeline") {
    printCheckpointTimeline(dependencies.loop.getCheckpoints(), dependencies);
    return HANDLED_COMMAND;
  }
  if (command === "/rewind") {
    await rewindToCheckpoint(argument, dependencies);
    return HANDLED_COMMAND;
  }
  if (command !== "/rollback") return null;
  if (argument === "all" || argument === "--all") {
    await dependencies.loop.rollbackLastCheckpoint();
    return HANDLED_COMMAND;
  }

  const git = dependencies.git ?? defaultGitAdapter;
  let entries: GitStatusEntry[];
  try {
    entries = parseGitStatusEntries(git.status(dependencies.cwd));
    for (const entry of entries) {
      resolveSafePath(dependencies.cwd, entry.path);
      if (entry.originalPath) {
        resolveSafePath(dependencies.cwd, entry.originalPath);
      }
    }
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes("outside workspace")) {
      dependencies.printOutput(
        picocolors.red(
          isZh
            ? `✖ Git 状态包含工作区外路径，已拒绝回滚: ${error.message}`
            : `✖ Refused rollback path outside the workspace: ${error.message}`,
        ),
      );
      return HANDLED_COMMAND;
    }
    await dependencies.loop.rollbackLastCheckpoint();
    return HANDLED_COMMAND;
  }

  if (entries.length === 0) {
    dependencies.printOutput(
      picocolors.yellow(
        isZh
          ? "当前工作区没有检测到任何未提交的代码变更。"
          : "No uncommitted changes detected in the workspace.",
      ),
    );
    return HANDLED_COMMAND;
  }

  const options: PromptOption[] = [
    {
      value: "all",
      label: isZh
        ? "【全部回滚】 撤销所有变更"
        : "[Rollback All] Discard all changes",
    },
    ...entries.map((entry) => ({ value: entry.path, label: entry.path })),
  ];
  const selected = await (dependencies.prompt ?? Prompt).askMultiSelect(
    isZh
      ? "选择要回滚（撤销变更）的文件："
      : "Select files to rollback (discard changes):",
    options,
  );
  if (!selected?.length) {
    dependencies.printOutput(
      picocolors.yellow(isZh ? "未选择任何文件。" : "No files selected."),
    );
    return HANDLED_COMMAND;
  }
  if (selected.includes("all")) {
    await dependencies.loop.rollbackLastCheckpoint();
    return HANDLED_COMMAND;
  }

  try {
    const selectedEntries = revalidateSelectedEntries(
      selected,
      entries,
      parseGitStatusEntries(git.status(dependencies.cwd)),
    );
    const indexPaths = collectIndexPaths(selectedEntries);
    const workspaceSnapshot = snapshotWorkspacePaths(
      dependencies.cwd,
      collectWorkspacePaths(selectedEntries),
    );
    const indexSnapshot = git.snapshotIndex?.(dependencies.cwd, indexPaths);
    try {
      if (indexPaths.length > 0) git.reset(dependencies.cwd, indexPaths);
      const checkpointResult = dependencies.loop.rollbackFilesToCheckpoints
        ? dependencies.loop.rollbackFilesToCheckpoints(
            selectedEntries.map((entry) => entry.path),
          )
        : rollbackFilesIndividually(selectedEntries, dependencies.loop);
      if (!checkpointResult.success) {
        throw new Error(
          checkpointResult.error || "Checkpoint rollback transaction failed.",
        );
      }
      const checkpointRestored = new Set(checkpointResult.restored);
      const gitEntries = selectedEntries.filter(
        (entry) => !checkpointRestored.has(entry.path),
      );
      for (const entry of gitEntries) {
        restoreGitStatusEntry(entry, dependencies, git);
      }
    } catch (error: unknown) {
      const compensationErrors: string[] = [];
      try {
        restoreWorkspaceSnapshot(dependencies.cwd, workspaceSnapshot);
      } catch (compensationError: unknown) {
        compensationErrors.push(toErrorMessage(compensationError));
      }
      if (indexPaths.length > 0 && indexSnapshot && git.restoreIndex) {
        try {
          git.restoreIndex(dependencies.cwd, indexPaths, indexSnapshot);
        } catch (compensationError: unknown) {
          compensationErrors.push(toErrorMessage(compensationError));
        }
      } else if (indexPaths.length > 0) {
        compensationErrors.push("Git index compensation is unavailable.");
      }
      const detail =
        compensationErrors.length === 0
          ? " Previous workspace state was restored."
          : ` Compensation was incomplete: ${compensationErrors.join("; ")}`;
      throw new Error(`${toErrorMessage(error)}${detail}`);
    }
    dependencies.printOutput(
      picocolors.green(
        isZh
          ? `✔ 成功回滚以下文件的变更: ${selected.join(", ")}`
          : `✔ Successfully rolled back changes for: ${selected.join(", ")}`,
      ),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    dependencies.printOutput(
      picocolors.red(
        isZh ? `✖ 回滚操作失败: ${message}` : `✖ Rollback failed: ${message}`,
      ),
    );
  }
  return HANDLED_COMMAND;
}

function rollbackFilesIndividually(
  entries: GitStatusEntry[],
  loop: RollbackLoop,
): ReturnType<NonNullable<RollbackLoop["rollbackFilesToCheckpoints"]>> {
  const restored = entries
    .filter((entry) => loop.rollbackFileToCheckpoint(entry.path))
    .map((entry) => entry.path);
  const restoredSet = new Set(restored);
  return {
    success: true,
    restored,
    unresolved: entries
      .map((entry) => entry.path)
      .filter((filePath) => !restoredSet.has(filePath)),
  };
}

function revalidateSelectedEntries(
  selected: string[],
  displayed: GitStatusEntry[],
  current: GitStatusEntry[],
): GitStatusEntry[] {
  const displayedByPath = new Map(
    displayed.map((entry) => [entry.path, entry]),
  );
  const currentByPath = new Map(current.map((entry) => [entry.path, entry]));
  return selected.map((filePath) => {
    const previous = displayedByPath.get(filePath);
    const latest = currentByPath.get(filePath);
    if (!previous || !latest || !sameStatusEntry(previous, latest)) {
      throw new Error(
        `Git status changed while choosing rollback paths: ${filePath}`,
      );
    }
    if (isUnmergedStatus(latest.status)) {
      throw new Error(
        `Resolve merge conflicts before rolling back this path: ${filePath}`,
      );
    }
    return latest;
  });
}

function isUnmergedStatus(status: string): boolean {
  return status.includes("U") || status === "AA" || status === "DD";
}

function sameStatusEntry(left: GitStatusEntry, right: GitStatusEntry): boolean {
  return (
    left.status === right.status &&
    left.path === right.path &&
    left.originalPath === right.originalPath
  );
}

function collectIndexPaths(entries: GitStatusEntry[]): string[] {
  return [
    ...new Set(
      entries.flatMap((entry) => {
        if (entry.status === "??") return [];
        return entry.originalPath
          ? [entry.path, entry.originalPath]
          : [entry.path];
      }),
    ),
  ];
}

function collectWorkspacePaths(entries: GitStatusEntry[]): string[] {
  return [
    ...new Set(
      entries.flatMap((entry) =>
        entry.originalPath ? [entry.path, entry.originalPath] : [entry.path],
      ),
    ),
  ];
}

function snapshotWorkspacePaths(
  cwd: string,
  filePaths: string[],
): WorkspacePathSnapshot[] {
  if (filePaths.length > ROLLBACK_SNAPSHOT_MAX_PATHS) {
    throw new Error(
      `Rollback selection exceeds ${ROLLBACK_SNAPSHOT_MAX_PATHS} paths.`,
    );
  }
  const snapshots: WorkspacePathSnapshot[] = [];
  let totalBytes = 0;
  for (const filePath of filePaths) {
    const absolutePath = resolveSafePath(cwd, filePath);
    try {
      const stats = lstatSync(absolutePath);
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new Error(
          `Rollback transaction supports regular files only: ${filePath}`,
        );
      }
      const content = readBoundedRegularFileBuffer(
        absolutePath,
        ROLLBACK_SNAPSHOT_FILE_MAX_BYTES,
      );
      if (content === undefined) {
        throw new Error(`Rollback target disappeared: ${filePath}`);
      }
      totalBytes += content.length;
      if (totalBytes > ROLLBACK_SNAPSHOT_TOTAL_MAX_BYTES) {
        throw new Error(
          "Rollback selection exceeds the 128 MiB transaction snapshot limit.",
        );
      }
      snapshots.push({ path: filePath, content });
    } catch (error: unknown) {
      if (isFileSystemError(error, "ENOENT")) {
        snapshots.push({ path: filePath, content: null });
        continue;
      }
      throw error;
    }
  }
  return snapshots;
}

function restoreWorkspaceSnapshot(
  cwd: string,
  snapshots: WorkspacePathSnapshot[],
): void {
  const failures: string[] = [];
  for (const snapshot of snapshots.slice().reverse()) {
    try {
      const absolutePath = resolveSafePath(cwd, snapshot.path);
      if (snapshot.content === null) {
        rmSync(absolutePath, { recursive: true, force: true });
        continue;
      }
      if (existsSync(absolutePath)) {
        const stats = lstatSync(absolutePath);
        if (stats.isSymbolicLink() || !stats.isFile()) {
          throw new Error(
            `Compensation target is not a regular file: ${snapshot.path}`,
          );
        }
      }
      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(resolveSafePath(cwd, snapshot.path), snapshot.content);
    } catch (error: unknown) {
      failures.push(`${snapshot.path}: ${toErrorMessage(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function restoreGitStatusEntry(
  entry: GitStatusEntry,
  dependencies: RollbackCommandDependencies,
  git: GitAdapter,
): void {
  const removePath = dependencies.removePath ?? removeWorkspacePath;
  const removeDestination = (): void => {
    const absolutePath = resolveSafePath(dependencies.cwd, entry.path);
    if (existsSync(absolutePath)) removePath(absolutePath);
  };
  if (entry.status === "??" || entry.status.includes("A")) {
    removeDestination();
    return;
  }
  if (entry.status.includes("R")) {
    if (!entry.originalPath) {
      throw new Error(`Git rename is missing its original path: ${entry.path}`);
    }
    git.checkout(dependencies.cwd, entry.originalPath);
    removeDestination();
    return;
  }
  if (entry.status.includes("C")) {
    removeDestination();
    return;
  }
  git.checkout(dependencies.cwd, entry.path);
}

function printCheckpointTimeline(
  checkpoints: ReturnType<RollbackLoop["getCheckpoints"]>,
  dependencies: RollbackCommandDependencies,
): void {
  const isZh = dependencies.language !== "en";
  if (checkpoints.length === 0) {
    dependencies.printOutput(
      picocolors.yellow(
        isZh
          ? "当前聊天还没有文件检查点。"
          : "This chat has no file checkpoints yet.",
      ),
    );
    return;
  }
  const newestFirst = checkpoints.slice().reverse();
  const visible = newestFirst.slice(0, 50);
  const lines = [
    picocolors.bold(
      isZh
        ? `文件检查点（${checkpoints.length}）`
        : `File checkpoints (${checkpoints.length})`,
    ),
    ...visible.map((checkpoint, index) => {
      const files = checkpoint.files.length
        ? checkpoint.files.slice(0, 3).join(", ") +
          (checkpoint.files.length > 3
            ? ` +${checkpoint.files.length - 3}`
            : "")
        : isZh
          ? "无文件"
          : "no files";
      return `${picocolors.cyan(String(index + 1).padStart(2))}  ${checkpoint.id.slice(0, 12)}  ${checkpoint.timestamp}  ${files}`;
    }),
  ];
  if (newestFirst.length > visible.length) {
    lines.push(
      picocolors.gray(
        isZh
          ? `仅显示最近 ${visible.length} 个检查点。`
          : `Showing the ${visible.length} most recent checkpoints.`,
      ),
    );
  }
  lines.push(
    picocolors.gray(
      isZh
        ? "使用 /rewind <编号或 ID 前缀> 回退。"
        : "Use /rewind <number or ID prefix> to restore one.",
    ),
  );
  dependencies.printOutput(lines.join("\n"));
}

async function rewindToCheckpoint(
  argument: string,
  dependencies: RollbackCommandDependencies,
): Promise<void> {
  const isZh = dependencies.language !== "en";
  const selector = argument.trim();
  if (!selector) {
    dependencies.printOutput(
      picocolors.red(
        isZh
          ? "✖ 用法：/rewind <检查点编号或 ID 前缀>"
          : "✖ Usage: /rewind <checkpoint number or ID prefix>",
      ),
    );
    return;
  }
  const newestFirst = dependencies.loop.getCheckpoints().slice().reverse();
  const numeric = /^\d+$/.test(selector) ? Number(selector) : Number.NaN;
  const matches =
    Number.isInteger(numeric) && numeric >= 1
      ? newestFirst[numeric - 1]
        ? [newestFirst[numeric - 1]]
        : []
      : newestFirst.filter((checkpoint) => checkpoint.id.startsWith(selector));
  if (matches.length !== 1) {
    dependencies.printOutput(
      picocolors.red(
        matches.length > 1
          ? isZh
            ? "✖ ID 前缀匹配多个检查点，请输入更长的前缀。"
            : "✖ The ID prefix matches multiple checkpoints; enter a longer prefix."
          : isZh
            ? `✖ 未找到检查点：${selector}`
            : `✖ Checkpoint not found: ${selector}`,
      ),
    );
    return;
  }
  await dependencies.loop.rewindToCheckpoint(matches[0].id);
}

function removeWorkspacePath(absolutePath: string): void {
  rmSync(absolutePath, { recursive: true, force: true });
}
