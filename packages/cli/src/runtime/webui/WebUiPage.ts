import { readCliVersion } from "../CliVersion.js";
import { renderOrbitMark } from "./WebUiBrand.js";

export type WebUiLanguage = "en" | "zh" | "zh-TW";

interface WebUiCopy {
  documentTitle: string;
  newTask: string;
  diagnostics: string;
  changes: string;
  tasks: string;
  addContext: string;
  commands: string;
  commandSearch: string;
  commandHint: string;
  noCommands: string;
  navigation: string;
  projects: string;
  recentProjects: string;
  newProject: string;
  projectDialogTitle: string;
  projectDialogBody: string;
  projectPath: string;
  projectPathPlaceholder: string;
  openProject: string;
  createProject: string;
  recentTasks: string;
  searchChats: string;
  showMoreChats: string;
  noMatchingChats: string;
  noRecentTasks: string;
  archivedTasks: string;
  noArchivedTasks: string;
  messages: string;
  deleteChatTitle: string;
  deleteChatBody: string;
  cancel: string;
  delete: string;
  untitledTask: string;
  localOnly: string;
  openNavigation: string;
  collapseNavigation: string;
  connected: string;
  connectionTitle: string;
  connectionBody: string;
  retry: string;
  details: string;
  emptyEyebrow: string;
  emptyTitle: string;
  emptyBody: string;
  suggestionReview: string;
  suggestionReviewBody: string;
  suggestionFix: string;
  suggestionFixBody: string;
  suggestionExplain: string;
  suggestionExplainBody: string;
  suggestionImprove: string;
  suggestionImproveBody: string;
  inputLabel: string;
  inputPlaceholder: string;
  slashCommands: string;
  slashCommandEmpty: string;
  slashCommandHint: string;
  context: string;
  contextPickerTitle: string;
  contextPickerSearch: string;
  contextPickerEmpty: string;
  contextPickerHint: string;
  activeContext: string;
  attachments: string;
  attachImage: string;
  clearContext: string;
  webSearch: string;
  sendHint: string;
  queuedMessages: string;
  clearQueue: string;
  queueMessage: string;
  inspectorTitle: string;
  close: string;
  activity: string;
  taskCenter: string;
  taskCenterDescription: string;
  taskActions: string;
  buildPlan: string;
  buildPlanBody: string;
  parallelImprove: string;
  parallelImproveBody: string;
  settings: string;
  language: string;
  languageDescription: string;
  languageEnglish: string;
  languageSimplified: string;
  languageTraditional: string;
  noChanges: string;
  changedFiles: string;
  toolCalls: string;
  checkpoints: string;
  verification: string;
  restoreFile: string;
  rewind: string;
  exportTrace: string;
  runtime: string;
  projectMemory: string;
  taskPlan: string;
  agentRuns: string;
  noAgents: string;
  abortAgent: string;
  reviewProject: string;
  reviewProjectBody: string;
  reviewComprehensive: string;
  reviewSecurity: string;
  reviewTests: string;
  reviewPerformance: string;
  reviewAccessibility: string;
  noMemory: string;
  noPlan: string;
  noActivity: string;
  clearActivity: string;
  activityAll: string;
  activityRunning: string;
  activityIssues: string;
  filterChanges: string;
  promptCache: string;
  provider: string;
  model: string;
  customModel: string;
  apply: string;
  permission: string;
  modeStrict: string;
  modeNormal: string;
  modeAuto: string;
  modePlan: string;
  searchProvider: string;
  searchResults: string;
  webSearchDescription: string;
  skills: string;
  skillsDescription: string;
  skillAuto: string;
  skillExplicit: string;
  skillMaxActive: string;
  refresh: string;
  noSkills: string;
  capabilities: string;
  capabilitiesDescription: string;
  workflows: string;
  workflowsDescription: string;
  noWorkflows: string;
  addCapability: string;
  addSkill: string;
  addWorkflow: string;
  capabilityName: string;
  capabilityDescription: string;
  capabilityInstructions: string;
  capabilitySkills: string;
  capabilitySkillsHint: string;
  capabilityArgumentHint: string;
  capabilityTemplate: string;
  templateBlank: string;
  templateReview: string;
  templateResearch: string;
  templateMcm: string;
  capabilityPreview: string;
  exportCatalog: string;
  create: string;
  theme: string;
  system: string;
  light: string;
  dark: string;
  scrollEarlier: string;
  scrollLatest: string;
  approvalEyebrow: string;
  approvalDeny: string;
  approvalApprove: string;
}

const BASE_COPY: Record<"en" | "zh", WebUiCopy> = {
  en: {
    documentTitle: "Orbit · AI coding workspace",
    newTask: "New chat",
    diagnostics: "Diagnostics",
    changes: "Changes",
    tasks: "Tasks",
    addContext: "Add context",
    commands: "Commands",
    commandSearch: "Search actions…",
    commandHint: "Navigate with ↑↓ · Enter to run · Esc to close",
    noCommands: "No matching actions",
    navigation: "Tools",
    projects: "Projects",
    recentProjects: "Recent projects",
    newProject: "New project",
    projectDialogTitle: "Open a project",
    projectDialogBody:
      "Use one folder per codebase. Orbit opens it in a separate local tab with its own chats and context.",
    projectPath: "Project folder path",
    projectPathPlaceholder: "C:\\path\\to\\project",
    openProject: "Open folder",
    createProject: "Create & open",
    recentTasks: "Chats",
    searchChats: "Search chats",
    showMoreChats: "Show more",
    noMatchingChats: "No matching chats",
    noRecentTasks: "No chats yet",
    archivedTasks: "Archived chats",
    noArchivedTasks: "No archived chats",
    messages: "Conversation",
    deleteChatTitle: "Delete this chat?",
    deleteChatBody:
      "This permanently removes the conversation and cannot be undone.",
    cancel: "Cancel",
    delete: "Delete",
    untitledTask: "Untitled task",
    localOnly: "Local session",
    openNavigation: "Open navigation",
    collapseNavigation: "Collapse navigation",
    connected: "Connecting",
    connectionTitle: "Orbit is reconnecting",
    connectionBody:
      "Keep the Orbit terminal open. Reconnection is automatic and your draft stays on this device.",
    retry: "Retry now",
    details: "Details",
    emptyEyebrow: "ORBIT · LOCAL SESSION",
    emptyTitle: "What should we work on?",
    emptyBody: "Ask, plan, build, or verify anything in this workspace.",
    suggestionReview: "Review this project",
    suggestionReviewBody: "Find the highest-impact issues and fix them.",
    suggestionFix: "Fix a problem",
    suggestionFixBody: "Diagnose a failing build or unexpected behavior.",
    suggestionExplain: "Explain the code",
    suggestionExplainBody: "Map an unfamiliar flow in plain language.",
    suggestionImprove: "Improve quality",
    suggestionImproveBody: "Optimize performance, safety, and maintainability.",
    inputLabel: "Message Orbit",
    inputPlaceholder: "Ask Orbit to work on this codebase…",
    slashCommands: "Slash commands",
    slashCommandEmpty: "No matching commands",
    slashCommandHint:
      "Terminal-style commands work here · ↑↓ navigate · Enter or Tab to insert",
    context: "Context",
    contextPickerTitle: "Add file context",
    contextPickerSearch: "Search workspace files…",
    contextPickerEmpty: "No matching workspace files",
    contextPickerHint: "Enter to add · ↑↓ to navigate · Esc to close",
    activeContext: "Active context",
    attachments: "Images",
    attachImage: "Attach image",
    clearContext: "Clear all",
    webSearch: "Web",
    sendHint:
      "Enter to send · Shift+Enter for a new line · Type / for commands",
    queuedMessages: "Queued follow-ups",
    clearQueue: "Clear queue",
    queueMessage: "Queue message",
    inspectorTitle: "Task details",
    close: "Close",
    activity: "Activity",
    taskCenter: "Task center",
    taskCenterDescription:
      "Track the current chat, recoverable plan, and delegated agents in one place.",
    taskActions: "Start a task",
    buildPlan: "Build a plan",
    buildPlanBody:
      "Turn the current goal and workspace context into recoverable steps.",
    parallelImprove: "Parallel improve",
    parallelImproveBody:
      "Plan, implement, and review with Git worktree isolation when available.",
    settings: "Settings",
    language: "Language",
    languageDescription: "Used by this project in both WebUI and terminal.",
    languageEnglish: "English",
    languageSimplified: "简体中文",
    languageTraditional: "繁體中文",
    noChanges: "No file changes have been recorded in this chat.",
    changedFiles: "Changed files",
    toolCalls: "Tool calls",
    checkpoints: "Checkpoints",
    verification: "Verification",
    restoreFile: "Restore file",
    rewind: "Rewind here",
    exportTrace: "Export diagnostics",
    runtime: "Runtime",
    projectMemory: "Project memory",
    taskPlan: "Task plan",
    agentRuns: "Agent runs",
    noAgents: "No delegated agents for this workspace.",
    abortAgent: "Abort agent",
    reviewProject: "Review project",
    reviewProjectBody:
      "Launch an evidence-first, read-only review with a focused preset.",
    reviewComprehensive: "Comprehensive",
    reviewSecurity: "Security",
    reviewTests: "Tests",
    reviewPerformance: "Performance",
    reviewAccessibility: "Accessibility",
    noMemory: "No explicit project memory.",
    noPlan: "No plan steps for this chat.",
    noActivity: "Activity will appear here while Orbit works.",
    clearActivity: "Clear",
    activityAll: "All",
    activityRunning: "Running",
    activityIssues: "Issues",
    filterChanges: "Filter changed files",
    promptCache: "Prompt cache",
    provider: "Provider",
    model: "Model",
    customModel: "Custom model ID",
    apply: "Apply",
    permission: "Permission mode",
    modeStrict: "Strict",
    modeNormal: "Normal",
    modeAuto: "Auto",
    modePlan: "Plan",
    searchProvider: "Search provider",
    searchResults: "Maximum results",
    webSearchDescription: "Use configured search tools when needed.",
    skills: "Skills",
    skillsDescription:
      "Discover reusable project expertise and control when it enters context.",
    skillAuto: "Automatic",
    skillExplicit: "Explicit only",
    skillMaxActive: "Maximum active",
    refresh: "Refresh",
    noSkills: "No valid skills found in configured directories.",
    capabilities: "Capabilities",
    capabilitiesDescription:
      "Create reusable Skills or one-click Workflows for this project.",
    workflows: "Workflows",
    workflowsDescription:
      "One-click prompt entry points that can compose several Skills.",
    noWorkflows: "No project workflows yet.",
    addCapability: "Add",
    addSkill: "Skill",
    addWorkflow: "Workflow",
    capabilityName: "Name",
    capabilityDescription: "When should Orbit use it?",
    capabilityInstructions: "What should Orbit do?",
    capabilitySkills: "Compose Skills",
    capabilitySkillsHint: "Optional, comma-separated Skill names",
    capabilityArgumentHint: "Expected inputs",
    capabilityTemplate: "Start from a template",
    templateBlank: "Blank",
    templateReview: "Code review",
    templateResearch: "Research brief",
    templateMcm: "Modeling paper",
    capabilityPreview: "Invocation preview",
    exportCatalog: "Export catalog",
    create: "Create",
    theme: "Appearance",
    system: "System",
    light: "Light",
    dark: "Dark",
    scrollEarlier: "Jump to earlier messages",
    scrollLatest: "Scroll to latest message",
    approvalEyebrow: "PERMISSION REQUIRED",
    approvalDeny: "Deny",
    approvalApprove: "Approve",
  },
  zh: {
    documentTitle: "Orbit · AI 编程工作区",
    newTask: "新建对话",
    diagnostics: "运行诊断",
    changes: "改动审阅",
    tasks: "任务中心",
    addContext: "添加上下文",
    commands: "命令帮助",
    commandSearch: "搜索操作…",
    commandHint: "↑↓ 选择 · Enter 执行 · Esc 关闭",
    noCommands: "没有匹配的操作",
    navigation: "工具",
    projects: "项目",
    recentProjects: "最近项目",
    newProject: "新建项目",
    projectDialogTitle: "打开项目",
    projectDialogBody:
      "一个代码工程对应一个文件夹。Orbit 会在新的本地标签页打开，并保留独立的聊天和上下文。",
    projectPath: "项目文件夹路径",
    projectPathPlaceholder: "C:\\路径\\项目名称",
    openProject: "打开文件夹",
    createProject: "创建并打开",
    recentTasks: "对话",
    searchChats: "搜索对话",
    showMoreChats: "显示更多",
    noMatchingChats: "没有匹配的对话",
    noRecentTasks: "还没有对话",
    archivedTasks: "已归档对话",
    noArchivedTasks: "没有已归档对话",
    messages: "对话",
    deleteChatTitle: "删除这个对话？",
    deleteChatBody: "此操作会永久删除该对话，并且无法撤销。",
    cancel: "取消",
    delete: "删除",
    untitledTask: "未命名任务",
    localOnly: "本地会话",
    openNavigation: "打开导航",
    collapseNavigation: "收起导航",
    connected: "正在连接",
    connectionTitle: "正在重新连接 Orbit",
    connectionBody:
      "请保持 Orbit 终端运行；页面会自动重连，草稿会继续保存在本机。",
    retry: "立即重试",
    details: "任务详情",
    emptyEyebrow: "ORBIT · 本地会话",
    emptyTitle: "接下来想做什么？",
    emptyBody: "让 Orbit 在当前工作区中分析、规划、实现或验证任务。",
    suggestionReview: "全面审查项目",
    suggestionReviewBody: "找出影响最大的问题并直接修复。",
    suggestionFix: "修复一个问题",
    suggestionFixBody: "诊断构建失败或异常行为。",
    suggestionExplain: "解释代码逻辑",
    suggestionExplainBody: "用清晰语言梳理陌生的代码流程。",
    suggestionImprove: "提升工程质量",
    suggestionImproveBody: "优化性能、安全性与可维护性。",
    inputLabel: "给 Orbit 发送消息",
    inputPlaceholder: "让 Orbit 在这个代码库中完成任务…",
    slashCommands: "斜杠命令",
    slashCommandEmpty: "没有匹配的命令",
    slashCommandHint: "终端斜杠命令可直接使用 · ↑↓ 选择 · Enter 或 Tab 插入",
    context: "上下文",
    contextPickerTitle: "添加文件上下文",
    contextPickerSearch: "搜索工作区文件…",
    contextPickerEmpty: "没有匹配的工作区文件",
    contextPickerHint: "Enter 添加 · ↑↓ 选择 · Esc 关闭",
    activeContext: "活动上下文",
    attachments: "图片",
    attachImage: "添加图片",
    clearContext: "全部清空",
    webSearch: "联网",
    sendHint: "Enter 发送 · Shift+Enter 换行 · 输入 / 查看命令",
    queuedMessages: "待发送消息",
    clearQueue: "清空队列",
    queueMessage: "加入队列",
    inspectorTitle: "任务详情",
    close: "关闭",
    activity: "活动",
    taskCenter: "任务中心",
    taskCenterDescription:
      "集中查看当前对话、可恢复计划与委派智能体的执行状态。",
    taskActions: "启动任务",
    buildPlan: "制定计划",
    buildPlanBody: "把当前目标与工作区上下文整理成可恢复的执行步骤。",
    parallelImprove: "并行改进",
    parallelImproveBody:
      "完成规划、实现与审查，并在可用时通过 Git 工作树隔离改动。",
    settings: "设置",
    language: "语言",
    languageDescription: "当前工程的 WebUI 与终端将使用同一语言。",
    languageEnglish: "English",
    languageSimplified: "简体中文",
    languageTraditional: "繁體中文",
    noChanges: "当前对话还没有记录文件改动。",
    changedFiles: "文件改动",
    toolCalls: "工具调用",
    checkpoints: "检查点",
    verification: "验证结果",
    restoreFile: "恢复文件",
    rewind: "回退到这里",
    exportTrace: "导出诊断包",
    runtime: "运行状态",
    projectMemory: "项目记忆",
    taskPlan: "任务计划",
    agentRuns: "智能体运行",
    noAgents: "当前工作区还没有委派智能体。",
    abortAgent: "终止智能体",
    reviewProject: "项目审查",
    reviewProjectBody: "选择重点，启动基于证据的只读审查。",
    reviewComprehensive: "全面",
    reviewSecurity: "安全",
    reviewTests: "测试",
    reviewPerformance: "性能",
    reviewAccessibility: "无障碍",
    noMemory: "暂无显式项目记忆。",
    noPlan: "当前对话暂无计划步骤。",
    noActivity: "Orbit 工作时，步骤和工具状态会显示在这里。",
    clearActivity: "清空",
    activityAll: "全部",
    activityRunning: "进行中",
    activityIssues: "异常",
    filterChanges: "筛选改动文件",
    promptCache: "提示词缓存",
    provider: "服务商",
    model: "模型",
    customModel: "自定义模型 ID",
    apply: "应用",
    permission: "权限模式",
    modeStrict: "严格",
    modeNormal: "标准",
    modeAuto: "自动",
    modePlan: "规划",
    searchProvider: "搜索服务",
    searchResults: "最大结果数",
    webSearchDescription: "需要时使用已配置的搜索工具。",
    skills: "Skills 技能",
    skillsDescription: "发现可复用的项目能力，并控制它们何时进入上下文。",
    skillAuto: "自动匹配",
    skillExplicit: "仅显式调用",
    skillMaxActive: "最大激活数",
    refresh: "刷新",
    noSkills: "配置目录中尚未发现有效 Skill。",
    capabilities: "能力",
    capabilitiesDescription: "为当前工程创建可复用 Skill 或一键工作流。",
    workflows: "工作流",
    workflowsDescription: "可一键启动，并能组合多个 Skill 的提示词入口。",
    noWorkflows: "当前工程还没有工作流。",
    addCapability: "添加",
    addSkill: "Skill",
    addWorkflow: "工作流",
    capabilityName: "名称",
    capabilityDescription: "Orbit 应在什么情况下使用它？",
    capabilityInstructions: "Orbit 应该执行什么？",
    capabilitySkills: "组合 Skills",
    capabilitySkillsHint: "可选，用英文逗号分隔 Skill 名称",
    capabilityArgumentHint: "预期输入",
    capabilityTemplate: "从模板开始",
    templateBlank: "空白",
    templateReview: "代码审查",
    templateResearch: "研究简报",
    templateMcm: "数模论文",
    capabilityPreview: "调用预览",
    exportCatalog: "导出清单",
    create: "创建",
    theme: "外观",
    system: "跟随系统",
    light: "浅色",
    dark: "深色",
    scrollEarlier: "查看较早消息",
    scrollLatest: "滚动到最新消息",
    approvalEyebrow: "需要你的确认",
    approvalDeny: "拒绝",
    approvalApprove: "允许",
  },
};

const COPY: Record<WebUiLanguage, WebUiCopy> = {
  ...BASE_COPY,
  "zh-TW": {
    ...BASE_COPY.zh,
    documentTitle: "Orbit · AI 程式設計工作區",
    newTask: "新增對話",
    diagnostics: "執行診斷",
    changes: "變更檢視",
    tasks: "任務中心",
    addContext: "加入上下文",
    commands: "命令",
    commandSearch: "搜尋操作…",
    commandHint: "↑↓ 選擇 · Enter 執行 · Esc 關閉",
    noCommands: "沒有相符的操作",
    navigation: "工具",
    projects: "專案",
    recentProjects: "最近專案",
    newProject: "新增專案",
    projectDialogTitle: "開啟專案",
    projectDialogBody:
      "一個程式碼專案對應一個資料夾。Orbit 會在新的本機分頁開啟，並保留獨立的聊天和上下文。",
    projectPath: "專案資料夾路徑",
    openProject: "開啟資料夾",
    createProject: "建立並開啟",
    recentTasks: "對話",
    searchChats: "搜尋對話",
    showMoreChats: "顯示更多",
    noMatchingChats: "沒有相符的對話",
    noRecentTasks: "尚未有對話",
    archivedTasks: "已封存對話",
    noArchivedTasks: "沒有已封存對話",
    messages: "對話",
    deleteChatTitle: "刪除這個對話？",
    deleteChatBody: "此操作會永久刪除該對話，且無法復原。",
    untitledTask: "未命名任務",
    localOnly: "本機工作階段",
    openNavigation: "開啟導覽",
    collapseNavigation: "收合導覽",
    connected: "正在連線",
    details: "任務詳情",
    emptyEyebrow: "ORBIT · 本機工作階段",
    emptyTitle: "接下來想做什麼？",
    emptyBody: "讓 Orbit 在目前工作區中分析、規劃、實作或驗證任務。",
    suggestionReview: "全面檢視專案",
    suggestionReviewBody: "找出影響最大的問題並直接修正。",
    suggestionFix: "修正一個問題",
    suggestionFixBody: "診斷建置失敗或異常行為。",
    suggestionExplain: "解釋程式碼邏輯",
    suggestionExplainBody: "用清楚的語言梳理陌生的程式碼流程。",
    suggestionImprove: "提升工程品質",
    suggestionImproveBody: "最佳化效能、安全性與可維護性。",
    inputLabel: "傳送訊息給 Orbit",
    inputPlaceholder: "讓 Orbit 在這個程式碼庫中完成任務…",
    slashCommands: "斜線命令",
    slashCommandEmpty: "沒有符合的命令",
    slashCommandHint: "終端斜線命令可直接使用 · ↑↓ 選擇 · Enter 或 Tab 插入",
    contextPickerSearch: "搜尋工作區檔案…",
    activeContext: "作用中上下文",
    attachments: "圖片",
    attachImage: "加入圖片",
    clearContext: "全部清除",
    webSearch: "聯網",
    sendHint: "Enter 傳送 · Shift+Enter 換行 · 輸入 / 查看命令",
    queuedMessages: "待傳送訊息",
    clearQueue: "清除佇列",
    queueMessage: "加入佇列",
    inspectorTitle: "任務詳情",
    close: "關閉",
    activity: "活動",
    taskCenter: "任務中心",
    taskCenterDescription:
      "集中查看目前對話、可復原計畫與委派智慧體的執行狀態。",
    taskActions: "啟動任務",
    buildPlan: "制定計畫",
    buildPlanBody: "把目前目標與工作區脈絡整理成可恢復的執行步驟。",
    parallelImprove: "平行改進",
    parallelImproveBody:
      "完成規劃、實作與審查，並在可用時透過 Git 工作樹隔離變更。",
    settings: "設定",
    changedFiles: "檔案變更",
    toolCalls: "工具呼叫",
    verification: "驗證結果",
    restoreFile: "復原檔案",
    rewind: "回到這裡",
    exportTrace: "匯出診斷包",
    runtime: "執行狀態",
    projectMemory: "專案記憶",
    taskPlan: "任務計畫",
    noActivity: "Orbit 工作時，步驟和工具狀態會顯示在這裡。",
    clearActivity: "清除",
    activityAll: "全部",
    activityRunning: "進行中",
    activityIssues: "異常",
    filterChanges: "篩選變更檔案",
    provider: "服務供應商",
    customModel: "自訂模型 ID",
    apply: "套用",
    permission: "權限模式",
    modeStrict: "嚴格",
    modeNormal: "標準",
    modeAuto: "自動",
    modePlan: "規劃",
    searchProvider: "搜尋服務",
    searchResults: "最大結果數",
    webSearchDescription: "需要時使用已設定的搜尋工具。",
    skillsDescription: "探索可重用的專案能力，並控制它們何時進入上下文。",
    skillAuto: "自動配對",
    skillExplicit: "僅明確呼叫",
    skillMaxActive: "最大啟用數",
    refresh: "重新整理",
    noSkills: "設定目錄中尚未找到有效 Skill。",
    capabilities: "能力",
    capabilitiesDescription: "為目前專案建立可重用 Skill 或一鍵工作流程。",
    workflows: "工作流程",
    workflowsDescription: "可一鍵啟動，並能組合多個 Skill 的提示詞入口。",
    noWorkflows: "目前專案尚無工作流程。",
    addCapability: "新增",
    addSkill: "Skill",
    addWorkflow: "工作流程",
    capabilityName: "名稱",
    capabilityDescription: "Orbit 應在什麼情況下使用它？",
    capabilityInstructions: "Orbit 應該執行什麼？",
    capabilitySkills: "組合 Skills",
    capabilitySkillsHint: "選填，以英文逗號分隔 Skill 名稱",
    capabilityArgumentHint: "預期輸入",
    capabilityTemplate: "從範本開始",
    templateBlank: "空白",
    templateReview: "程式碼審查",
    templateResearch: "研究簡報",
    templateMcm: "數模論文",
    capabilityPreview: "呼叫預覽",
    exportCatalog: "匯出清單",
    create: "建立",
    theme: "外觀",
    system: "跟隨系統",
    light: "淺色",
    dark: "深色",
    scrollEarlier: "查看較早訊息",
    scrollLatest: "捲動到最新訊息",
    language: "語言",
    languageDescription: "目前專案的 WebUI 與終端會使用相同語言。",
    approvalEyebrow: "需要你的確認",
    approvalDeny: "拒絕",
    approvalApprove: "允許",
  },
};

type UiIcon =
  | "add"
  | "tasks"
  | "diagnostics"
  | "changes"
  | "context"
  | "image"
  | "commands"
  | "menu"
  | "panel"
  | "close"
  | "up"
  | "down"
  | "archive"
  | "search"
  | "folder"
  | "review"
  | "fix"
  | "explain"
  | "improve";

function renderUiIcon(name: UiIcon): string {
  const paths: Record<UiIcon, string> = {
    add: '<path d="M12 5v14M5 12h14" />',
    tasks:
      '<rect x="5" y="4.5" width="14" height="15" rx="2" /><path d="m8 9 1.5 1.5L12 8M13.5 10h2.5M8 14h8M8 17h5" />',
    diagnostics:
      '<path d="M4.5 12h3l1.7-4 3.1 8 1.7-4h5.5" /><path d="M6 5.5h12v13H6z" />',
    changes:
      '<path d="M5 7h14M5 12h14M5 17h14" /><path d="M8 5v4M15 10v4M11 15v4" />',
    context:
      '<path d="M7 4.5h7l3 3v12H7z" /><path d="M14 4.5v3h3M9.5 12h5M12 9.5v5" />',
    image:
      '<rect x="4.5" y="5" width="15" height="14" rx="2" /><circle cx="9" cy="9.5" r="1.5" /><path d="m6.5 17 4-4 2.5 2 2.5-3 2.5 5" />',
    commands:
      '<rect x="4.5" y="5.5" width="15" height="13" rx="2" /><path d="m8 10 2 2-2 2M12.5 14h3.5" />',
    menu: '<path d="M5 7h14M5 12h14M5 17h14" />',
    panel:
      '<rect x="4.5" y="5" width="15" height="14" rx="2" /><path d="M14 5v14" />',
    close: '<path d="m7 7 10 10M17 7 7 17" />',
    up: '<path d="m7 14 5-5 5 5" />',
    down: '<path d="m7 10 5 5 5-5" />',
    archive: '<path d="M5.5 8.5h13v10h-13zM4.5 5h15v3.5h-15zM9.5 12h5" />',
    search:
      '<circle cx="10.5" cy="10.5" r="5.5" /><path d="m14.7 14.7 4.3 4.3" />',
    folder: '<path d="M4.5 7h5.3l2-2h7.7v14h-15z" /><path d="M4.5 9h15" />',
    review:
      '<circle cx="10.5" cy="10.5" r="5.5" /><path d="m14.7 14.7 4.3 4.3M10.5 8v5M8 10.5h5" />',
    fix: '<path d="M14.5 5.5a4 4 0 0 0-4.8 5.2L5 15.4 8.6 19l4.7-4.7a4 4 0 0 0 5.2-4.8l-2.7 2.7-3-3z" />',
    explain: '<path d="m9 7-5 5 5 5M15 7l5 5-5 5M13 5l-2 14" />',
    improve:
      '<path d="M12 4l1.2 4.1L17 10l-3.8 1.9L12 16l-1.2-4.1L7 10l3.8-1.9zM18 16v4M16 18h4M5 4v3M3.5 5.5h3" />',
  };
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}

function renderComposer(copy: WebUiCopy): string {
  return `<div class="composer-dock" id="composerDock">
    <div class="turn-status" id="turnStatus" role="status" aria-live="polite"></div>
    <section class="approval-panel" id="approvalPanel" aria-live="assertive" aria-labelledby="approvalTitle" hidden>
      <div class="approval-panel-head">
        <span class="approval-mark" aria-hidden="true">!</span>
        <div>
          <span class="approval-eyebrow">${copy.approvalEyebrow}</span>
          <strong id="approvalTitle"></strong>
        </div>
      </div>
      <p class="approval-reason" id="approvalReason"></p>
      <pre class="approval-preview" id="approvalPreview" tabindex="0" hidden></pre>
      <div class="approval-actions">
        <button class="approval-button is-deny" id="denyApprovalButton" type="button">${copy.approvalDeny}</button>
        <button class="approval-button is-approve" id="approveApprovalButton" type="button">${copy.approvalApprove}</button>
      </div>
    </section>
    <form class="composer" id="composer">
      <label class="sr-only" for="prompt">${copy.inputLabel}</label>
      <textarea id="prompt" data-testid="composer-input" rows="1" maxlength="100000" autocomplete="off" autofocus placeholder="${copy.inputPlaceholder}" aria-autocomplete="list" aria-controls="slashCommandResults" aria-expanded="false"></textarea>
      <section class="slash-command-menu" id="slashCommandMenu" aria-label="${copy.slashCommands}" aria-hidden="true" hidden>
        <div class="slash-command-heading"><strong>${copy.slashCommands}</strong><span>/</span></div>
        <div class="slash-command-results" id="slashCommandResults" role="listbox"></div>
        <p class="slash-command-empty" id="slashCommandEmpty" role="status" hidden>${copy.slashCommandEmpty}</p>
        <p class="slash-command-hint">${copy.slashCommandHint}</p>
      </section>
      <section class="context-shelf" id="contextShelf" aria-label="${copy.activeContext}" hidden>
        <div class="context-shelf-header">
          <span>${renderUiIcon("context")}<strong>${copy.activeContext}</strong></span>
          <button id="clearContextButton" type="button">${copy.clearContext}</button>
        </div>
        <div class="context-file-list" id="contextFileList"></div>
      </section>
      <section class="attachment-shelf" id="attachmentShelf" aria-label="${copy.attachments}" hidden>
        <div class="attachment-list" id="attachmentList"></div>
      </section>
      <section class="prompt-queue" id="promptQueue" aria-label="${copy.queuedMessages}" hidden>
        <div class="prompt-queue-header"><strong>${copy.queuedMessages}</strong><button id="clearQueueButton" type="button">${copy.clearQueue}</button></div>
        <div class="prompt-queue-list" id="promptQueueList"></div>
      </section>
      <div class="composer-toolbar">
        <div class="composer-tools">
          <button class="composer-chip" id="contextPickerButton" type="button" data-open-context aria-label="${copy.context}" aria-haspopup="dialog" aria-controls="contextPicker" aria-expanded="false">${renderUiIcon("context")}<span>${copy.context}</span><span class="context-chip-count" id="contextChipCount" aria-label="0" hidden>0</span></button>
          <button class="composer-chip" id="attachmentButton" type="button" aria-label="${copy.attachImage}">${renderUiIcon("image")}<span>${copy.attachments}</span><span class="context-chip-count" id="attachmentCount" aria-label="0" hidden>0</span></button>
          <input id="attachmentInput" data-testid="attachment-input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden />
          <button class="composer-chip" id="searchToggle" type="button" aria-pressed="false"><span class="web-status-dot" aria-hidden="true"></span><span>${copy.webSearch}</span></button>
          <div class="select-control composer-select-control" data-select-control>
            <select class="native-select-proxy" id="permissionSelect" aria-label="${copy.permission}" tabindex="-1" aria-hidden="true" hidden>
              <option value="strict">${copy.modeStrict}</option>
              <option value="normal">${copy.modeNormal}</option>
              <option value="auto">${copy.modeAuto}</option>
              <option value="plan">${copy.modePlan}</option>
            </select>
            <button class="select-trigger composer-select-trigger" id="permissionSelectTrigger" type="button" aria-label="${copy.permission}" aria-haspopup="listbox" aria-controls="permissionSelectMenu" aria-expanded="false">
              <span class="select-value">${copy.modeNormal}</span>${renderUiIcon("down")}
            </button>
            <div class="select-menu" id="permissionSelectMenu" role="listbox" aria-label="${copy.permission}" hidden></div>
          </div>
        </div>
        <div class="composer-actions">
          <button class="queue-button" id="queueButton" type="button" aria-label="${copy.queueMessage}" title="${copy.queueMessage}" hidden>+</button>
          <button class="send-button" id="sendButton" data-testid="composer-send" type="submit" aria-label="${copy.inputLabel}"><span id="sendGlyph" aria-hidden="true">↑</span></button>
        </div>
      </div>
      <section class="context-picker" id="contextPicker" role="dialog" aria-label="${copy.contextPickerTitle}" aria-hidden="true" hidden>
        <div class="context-picker-header">
          <span class="context-picker-icon" aria-hidden="true">${renderUiIcon("context")}</span>
          <strong>${copy.contextPickerTitle}</strong>
          <button class="context-picker-close" id="contextPickerClose" type="button" aria-label="${copy.close}">${renderUiIcon("close")}</button>
        </div>
        <label class="sr-only" for="contextSearch">${copy.contextPickerSearch}</label>
        <div class="context-picker-search">
          <span aria-hidden="true">⌕</span>
          <input id="contextSearch" type="search" maxlength="200" autocomplete="off" placeholder="${copy.contextPickerSearch}" aria-controls="contextResults" aria-autocomplete="list" />
          <kbd>Esc</kbd>
        </div>
        <div class="context-results" id="contextResults" role="listbox"></div>
        <p class="context-empty" id="contextEmpty" role="status">${copy.contextPickerEmpty}</p>
        <p class="context-picker-hint">${copy.contextPickerHint}</p>
      </section>
    </form>
    <p class="composer-hint">${copy.sendHint}</p>
  </div>`;
}

/** Renders the self-contained Orbit application shell. */
export function renderWebUiPage(language: WebUiLanguage): string {
  const copy = COPY[language];
  const version = readCliVersion();
  const suggestions: Array<[UiIcon, string, string]> = [
    ["review", copy.suggestionReview, copy.suggestionReviewBody],
    ["fix", copy.suggestionFix, copy.suggestionFixBody],
    ["explain", copy.suggestionExplain, copy.suggestionExplainBody],
    ["improve", copy.suggestionImprove, copy.suggestionImproveBody],
  ];

  return `<!doctype html>
<html lang="${language === "zh" ? "zh-CN" : language}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#edf1f0" />
  <title>${copy.documentTitle}</title>
  <link rel="icon" type="image/svg+xml" href="/assets/orbit-mark.svg" />
  <link rel="stylesheet" href="/assets/orbit.css" />
  <script src="/assets/orbit.js" defer></script>
</head>
<body>
  <template id="orbitAvatarTemplate">${renderOrbitMark("message-mark")}</template>
  <div class="app-shell" id="appShell" data-testid="orbit-app">
    <button class="sidebar-backdrop" id="sidebarBackdrop" type="button" aria-label="${copy.close}" tabindex="-1"></button>
    <aside class="sidebar" id="sidebar" aria-label="Orbit">
      <div class="brand-row">
        ${renderOrbitMark("brand-mark")}
        <span class="brand-name">Orbit</span>
        <span class="brand-version">${version}</span>
        <button class="sidebar-collapse-button" id="sidebarCollapseButton" type="button" aria-label="${copy.collapseNavigation}" aria-controls="sidebar" aria-expanded="true">${renderUiIcon("panel")}</button>
      </div>

      <button class="new-task-button" id="newTaskButton" data-testid="new-chat" type="button">
        <span class="new-task-icon">${renderUiIcon("add")}</span>
        <span>${copy.newTask}</span>
        <kbd>Ctrl N</kbd>
      </button>

      <div class="nav-section-heading"><span>${copy.navigation}</span><i></i></div>
      <nav class="primary-nav" aria-label="${copy.navigation}">
        <button class="nav-button" id="tasksButton" data-testid="tasks" type="button">
          ${renderUiIcon("tasks")}
          <span>${copy.tasks}</span>
        </button>
        <button class="nav-button" id="changesButton" data-testid="changes" type="button">
          ${renderUiIcon("changes")}
          <span>${copy.changes}</span>
        </button>
        <button class="nav-button" type="button" data-command="/doctor">
          ${renderUiIcon("diagnostics")}
          <span>${copy.diagnostics}</span>
        </button>
        <button class="nav-button" type="button" data-open-context>
          ${renderUiIcon("context")}
          <span>${copy.addContext}</span>
        </button>
        <button class="nav-button" id="commandsButton" type="button">
          ${renderUiIcon("commands")}
          <span>${copy.commands}</span>
        </button>
      </nav>

      <div class="nav-section-heading project-heading">
        <span>${copy.projects}</span><i></i>
        <button class="new-project-button" id="newProjectButton" type="button" aria-label="${copy.newProject}" aria-haspopup="dialog" aria-controls="projectDialog">${renderUiIcon("add")}</button>
      </div>
      <section class="project-section" id="projectSection" data-testid="active-project" aria-label="${copy.projects}">
        <button class="project-toggle" id="projectToggle" type="button" aria-expanded="true" aria-controls="projectChatBody">
          <span class="project-folder-icon">${renderUiIcon("folder")}</span>
          <span class="project-copy">
            <strong id="sidebarWorkspace">—</strong>
            <small id="sidebarSession">${copy.localOnly}</small>
          </span>
          <span class="project-chat-count" id="projectChatCount" aria-label="0">0</span>
          <span class="project-toggle-chevron">${renderUiIcon("down")}</span>
        </button>
        <div class="project-chat-body" id="projectChatBody">
          <section class="recent-section" id="recentSection" aria-labelledby="recentHeading">
            <div class="nav-section-heading session-section-heading" id="recentHeading">
              <span>${copy.recentTasks}</span><i></i>
              <button class="archive-toggle" id="archiveToggle" type="button" aria-label="${copy.archivedTasks}" aria-controls="archivedPanel" aria-expanded="false">
                ${renderUiIcon("archive")}<b id="archiveCount">0</b>
              </button>
            </div>
            <label class="session-search" id="sessionSearchField" hidden>
              <span class="sr-only">${copy.searchChats}</span>
              ${renderUiIcon("search")}
              <input id="sessionSearch" type="search" maxlength="160" autocomplete="off" spellcheck="false" placeholder="${copy.searchChats}" />
            </label>
            <div class="recent-sessions" id="recentSessions" data-testid="chat-list" aria-label="${copy.recentTasks}"></div>
            <p class="session-list-empty" id="recentEmpty">${copy.noRecentTasks}</p>
            <button class="session-show-more" id="sessionShowMore" type="button" hidden>${copy.showMoreChats}</button>
            <section class="archived-panel" id="archivedPanel" aria-label="${copy.archivedTasks}" hidden>
              <div class="archived-panel-title">${copy.archivedTasks}</div>
              <div class="archived-sessions" id="archivedSessions"></div>
              <p class="session-list-empty" id="archivedEmpty">${copy.noArchivedTasks}</p>
            </section>
          </section>
        </div>
      </section>

      <section class="recent-projects-shell" id="recentProjectsShell" aria-label="${copy.recentProjects}" hidden>
        <div class="project-list-label">${copy.recentProjects}</div>
        <div class="project-list" id="projectList"></div>
      </section>

      <div class="sidebar-spacer"></div>
    </aside>

    <section class="workspace-view">
      <header class="topbar">
        <div class="topbar-start">
          <button class="icon-button mobile-menu" id="menuButton" type="button" aria-label="${copy.openNavigation}" aria-controls="sidebar" aria-expanded="false">${renderUiIcon("menu")}</button>
          <div class="workspace-heading">
            <strong id="workspaceName">Orbit</strong>
            <span id="workspacePath">${copy.localOnly}</span>
          </div>
        </div>
        <div class="topbar-actions">
          <button class="context-meter" id="contextMeter" type="button" aria-label="${copy.context}" aria-controls="inspector">
            <span class="context-ring" aria-hidden="true"><i></i></span>
            <span class="context-meter-copy"><small>${copy.context}</small><strong id="contextPercent">0%</strong></span>
          </button>
          <button class="command-trigger" id="commandTrigger" type="button" aria-label="${copy.commands}" aria-haspopup="dialog" aria-controls="commandPalette">
            ${renderUiIcon("commands")}
            <span>${copy.commands}</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div class="select-control provider-control" data-select-control title="${copy.provider}">
            <select class="native-select-proxy" id="providerSelect" aria-label="${copy.provider}" tabindex="-1" aria-hidden="true" hidden></select>
            <button class="select-trigger provider-select-trigger" id="providerSelectTrigger" type="button" aria-label="${copy.provider}" aria-haspopup="listbox" aria-controls="providerSelectMenu" aria-expanded="false">
              <span class="select-value">—</span>${renderUiIcon("down")}
            </button>
            <div class="select-menu provider-select-menu" id="providerSelectMenu" role="listbox" aria-label="${copy.provider}" hidden></div>
          </div>
          <div class="select-control model-control" data-select-control title="${copy.model}">
            <select class="native-select-proxy" id="modelSelect" aria-label="${copy.model}" tabindex="-1" aria-hidden="true" hidden></select>
            <button class="select-trigger model-select-trigger" id="modelSelectTrigger" type="button" aria-label="${copy.model}" aria-haspopup="listbox" aria-controls="modelSelectMenu" aria-expanded="false">
              <span class="select-value">—</span>${renderUiIcon("down")}
            </button>
            <div class="select-menu model-select-menu" id="modelSelectMenu" role="listbox" aria-label="${copy.model}" hidden></div>
          </div>
          <button class="connection-state" id="connectionState" type="button" aria-label="${copy.connected}. ${copy.retry}" title="${copy.retry}">
            <span class="connection-dot"></span>
            <span id="connectionLabel" role="status" aria-live="polite">${copy.connected}</span>
          </button>
          <button class="details-button" id="inspectorButton" type="button" aria-label="${copy.details}" aria-controls="inspector" aria-expanded="false">
            ${renderUiIcon("panel")}
            <span>${copy.details}</span>
          </button>
        </div>
      </header>

      <div class="connection-help" id="connectionHelp" role="alert">
        <span class="connection-help-icon">!</span>
        <span><strong>${copy.connectionTitle}</strong><small>${copy.connectionBody}</small></span>
        <button type="button" id="retryConnection">${copy.retry}</button>
      </div>

      <main class="conversation" id="conversation">
        <div class="message-scroll" id="messageScroll">
          <div class="message-column" id="messages" role="log" aria-live="off" aria-relevant="additions" aria-label="${copy.messages}"></div>
          <section class="empty-state" id="emptyState">
            <p class="eyebrow">${renderOrbitMark("eyebrow-mark")}<span>${copy.emptyEyebrow}</span></p>
            <h1>${copy.emptyTitle}</h1>
            <p class="empty-description">${copy.emptyBody}</p>
            <div class="empty-composer-slot" id="emptyComposerSlot">
              ${renderComposer(copy)}
            </div>
            <div class="suggestion-grid">
              ${suggestions
                .map(
                  (
                    [icon, title, body],
                    index,
                  ) => `<button class="suggestion-card" type="button" data-suggestion="${index}" title="${body}">
                    <span class="suggestion-icon" aria-hidden="true">${renderUiIcon(icon)}</span>
                    <span class="suggestion-copy"><strong>${title}</strong><small>${body}</small></span>
                  </button>`,
                )
                .join("")}
            </div>
          </section>
        </div>

        <button class="jump-earlier" id="jumpEarlier" type="button" aria-label="${copy.scrollEarlier}">
          ${renderUiIcon("up")}<span>${copy.scrollEarlier}</span>
        </button>
        <button class="jump-bottom" id="jumpBottom" type="button" aria-label="${copy.scrollLatest}">${renderUiIcon("down")}</button>
        <div class="composer-anchor" id="composerAnchor"></div>
      </main>
    </section>

    <button class="inspector-backdrop" id="inspectorBackdrop" type="button" aria-label="${copy.close}" tabindex="-1" hidden></button>
    <aside class="inspector" id="inspector" role="dialog" aria-modal="true" aria-label="${copy.inspectorTitle}" aria-hidden="true" tabindex="-1" inert>
      <div class="inspector-header">
        <div>
          <span class="inspector-kicker">ORBIT</span>
          <h2>${copy.inspectorTitle}</h2>
        </div>
        <button class="icon-button" id="inspectorClose" type="button" aria-label="${copy.close}">${renderUiIcon("close")}</button>
      </div>
      <div class="inspector-tabs" role="tablist">
        <button class="inspector-tab is-active" id="tasksTab" type="button" role="tab" aria-selected="true" aria-controls="tasksPanel">${copy.tasks}</button>
        <button class="inspector-tab" id="activityTab" type="button" role="tab" aria-selected="false" aria-controls="activityPanel" tabindex="-1">${copy.activity}</button>
        <button class="inspector-tab" id="changesTab" type="button" role="tab" aria-selected="false" aria-controls="changesPanel" tabindex="-1">${copy.changes}</button>
        <button class="inspector-tab" id="settingsTab" type="button" role="tab" aria-selected="false" aria-controls="settingsPanel" tabindex="-1">${copy.settings}</button>
      </div>

      <div class="inspector-content">
        <section class="tab-panel" id="tasksPanel" role="tabpanel" aria-labelledby="tasksTab">
          <header class="task-center-heading">
            <span class="inspector-kicker">MISSION CONTROL</span>
            <h3>${copy.taskCenter}</h3>
            <p>${copy.taskCenterDescription}</p>
          </header>
          <section class="task-overview" id="taskOverview" aria-live="polite"></section>
          <section class="task-actions" aria-labelledby="taskActionsTitle">
            <div class="section-heading"><h3 id="taskActionsTitle">${copy.taskActions}</h3></div>
            <div class="task-action-grid">
              <button class="task-action-card is-primary" id="buildPlanButton" type="button" data-task-action="plan" data-task-label="${copy.buildPlan}">
                <span class="task-action-icon">${renderUiIcon("tasks")}</span>
                <span><strong>${copy.buildPlan}</strong><small>${copy.buildPlanBody}</small></span>
              </button>
              <button class="task-action-card" id="parallelImproveButton" type="button" data-task-action="parallel-improve" data-task-label="${copy.parallelImprove}">
                <span class="task-action-icon">${renderUiIcon("improve")}</span>
                <span><strong>${copy.parallelImprove}</strong><small>${copy.parallelImproveBody}</small></span>
              </button>
            </div>
          </section>
          <section class="detail-section">
            <div class="section-heading"><h3>${copy.taskPlan}</h3><span id="planCount">0</span></div>
            <div class="review-list" id="planReview"><p class="review-empty">${copy.noPlan}</p></div>
          </section>
          <section class="detail-section">
            <div class="section-heading"><h3>${copy.agentRuns}</h3><span id="agentRunCount">0</span></div>
            <div class="agent-run-list" id="agentRunList"><p class="review-empty">${copy.noAgents}</p></div>
          </section>
        </section>

        <section class="tab-panel" id="activityPanel" role="tabpanel" aria-labelledby="activityTab" hidden>
          <section class="detail-section">
            <div class="section-heading"><h3>${copy.runtime}</h3><span id="runtimeUpdated">—</span></div>
            <dl class="runtime-grid" id="runtime"></dl>
          </section>
          <section class="detail-section">
            <div class="section-heading"><h3>${copy.projectMemory}</h3><span id="memoryCount">0</span></div>
            <div class="review-list" id="memoryReview"><p class="review-empty">${copy.noMemory}</p></div>
          </section>
          <section class="detail-section">
            <div class="section-heading"><h3>${copy.toolCalls}</h3><span id="toolHistoryCount">0</span></div>
            <div class="tool-history-list" id="toolHistory"><p class="review-empty">${copy.noActivity}</p></div>
          </section>
          <section class="detail-section activity-section">
            <div class="section-heading"><h3>${copy.activity}</h3><button class="text-button" id="clearActivity" type="button">${copy.clearActivity}</button></div>
            <div class="compact-filter-bar segmented" id="activityFilters" aria-label="${copy.activity}">
              <button type="button" data-activity-filter="all" aria-pressed="true">${copy.activityAll}</button>
              <button type="button" data-activity-filter="running" aria-pressed="false">${copy.activityRunning}</button>
              <button type="button" data-activity-filter="issues" aria-pressed="false">${copy.activityIssues}</button>
            </div>
            <div class="activity-list" id="events">
              <p class="activity-empty" id="activityEmpty">${copy.noActivity}</p>
            </div>
          </section>
          <details class="detail-section cache-section">
            <summary>${copy.promptCache}<span id="cacheSummary">—</span></summary>
            <pre id="cache">—</pre>
          </details>
        </section>

        <section class="tab-panel" id="changesPanel" role="tabpanel" aria-labelledby="changesTab" hidden>
          <section class="detail-section review-launcher">
            <div class="section-heading"><h3>${copy.reviewProject}</h3><span>READ ONLY</span></div>
            <p>${copy.reviewProjectBody}</p>
            <div class="review-preset-grid" id="reviewPresets">
              <button type="button" data-review-preset="comprehensive">${copy.reviewComprehensive}</button>
              <button type="button" data-review-preset="security">${copy.reviewSecurity}</button>
              <button type="button" data-review-preset="tests">${copy.reviewTests}</button>
              <button type="button" data-review-preset="performance">${copy.reviewPerformance}</button>
              <button type="button" data-review-preset="accessibility">${copy.reviewAccessibility}</button>
            </div>
          </section>
          <section class="detail-section changes-summary-section">
            <div class="section-heading"><h3>${copy.changedFiles}</h3><span id="changeCount">0</span></div>
            <input class="field-control compact-filter-input" id="changeFilter" type="search" maxlength="200" autocomplete="off" placeholder="${copy.filterChanges}" aria-label="${copy.filterChanges}" />
            <div class="changes-list" id="changesList" data-testid="changes-list"><p class="review-empty">${copy.noChanges}</p></div>
          </section>
          <section class="detail-section">
            <div class="section-heading"><h3>${copy.checkpoints}</h3><span id="checkpointCount">0</span></div>
            <div class="checkpoint-list" id="checkpointList"><p class="review-empty">—</p></div>
          </section>
          <section class="detail-section">
            <div class="section-heading"><h3>${copy.verification}</h3><span id="verificationCount">0</span></div>
            <div class="verification-list" id="verificationList"><p class="review-empty">—</p></div>
          </section>
          <button class="secondary-button export-trace-button" id="exportTraceButton" type="button">${copy.exportTrace}</button>
        </section>

        <section class="tab-panel" id="settingsPanel" role="tabpanel" aria-labelledby="settingsTab" hidden>
          <section class="settings-group">
            <div class="setting-row setting-row-stacked">
              <div><h3>${copy.language}</h3><p>${copy.languageDescription}</p></div>
              <div class="segmented language-options" id="languageOptions">
                <button type="button" data-language-value="en" aria-pressed="false">${copy.languageEnglish}</button>
                <button type="button" data-language-value="zh" aria-pressed="false">${copy.languageSimplified}</button>
                <button type="button" data-language-value="zh-TW" aria-pressed="false">${copy.languageTraditional}</button>
              </div>
            </div>
          </section>
          <section class="settings-group">
            <h3>${copy.model}</h3>
            <label class="field-label" for="customModel">${copy.customModel}</label>
            <div class="inline-field">
              <input id="customModel" type="text" maxlength="200" placeholder="deepseek-v4-pro" />
              <button class="secondary-button" id="applyModel" type="button">${copy.apply}</button>
            </div>
          </section>
          <section class="settings-group">
            <h3>${copy.permission}</h3>
            <div class="segmented" id="permissionSegments">
              <button type="button" data-mode="strict" aria-pressed="false">${copy.modeStrict}</button>
              <button type="button" data-mode="normal" aria-pressed="false">${copy.modeNormal}</button>
              <button type="button" data-mode="auto" aria-pressed="false">${copy.modeAuto}</button>
              <button type="button" data-mode="plan" aria-pressed="false">${copy.modePlan}</button>
            </div>
          </section>
          <section class="settings-group">
            <div class="setting-row">
              <div><h3>${copy.webSearch}</h3><p>${copy.webSearchDescription}</p></div>
              <label class="switch"><input id="searchEnabled" type="checkbox" aria-label="${copy.webSearch}" /><span class="switch-track" aria-hidden="true"></span></label>
            </div>
            <div class="search-dependencies" id="searchDependencies">
              <span class="field-label" id="searchProviderLabel">${copy.searchProvider}</span>
              <div class="select-control field-select-control" data-select-control>
                <select class="native-select-proxy" id="searchProvider" aria-labelledby="searchProviderLabel" tabindex="-1" aria-hidden="true" hidden>
                  <option value="auto">Auto</option>
                  <option value="searxng">SearXNG</option>
                  <option value="tavily">Tavily</option>
                  <option value="bing">Bing</option>
                  <option value="duckduckgo">DuckDuckGo</option>
                </select>
                <button class="select-trigger field-select-trigger" id="searchProviderTrigger" type="button" aria-labelledby="searchProviderLabel" aria-haspopup="listbox" aria-controls="searchProviderMenu" aria-expanded="false">
                  <span class="select-value">Auto</span>${renderUiIcon("down")}
                </button>
                <div class="select-menu" id="searchProviderMenu" role="listbox" aria-labelledby="searchProviderLabel" hidden></div>
              </div>
              <label class="field-label" for="searchMax">${copy.searchResults}</label>
              <input class="field-control" id="searchMax" type="number" min="1" max="20" />
            </div>
          </section>
          <section class="settings-group skill-settings">
            <div class="setting-row">
              <div><h3>${copy.skills}</h3><p>${copy.skillsDescription}</p></div>
              <label class="switch"><input id="skillsEnabled" type="checkbox" aria-label="${copy.skills}" /><span class="switch-track" aria-hidden="true"></span></label>
            </div>
            <div class="skill-controls" id="skillControls">
              <div class="capability-toolbar">
                <div>
                  <strong>${copy.capabilities}</strong>
                  <span>${copy.capabilitiesDescription}</span>
                </div>
                <button class="secondary-button capability-add-button" id="addCapabilityButton" type="button" aria-expanded="false" aria-controls="capabilityCreator">${copy.addCapability}</button>
              </div>
              <form class="capability-creator" id="capabilityCreator" novalidate hidden>
                <div class="segmented capability-kind" id="capabilityKind">
                  <button type="button" data-capability-kind="skill" aria-pressed="true">${copy.addSkill}</button>
                  <button type="button" data-capability-kind="workflow" aria-pressed="false">${copy.addWorkflow}</button>
                </div>
                <label class="field-label" for="capabilityTemplate">${copy.capabilityTemplate}</label>
                <select class="field-control capability-template" id="capabilityTemplate">
                  <option value="blank">${copy.templateBlank}</option>
                  <option value="review">${copy.templateReview}</option>
                  <option value="research">${copy.templateResearch}</option>
                  <option value="mcm">${copy.templateMcm}</option>
                </select>
                <label class="field-label" for="capabilityName">${copy.capabilityName}</label>
                <input class="field-control" id="capabilityName" type="text" maxlength="48" pattern="[a-z0-9][a-z0-9-]*" placeholder="data-review" autocomplete="off" required />
                <label class="field-label" for="capabilityDescription">${copy.capabilityDescription}</label>
                <input class="field-control" id="capabilityDescription" type="text" maxlength="2000" autocomplete="off" required />
                <label class="field-label" for="capabilityInstructions">${copy.capabilityInstructions}</label>
                <textarea class="field-control capability-instructions" id="capabilityInstructions" maxlength="24000" required></textarea>
                <div class="capability-workflow-fields" id="capabilityWorkflowFields" hidden>
                  <label class="field-label" for="capabilityArgumentHint">${copy.capabilityArgumentHint}</label>
                  <input class="field-control" id="capabilityArgumentHint" type="text" maxlength="160" placeholder="[files or requirements]" autocomplete="off" />
                  <label class="field-label" for="capabilitySkills">${copy.capabilitySkills}</label>
                  <input class="field-control" id="capabilitySkills" type="text" maxlength="520" placeholder="${copy.capabilitySkillsHint}" autocomplete="off" />
                </div>
                <div class="capability-preview">
                  <span class="field-label">${copy.capabilityPreview}</span>
                  <code id="capabilityPreview">—</code>
                </div>
                <p class="capability-form-error" id="capabilityFormError" role="alert" hidden></p>
                <div class="capability-creator-actions">
                  <button class="text-button" id="cancelCapabilityButton" type="button">${copy.cancel}</button>
                  <button class="secondary-button" id="createCapabilityButton" type="submit">${copy.create}</button>
                </div>
              </form>
              <div class="segmented" id="skillActivationSegments">
                <button type="button" data-skill-activation="auto" aria-pressed="false">${copy.skillAuto}</button>
                <button type="button" data-skill-activation="explicit" aria-pressed="false">${copy.skillExplicit}</button>
              </div>
              <div class="skill-limit-row">
                <label class="field-label" for="skillsMaxActive">${copy.skillMaxActive}</label>
                <input class="field-control" id="skillsMaxActive" type="number" min="0" max="8" />
                <button class="secondary-button" id="refreshSkills" type="button">${copy.refresh}</button>
              </div>
              <div class="skill-summary" id="skillSummary" role="status"></div>
              <div class="skill-list" id="skillList"><p class="review-empty">${copy.noSkills}</p></div>
              <div class="capability-subheading"><strong>${copy.workflows}</strong><span><button class="text-button" id="exportCapabilityCatalog" type="button">${copy.exportCatalog}</button> · <b id="workflowCount">0</b></span></div>
              <div class="workflow-list" id="workflowList"><p class="review-empty">${copy.noWorkflows}</p></div>
              <div class="skill-diagnostics" id="skillDiagnostics"></div>
            </div>
          </section>
          <section class="settings-group">
            <h3>${copy.theme}</h3>
            <div class="theme-options" id="themeOptions">
              <button type="button" data-theme-value="system" aria-pressed="false">${copy.system}</button>
              <button type="button" data-theme-value="light" aria-pressed="false">${copy.light}</button>
              <button type="button" data-theme-value="dark" aria-pressed="false">${copy.dark}</button>
            </div>
          </section>
        </section>
      </div>
    </aside>

  </div>
  <div class="command-palette" id="commandPalette" aria-hidden="true" hidden>
    <button class="command-palette-backdrop" id="commandPaletteBackdrop" type="button" aria-label="${copy.close}" tabindex="-1"></button>
    <section class="command-palette-dialog" role="dialog" aria-modal="true" aria-labelledby="commandPaletteTitle">
      <h2 class="sr-only" id="commandPaletteTitle">${copy.commands}</h2>
      <label class="command-search" for="commandSearch">
        <span aria-hidden="true">⌘</span>
        <input id="commandSearch" type="search" aria-label="${copy.commandSearch}" aria-controls="commandResults" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="${copy.commandSearch}" />
        <kbd aria-hidden="true">Esc</kbd>
      </label>
      <div class="command-results" id="commandResults" role="listbox"></div>
      <p class="command-empty" id="commandEmpty" hidden>${copy.noCommands}</p>
      <footer class="command-palette-footer">${copy.commandHint}</footer>
    </section>
  </div>
  <div class="session-delete-dialog" id="sessionDeleteDialog" aria-hidden="true" hidden>
    <button class="session-delete-backdrop" id="sessionDeleteBackdrop" type="button" aria-label="${copy.cancel}" tabindex="-1"></button>
    <section class="session-delete-card" role="dialog" aria-modal="true" aria-labelledby="sessionDeleteTitle" aria-describedby="sessionDeleteBody">
      <span class="session-delete-mark" aria-hidden="true">!</span>
      <div class="session-delete-copy">
        <h2 id="sessionDeleteTitle">${copy.deleteChatTitle}</h2>
        <p id="sessionDeleteBody">${copy.deleteChatBody}</p>
        <strong id="sessionDeleteName"></strong>
      </div>
      <div class="session-delete-actions">
        <button class="session-delete-cancel" id="sessionDeleteCancel" type="button">${copy.cancel}</button>
        <button class="session-delete-confirm" id="sessionDeleteConfirm" type="button">${copy.delete}</button>
      </div>
    </section>
  </div>
  <div class="project-dialog" id="projectDialog" aria-hidden="true" hidden>
    <button class="project-dialog-backdrop" id="projectDialogBackdrop" type="button" aria-label="${copy.cancel}" tabindex="-1"></button>
    <section class="project-dialog-card" role="dialog" aria-modal="true" aria-labelledby="projectDialogTitle" aria-describedby="projectDialogBody">
      <div class="project-dialog-heading">
        <span class="project-dialog-mark">${renderUiIcon("folder")}</span>
        <div>
          <h2 id="projectDialogTitle">${copy.projectDialogTitle}</h2>
          <p id="projectDialogBody">${copy.projectDialogBody}</p>
        </div>
      </div>
      <label class="project-path-field" for="projectPathInput">
        <span>${copy.projectPath}</span>
        <input id="projectPathInput" type="text" maxlength="4096" autocomplete="off" spellcheck="false" placeholder="${copy.projectPathPlaceholder}" />
      </label>
      <div class="project-dialog-actions">
        <button class="project-dialog-cancel" id="projectDialogCancel" type="button">${copy.cancel}</button>
        <button class="project-dialog-open" id="projectDialogOpen" type="button">${copy.openProject}</button>
        <button class="project-dialog-create" id="projectDialogCreate" type="button">${copy.createProject}</button>
      </div>
    </section>
  </div>
  <div class="toast-region" id="toasts" aria-live="polite" aria-relevant="additions"></div>
</body>
</html>`;
}
