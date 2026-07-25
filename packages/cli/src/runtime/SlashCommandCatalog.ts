import picocolors from "picocolors";

export type SlashCommandCategory =
  | "context"
  | "session"
  | "settings"
  | "git"
  | "system";

export interface SlashCommandDefinition {
  command: `/${string}`;
  usage: string;
  category: SlashCommandCategory;
  description: { en: string; zh: string };
  /** Commands that are useful and safe to advertise inside the WebUI composer. */
  webSuggested: boolean;
}

/**
 * Canonical metadata for built-in slash commands.
 *
 * TUI help, terminal completion, and WebUI discovery all derive from this
 * catalog so a newly added command cannot silently disappear from one surface.
 */
export const SLASH_COMMAND_DEFINITIONS = [
  {
    command: "/help",
    usage: "",
    category: "system",
    description: {
      en: "Show all commands and usage",
      zh: "显示全部命令与用法",
    },
    webSuggested: true,
  },
  {
    command: "/status",
    usage: "",
    category: "settings",
    description: {
      en: "Show the active session, model, context, and cost",
      zh: "查看当前会话、模型、上下文与费用",
    },
    webSuggested: true,
  },
  {
    command: "/goal",
    usage: "[objective]",
    category: "session",
    description: {
      en: "Show or set this chat's durable goal; use clear to remove",
      zh: "查看或设置当前聊天的持续目标；使用 clear 清除",
    },
    webSuggested: true,
  },
  {
    command: "/rename",
    usage: "<title>",
    category: "session",
    description: { en: "Rename the current chat", zh: "重命名当前聊天" },
    webSuggested: true,
  },
  {
    command: "/memory",
    usage: "[action]",
    category: "session",
    description: {
      en: "Review and manage explicit project memory",
      zh: "审查和管理项目级显式记忆",
    },
    webSuggested: true,
  },
  {
    command: "/plan",
    usage: "[action]",
    category: "session",
    description: {
      en: "Manage this chat's recoverable task plan",
      zh: "管理当前聊天可恢复的任务计划",
    },
    webSuggested: true,
  },
  {
    command: "/metrics",
    usage: "",
    category: "settings",
    description: {
      en: "Show local runtime and reliability metrics",
      zh: "查看本地运行与可靠性指标",
    },
    webSuggested: true,
  },
  {
    command: "/doctor",
    usage: "",
    category: "settings",
    description: {
      en: "Diagnose runtime, models, web, skills, and safety",
      zh: "诊断运行环境、模型、联网、技能与安全配置",
    },
    webSuggested: true,
  },
  {
    command: "/config",
    usage: "[key=value]",
    category: "settings",
    description: {
      en: "View or update Orbit configuration",
      zh: "查看或更新 Orbit 配置",
    },
    webSuggested: true,
  },
  {
    command: "/model",
    usage: "[name]",
    category: "settings",
    description: {
      en: "Show or switch the active model",
      zh: "查看或切换当前模型",
    },
    webSuggested: true,
  },
  {
    command: "/chat",
    usage: "[action]",
    category: "session",
    description: {
      en: "List, create, delete, or switch chats",
      zh: "列出、新建、删除或切换聊天",
    },
    webSuggested: true,
  },
  {
    command: "/commit",
    usage: "[message]",
    category: "git",
    description: {
      en: "Stage workspace changes and create a commit",
      zh: "暂存工作区修改并创建提交",
    },
    webSuggested: true,
  },
  {
    command: "/review",
    usage: "[preset|commit <ref>|branch <ref>|custom <policy>]",
    category: "git",
    description: {
      en: "Run an evidence-first code review with focused presets",
      zh: "使用专项预设执行基于证据的代码审查",
    },
    webSuggested: true,
  },
  {
    command: "/exit",
    usage: "",
    category: "system",
    description: { en: "Exit the interactive terminal", zh: "退出交互式终端" },
    webSuggested: false,
  },
  {
    command: "/quit",
    usage: "",
    category: "system",
    description: { en: "Exit the interactive terminal", zh: "退出交互式终端" },
    webSuggested: false,
  },
  {
    command: "/rollback",
    usage: "",
    category: "session",
    description: {
      en: "Restore the latest file modification checkpoint",
      zh: "恢复最近一次文件修改检查点",
    },
    webSuggested: true,
  },
  {
    command: "/timeline",
    usage: "",
    category: "session",
    description: {
      en: "List persisted file checkpoints for this chat",
      zh: "列出当前聊天持久化的文件检查点",
    },
    webSuggested: true,
  },
  {
    command: "/rewind",
    usage: "<id|number>",
    category: "session",
    description: {
      en: "Rewind this chat to a selected file checkpoint",
      zh: "将当前聊天回退到指定文件检查点",
    },
    webSuggested: true,
  },
  {
    command: "/compact",
    usage: "",
    category: "context",
    description: {
      en: "Compact older dialogue against the active model window",
      zh: "按当前模型上下文窗口压缩旧对话",
    },
    webSuggested: true,
  },
  {
    command: "/clear",
    usage: "",
    category: "context",
    description: {
      en: "Reset dialogue history and clear the conversation view",
      zh: "重置对话历史并清空会话视图",
    },
    webSuggested: true,
  },
  {
    command: "/add",
    usage: "<file>",
    category: "context",
    description: {
      en: "Add a file or directory to active context",
      zh: "将文件或目录加入活动上下文",
    },
    webSuggested: true,
  },
  {
    command: "/drop",
    usage: "<file>",
    category: "context",
    description: {
      en: "Remove a file or pattern from active context",
      zh: "从活动上下文移除文件或通配符",
    },
    webSuggested: true,
  },
  {
    command: "/mode",
    usage: "[mode]",
    category: "settings",
    description: {
      en: "Switch permission mode: strict, normal, auto, or plan",
      zh: "切换权限模式：strict、normal、auto 或 plan",
    },
    webSuggested: true,
  },
  {
    command: "/copy",
    usage: "",
    category: "session",
    description: {
      en: "Copy the latest Orbit reply",
      zh: "复制 Orbit 的最新回复",
    },
    webSuggested: true,
  },
  {
    command: "/run",
    usage: "<command>",
    category: "system",
    description: {
      en: "Run a native shell command after permission checks",
      zh: "经过权限检查后运行本地 Shell 命令",
    },
    webSuggested: true,
  },
  {
    command: "/update",
    usage: "",
    category: "settings",
    description: {
      en: "Check npm; terminal sessions can install and verify updates",
      zh: "检查 npm；终端会话可安装并验证更新",
    },
    webSuggested: true,
  },
  {
    command: "/webui",
    usage: "[port]",
    category: "settings",
    description: {
      en: "Open the Orbit graphical console",
      zh: "打开 Orbit 图形控制台",
    },
    webSuggested: false,
  },
] as const satisfies readonly SlashCommandDefinition[];

/** Slash commands reserved by Orbit and unavailable to custom commands. */
export const BUILTIN_SLASH_COMMANDS = SLASH_COMMAND_DEFINITIONS.map(
  ({ command }) => command,
);

const CATEGORY_LABELS: Record<
  SlashCommandCategory,
  { en: string; zh: string }
> = {
  context: { en: "Context Management", zh: "上下文管理" },
  session: { en: "Session & History", zh: "会话与历史" },
  settings: { en: "Configuration & Status", zh: "配置与状态" },
  git: { en: "Git Version Control", zh: "Git 提交" },
  system: { en: "System Control", zh: "系统控制" },
};

/** Builds the localized help screen from the canonical command catalog. */
export function buildSlashCommandHelp(isZh: boolean): string {
  const locale = isZh ? "zh" : "en";
  const sections: string[] = [];
  for (const category of Object.keys(
    CATEGORY_LABELS,
  ) as SlashCommandCategory[]) {
    const commands = SLASH_COMMAND_DEFINITIONS.filter(
      (definition) => definition.category === category,
    );
    sections.push(
      picocolors.bold(
        picocolors.yellow(`[ ${CATEGORY_LABELS[category][locale]} ]`),
      ),
      ...commands.map(({ command, usage, description }) => {
        const invocation = usage ? `${command} ${usage}` : command;
        return `  ${picocolors.green(invocation.padEnd(25))} - ${description[locale]}`;
      }),
      "",
    );
  }
  sections.push(
    `  ${picocolors.green("!<cmd>")} - ${isZh ? "直接运行本地 Shell 命令（等同 /run）" : "Run a native shell command (same as /run)"}`,
  );
  return sections.join("\n").trimEnd();
}
