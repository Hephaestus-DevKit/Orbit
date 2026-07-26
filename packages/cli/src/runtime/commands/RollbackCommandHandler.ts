import {
  HIDDEN_CHILD_PROCESS_OPTIONS,
  resolveSafePath,
} from "@orbit-build/shared";
import { Prompt, type PromptOption } from "@orbit-build/tui";
import { execFileSync } from "child_process";
import { existsSync, rmSync } from "fs";
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
  checkout(cwd: string, filePath: string): void;
}

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
    execFileSync("git", ["status", "--porcelain=v1", "-z"], {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  checkout: (cwd, filePath) => {
    execFileSync("git", ["checkout", "--", filePath], {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      cwd,
      stdio: "ignore",
    });
  },
};

/** Parse NUL-delimited porcelain v1 output without corrupting path whitespace. */
export function parseGitStatusPaths(output: string): string[] {
  const fields = output.split("\0");
  const paths: string[] = [];
  for (let index = 0; index < fields.length; index++) {
    const record = fields[index];
    if (!record) continue;
    if (record.length < 4 || record[2] !== " ") {
      throw new Error("Git returned an invalid status record.");
    }
    const status = GitStatusCodeSchema.parse(record.slice(0, 2));
    const filePath = GitStatusPathSchema.parse(record.slice(3));
    paths.push(filePath);

    if (status.includes("R") || status.includes("C")) {
      const originalPath = fields[index + 1];
      GitStatusPathSchema.parse(originalPath);
      index++;
    }
  }
  return [...new Set(paths)];
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
  let paths: string[];
  try {
    paths = parseGitStatusPaths(git.status(dependencies.cwd));
    for (const filePath of paths) {
      resolveSafePath(dependencies.cwd, filePath);
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

  if (paths.length === 0) {
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
    ...paths.map((filePath) => ({ value: filePath, label: filePath })),
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
    for (const filePath of selected) {
      const absolutePath = resolveSafePath(dependencies.cwd, filePath);
      if (dependencies.loop.rollbackFileToCheckpoint(filePath)) continue;
      try {
        git.checkout(dependencies.cwd, filePath);
      } catch {
        if (existsSync(absolutePath)) {
          (dependencies.removePath ?? removeWorkspacePath)(absolutePath);
        }
      }
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
