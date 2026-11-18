import picocolors from "picocolors";
import { z } from "zod";
import { HANDLED_COMMAND, type CommandHandlerResult } from "./CommandHandlerTypes.js";

const TextSchema = z.string().trim().min(1).max(2000);
const ItemReferenceSchema = z.string().trim().min(1).max(100);

interface MemoryEntry {
  id: string;
  text: string;
}

interface TaskPlanItemView {
  id: string;
  text: string;
  status: "pending" | "in_progress" | "completed";
}

interface WorkspaceStateLoop {
  getProjectMemory(): { enabled: boolean; entries: MemoryEntry[] };
  addProjectMemory(text: string): MemoryEntry;
  removeProjectMemory(id: string): boolean;
  clearProjectMemory(): void;
  setProjectMemoryEnabled(enabled: boolean): { enabled: boolean };
  getTaskPlan(): { items: TaskPlanItemView[] } | undefined;
  addTaskPlanItem(text: string): unknown;
  updateTaskPlanItem(id: string, status: TaskPlanItemView["status"]): unknown;
  removeTaskPlanItem(id: string): boolean;
  clearTaskPlan(): void;
  getSessionMetrics():
    | {
      eventCount: number;
      toolRuns: number;
      toolFailures: number;
      deniedTools: number;
      filesChanged: number;
      modelSwitches: number;
      routingDecisions: number;
      fastRoutes: number;
      qualityRoutes: number;
      compactions: number;
      resumedCount: number;
    }
    | undefined;
}

interface Dependencies {
  loop: WorkspaceStateLoop;
  isZh: boolean;
  printOutput(text: string): void;
}

/** Handles explicit project memory, durable per-chat plans, and local metrics. */
export function handleWorkspaceStateCommand(
  command: string,
  argument: string,
  dependencies: Dependencies,
): CommandHandlerResult | undefined {
  if (command === "/memory") {
    handleMemory(argument, dependencies);
    return HANDLED_COMMAND;
  }
  if (command === "/plan") {
    handlePlan(argument, dependencies);
    return HANDLED_COMMAND;
  }
  if (command === "/metrics") {
    handleMetrics(dependencies);
    return HANDLED_COMMAND;
  }
  return undefined;
}

function handleMemory(
  argument: string,
  { loop, isZh, printOutput }: Dependencies,
): void {
  const [action = "list", ...rest] = argument.trim().split(/\s+/);
  const value = rest.join(" ").trim();
  if (["list", "ls"].includes(action.toLowerCase())) {
    const memory = loop.getProjectMemory();
    const rows = memory.entries.map(
      (entry, index) => `  ${index + 1}. ${entry.text}`,
    );
    printOutput(
      [
        picocolors.bold(isZh ? "项目记忆" : "Project memory"),
        picocolors.gray(
          memory.enabled
            ? isZh
              ? "状态：启用"
              : "Status: enabled"
            : isZh
            ? "状态：暂停"
            : "Status: paused",
        ),
        ...(rows.length
          ? rows
          : [picocolors.gray(isZh ? "  暂无条目。" : "  No entries.")]),
      ].join("\n"),
    );
    return;
  }
  if (action === "add") {
    const parsed = TextSchema.safeParse(value);
    if (!parsed.success)
      return printOutput(
        picocolors.red(
          isZh ? "✖ 用法：/memory add <内容>" : "✖ Usage: /memory add <text>",
        ),
      );
    loop.addProjectMemory(parsed.data);
    printOutput(
      picocolors.green(
        isZh
          ? "✔ 已保存项目记忆（敏感信息会自动脱敏）。"
          : "✔ Project memory saved (secrets are redacted).",
      ),
    );
    return;
  }
  if (["remove", "rm", "delete"].includes(action)) {
    const memory = loop.getProjectMemory();
    const id = resolveItemId(value, memory.entries);
    const removed = id ? loop.removeProjectMemory(id) : false;
    printOutput(
      removed
        ? picocolors.green(isZh ? "✔ 已删除记忆。" : "✔ Memory removed.")
        : picocolors.red(isZh ? "✖ 未找到该记忆。" : "✖ Memory not found."),
    );
    return;
  }
  if (action === "clear") {
    loop.clearProjectMemory();
    printOutput(
      picocolors.green(
        isZh ? "✔ 已清空项目记忆。" : "✔ Project memory cleared.",
      ),
    );
    return;
  }
  if (["on", "off"].includes(action)) {
    loop.setProjectMemoryEnabled(action === "on");
    printOutput(
      picocolors.green(
        action === "on"
          ? isZh
            ? "✔ 项目记忆已启用。"
            : "✔ Project memory enabled."
          : isZh
          ? "✔ 项目记忆已暂停。"
          : "✔ Project memory paused.",
      ),
    );
    return;
  }
  printOutput(
    picocolors.red(
      isZh
        ? "✖ 用法：/memory [list|add|remove|clear|on|off]"
        : "✖ Usage: /memory [list|add|remove|clear|on|off]",
    ),
  );
}

function handlePlan(
  argument: string,
  { loop, isZh, printOutput }: Dependencies,
): void {
  const [action = "list", ...rest] = argument.trim().split(/\s+/);
  const value = rest.join(" ").trim();
  const plan = loop.getTaskPlan();
  if (["list", "ls", "show"].includes(action.toLowerCase())) {
    const symbols = { pending: "○", in_progress: "●", completed: "✔" } as const;
    const rows = (plan?.items || []).map(
      (item, index) => `  ${index + 1}. ${symbols[item.status]} ${item.text}`,
    );
    printOutput(
      [
        picocolors.bold(isZh ? "当前计划" : "Current plan"),
        ...(rows.length
          ? rows
          : [picocolors.gray(isZh ? "  暂无步骤。" : "  No steps.")]),
      ].join("\n"),
    );
    return;
  }
  if (action === "add") {
    const parsed = TextSchema.safeParse(value);
    if (!parsed.success)
      return printOutput(
        picocolors.red(
          isZh ? "✖ 用法：/plan add <步骤>" : "✖ Usage: /plan add <step>",
        ),
      );
    loop.addTaskPlanItem(parsed.data);
    printOutput(
      picocolors.green(isZh ? "✔ 已添加计划步骤。" : "✔ Plan step added."),
    );
    return;
  }
  if (["start", "done", "pending"].includes(action)) {
    const id = resolveItemId(value, plan?.items || []);
    const status = action === "start"
      ? "in_progress"
      : action === "done"
      ? "completed"
      : "pending";
    const updated = id ? loop.updateTaskPlanItem(id, status) : undefined;
    printOutput(
      updated
        ? picocolors.green(
          isZh ? "✔ 计划状态已更新。" : "✔ Plan status updated.",
        )
        : picocolors.red(isZh ? "✖ 未找到该步骤。" : "✖ Plan step not found."),
    );
    return;
  }
  if (["remove", "rm", "delete"].includes(action)) {
    const id = resolveItemId(value, plan?.items || []);
    const removed = id ? loop.removeTaskPlanItem(id) : false;
    printOutput(
      removed
        ? picocolors.green(isZh ? "✔ 已删除步骤。" : "✔ Plan step removed.")
        : picocolors.red(isZh ? "✖ 未找到该步骤。" : "✖ Plan step not found."),
    );
    return;
  }
  if (action === "clear") {
    loop.clearTaskPlan();
    printOutput(
      picocolors.green(isZh ? "✔ 已清空当前计划。" : "✔ Plan cleared."),
    );
    return;
  }
  printOutput(
    picocolors.red(
      isZh
        ? "✖ 用法：/plan [list|add|start|done|pending|remove|clear]"
        : "✖ Usage: /plan [list|add|start|done|pending|remove|clear]",
    ),
  );
}

function handleMetrics({ loop, isZh, printOutput }: Dependencies): void {
  const metrics = loop.getSessionMetrics();
  if (!metrics)
    return printOutput(
      picocolors.gray(isZh ? "当前没有活动会话。" : "No active session."),
    );
  printOutput(
    [
      picocolors.bold(isZh ? "本地会话指标" : "Local session metrics"),
      `  ${isZh ? "审计事件" : "Audit events"}: ${metrics.eventCount}`,
      `  ${
        isZh ? "工具运行 / 失败 / 拒绝" : "Tool runs / failed / denied"
      }: ${metrics.toolRuns} / ${metrics.toolFailures} / ${metrics.deniedTools}`,
      `  ${isZh ? "文件修改" : "File changes"}: ${metrics.filesChanged}`,
      `  ${
        isZh ? "模型切换 / 压缩 / 恢复" : "Model switches / compactions / resumes"
      }: ${metrics.modelSwitches} / ${metrics.compactions} / ${metrics.resumedCount}`,
      `  ${
        isZh ? "自动路由（快速 / 质量）" : "Auto routes (fast / quality)"
      }: ${metrics.routingDecisions} (${metrics.fastRoutes} / ${metrics.qualityRoutes})`,
    ].join("\n"),
  );
}

function resolveItemId(
  reference: string,
  items: Array<{ id: string }>,
): string | undefined {
  const parsed = ItemReferenceSchema.safeParse(reference);
  if (!parsed.success) return undefined;
  const index = Number(parsed.data);
  if (Number.isInteger(index) && index >= 1 && index <= items.length)
    return items[index - 1].id;
  return items.find((item) => item.id === parsed.data)?.id;
}
