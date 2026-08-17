/** Localization, DOM references, shared state, and shell-level browser helpers. */
export const WEB_UI_CLIENT_FOUNDATION_SCRIPT = String.raw`  const byId = (id) => document.getElementById(id);
  const documentLanguage = document.documentElement.lang;
  const language = documentLanguage === 'zh-TW' ? 'zh-TW' : documentLanguage.startsWith('zh') ? 'zh' : 'en';
  const isChinese = language !== 'en';
  const chinese = (simplified, traditional) => language === 'zh-TW' ? traditional : simplified;
  const copy = isChinese
    ? {
        connected: '已连接',
        reconnecting: '正在重连',
        disconnected: '连接断开',
        retry: '立即重试',
        ready: '准备就绪',
        waitingApproval: '等待审批',
        cancelling: '正在取消',
        thinking: 'Orbit 正在思考…',
        sendAction: '发送消息',
        stopAction: '停止生成',
        stopping: '正在停止…',
        stopped: '已停止生成',
        working: '正在处理任务…',
        failed: '任务失败',
        completed: '任务已完成',
        copied: '已复制代码',
        copy: '复制',
        copyResponse: '复制回复',
        copiedShort: '已复制',
        codeLines: '行',
        expandCode: '展开代码',
        collapseCode: '收起代码',
        table: '数据表格',
        reasoning: '思考过程',
        tool: '工具',
        toolBatch: '工具步骤',
        running: '运行中',
        done: '完成',
        error: '失败',
        noReply: 'Orbit 未返回文字内容。',
        accessExpired: 'WebUI 访问凭据无效，请在终端重新运行 /webui。',
        settingsSaved: '设置已更新',
        settingsSaving: '正在应用设置…',
        nothingRunning: '当前没有正在运行的任务。',
        approvalRequired: '等待你的确认',
        approvalApproved: '已允许操作',
        approvalDenied: '已拒绝操作',
        approvalOwner: chinese('请求方', '請求方'),
        models: '模型',
        mode: '权限',
        messages: '消息',
        goal: '目标',
        context: '上下文',
        activeContext: '活动上下文',
        clearContext: '全部清空',
        removeContext: '从上下文移除',
        readOnlyContext: '只读',
        contextAdded: '已添加',
        contextMore: '个更多文件',
        workspace: '工作区',
        tokens: '输入 / 输出',
        contextWindow: '上下文',
        cache: '缓存读取',
        cost: '费用',
        user: '你',
        assistant: 'Orbit',
        draftRestored: '已恢复上次未发送的内容',
        waitForConnection: '正在重连 Orbit，内容已保留，请稍后重试。',
        terminalTurn: '终端任务',
        untitledTask: '未命名任务',
        sessionSwitched: '会话已切换',
        sessionCreated: '已新建任务',
        sessionArchived: '对话已归档',
        sessionRestored: '对话已恢复',
        sessionDeleted: '对话已删除',
        projectOpening: '正在新标签页打开项目…',
        projectCreating: '正在准备项目并打开新标签页…',
        projectOpened: '项目已在新标签页中打开',
        projectSwitchFailed: '项目已启动，但无法安全打开页面',
        projectRemoved: '项目已从 Orbit 移除，磁盘文件未删除',
        removeProject: '从 Orbit 移除项目',
        confirmRemoveProject: '再次点击确认移除',
        projectPathRequired: '请输入项目文件夹的绝对路径',
        archiveSession: '归档',
        restoreSession: '恢复',
        deleteSession: '删除',
        focusComposer: '聚焦输入框',
        useSkill: '使用技能',
        useWorkflow: '使用工作流',
        skillExplicit: '显式激活',
        skillAuto: '自动激活',
        copyDiff: '复制补丁',
        diffCopied: '补丁已复制',
        catalogExported: '能力清单已导出',
        capabilityCreated: '能力已添加',
        skillsRefreshed: 'Skill 列表已刷新',
        capabilityNameInvalid: '名称必须以小写字母或数字开头，只能包含小写字母、数字和连字符。',
        capabilityDescriptionRequired: '请填写能力说明。',
        capabilityInstructionsRequired: '请填写执行说明。',
        capabilitySkillsInvalid: '组合 Skill 名称只能包含小写字母、数字和连字符。',
        capabilitySkillsLimit: '一个工作流最多组合 8 个 Skill。',
        capabilitySkillsMissing: '未发现这些 Skill：',
        openActivity: '打开任务活动',
        openChanges: '打开改动审阅',
        openSettings: '打开设置',
        restoreFile: '恢复文件',
        rewindCheckpoint: '回退到此检查点',
        restoreConfirm: '再次点击确认恢复',
        restored: '已恢复工作区',
        traceExported: '诊断包已导出',
        noChanges: '当前对话还没有文件改动。',
        noActivity: 'Orbit 工作时，步骤和工具状态会显示在这里。',
        noToolCalls: '当前对话还没有工具调用。',
        noMatchingChats: '没有匹配的对话',
        noRecentTasks: '还没有对话',
        noCheckpoints: '暂无可恢复检查点。',
        noVerification: '暂无验证结果。',
        noAgents: '当前工作区还没有委派智能体。',
        abortAgent: '终止智能体',
        agentAborted: '已发送智能体终止请求',
        resumeAgent: chinese('恢复智能体', '恢復智慧體'),
        agentResumed: chinese('智能体已从持久化会话恢复', '智慧體已從持久化工作階段恢復'),
        steerAgent: chinese('引导智能体', '引導智能體'),
        agentSteerPlaceholder: chinese('补充给这个智能体的要求…', '補充給這個智能體的要求…'),
        sendAgentSteering: chinese('发送引导', '傳送引導'),
        cancelAgentSteering: chinese('取消引导', '取消引導'),
        agentSteered: chinese('引导将在下一个安全步骤生效', '引導將在下一個安全步驟生效'),
        steeringCount: chinese('已引导', '已引導'),
        queued: '已加入待发送队列',
        queueMessage: '加入队列',
        removeQueued: '移除待发送消息',
        queueActions: '管理待发送消息',
        editQueued: '编辑消息',
        saveQueued: '保存修改',
        cancelQueueEdit: '取消编辑',
        moveQueuedEarlier: '提前一位',
        moveQueuedLater: '推后一位',
        steerQueued: '提升为当前引导',
        queuedUpdated: '待发送消息已更新',
        attachmentAdded: '图片已添加',
        attachmentRemoved: '图片已移除',
        removeAttachment: '移除图片',
        attachmentLimit: '每次最多添加 4 张图片，每张不超过 5 MB。',
        sessionRecovered: '已安全恢复上次异常中断的会话',
        compactContext: '压缩当前上下文',
        recentSession: '最近会话',
        switchModel: '切换模型',
        switchMode: '切换权限模式',
        action: '操作',
        close: '关闭',
        openNavigation: '打开导航',
        collapseNavigation: '收起导航',
        modeStrict: '严格',
        modeNormal: '标准',
        modeAuto: '全自动',
        modePlan: '规划',
        permissionFullAccess: chinese('完整权限已开启：所有已启用工具操作均自动批准。', '完整權限已開啟：所有已啟用工具操作均自動批准。'),
        permissionAutoLimited: chinese('全自动尚未完全生效，部分操作仍需确认。', '全自動尚未完全生效，部分操作仍需確認。'),
        permissionStrict: chinese('严格模式会在重要操作前请求确认。', '嚴格模式會在重要操作前請求確認。'),
        permissionNormal: chinese('标准模式会在写入和执行命令前请求确认。', '標準模式會在寫入和執行命令前請求確認。'),
        permissionPlan: chinese('规划模式只分析和读取，不修改文件。', '規劃模式只分析和讀取，不修改檔案。'),
        permissionGuards: chinese('危险操作会被阻止，显式文件路径会受保护；本机命令、预算与长任务上限仍然有效。', '危險操作會被阻止，顯式檔案路徑會受保護；本機命令、預算與長任務上限仍然有效。'),
        permissionGuardsReduced: chinese('警告：部分硬安全保护已在配置中关闭。', '警告：部分硬安全保護已在設定中關閉。'),
        permissionNoGuards: chinese('权限策略不再拦截或复核危险、密钥、不透明、本地网络及工作区外操作。命令拥有当前系统账户权限并继承 Orbit 进程环境；已运行的子进程会保留这些权限直至停止。中间迭代检查点会自动继续且不再询问。输出脱敏、项目钩子、验证契约、预算、停滞循环检测和配置的最终迭代上限仍有效；工作区外改动无法由 Orbit 回滚。', '權限策略不再攔截或複核危險、密鑰、不透明、本機網路及工作區外操作。命令擁有目前系統帳戶權限並繼承 Orbit 程序環境；已執行的子程序會保留這些權限直至停止。中間迭代檢查點會自動繼續且不再詢問。輸出脫敏、專案掛鉤、驗證契約、預算、停滯迴圈偵測和設定的最終迭代上限仍有效；工作區外變更無法由 Orbit 回滾。'),
      }
    : {
        connected: 'Connected',
        reconnecting: 'Reconnecting',
        disconnected: 'Disconnected',
        retry: 'Retry now',
        ready: 'Ready',
        waitingApproval: 'Waiting for approval',
        cancelling: 'Cancelling',
        thinking: 'Orbit is thinking…',
        sendAction: 'Send message',
        stopAction: 'Stop generating',
        stopping: 'Stopping…',
        stopped: 'Generation stopped',
        working: 'Working on your task…',
        failed: 'Task failed',
        completed: 'Task complete',
        copied: 'Code copied',
        copy: 'Copy',
        copyResponse: 'Copy response',
        copiedShort: 'Copied',
        codeLines: 'lines',
        expandCode: 'Expand code',
        collapseCode: 'Collapse code',
        table: 'Data table',
        reasoning: 'Reasoning',
        tool: 'Tool',
        toolBatch: 'Tool steps',
        running: 'Running',
        done: 'Done',
        error: 'Failed',
        noReply: 'Orbit returned no text.',
        accessExpired: 'Web UI access expired. Run /webui again in Orbit.',
        settingsSaved: 'Settings updated',
        settingsSaving: 'Applying settings…',
        nothingRunning: 'Nothing is currently running.',
        approvalRequired: 'Waiting for your approval',
        approvalApproved: 'Action approved',
        approvalDenied: 'Action denied',
        approvalOwner: 'Requested by',
        models: 'Model',
        mode: 'Mode',
        messages: 'Messages',
        goal: 'Goal',
        context: 'Context',
        activeContext: 'Active context',
        clearContext: 'Clear all',
        removeContext: 'Remove from context',
        readOnlyContext: 'Read only',
        contextAdded: 'Added',
        contextMore: 'more files',
        workspace: 'Workspace',
        tokens: 'Input / output',
        contextWindow: 'Context',
        cache: 'Cache read',
        cost: 'Cost',
        user: 'You',
        assistant: 'Orbit',
        draftRestored: 'Restored your unsent draft',
        waitForConnection: 'Orbit is reconnecting. Your message is preserved; try again shortly.',
        terminalTurn: 'Terminal task',
        untitledTask: 'Untitled task',
        sessionSwitched: 'Session switched',
        sessionCreated: 'New task created',
        sessionArchived: 'Chat archived',
        sessionRestored: 'Chat restored',
        sessionDeleted: 'Chat deleted',
        projectOpening: 'Opening project in a new tab…',
        projectCreating: 'Preparing project in a new tab…',
        projectOpened: 'Project opened in a new tab',
        projectSwitchFailed: 'The project started, but Orbit could not open it safely',
        projectRemoved: 'Project removed from Orbit; files were not deleted',
        removeProject: 'Remove project from Orbit',
        confirmRemoveProject: 'Click again to confirm removal',
        projectPathRequired: 'Enter an absolute project folder path',
        archiveSession: 'Archive',
        restoreSession: 'Restore',
        deleteSession: 'Delete',
        focusComposer: 'Focus message composer',
        useSkill: 'Use skill',
        useWorkflow: 'Use workflow',
        skillExplicit: 'explicit',
        skillAuto: 'auto',
        copyDiff: 'Copy patch',
        diffCopied: 'Patch copied',
        catalogExported: 'Capability catalog exported',
        capabilityCreated: 'Capability added',
        skillsRefreshed: 'Skill catalog refreshed',
        capabilityNameInvalid: 'Use a lowercase name that starts with a letter or number and contains only letters, numbers, and hyphens.',
        capabilityDescriptionRequired: 'Add a capability description.',
        capabilityInstructionsRequired: 'Add execution instructions.',
        capabilitySkillsInvalid: 'Composed Skill names may contain only lowercase letters, numbers, and hyphens.',
        capabilitySkillsLimit: 'A Workflow can compose at most 8 Skills.',
        capabilitySkillsMissing: 'These Skills were not found: ',
        openActivity: 'Open task activity',
        openChanges: 'Open change review',
        openSettings: 'Open settings',
        restoreFile: 'Restore file',
        rewindCheckpoint: 'Rewind to this checkpoint',
        restoreConfirm: 'Click again to confirm restore',
        restored: 'Workspace restored',
        traceExported: 'Diagnostics exported',
        noChanges: 'No file changes in this chat.',
        noActivity: 'Activity will appear here while Orbit works.',
        noToolCalls: 'No tool calls in this chat.',
        noMatchingChats: 'No matching chats',
        noRecentTasks: 'No chats yet',
        noCheckpoints: 'No restorable checkpoints.',
        noVerification: 'No verification results.',
        noAgents: 'No delegated agents for this workspace.',
        abortAgent: 'Abort agent',
        agentAborted: 'Agent abort requested',
        resumeAgent: 'Resume agent',
        agentResumed: 'Agent resumed from its persisted session',
        steerAgent: 'Steer agent',
        agentSteerPlaceholder: 'Add a requirement for this agent…',
        sendAgentSteering: 'Send steering',
        cancelAgentSteering: 'Cancel steering',
        agentSteered: 'Steering will apply at the next safe step',
        steeringCount: 'steered',
        queued: 'Added to follow-up queue',
        queueMessage: 'Queue message',
        removeQueued: 'Remove queued message',
        queueActions: 'Manage queued message',
        editQueued: 'Edit message',
        saveQueued: 'Save changes',
        cancelQueueEdit: 'Cancel editing',
        moveQueuedEarlier: 'Move earlier',
        moveQueuedLater: 'Move later',
        steerQueued: 'Steer current task',
        queuedUpdated: 'Queued message updated',
        attachmentAdded: 'Image attached',
        attachmentRemoved: 'Image removed',
        removeAttachment: 'Remove image',
        attachmentLimit: 'Attach up to 4 images, 5 MB each.',
        sessionRecovered: 'Safely recovered the previously interrupted session',
        compactContext: 'Compact current context',
        recentSession: 'Recent session',
        switchModel: 'Switch model',
        switchMode: 'Switch permission mode',
        action: 'Action',
        close: 'Close',
        openNavigation: 'Open navigation',
        collapseNavigation: 'Collapse navigation',
        modeStrict: 'Strict',
        modeNormal: 'Normal',
        modeAuto: 'Full access',
        modePlan: 'Plan',
        permissionFullAccess: 'Unrestricted Full Access is on: every enabled tool action is approved automatically.',
        permissionAutoLimited: 'Full access is not fully active; some actions still require approval.',
        permissionStrict: 'Strict mode asks before consequential operations.',
        permissionNormal: 'Normal mode asks before writes and command execution.',
        permissionPlan: 'Plan mode analyzes and reads without changing files.',
        permissionGuards: 'Dangerous patterns are blocked and explicit file paths are guarded; commands remain host processes and budget/long-task limits stay active.',
        permissionGuardsReduced: 'Warning: some hard safety guards are disabled in configuration.',
        permissionNoGuards: "The permission policy no longer blocks or reviews dangerous, protected, opaque, local-network, or outside-workspace actions. Commands use host-account permissions and inherit Orbit's process environment; running children retain that authority until stopped. Intermediate iteration checkpoints continue automatically without asking. Output redaction, project hooks, verification contracts, budget, stalled-loop detection, and the configured final iteration ceiling remain; outside-workspace changes have no Orbit rollback.",
      };

  if (language === 'zh-TW') {
    Object.assign(copy, {
      connected: '已連線',
      reconnecting: '正在重新連線',
      disconnected: '連線中斷',
      retry: '立即重試',
      ready: '準備就緒',
      waitingApproval: '等待審批',
      cancelling: '正在取消',
      thinking: 'Orbit 正在思考…',
      stopping: '正在停止…',
      stopped: '已停止產生',
      working: '正在處理任務…',
      failed: '任務失敗',
      completed: '任務已完成',
      copied: '已複製程式碼',
      copy: '複製',
      copyResponse: '複製回覆',
      copiedShort: '已複製',
      expandCode: '展開程式碼',
      collapseCode: '收合程式碼',
      settingsSaved: '設定已更新',
      settingsSaving: '正在套用設定…',
      sessionSwitched: '工作階段已切換',
      sessionCreated: '已新增任務',
      sessionArchived: '對話已封存',
      sessionRestored: '對話已復原',
      sessionDeleted: '對話已刪除',
      projectOpening: '正在新分頁開啟專案…',
      projectCreating: '正在準備專案並開啟新分頁…',
      projectOpened: '專案已在新分頁中開啟',
      projectSwitchFailed: '專案已啟動，但無法安全開啟頁面',
      projectRemoved: '專案已從 Orbit 移除，磁碟檔案未刪除',
      removeProject: '從 Orbit 移除專案',
      projectPathRequired: '請輸入專案資料夾的絕對路徑',
      archiveSession: '封存',
      restoreSession: '復原',
      deleteSession: '刪除',
      openActivity: '開啟任務活動',
      openChanges: '開啟變更檢視',
      openSettings: '開啟設定',
      restoreFile: '復原檔案',
      traceExported: '診斷包已匯出',
      noChanges: '目前對話尚未有檔案變更。',
      noActivity: 'Orbit 工作時，步驟和工具狀態會顯示在這裡。',
      noToolCalls: '目前對話尚未有工具呼叫。',
      noMatchingChats: '沒有相符的對話',
      noRecentTasks: '尚未有對話',
      queued: '已加入待傳送佇列',
      queueMessage: '加入佇列',
      removeQueued: '移除待傳送訊息',
      queueActions: '管理待傳送訊息',
      editQueued: '編輯訊息',
      saveQueued: '儲存修改',
      cancelQueueEdit: '取消編輯',
      moveQueuedEarlier: '提前一位',
      moveQueuedLater: '延後一位',
      steerQueued: '提升為目前引導',
      queuedUpdated: '待傳送訊息已更新',
      close: '關閉',
      openNavigation: '開啟導覽',
      collapseNavigation: '收合導覽',
      modeStrict: '嚴格',
      modeNormal: '標準',
      modeAuto: '自動',
      modePlan: '規劃',
      recentSession: '最近工作階段',
      useWorkflow: '使用工作流程',
      copyDiff: '複製補丁',
      diffCopied: '補丁已複製',
      catalogExported: '能力清單已匯出',
      capabilityCreated: '能力已新增',
      skillsRefreshed: 'Skill 清單已重新整理',
      capabilityNameInvalid: '名稱須以小寫字母或數字開頭，且只能包含小寫字母、數字與連字號。',
      capabilityDescriptionRequired: '請填寫能力說明。',
      capabilityInstructionsRequired: '請填寫執行說明。',
      capabilitySkillsInvalid: '組合 Skill 名稱只能包含小寫字母、數字與連字號。',
      capabilitySkillsLimit: '一個工作流程最多組合 8 個 Skill。',
      capabilitySkillsMissing: '找不到這些 Skill：',
    });
  }

  const projectErrorMessages = isChinese
    ? {
        absolute_path_required: chinese('请输入项目文件夹的绝对路径。', '請輸入專案資料夾的絕對路徑。'),
        filesystem_root: chinese('为保护系统，不能把磁盘根目录作为 Orbit 项目。', '為保護系統，不能把磁碟根目錄作為 Orbit 專案。'),
        entrypoint_unavailable: chinese('Orbit CLI 启动入口不可用，请重启 Orbit 后再试。', 'Orbit CLI 啟動入口無法使用，請重新啟動 Orbit 後再試。'),
        project_missing: chinese('项目文件夹不存在。', '專案資料夾不存在。'),
        project_not_directory: chinese('选择的路径不是文件夹。', '選擇的路徑不是資料夾。'),
        parent_missing: chinese('上级文件夹不存在，请先选择一个已有位置。', '上層資料夾不存在，請先選擇一個現有位置。'),
        parent_not_directory: chinese('项目的上级路径不是文件夹。', '專案的上層路徑不是資料夾。'),
        create_failed: chinese('无法创建项目文件夹，请检查路径和权限。', '無法建立專案資料夾，請檢查路徑與權限。'),
        launch_failed: chinese('无法启动此项目的 Orbit 实例。', '無法啟動此專案的 Orbit 執行個體。'),
        startup_failed: chinese('项目实例在 WebUI 就绪前退出。', '專案執行個體在 WebUI 就緒前結束。'),
        startup_timeout: chinese('启动项目超时，请重试或检查运行诊断。', '啟動專案逾時，請重試或檢查執行診斷。'),
      }
    : {
        absolute_path_required: 'Enter an absolute project folder path.',
        filesystem_root: 'A filesystem root cannot be used as an Orbit project.',
        entrypoint_unavailable: 'The Orbit CLI entry point is unavailable. Restart Orbit and try again.',
        project_missing: 'The project folder does not exist.',
        project_not_directory: 'The selected path is not a folder.',
        parent_missing: 'The parent folder does not exist. Choose an existing location first.',
        parent_not_directory: 'The project parent path is not a folder.',
        create_failed: 'Orbit could not create the project folder. Check the path and permissions.',
        launch_failed: 'Orbit could not start this project.',
        startup_failed: 'The project exited before its Web UI was ready.',
        startup_timeout: 'The project took too long to start. Retry or open Diagnostics.',
      };
  const projectErrorMessage = (error) =>
    projectErrorMessages[error && error.projectErrorCode] ||
    error && error.message ||
    String(error);

  const suggestionPrompts = isChinese
    ? [
        '全面审查这个项目，找出影响最大的问题并直接修复，最后运行完整验证。',
        '诊断当前项目中最可能导致构建失败或运行异常的问题，并完成修复。',
        '先阅读项目结构，然后用清晰的语言解释核心架构、数据流和主要入口。',
        '全面优化当前项目的性能、安全性和可维护性，并用测试验证所有改动。',
      ]
    : [
        'Review this entire project, fix the highest-impact issues, and run full verification.',
        'Diagnose the most likely build or runtime failure in this project and fix it.',
        'Inspect the project, then explain its architecture, data flow, and main entry points.',
        'Improve this project\'s performance, security, and maintainability, then verify every change.',
      ];

  const elements = {
    appShell: byId('appShell'),
    sidebar: byId('sidebar'),
    workspaceView: document.querySelector('.workspace-view'),
    sidebarBackdrop: byId('sidebarBackdrop'),
    menuButton: byId('menuButton'),
    sidebarCollapseButton: byId('sidebarCollapseButton'),
    inspector: byId('inspector'),
    inspectorBackdrop: byId('inspectorBackdrop'),
    inspectorButton: byId('inspectorButton'),
    inspectorClose: byId('inspectorClose'),
    tasksButton: byId('tasksButton'),
    changesButton: byId('changesButton'),
    tasksTab: byId('tasksTab'),
    activityTab: byId('activityTab'),
    changesTab: byId('changesTab'),
    settingsTab: byId('settingsTab'),
    tasksPanel: byId('tasksPanel'),
    activityPanel: byId('activityPanel'),
    changesPanel: byId('changesPanel'),
    settingsPanel: byId('settingsPanel'),
    languageOptions: byId('languageOptions'),
    conversation: byId('conversation'),
    messageScroll: byId('messageScroll'),
    messages: byId('messages'),
    emptyState: byId('emptyState'),
    projectToggle: byId('projectToggle'),
    projectList: byId('projectList'),
    recentProjectsShell: byId('recentProjectsShell'),
    projectChatBody: byId('projectChatBody'),
    projectChatCount: byId('projectChatCount'),
    newProjectButton: byId('newProjectButton'),
    projectDialog: byId('projectDialog'),
    projectDialogBackdrop: byId('projectDialogBackdrop'),
    projectDialogCancel: byId('projectDialogCancel'),
    projectDialogCreate: byId('projectDialogCreate'),
    projectDialogBrowse: byId('projectDialogBrowse'),
    projectPathInput: byId('projectPathInput'),
    recentSection: byId('recentSection'),
    sessionSearchField: byId('sessionSearchField'),
    sessionSearch: byId('sessionSearch'),
    sessionShowMore: byId('sessionShowMore'),
    recentSessions: byId('recentSessions'),
    recentEmpty: byId('recentEmpty'),
    archiveToggle: byId('archiveToggle'),
    archiveCount: byId('archiveCount'),
    archivedPanel: byId('archivedPanel'),
    archivedSessions: byId('archivedSessions'),
    archivedEmpty: byId('archivedEmpty'),
    sessionDeleteDialog: byId('sessionDeleteDialog'),
    sessionDeleteBackdrop: byId('sessionDeleteBackdrop'),
    sessionDeleteName: byId('sessionDeleteName'),
    fullAccessDialog: byId('fullAccessDialog'),
    fullAccessBackdrop: byId('fullAccessBackdrop'),
    fullAccessCancel: byId('fullAccessCancel'),
    fullAccessConfirm: byId('fullAccessConfirm'),
    sessionDeleteCancel: byId('sessionDeleteCancel'),
    sessionDeleteConfirm: byId('sessionDeleteConfirm'),
    newTaskButton: byId('newTaskButton'),
    commandsButton: byId('commandsButton'),
    commandTrigger: byId('commandTrigger'),
    commandPalette: byId('commandPalette'),
    commandPaletteBackdrop: byId('commandPaletteBackdrop'),
    commandSearch: byId('commandSearch'),
    commandResults: byId('commandResults'),
    commandEmpty: byId('commandEmpty'),
    contextMeter: byId('contextMeter'),
    contextPercent: byId('contextPercent'),
    emptyComposerSlot: byId('emptyComposerSlot'),
    composerDock: byId('composerDock'),
    composerAnchor: byId('composerAnchor'),
    jumpEarlier: byId('jumpEarlier'),
    jumpBottom: byId('jumpBottom'),
    composer: byId('composer'),
    prompt: byId('prompt'),
    slashCommandMenu: byId('slashCommandMenu'),
    slashCommandResults: byId('slashCommandResults'),
    slashCommandEmpty: byId('slashCommandEmpty'),
    contextPickerButton: byId('contextPickerButton'),
    contextChipCount: byId('contextChipCount'),
    contextShelf: byId('contextShelf'),
    contextFileList: byId('contextFileList'),
    clearContextButton: byId('clearContextButton'),
    attachmentButton: byId('attachmentButton'),
    attachmentInput: byId('attachmentInput'),
    attachmentShelf: byId('attachmentShelf'),
    attachmentList: byId('attachmentList'),
    attachmentCount: byId('attachmentCount'),
    promptQueue: byId('promptQueue'),
    promptQueueList: byId('promptQueueList'),
    clearQueueButton: byId('clearQueueButton'),
    queueButton: byId('queueButton'),
    contextPicker: byId('contextPicker'),
    contextPickerClose: byId('contextPickerClose'),
    contextSearch: byId('contextSearch'),
    contextResults: byId('contextResults'),
    contextEmpty: byId('contextEmpty'),
    sendButton: byId('sendButton'),
    sendGlyph: byId('sendGlyph'),
    turnStatus: byId('turnStatus'),
    approvalPanel: byId('approvalPanel'),
    approvalTitle: byId('approvalTitle'),
    approvalReason: byId('approvalReason'),
    approvalPreview: byId('approvalPreview'),
    denyApprovalButton: byId('denyApprovalButton'),
    approveApprovalButton: byId('approveApprovalButton'),
    connectionState: byId('connectionState'),
    connectionLabel: byId('connectionLabel'),
    providerSelect: byId('providerSelect'),
    modelSelect: byId('modelSelect'),
    settingsModelSelect: byId('settingsModelSelect'),
    settingsAgentProfileSelect: byId('settingsAgentProfileSelect'),
    customModel: byId('customModel'),
    applyModel: byId('applyModel'),
    permissionSelect: byId('permissionSelect'),
    permissionSegments: byId('permissionSegments'),
    permissionSummary: byId('permissionSummary'),
    agentMaxIterations: byId('agentMaxIterations'),
    searchToggle: byId('searchToggle'),
    searchEnabled: byId('searchEnabled'),
    searchDependencies: byId('searchDependencies'),
    searchProvider: byId('searchProvider'),
    searchMax: byId('searchMax'),
    skillsEnabled: byId('skillsEnabled'),
    addCapabilityButton: byId('addCapabilityButton'),
    capabilityCreator: byId('capabilityCreator'),
    capabilityKind: byId('capabilityKind'),
    capabilityTemplate: byId('capabilityTemplate'),
    capabilitySkillFields: byId('capabilitySkillFields'),
    capabilityScope: byId('capabilityScope'),
    capabilityName: byId('capabilityName'),
    capabilityDescription: byId('capabilityDescription'),
    capabilityInstructions: byId('capabilityInstructions'),
    capabilityWorkflowFields: byId('capabilityWorkflowFields'),
    capabilityArgumentHint: byId('capabilityArgumentHint'),
    capabilitySkills: byId('capabilitySkills'),
    capabilityPreview: byId('capabilityPreview'),
    capabilityFormError: byId('capabilityFormError'),
    cancelCapabilityButton: byId('cancelCapabilityButton'),
    createCapabilityButton: byId('createCapabilityButton'),
    skillControls: byId('skillControls'),
    skillActivationSegments: byId('skillActivationSegments'),
    skillsMaxActive: byId('skillsMaxActive'),
    refreshSkills: byId('refreshSkills'),
    skillSummary: byId('skillSummary'),
    skillList: byId('skillList'),
    workflowList: byId('workflowList'),
    workflowCount: byId('workflowCount'),
    exportCapabilityCatalog: byId('exportCapabilityCatalog'),
    skillDiagnostics: byId('skillDiagnostics'),
    events: byId('events'),
    activityEmpty: byId('activityEmpty'),
    activityFilters: byId('activityFilters'),
    clearActivity: byId('clearActivity'),
    runtime: byId('runtime'),
    taskOverview: byId('taskOverview'),
    buildPlanButton: byId('buildPlanButton'),
    parallelImproveButton: byId('parallelImproveButton'),
    planReview: byId('planReview'),
    planCount: byId('planCount'),
    agentRunList: byId('agentRunList'),
    agentRunCount: byId('agentRunCount'),
    reviewPresets: byId('reviewPresets'),
    memoryReview: byId('memoryReview'),
    memoryCount: byId('memoryCount'),
    toolHistory: byId('toolHistory'),
    toolHistoryCount: byId('toolHistoryCount'),
    cache: byId('cache'),
    cacheSummary: byId('cacheSummary'),
    runtimeUpdated: byId('runtimeUpdated'),
    changeCount: byId('changeCount'),
    changeFilter: byId('changeFilter'),
    changesList: byId('changesList'),
    checkpointCount: byId('checkpointCount'),
    checkpointList: byId('checkpointList'),
    verificationCount: byId('verificationCount'),
    verificationList: byId('verificationList'),
    exportTraceButton: byId('exportTraceButton'),
    toasts: byId('toasts'),
  };

  const state = {
    ready: false,
    initializing: false,
    busy: false,
    submitting: false,
    stopping: false,
    activeTurnId: null,
    streaming: null,
    streamingTurnId: null,
    streamText: '',
    pendingDelta: '',
    pendingThinking: '',
    animationFrame: 0,
    streamFlushTimer: 0,
    lastStreamRenderAt: 0,
    stickToBottom: true,
    eventSource: null,
    eventRetryTimer: 0,
    eventRetryAttempt: 0,
    connectionNoticeTimer: 0,
    shuttingDown: false,
    status: null,
    activityRows: 0,
    currentThinkingRow: null,
    toolRows: new Map(),
    streamingTools: new Map(),
    statusRefresh: null,
    settingsPromise: null,
    settingsCatalogLoaded: false,
    settingsCatalogPromise: null,
    customModelPending: false,
    skills: null,
    skillsPromise: null,
    skillRequestId: 0,
    controlTurnId: null,
    controlPrompt: '',
    controlTurns: new Map(),
    messageCache: new Map(),
    messageSessionId: '',
    messageTotal: 0,
    earliestMessagePosition: 0,
    loadingEarlierMessages: false,
    externalTurn: false,
    useBearerTransport: false,
    pendingApproval: null,
    approvalSubmitting: false,
    pendingSessionDeleteId: null,
    sessionData: null,
    sessionQuery: '',
    sessionLimit: 24,
    sessionDeleteReturnFocus: null,
    fullAccessReturnFocus: null,
    fullAccessRequest: null,
    projectDialogReturnFocus: null,
    projectPickerPending: false,
    projectLaunchPending: false,
    promptQueue: [],
    queueEditingId: null,
    queueEditDraft: '',
    agentSteeringId: null,
    agentSteeringDraft: '',
    attachments: [],
    lastRecoveryKey: '',
    capabilityKind: 'skill',
    activityFilter: 'all',
    changeQuery: '',
    changeReview: null,
  };

  const mobileSidebarQuery = window.matchMedia('(max-width: 900px)');
  const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  let sidebarReturnFocus = null;
  let inspectorReturnFocus = null;

  const webSessionTokenKey = 'orbit.webui.bootstrap-token';
  const tokenFromHash = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  let webSessionToken = tokenFromHash;
  let sessionRecoveryPromise = null;
  try {
    if (tokenFromHash) sessionStorage.setItem(webSessionTokenKey, tokenFromHash);
  } catch {}
  if (location.hash) {
    history.replaceState(null, document.title, location.pathname + location.search);
  }

  function readLocalStorage(key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  }

  function writeLocalStorage(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {}
  }

  function setConnection(kind, label) {
    if (state.connectionNoticeTimer) {
      window.clearTimeout(state.connectionNoticeTimer);
      state.connectionNoticeTimer = 0;
    }
    elements.connectionState.classList.toggle('is-connected', kind === 'connected');
    elements.connectionState.classList.toggle('is-disconnected', kind === 'disconnected');
    elements.appShell.classList.toggle('is-connected', kind === 'connected');
    elements.appShell.classList.remove('is-reconnecting', 'is-disconnected');
    if (kind === 'connecting') {
      state.connectionNoticeTimer = window.setTimeout(() => {
        state.connectionNoticeTimer = 0;
        if (!state.ready && elements.connectionLabel.textContent === label) {
          elements.appShell.classList.add('is-reconnecting');
        }
      }, 1400);
    } else if (kind === 'disconnected') {
      elements.appShell.classList.add('is-disconnected');
    }
    elements.connectionLabel.textContent = label;
    elements.connectionState.setAttribute('aria-label', label + '. ' + copy.retry);
  }

  function showToast(message, kind) {
    const text = String(message || '');
    const existing = Array.from(elements.toasts.children).find((item) => item.dataset.message === text);
    if (existing) return;
    const toast = document.createElement('div');
    toast.className = 'toast' + (kind ? ' is-' + kind : '');
    toast.dataset.message = text;
    toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-atomic', 'true');
    const body = document.createElement('div');
    body.textContent = text;
    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', copy.close);
    close.textContent = '×';
    close.addEventListener('click', () => toast.remove());
    toast.append(body, close);
    elements.toasts.append(toast);
    window.setTimeout(() => toast.remove(), kind === 'error' ? 8000 : 3600);
  }

  async function bootstrapSession() {
    let savedToken = '';
    try { savedToken = sessionStorage.getItem(webSessionTokenKey) || ''; } catch {}
    const bootstrapToken = webSessionToken || savedToken;
    if (!bootstrapToken) return false;
    webSessionToken = bootstrapToken;
    const response = await fetch('/api/bootstrap', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Authorization: 'Bearer ' + bootstrapToken },
    });
    await response.body?.cancel().catch(() => {});
    if (!response.ok) {
      try { sessionStorage.removeItem(webSessionTokenKey); } catch {}
      webSessionToken = '';
      state.useBearerTransport = false;
      return false;
    }
    state.useBearerTransport = false;
    return true;
  }

  async function recoverAuthenticatedSession() {
    if (sessionRecoveryPromise) return sessionRecoveryPromise;
    sessionRecoveryPromise = bootstrapSession().finally(() => {
      sessionRecoveryPromise = null;
    });
    return sessionRecoveryPromise;
  }

  async function api(url, options) {
    const request = options || {};
    const requestApi = (useBearer) => fetch(url, {
      ...request,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(useBearer && webSessionToken ? { Authorization: 'Bearer ' + webSessionToken } : {}),
        ...(request.headers || {}),
      },
    });
    let response = await requestApi(state.useBearerTransport);
    if (response.status === 401 && webSessionToken && !state.useBearerTransport) {
      await response.body?.cancel().catch(() => {});
      state.useBearerTransport = true;
      response = await requestApi(true);
    }
    if (response.status === 401 && await recoverAuthenticatedSession()) {
      await response.body?.cancel().catch(() => {});
      response = await requestApi(false);
    }
    let data = {};
    const type = response.headers.get('content-type') || '';
    if (type.includes('application/json')) {
      data = await response.json();
    }
    if (!response.ok || data.ok === false) {
      const message = response.status === 401
        ? copy.accessExpired
        : data.message || data.error || response.statusText || 'Request failed';
      const error = new Error(message);
      error.status = response.status;
      error.projectErrorCode = typeof data.errorCode === 'string' ? data.errorCode : '';
      throw error;
    }
    return data;
  }

  function applyTheme(theme) {
    if (theme === 'dark' || theme === 'light') {
      document.documentElement.dataset.theme = theme;
    } else {
      delete document.documentElement.dataset.theme;
      theme = 'system';
    }
    writeLocalStorage('orbit.webui.theme', theme);
    document.querySelectorAll('[data-theme-value]').forEach((button) => {
      const active = button.dataset.themeValue === theme;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const meta = document.querySelector('meta[name="theme-color"]');
    const isDark = theme === 'dark' || (theme === 'system' && systemThemeQuery.matches);
    if (meta) meta.content = isDark ? '#151b21' : '#edf1f0';
  }

  function autoSizePrompt() {
    elements.prompt.style.height = 'auto';
    elements.prompt.style.height = Math.min(elements.prompt.scrollHeight, 210) + 'px';
  }

  function syncSidebarInteractivity() {
    const inspectorOpen = elements.inspector.classList.contains('is-open');
    const mobile = mobileSidebarQuery.matches;
    const sidebarOpen = mobile && elements.appShell.classList.contains('sidebar-open');
    const desktopCollapsed = !mobile && elements.appShell.classList.contains('sidebar-collapsed');
    const sidebarHidden = inspectorOpen || desktopCollapsed || (mobile && !sidebarOpen);
    elements.sidebar.inert = sidebarHidden;
    elements.workspaceView.inert = inspectorOpen || sidebarOpen;
    if (sidebarHidden) elements.sidebar.setAttribute('aria-hidden', 'true');
    else elements.sidebar.removeAttribute('aria-hidden');
    elements.menuButton.setAttribute('aria-expanded', String(mobile ? sidebarOpen : !desktopCollapsed));
    elements.menuButton.setAttribute('aria-label', copy.openNavigation);
    elements.sidebarCollapseButton.setAttribute('aria-expanded', String(!desktopCollapsed));
    elements.sidebarCollapseButton.setAttribute('aria-label', copy.collapseNavigation);
  }

  function syncApplicationModalState() {
    const modalOpen = !elements.commandPalette.hidden || !elements.sessionDeleteDialog.hidden || !elements.fullAccessDialog.hidden || !elements.projectDialog.hidden;
    elements.appShell.inert = modalOpen;
  }

  function setDesktopSidebarCollapsed(collapsed) {
    elements.appShell.classList.toggle('sidebar-collapsed', collapsed);
    writeLocalStorage('orbit.webui.sidebar', collapsed ? 'collapsed' : 'expanded');
    syncSidebarInteractivity();
    if (collapsed) elements.menuButton.focus();
  }

  function toggleNavigation() {
    if (mobileSidebarQuery.matches) {
      if (elements.appShell.classList.contains('sidebar-open')) closeSidebar();
      else openSidebar();
      return;
    }
    setDesktopSidebarCollapsed(!elements.appShell.classList.contains('sidebar-collapsed'));
  }

  function closeSidebar() {
    const wasOpen = elements.appShell.classList.contains('sidebar-open');
    elements.appShell.classList.remove('sidebar-open');
    elements.menuButton.setAttribute('aria-expanded', 'false');
    syncSidebarInteractivity();
    if (wasOpen && sidebarReturnFocus && sidebarReturnFocus.isConnected) {
      sidebarReturnFocus.focus();
    }
    sidebarReturnFocus = null;
  }

  function openSidebar() {
    if (!elements.appShell.classList.contains('sidebar-open')) {
      sidebarReturnFocus = document.activeElement;
    }
    elements.appShell.classList.add('sidebar-open');
    elements.menuButton.setAttribute('aria-expanded', 'true');
    syncSidebarInteractivity();
    const firstControl = Array.from(elements.sidebar.querySelectorAll(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )).find((node) => !node.hidden && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden');
    const focusFirstControl = () => {
      if (firstControl) firstControl.focus({ preventScroll: true });
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focusFirstControl);
    else focusFirstControl();
  }

  function setInspector(open, tab) {
    const wasOpen = elements.inspector.classList.contains('is-open');
    if (open && !wasOpen) inspectorReturnFocus = document.activeElement;
    if (open) {
      elements.appShell.classList.remove('sidebar-open');
      elements.menuButton.setAttribute('aria-expanded', 'false');
    }
    elements.inspector.classList.toggle('is-open', open);
    elements.inspectorBackdrop.classList.toggle('is-open', open);
    elements.inspectorBackdrop.hidden = !open;
    elements.inspector.setAttribute('aria-hidden', open ? 'false' : 'true');
    elements.inspector.inert = !open;
    elements.inspectorButton.setAttribute('aria-expanded', open ? 'true' : 'false');
    syncSidebarInteractivity();
    if (open && tab) selectInspectorTab(tab);
    if (open && !wasOpen) {
      elements.inspectorClose.focus();
    } else if (!open && wasOpen) {
      const returnTarget = inspectorReturnFocus && inspectorReturnFocus.isConnected
        ? inspectorReturnFocus
        : elements.inspectorButton;
      inspectorReturnFocus = null;
      returnTarget.focus();
    }
  }

  function trapInspectorFocus(event) {
    if (event.key !== 'Tab' || !elements.inspector.classList.contains('is-open')) return;
    const focusable = Array.from(elements.inspector.querySelectorAll(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    )).filter((node) => !node.hidden && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden');
    if (!focusable.length) {
      event.preventDefault();
      elements.inspector.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function trapSidebarFocus(event) {
    if (event.key !== 'Tab' || !mobileSidebarQuery.matches || !elements.appShell.classList.contains('sidebar-open')) return;
    const focusable = Array.from(elements.sidebar.querySelectorAll(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    )).filter((node) => !node.hidden && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function selectInspectorTab(tab) {
    const tasks = tab === 'tasks';
    const activity = tab === 'activity';
    const changes = tab === 'changes';
    const settings = tab === 'settings';
    elements.tasksTab.classList.toggle('is-active', tasks);
    elements.tasksTab.setAttribute('aria-selected', tasks ? 'true' : 'false');
    elements.tasksTab.tabIndex = tasks ? 0 : -1;
    elements.activityTab.classList.toggle('is-active', activity);
    elements.activityTab.setAttribute('aria-selected', activity ? 'true' : 'false');
    elements.activityTab.tabIndex = activity ? 0 : -1;
    elements.changesTab.classList.toggle('is-active', changes);
    elements.changesTab.setAttribute('aria-selected', changes ? 'true' : 'false');
    elements.changesTab.tabIndex = changes ? 0 : -1;
    elements.settingsTab.classList.toggle('is-active', settings);
    elements.settingsTab.setAttribute('aria-selected', settings ? 'true' : 'false');
    elements.settingsTab.tabIndex = settings ? 0 : -1;
    elements.tasksPanel.hidden = !tasks;
    elements.activityPanel.hidden = !activity;
    elements.changesPanel.hidden = !changes;
    elements.settingsPanel.hidden = !settings;
  }

  function handleInspectorTabKeydown(event) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const tabs = [elements.tasksTab, elements.activityTab, elements.changesTab, elements.settingsTab];
    const current = Math.max(0, tabs.indexOf(event.currentTarget));
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else next = (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    selectInspectorTab(['tasks', 'activity', 'changes', 'settings'][next]);
    tabs[next].focus();
  }

  function nearBottom() {
    const distance = elements.messageScroll.scrollHeight - elements.messageScroll.scrollTop - elements.messageScroll.clientHeight;
    return distance < 110;
  }

  function updateMessageNavigation() {
    const overflow = elements.messageScroll.scrollHeight > elements.messageScroll.clientHeight + 8;
    const awayFromTop = elements.messageScroll.scrollTop > 72;
    const hasEarlierPage = state.earliestMessagePosition > 0;
    elements.jumpEarlier.classList.toggle('is-visible', hasEarlierPage || (overflow && awayFromTop));
    elements.jumpBottom.classList.toggle('is-visible', overflow && !nearBottom());
  }

  function scrollToBottom(force) {
    if (!force && !state.stickToBottom) return;
    elements.messageScroll.scrollTop = elements.messageScroll.scrollHeight;
    updateMessageNavigation();
  }

  function setBusy(busy, label) {
    state.busy = busy;
    elements.appShell.classList.toggle('is-busy', busy);
    if (!busy) state.stopping = false;
    elements.sendButton.classList.toggle('is-stop', busy);
    elements.sendGlyph.textContent = busy ? '■' : '↑';
    elements.sendButton.setAttribute('aria-label', busy ? copy.stopAction : copy.sendAction);
    elements.contextPickerButton.disabled = busy;
    elements.clearContextButton.disabled = busy;
    elements.buildPlanButton.disabled = busy || !state.ready;
    elements.parallelImproveButton.disabled = busy || !state.ready;
    elements.contextFileList.querySelectorAll('button').forEach((button) => { button.disabled = busy; });
    if (busy) closeContextPicker({ skipRestore: true });
    document.querySelectorAll(
      '#modelSelect, #permissionSelect, #searchToggle, #settingsPanel input, #settingsPanel select, #settingsPanel button:not([data-theme-value])',
    ).forEach((control) => { control.disabled = busy; });
    syncSearchSettings(Boolean(state.status && state.status.tools && state.status.tools.webSearch && state.status.tools.webSearch.enabled));
    syncSkillControls(Boolean(
      state.skills
        ? state.skills.enabled
        : state.status && state.status.skills && state.status.skills.enabled
    ));
    syncCustomModelAction();
    elements.turnStatus.classList.toggle('is-working', busy);
    elements.turnStatus.textContent = label || (busy ? copy.thinking : '');
    updateSendButtonState();
    renderPromptQueue();
  }

  function syncCustomModelAction() {
    const pending = state.customModelPending;
    elements.customModel.disabled = state.busy || pending;
    elements.applyModel.disabled = state.busy || pending || !elements.customModel.value.trim();
    elements.applyModel.setAttribute('aria-busy', pending ? 'true' : 'false');
    if (pending) elements.applyModel.setAttribute('aria-label', copy.settingsSaving);
    else elements.applyModel.removeAttribute('aria-label');
  }

  function updateSendButtonState() {
    const hasPrompt = Boolean(elements.prompt.value.trim());
    elements.buildPlanButton.disabled = state.busy || !state.ready;
    elements.parallelImproveButton.disabled = state.busy || !state.ready;
    elements.queueButton.hidden = !state.busy;
    elements.queueButton.disabled = !hasPrompt || state.stopping;
    elements.sendButton.disabled = state.busy
      ? state.stopping
      : !state.ready || !hasPrompt;
  }

  function setEmptyState() {
    const hasMessages = elements.messages.childElementCount > 0;
    elements.emptyState.hidden = hasMessages;
    elements.conversation.classList.toggle('has-messages', hasMessages);
    const target = hasMessages ? elements.composerAnchor : elements.emptyComposerSlot;
    if (hasMessages) {
      if (elements.composerDock.nextElementSibling !== elements.composerAnchor) {
        elements.composerAnchor.before(elements.composerDock);
      }
    } else if (elements.composerDock.parentElement !== target) {
      target.append(elements.composerDock);
    }
  }

  function formatTime(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(language === 'zh-TW' ? 'zh-TW' : language !== 'en' ? 'zh-CN' : 'en', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

`;
