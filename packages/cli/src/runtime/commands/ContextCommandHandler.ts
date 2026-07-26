import { resolveSafePath } from "@orbit-build/shared";
import { Prompt, type PromptOption } from "@orbit-build/tui";
import glob from "fast-glob";
import { existsSync, statSync } from "fs";
import { isAbsolute, relative, resolve } from "path";
import picocolors from "picocolors";
import {
  HANDLED_COMMAND,
  type CommandHandlerResult,
  type CommandOutput,
} from "./CommandHandlerTypes.js";

interface ContextFile {
  path: string;
  reason: string;
  readOnly?: boolean;
}

interface ContextLoop {
  getRelevantFiles(): ContextFile[];
  addRelevantFilePublic(path: string, reason: string): void;
  addReadOnlyFilePublic(path: string, reason: string): void;
  removeRelevantFilePublic(path: string): void;
  clearRelevantFilesPublic(): void;
  clearHistoryPublic(): void;
  compactHistoryPublic(): Promise<{
    model: string;
    maxContextTokens: number;
    compactAtTokens: number;
    beforeTokens: number;
    afterTokens: number;
    truncatedToolResults: number;
    truncatedContextMessages: number;
    droppedMessages: number;
    changed: boolean;
  }>;
}

interface ContextTui {
  syncFromLoop(loop: unknown): void;
  clearHistoryView(options: { silent?: boolean }): void;
}

interface ContextPromptAdapter {
  askText(question: string): Promise<string | null>;
  askMultiSelect(
    question: string,
    options: PromptOption[],
  ): Promise<string[] | null>;
}

export interface ContextCommandDependencies {
  cwd: string;
  language: "en" | "zh" | "zh-TW";
  candidates: { files: string[] } | null | undefined;
  loop: ContextLoop;
  tui: ContextTui;
  useFullscreenTui: boolean;
  printOutput: CommandOutput;
  prompt?: ContextPromptAdapter;
  clearConsole?: () => void;
}

interface ParsedAddArgument {
  fileArgument: string;
  readOnly: boolean;
}

function parseAddArgument(argument: string): ParsedAddArgument {
  const match = argument.match(/^(--read-only|--readonly|-r)(?:\s+|$)/);
  return match
    ? { fileArgument: argument.slice(match[0].length).trim(), readOnly: true }
    : { fileArgument: argument, readOnly: false };
}

function toWorkspaceRelative(cwd: string, absolutePath: string): string {
  return relative(cwd, absolutePath).replace(/\\/g, "/");
}

function safeCandidateFiles(cwd: string, candidates: string[]): string[] {
  return candidates.filter((candidate) => {
    try {
      resolveSafePath(cwd, candidate);
      return true;
    } catch {
      return false;
    }
  });
}

function containsWildcard(value: string): boolean {
  return value.includes("*") || value.includes("?");
}

function isUnsafePattern(value: string): boolean {
  return (
    isAbsolute(value) ||
    value
      .replace(/\\/g, "/")
      .split("/")
      .some((segment) => segment === "..")
  );
}

function wildcardExpression(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__DOUBLE_STAR__\/?/g, "(?:|.*/)");
  return new RegExp(`^${escaped}$`, "i");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function addContextFile(
  loop: ContextLoop,
  path: string,
  readOnly: boolean,
  reason: string,
): void {
  if (readOnly) loop.addReadOnlyFilePublic(path, reason);
  else loop.addRelevantFilePublic(path, reason);
}

async function handleInteractiveAdd(
  readOnly: boolean,
  dependencies: ContextCommandDependencies,
  candidateFiles: string[],
): Promise<CommandHandlerResult> {
  const { language, loop, printOutput, prompt = Prompt, tui } = dependencies;
  const isZh = language !== "en";
  if (candidateFiles.length === 0) {
    printOutput(
      isZh
        ? picocolors.yellow("工作区未找到可添加的文件。")
        : picocolors.yellow("No files found in the workspace to add."),
    );
    tui.syncFromLoop(loop);
    return HANDLED_COMMAND;
  }

  try {
    const query = await prompt.askText(
      isZh
        ? "输入文件名过滤词（支持模糊匹配，直接回车列出所有）："
        : "Enter filename filter query (fuzzy, press Enter for all):",
    );
    if (query === null) {
      printOutput(
        isZh
          ? picocolors.yellow("操作已取消。")
          : picocolors.yellow("Operation cancelled."),
      );
      return HANDLED_COMMAND;
    }

    const normalizedQuery = query.trim().toLowerCase();
    const filtered = normalizedQuery
      ? candidateFiles.filter((file) =>
          file.toLowerCase().includes(normalizedQuery),
        )
      : candidateFiles;
    if (filtered.length === 0) {
      printOutput(
        isZh
          ? picocolors.yellow("未找到匹配过滤词的文件。")
          : picocolors.yellow("No matching files found."),
      );
      return HANDLED_COMMAND;
    }

    const selected = await prompt.askMultiSelect(
      isZh
        ? readOnly
          ? "选择要添加到上下文的只读参考文件："
          : "选择要添加到上下文的文件："
        : readOnly
          ? "Select files to add as read-only reference context:"
          : "Select files to add to the context:",
      filtered.map((file) => ({ value: file, label: file })),
    );
    if (!selected?.length) {
      printOutput(
        isZh
          ? picocolors.yellow("未选择任何文件。")
          : picocolors.yellow("No files selected."),
      );
      return HANDLED_COMMAND;
    }
    for (const file of selected) {
      if (!candidateFiles.includes(file)) continue;
      addContextFile(
        loop,
        file,
        readOnly,
        readOnly
          ? "Manually added via interactive /add --read-only"
          : "Manually added via interactive /add",
      );
    }
    printOutput(
      isZh
        ? picocolors.green(
            `✔ 成功添加 ${selected.length} 个${readOnly ? "只读" : ""}文件到上下文。`,
          )
        : picocolors.green(
            `✔ Added ${selected.length} ${readOnly ? "read-only " : ""}file(s) to active context.`,
          ),
    );
  } catch (error: unknown) {
    printOutput(
      isZh
        ? picocolors.red(`选择文件失败: ${errorMessage(error)}`)
        : picocolors.red(`Failed to select files: ${errorMessage(error)}`),
    );
  } finally {
    tui.syncFromLoop(loop);
  }
  return HANDLED_COMMAND;
}

async function handleAdd(
  argument: string,
  dependencies: ContextCommandDependencies,
): Promise<CommandHandlerResult> {
  const { cwd, language, loop, printOutput, tui } = dependencies;
  const isZh = language !== "en";
  const { fileArgument, readOnly } = parseAddArgument(argument);
  const candidates = safeCandidateFiles(
    cwd,
    dependencies.candidates?.files ?? [],
  );
  if (!fileArgument) {
    return handleInteractiveAdd(readOnly, dependencies, candidates);
  }

  if (containsWildcard(fileArgument)) {
    if (isUnsafePattern(fileArgument)) {
      printOutput(
        picocolors.red(
          isZh
            ? `路径已被安全策略阻止: ${fileArgument}`
            : `Path blocked by workspace safety policy: ${fileArgument}`,
        ),
      );
      return HANDLED_COMMAND;
    }
    const expression = wildcardExpression(fileArgument.replace(/\\/g, "/"));
    const matched = candidates.filter((file) => expression.test(file));
    for (const file of matched) {
      addContextFile(loop, file, readOnly, "Matched via glob /add");
    }
    printOutput(
      matched.length > 0
        ? isZh
          ? picocolors.green(
              `✔ 已通过通配符自动添加 ${matched.length} 个${readOnly ? "只读" : ""}文件到上下文。`,
            )
          : picocolors.green(
              `✔ Automatically added ${matched.length} ${readOnly ? "read-only " : ""}file(s) via wildcard.`,
            )
        : isZh
          ? picocolors.yellow(`没有找到匹配通配符 "${fileArgument}" 的文件。`)
          : picocolors.yellow(
              `No files matching wildcard "${fileArgument}" were found.`,
            ),
    );
    tui.syncFromLoop(loop);
    return HANDLED_COMMAND;
  }

  let absolutePath: string;
  try {
    absolutePath = resolveSafePath(cwd, fileArgument);
  } catch (error: unknown) {
    printOutput(
      picocolors.red(
        isZh
          ? `路径已被安全策略阻止: ${errorMessage(error)}`
          : `Path blocked by workspace safety policy: ${errorMessage(error)}`,
      ),
    );
    return HANDLED_COMMAND;
  }

  if (!existsSync(absolutePath)) {
    const normalizedArgument = fileArgument.toLowerCase();
    const matched = candidates.filter(
      (file) =>
        file.toLowerCase().includes(normalizedArgument) ||
        file.toLowerCase().endsWith(`/${normalizedArgument}`),
    );
    if (matched.length === 1) {
      addContextFile(
        loop,
        matched[0],
        readOnly,
        readOnly
          ? "Fuzzy matched via /add --read-only"
          : "Fuzzy matched via /add",
      );
      printOutput(
        picocolors.green(
          isZh
            ? `✔ 自动匹配并添加${readOnly ? "只读" : ""}文件: ${matched[0]}`
            : `✔ Auto-matched and added ${readOnly ? "read-only " : ""}file: ${matched[0]}`,
        ),
      );
      tui.syncFromLoop(loop);
      return HANDLED_COMMAND;
    }
    if (matched.length > 1) {
      printOutput(
        picocolors.yellow(
          `${isZh ? "找到多个匹配文件，请精确输入路径或使用无参交互选择" : "Multiple matches found, please specify or use interactive select"}:\n${matched.map((file) => `  • ${file}`).join("\n")}`,
        ),
      );
      return HANDLED_COMMAND;
    }
    printOutput(
      picocolors.red(
        isZh
          ? `文件不存在: ${fileArgument}`
          : `File does not exist: ${fileArgument}`,
      ),
    );
    return HANDLED_COMMAND;
  }

  const relativePath = toWorkspaceRelative(cwd, absolutePath);
  try {
    if (statSync(absolutePath).isDirectory()) {
      const files = await glob("**/*", {
        cwd: absolutePath,
        onlyFiles: true,
        followSymbolicLinks: false,
        suppressErrors: true,
      });
      for (const file of files) {
        const childAbsolute = resolveSafePath(absolutePath, file);
        const childRelative = toWorkspaceRelative(cwd, childAbsolute);
        addContextFile(
          loop,
          childRelative,
          readOnly,
          readOnly
            ? "Manually added directory via /add --read-only"
            : "Manually added directory via /add",
        );
      }
      printOutput(
        picocolors.green(
          isZh
            ? `✔ 成功添加目录 ${relativePath} 下的所有${readOnly ? "只读" : ""}文件到上下文。`
            : `✔ Added all files in directory ${relativePath} ${readOnly ? "as read-only " : ""}to active context.`,
        ),
      );
    } else {
      addContextFile(
        loop,
        relativePath,
        readOnly,
        readOnly
          ? "Manually added file via /add --read-only"
          : "Manually added file via /add",
      );
      printOutput(
        picocolors.green(
          isZh
            ? `✔ 已将${readOnly ? "只读文件" : ""} ${relativePath} 添加到上下文。`
            : `✔ Added ${readOnly ? "read-only file " : ""}${relativePath} to active context.`,
        ),
      );
    }
    tui.syncFromLoop(loop);
  } catch (error: unknown) {
    printOutput(
      isZh
        ? picocolors.red(`添加失败: ${errorMessage(error)}`)
        : picocolors.red(`Failed to add: ${errorMessage(error)}`),
    );
  }
  return HANDLED_COMMAND;
}

async function handleDrop(
  argument: string,
  dependencies: ContextCommandDependencies,
): Promise<CommandHandlerResult> {
  const {
    cwd,
    language,
    loop,
    printOutput,
    prompt = Prompt,
    tui,
  } = dependencies;
  const isZh = language !== "en";
  if (!argument) {
    try {
      const activeFiles = loop.getRelevantFiles();
      if (activeFiles.length === 0) {
        printOutput(
          isZh
            ? picocolors.yellow("当前活动上下文为空，无可移除的文件。")
            : picocolors.yellow("Active context is empty, no files to remove."),
        );
      } else {
        const selected = await prompt.askMultiSelect(
          isZh
            ? "选择要从上下文中移除的文件："
            : "Select files to remove from the context:",
          activeFiles.map((file) => ({ value: file.path, label: file.path })),
        );
        for (const file of selected ?? []) loop.removeRelevantFilePublic(file);
        printOutput(
          selected?.length
            ? picocolors.green(
                isZh
                  ? `✔ 成功从上下文中移除 ${selected.length} 个文件。`
                  : `✔ Removed ${selected.length} file(s) from active context.`,
              )
            : isZh
              ? picocolors.yellow("未选择任何文件。")
              : picocolors.yellow("No files selected."),
        );
      }
    } catch (error: unknown) {
      printOutput(
        isZh
          ? picocolors.red(`移除文件失败: ${errorMessage(error)}`)
          : picocolors.red(`Failed to remove files: ${errorMessage(error)}`),
      );
    } finally {
      tui.syncFromLoop(loop);
    }
    return HANDLED_COMMAND;
  }

  if (argument === "all" || argument === "*") {
    loop.clearRelevantFilesPublic();
    tui.syncFromLoop(loop);
    printOutput(
      isZh
        ? picocolors.green("✔ 已从上下文中清空所有文件。")
        : picocolors.green("✔ Cleared all files from active context."),
    );
    return HANDLED_COMMAND;
  }

  if (isUnsafePattern(argument)) {
    printOutput(
      picocolors.red(
        isZh
          ? `路径已被安全策略阻止: ${argument}`
          : `Path blocked by workspace safety policy: ${argument}`,
      ),
    );
    return HANDLED_COMMAND;
  }
  const relativePath = containsWildcard(argument)
    ? argument.replace(/\\/g, "/")
    : toWorkspaceRelative(cwd, resolve(cwd, argument));
  const beforeCount = loop.getRelevantFiles().length;
  loop.removeRelevantFilePublic(relativePath);
  const expression = wildcardExpression(argument.replace(/\\/g, "/"));
  for (const file of loop.getRelevantFiles().map((entry) => entry.path)) {
    if (expression.test(file) || file.startsWith(relativePath)) {
      loop.removeRelevantFilePublic(file);
    }
  }
  tui.syncFromLoop(loop);
  const droppedCount = beforeCount - loop.getRelevantFiles().length;
  printOutput(
    droppedCount > 0
      ? picocolors.green(
          isZh
            ? `✔ 从上下文中成功移除 ${droppedCount} 个文件。`
            : `✔ Removed ${droppedCount} file(s) from active context.`,
        )
      : picocolors.yellow(
          isZh
            ? `上下文中未找到匹配 "${argument}" 的文件。`
            : `No files matching "${argument}" were found in active context.`,
        ),
  );
  return HANDLED_COMMAND;
}

async function handleCompact(
  dependencies: ContextCommandDependencies,
): Promise<CommandHandlerResult> {
  const { language, loop, printOutput, tui } = dependencies;
  const isZh = language !== "en";
  try {
    const result = await loop.compactHistoryPublic();
    if (!result.changed) {
      printOutput(
        picocolors.green(
          isZh
            ? `✔ 当前历史无需压缩：约 ${result.afterTokens.toLocaleString()} tokens；模型 ${result.model} 的自动压缩线为 ${result.compactAtTokens.toLocaleString()} / ${result.maxContextTokens.toLocaleString()}。`
            : `✔ History is already compact: ~${result.afterTokens.toLocaleString()} tokens; ${result.model} auto-compacts at ${result.compactAtTokens.toLocaleString()} / ${result.maxContextTokens.toLocaleString()}.`,
        ),
      );
    } else {
      printOutput(
        picocolors.green(
          isZh
            ? `✔ 上下文压缩完成：${result.beforeTokens.toLocaleString()} → ${result.afterTokens.toLocaleString()} tokens；总结 ${result.droppedMessages} 条旧消息，截断 ${result.truncatedToolResults} 条工具结果。当前模型：${result.model}（窗口 ${result.maxContextTokens.toLocaleString()}）。`
            : `✔ Context compacted: ${result.beforeTokens.toLocaleString()} → ${result.afterTokens.toLocaleString()} tokens; summarized ${result.droppedMessages} older messages and truncated ${result.truncatedToolResults} tool results. Model: ${result.model} (${result.maxContextTokens.toLocaleString()} window).`,
        ),
      );
    }
  } catch (error: unknown) {
    printOutput(
      picocolors.red(
        isZh
          ? `✖ 上下文压缩失败：${errorMessage(error)}`
          : `✖ Context compaction failed: ${errorMessage(error)}`,
      ),
    );
  } finally {
    tui.syncFromLoop(loop);
  }
  return HANDLED_COMMAND;
}

/** Handles `/add`, `/drop`, `/compact`, and `/clear` context commands. */
export async function handleContextCommand(
  command: string,
  argument: string,
  dependencies: ContextCommandDependencies,
): Promise<CommandHandlerResult | null> {
  if (command === "/add") return handleAdd(argument, dependencies);
  if (command === "/drop") return handleDrop(argument, dependencies);
  if (command === "/compact") return handleCompact(dependencies);
  if (command === "/clear") {
    dependencies.loop.clearHistoryPublic();
    dependencies.tui.clearHistoryView({
      silent: !dependencies.useFullscreenTui,
    });
    if (!dependencies.useFullscreenTui) {
      (dependencies.clearConsole ?? console.clear)();
    }
    return HANDLED_COMMAND;
  }
  return null;
}
