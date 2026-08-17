import picocolors from "picocolors";
import { localizeOrbit, type OrbitLanguage } from "@orbit-build/config";

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
  description: SlashCommandLocalizedText;
  suggestions?: readonly SlashCommandSuggestion[];
  /** Commands that are useful and safe to advertise inside the WebUI composer. */
  webSuggested: boolean;
}

export interface SlashCommandSuggestion {
  value: string;
  description: SlashCommandLocalizedText;
}

export interface SlashCommandLocalizedText {
  en: string;
  zh: string;
  "zh-TW": string;
}

export interface SlashCommandDetail {
  command: string;
  description: string;
  argumentHint?: string;
  category: SlashCommandCategory | "workflow";
  source: "builtin" | "user" | "project" | "mcp";
}

/**
 * Canonical metadata for built-in slash commands.
 *
 * TUI help, terminal completion, and WebUI discovery all derive from this
 * catalog so a newly added command cannot silently disappear from one surface.
 */
export const SLASH_COMMAND_DEFINITIONS: readonly SlashCommandDefinition[] = [
  {
    command: "/help",
    usage: "",
    category: "system",
    description: {
      en: "Show all commands and usage",
      zh: "显示全部命令与用法",
      "zh-TW": "顯示全部命令與用法",
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
      "zh-TW": "查看目前工作階段、模型、上下文與費用",
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
      "zh-TW": "查看或設定目前聊天的持續目標；使用 clear 清除",
    },
    suggestions: [
      {
        value: "clear",
        description: {
          en: "Remove the current goal",
          zh: "清除当前目标",
          "zh-TW": "清除目前目標",
        },
      },
    ],
    webSuggested: true,
  },
  {
    command: "/queue",
    usage: "[list|clear|remove|edit|up|down|next|steer]",
    category: "session",
    description: {
      en: "Inspect and manage durable follow-ups and steering inputs",
      zh: "查看和管理持久化后续消息与引导指令",
      "zh-TW": "查看和管理持久化後續訊息與引導指令",
    },
    suggestions: [
      {
        value: "list",
        description: {
          en: "List queued inputs",
          zh: "列出待发送消息",
          "zh-TW": "列出待傳送訊息",
        },
      },
      {
        value: "next ",
        description: {
          en: "Run one input first after the current task",
          zh: "将一条消息提升为当前任务后的首项",
          "zh-TW": "將一條訊息提升為目前任務後的首項",
        },
      },
      {
        value: "steer ",
        description: {
          en: "Promote an input to mid-turn steering",
          zh: "将消息提升为中途引导",
          "zh-TW": "將訊息提升為中途引導",
        },
      },
      {
        value: "clear",
        description: {
          en: "Clear queued inputs",
          zh: "清空待发送队列",
          "zh-TW": "清空待傳送佇列",
        },
      },
    ],
    webSuggested: false,
  },
  {
    command: "/rename",
    usage: "<title>",
    category: "session",
    description: {
      en: "Rename the current chat",
      zh: "重命名当前聊天",
      "zh-TW": "重新命名目前聊天",
    },
    webSuggested: true,
  },
  {
    command: "/memory",
    usage: "[action]",
    category: "session",
    description: {
      en: "Review and manage explicit project memory",
      zh: "审查和管理项目级显式记忆",
      "zh-TW": "審查和管理專案級明確記憶",
    },
    suggestions: [
      {
        value: "list",
        description: {
          en: "List saved memory",
          zh: "列出已保存记忆",
          "zh-TW": "列出已儲存記憶",
        },
      },
      {
        value: "add ",
        description: {
          en: "Save a memory entry",
          zh: "添加一条记忆",
          "zh-TW": "新增一條記憶",
        },
      },
      {
        value: "remove ",
        description: {
          en: "Remove a memory entry",
          zh: "删除一条记忆",
          "zh-TW": "刪除一條記憶",
        },
      },
      {
        value: "clear",
        description: {
          en: "Clear project memory",
          zh: "清空项目记忆",
          "zh-TW": "清空專案記憶",
        },
      },
      {
        value: "on",
        description: {
          en: "Enable project memory",
          zh: "启用项目记忆",
          "zh-TW": "啟用專案記憶",
        },
      },
      {
        value: "off",
        description: {
          en: "Pause project memory",
          zh: "暂停项目记忆",
          "zh-TW": "暫停專案記憶",
        },
      },
    ],
    webSuggested: true,
  },
  {
    command: "/plan",
    usage: "[action]",
    category: "session",
    description: {
      en: "Manage this chat's recoverable task plan",
      zh: "管理当前聊天可恢复的任务计划",
      "zh-TW": "管理目前聊天可復原的任務計畫",
    },
    suggestions: [
      {
        value: "list",
        description: {
          en: "Show the current plan",
          zh: "显示当前计划",
          "zh-TW": "顯示目前計畫",
        },
      },
      {
        value: "add ",
        description: {
          en: "Add a plan step",
          zh: "添加计划步骤",
          "zh-TW": "新增計畫步驟",
        },
      },
      {
        value: "start ",
        description: {
          en: "Start a plan step",
          zh: "开始一个计划步骤",
          "zh-TW": "開始一個計畫步驟",
        },
      },
      {
        value: "done ",
        description: {
          en: "Complete a plan step",
          zh: "完成一个计划步骤",
          "zh-TW": "完成一個計畫步驟",
        },
      },
      {
        value: "pending ",
        description: {
          en: "Reset a step to pending",
          zh: "将步骤恢复为待处理",
          "zh-TW": "將步驟恢復為待處理",
        },
      },
      {
        value: "remove ",
        description: {
          en: "Remove a plan step",
          zh: "删除计划步骤",
          "zh-TW": "刪除計畫步驟",
        },
      },
      {
        value: "clear",
        description: {
          en: "Clear the current plan",
          zh: "清空当前计划",
          "zh-TW": "清空目前計畫",
        },
      },
    ],
    webSuggested: true,
  },
  {
    command: "/metrics",
    usage: "",
    category: "settings",
    description: {
      en: "Show local runtime and reliability metrics",
      zh: "查看本地运行与可靠性指标",
      "zh-TW": "查看本機執行與可靠性指標",
    },
    webSuggested: true,
  },
  {
    command: "/workflow",
    usage: "export <kebab-name> [local|versioned]",
    category: "session",
    description: {
      en: "Compile this session into a reviewable reusable Skill",
      zh: "将当前会话编译为可审阅的复用 Skill",
      "zh-TW": "將目前工作階段編譯為可審閱的重用 Skill",
    },
    suggestions: [
      {
        value: "export ",
        description: {
          en: "Create a local Skill from the current trace",
          zh: "从当前审计记录创建本地 Skill",
          "zh-TW": "從目前稽核記錄建立本機 Skill",
        },
      },
    ],
    webSuggested: true,
  },
  {
    command: "/mcp",
    usage: "[status|refresh] [server]",
    category: "system",
    description: {
      en: "Inspect MCP health or refresh live catalogs",
      zh: "查看 MCP 健康状态或刷新实时目录",
      "zh-TW": "查看 MCP 健康狀態或重新整理即時目錄",
    },
    suggestions: [
      {
        value: "status",
        description: {
          en: "Show server health",
          zh: "显示服务健康状态",
          "zh-TW": "顯示服務健康狀態",
        },
      },
      {
        value: "refresh",
        description: {
          en: "Refresh tools, resources, and prompts",
          zh: "刷新工具、资源与提示词",
          "zh-TW": "重新整理工具、資源與提示詞",
        },
      },
    ],
    webSuggested: false,
  },
  {
    command: "/doctor",
    usage: "",
    category: "settings",
    description: {
      en: "Diagnose runtime, models, web, skills, and safety",
      zh: "诊断运行环境、模型、联网、技能与安全配置",
      "zh-TW": "診斷執行環境、模型、聯網、技能與安全設定",
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
      "zh-TW": "查看或更新 Orbit 設定",
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
      "zh-TW": "查看或切換目前模型",
    },
    webSuggested: true,
  },
  {
    command: "/agent",
    usage: "[profile|default]",
    category: "settings",
    description: {
      en: "Show or switch the active Agent Profile",
      zh: "查看或切换当前 Agent Profile",
      "zh-TW": "查看或切換目前 Agent Profile",
    },
    suggestions: [
      {
        value: "default",
        description: {
          en: "Restore the default Agent configuration",
          zh: "恢复默认 Agent 配置",
          "zh-TW": "恢復預設 Agent 設定",
        },
      },
    ],
    webSuggested: true,
  },
  {
    command: "/language",
    usage: "[en|zh|zh-TW]",
    category: "settings",
    description: {
      en: "Show or switch the interface language",
      zh: "查看或切换界面语言",
      "zh-TW": "查看或切換介面語言",
    },
    suggestions: [
      {
        value: "en",
        description: { en: "Use English", zh: "使用英语", "zh-TW": "使用英文" },
      },
      {
        value: "zh",
        description: {
          en: "Use Simplified Chinese",
          zh: "使用简体中文",
          "zh-TW": "使用簡體中文",
        },
      },
      {
        value: "zh-TW",
        description: {
          en: "Use Traditional Chinese",
          zh: "使用繁体中文",
          "zh-TW": "使用繁體中文",
        },
      },
    ],
    webSuggested: true,
  },
  {
    command: "/skills",
    usage: "",
    category: "settings",
    description: {
      en: "List reusable Skills and their explicit invocation names",
      zh: "列出可复用 Skill 及其显式调用名称",
      "zh-TW": "列出可重用 Skill 及其明確呼叫名稱",
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
      "zh-TW": "列出、新建、刪除或切換聊天",
    },
    suggestions: [
      {
        value: "list",
        description: {
          en: "List saved chats",
          zh: "列出已保存聊天",
          "zh-TW": "列出已儲存聊天",
        },
      },
      {
        value: "new",
        description: {
          en: "Create a new chat",
          zh: "新建聊天",
          "zh-TW": "新建聊天",
        },
      },
      {
        value: "delete ",
        description: {
          en: "Delete a saved chat",
          zh: "删除已保存聊天",
          "zh-TW": "刪除已儲存聊天",
        },
      },
      {
        value: "switch ",
        description: {
          en: "Switch to a saved chat",
          zh: "切换到已保存聊天",
          "zh-TW": "切換到已儲存聊天",
        },
      },
    ],
    webSuggested: true,
  },
  {
    command: "/commit",
    usage: "[message]",
    category: "git",
    description: {
      en: "Stage workspace changes and create a commit",
      zh: "暂存工作区修改并创建提交",
      "zh-TW": "暫存工作區修改並建立提交",
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
      "zh-TW": "使用專項預設執行基於證據的程式碼審查",
    },
    suggestions: [
      {
        value: "comprehensive",
        description: {
          en: "Review all major risk areas",
          zh: "审查所有主要风险领域",
          "zh-TW": "審查所有主要風險領域",
        },
      },
      {
        value: "security",
        description: {
          en: "Focus on security risks",
          zh: "聚焦安全风险",
          "zh-TW": "聚焦安全風險",
        },
      },
      {
        value: "tests",
        description: {
          en: "Focus on test coverage and reliability",
          zh: "聚焦测试覆盖与可靠性",
          "zh-TW": "聚焦測試覆蓋與可靠性",
        },
      },
      {
        value: "performance",
        description: {
          en: "Focus on performance",
          zh: "聚焦性能问题",
          "zh-TW": "聚焦效能問題",
        },
      },
      {
        value: "accessibility",
        description: {
          en: "Focus on accessibility",
          zh: "聚焦可访问性",
          "zh-TW": "聚焦無障礙存取",
        },
      },
      {
        value: "commit ",
        description: {
          en: "Review a commit reference",
          zh: "审查指定提交",
          "zh-TW": "審查指定提交",
        },
      },
      {
        value: "branch ",
        description: {
          en: "Compare against a branch",
          zh: "与指定分支比较",
          "zh-TW": "與指定分支比較",
        },
      },
      {
        value: "custom ",
        description: {
          en: "Use a custom review policy",
          zh: "使用自定义审查策略",
          "zh-TW": "使用自訂審查策略",
        },
      },
    ],
    webSuggested: true,
  },
  {
    command: "/exit",
    usage: "",
    category: "system",
    description: {
      en: "Exit the interactive terminal",
      zh: "退出交互式终端",
      "zh-TW": "退出互動式終端",
    },
    webSuggested: false,
  },
  {
    command: "/quit",
    usage: "",
    category: "system",
    description: {
      en: "Exit the interactive terminal",
      zh: "退出交互式终端",
      "zh-TW": "退出互動式終端",
    },
    webSuggested: false,
  },
  {
    command: "/rollback",
    usage: "",
    category: "session",
    description: {
      en: "Restore the latest file modification checkpoint",
      zh: "恢复最近一次文件修改检查点",
      "zh-TW": "還原最近一次檔案修改檢查點",
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
      "zh-TW": "列出目前聊天持久化的檔案檢查點",
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
      "zh-TW": "將目前聊天回退到指定檔案檢查點",
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
      "zh-TW": "按目前模型上下文視窗壓縮舊對話",
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
      "zh-TW": "重設對話歷史並清空聊天檢視",
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
      "zh-TW": "將檔案或目錄加入作用中上下文",
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
      "zh-TW": "從作用中上下文移除檔案或萬用字元",
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
      "zh-TW": "切換權限模式：strict、normal、auto 或 plan",
    },
    suggestions: [
      {
        value: "strict",
        description: {
          en: "Confirm every tool call",
          zh: "每次工具调用都需确认",
          "zh-TW": "每次工具呼叫都需確認",
        },
      },
      {
        value: "normal",
        description: {
          en: "Confirm write and execution actions",
          zh: "写入和执行操作需确认",
          "zh-TW": "寫入和執行操作需確認",
        },
      },
      {
        value: "auto",
        description: {
          en: "Approve every enabled tool action with the current host account's permissions",
          zh: "以当前系统账户权限自动批准所有已启用工具操作",
          "zh-TW": "以目前系統帳戶權限自動批准所有已啟用工具操作",
        },
      },
      {
        value: "plan",
        description: {
          en: "Plan without changing files",
          zh: "仅规划，不修改文件",
          "zh-TW": "僅規劃，不修改檔案",
        },
      },
    ],
    webSuggested: true,
  },
  {
    command: "/copy",
    usage: "",
    category: "session",
    description: {
      en: "Copy the latest Orbit reply",
      zh: "复制 Orbit 的最新回复",
      "zh-TW": "複製 Orbit 的最新回覆",
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
      "zh-TW": "通過權限檢查後執行本機 Shell 命令",
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
      "zh-TW": "檢查 npm；終端工作階段可安裝並驗證更新",
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
      "zh-TW": "開啟 Orbit 圖形控制台",
    },
    webSuggested: false,
  },
] as const;

/** Slash commands reserved by Orbit and unavailable to custom commands. */
export const BUILTIN_SLASH_COMMANDS = SLASH_COMMAND_DEFINITIONS.map(
  ({ command }) => command,
);

const CATEGORY_LABELS: Record<SlashCommandCategory, SlashCommandLocalizedText> =
  {
    context: {
      en: "Context Management",
      zh: "上下文管理",
      "zh-TW": "上下文管理",
    },
    session: {
      en: "Session & History",
      zh: "会话与历史",
      "zh-TW": "工作階段與歷史",
    },
    settings: {
      en: "Configuration & Status",
      zh: "配置与状态",
      "zh-TW": "設定與狀態",
    },
    git: {
      en: "Git Version Control",
      zh: "Git 提交",
      "zh-TW": "Git 提交",
    },
    system: {
      en: "System Control",
      zh: "系统控制",
      "zh-TW": "系統控制",
    },
  };

/** Selects the closest available translation for slash-command copy. */
export function localizeSlashText(
  text: SlashCommandLocalizedText,
  language: OrbitLanguage,
): string {
  return text[language];
}

/** Builds built-in completion details for terminal and browser clients. */
export function buildBuiltinSlashCommandDetails(
  language: OrbitLanguage,
): SlashCommandDetail[] {
  return SLASH_COMMAND_DEFINITIONS.map((definition) => ({
    command: definition.command,
    description: localizeSlashText(definition.description, language),
    argumentHint: definition.usage || undefined,
    category: definition.category,
    source: "builtin",
  }));
}

/** Builds the localized help screen from the canonical command catalog. */
export function buildSlashCommandHelp(language: OrbitLanguage): string {
  const sections: string[] = [];
  for (const category of Object.keys(
    CATEGORY_LABELS,
  ) as SlashCommandCategory[]) {
    const commands = SLASH_COMMAND_DEFINITIONS.filter(
      (definition) => definition.category === category,
    );
    sections.push(
      picocolors.bold(
        picocolors.yellow(
          `[ ${localizeSlashText(CATEGORY_LABELS[category], language)} ]`,
        ),
      ),
      ...commands.map(({ command, usage, description }) => {
        const invocation = usage ? `${command} ${usage}` : command;
        return `  ${picocolors.green(invocation.padEnd(25))} - ${localizeSlashText(description, language)}`;
      }),
      "",
    );
  }
  sections.push(
    `  ${picocolors.green("!<cmd>")} - ${localizeOrbit(
      language,
      "Run a native shell command (same as /run)",
      "直接运行本地 Shell 命令（等同 /run）",
      "直接執行本機 Shell 命令（等同 /run）",
    )}`,
  );
  return sections.join("\n").trimEnd();
}
