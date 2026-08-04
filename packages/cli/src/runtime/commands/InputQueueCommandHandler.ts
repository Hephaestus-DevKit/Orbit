import type { AgentLoop } from "@orbit-build/core";
import type { OrbitLanguage } from "@orbit-build/config";
import type { QueuedAgentInput } from "@orbit-build/session";

type CommandResult = { shouldExit: false; processed: true };

interface InputQueueCommandContext {
  loop: Pick<
    AgentLoop,
    | "getQueuedInputs"
    | "removeQueuedInput"
    | "clearQueuedInputs"
    | "updateQueuedInput"
    | "moveQueuedInput"
  >;
  language: OrbitLanguage;
  canSteer: boolean;
  printOutput: (text: string) => void;
}

const HANDLED: CommandResult = { shouldExit: false, processed: true };

function compactPreview(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}

function findQueuedInput(
  items: QueuedAgentInput[],
  reference: string | undefined,
): QueuedAgentInput | undefined {
  if (!reference) return undefined;
  if (/^\d+$/.test(reference)) {
    return items[Number(reference) - 1];
  }
  return items.find((item) => item.id === reference);
}

function usage(isZh: boolean): string {
  return isZh
    ? "用法: /queue [list|clear|remove <序号>|edit <序号> <内容>|up <序号>|down <序号>|next <序号>|steer <序号>]"
    : "Usage: /queue [list|clear|remove <n>|edit <n> <text>|up <n>|down <n>|next <n>|steer <n>]";
}

/** Manage the same durable queue used by TUI, WebUI, and the agent loop. */
export function handleInputQueueCommand(
  command: string,
  rawArguments: string,
  context: InputQueueCommandContext,
): CommandResult | undefined {
  if (command !== "/queue") return undefined;
  const isZh = context.language !== "en";
  const items = context.loop.getQueuedInputs();
  const trimmed = rawArguments.trim();
  const [action, reference] = (trimmed || "list").split(/\s+/, 3);

  if (action === "list") {
    if (items.length === 0) {
      context.printOutput(
        isZh ? "待发送队列为空。" : "The input queue is empty.",
      );
      return HANDLED;
    }
    const rows = items.map(
      (item, index) =>
        `${String(index + 1).padStart(2, " ")}. ${item.mode === "steer" ? "↯" : "·"} ${compactPreview(item.text)}${item.attachments.length ? ` · 📎 ${item.attachments.length}` : ""}`,
    );
    context.printOutput(
      `${isZh ? "待发送队列" : "Queued inputs"} (${items.length}/12)\n${rows.join("\n")}`,
    );
    return HANDLED;
  }

  if (action === "clear") {
    const removed = context.loop.clearQueuedInputs();
    context.printOutput(
      isZh
        ? `✔ 已清空 ${removed} 条待发送消息。`
        : `✔ Cleared ${removed} queued input(s).`,
    );
    return HANDLED;
  }

  const input = findQueuedInput(items, reference);
  if (!input) {
    context.printOutput(
      isZh
        ? `✖ 找不到指定的待发送消息。\n${usage(true)}`
        : `✖ Queued input not found.\n${usage(false)}`,
    );
    return HANDLED;
  }

  if (action === "remove") {
    context.loop.removeQueuedInput(input.id);
    context.printOutput(
      isZh ? "✔ 已移除待发送消息。" : "✔ Queued input removed.",
    );
    return HANDLED;
  }

  if (action === "edit") {
    const match = trimmed.match(/^edit\s+\S+\s+([\s\S]+)$/);
    const text = match?.[1]?.trim();
    if (!text || text.length > 100_000) {
      context.printOutput(usage(isZh));
      return HANDLED;
    }
    context.loop.updateQueuedInput(input.id, { text });
    context.printOutput(
      isZh ? "✔ 待发送消息已更新。" : "✔ Queued input updated.",
    );
    return HANDLED;
  }

  if (action === "up" || action === "down") {
    const moved = context.loop.moveQueuedInput(input.id, action);
    context.printOutput(
      moved
        ? isZh
          ? "✔ 队列顺序已更新。"
          : "✔ Queue order updated."
        : isZh
          ? "⚠️ 消息已经位于该方向的边界。"
          : "⚠️ The input is already at that queue boundary.",
    );
    return HANDLED;
  }

  if (action === "next") {
    let moved = false;
    while (context.loop.moveQueuedInput(input.id, "up")) moved = true;
    context.printOutput(
      moved
        ? isZh
          ? "✔ 该消息将在当前任务后优先执行。"
          : "✔ This input will run first after the current task."
        : isZh
          ? "⚠️ 该消息已经排在首位。"
          : "⚠️ This input is already first.",
    );
    return HANDLED;
  }

  if (action === "steer") {
    if (!context.canSteer) {
      context.printOutput(
        isZh
          ? "⚠️ 只有正在运行的单智能体任务可以接收中途引导。"
          : "⚠️ Mid-turn steering requires an active single-agent task.",
      );
      return HANDLED;
    }
    context.loop.updateQueuedInput(input.id, { mode: "steer" });
    context.printOutput(
      isZh
        ? "✔ 已提升为当前任务引导，将在下一个安全步骤生效。"
        : "✔ Promoted to steering; it will apply at the next safe step.",
    );
    return HANDLED;
  }

  context.printOutput(usage(isZh));
  return HANDLED;
}
