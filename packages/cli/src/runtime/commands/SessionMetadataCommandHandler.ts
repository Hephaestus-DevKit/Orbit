import picocolors from "picocolors";
import { z } from "zod";

const GoalSchema = z.string().trim().min(1).max(4000);
const SessionTitleSchema = z.string().trim().min(1).max(160);

interface SessionMetadataLoop {
  getGoal(): string | undefined;
  setGoal(goal?: string): void;
  setSessionTitle(title: string): void;
}

interface SessionMetadataCommandDependencies {
  loop: SessionMetadataLoop;
  isZh: boolean;
  printOutput(text: string): void;
}

/** Handle persistent goal and chat-title commands. */
export function handleSessionMetadataCommand(
  command: string,
  argument: string,
  dependencies: SessionMetadataCommandDependencies,
): boolean {
  if (command === "/goal") {
    handleGoal(argument, dependencies);
    return true;
  }
  if (command === "/rename") {
    handleRename(argument, dependencies);
    return true;
  }
  return false;
}

function handleGoal(
  argument: string,
  { loop, isZh, printOutput }: SessionMetadataCommandDependencies,
): void {
  const value = argument.trim();
  if (!value) {
    const goal = loop.getGoal();
    printOutput(
      goal
        ? `${picocolors.bold(isZh ? "当前目标" : "Current goal")}\n${goal}`
        : picocolors.gray(
          isZh
            ? "当前聊天尚未设置目标。使用 /goal <目标> 设置。"
            : "No goal is set for this chat. Use /goal <objective> to set one.",
        ),
    );
    return;
  }
  if (["clear", "reset", "off"].includes(value.toLowerCase())) {
    loop.setGoal(undefined);
    printOutput(
      picocolors.green(
        isZh ? "✔ 已清除当前聊天目标。" : "✔ Chat goal cleared.",
      ),
    );
    return;
  }
  const parsed = GoalSchema.safeParse(value);
  if (!parsed.success) {
    printOutput(
      picocolors.red(
        isZh
          ? "✖ 目标长度必须为 1–4000 个字符。"
          : "✖ Goal must be 1–4000 characters.",
      ),
    );
    return;
  }
  loop.setGoal(parsed.data);
  printOutput(
    `${picocolors.green(isZh ? "✔ 已设置聊天目标：" : "✔ Chat goal set:")} ${parsed.data}`,
  );
}

function handleRename(
  argument: string,
  { loop, isZh, printOutput }: SessionMetadataCommandDependencies,
): void {
  const parsed = SessionTitleSchema.safeParse(argument);
  if (!parsed.success) {
    printOutput(
      picocolors.red(
        isZh
          ? "✖ 用法：/rename <聊天名称>（最多 160 个字符）"
          : "✖ Usage: /rename <chat title> (maximum 160 characters)",
      ),
    );
    return;
  }
  loop.setSessionTitle(parsed.data);
  printOutput(
    `${picocolors.green(isZh ? "✔ 聊天已重命名：" : "✔ Chat renamed:")} ${parsed.data}`,
  );
}
