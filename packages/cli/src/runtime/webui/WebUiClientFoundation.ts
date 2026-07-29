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
        projectOpened: '正在切换到所选工程',
        projectSwitchFailed: '新工程已启动，但无法安全切换页面',
        projectRemoved: '项目已从 Orbit 移除，磁盘文件未删除',
        removeProject: '从 Orbit 移除项目',
        confirmRemoveProject: '再次点击确认移除',
        projectPathRequired: '请输入完整的项目文件夹路径',
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
        noCheckpoints: '暂无可恢复检查点。',
        noVerification: '暂无验证结果。',
        noAgents: '当前工作区还没有委派智能体。',
        abortAgent: '终止智能体',
        agentAborted: '已发送智能体终止请求',
        queued: '已加入待发送队列',
        queueMessage: '加入队列',
        removeQueued: '移除待发送消息',
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
        modeAuto: '自动',
        modePlan: '规划',
      }
    : {
        connected: 'Connected',
        reconnecting: 'Reconnecting',
        disconnected: 'Disconnected',
        retry: 'Retry now',
        ready: 'Ready',
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
        projectOpened: 'Switching to the selected project',
        projectSwitchFailed: 'The project started, but Orbit could not switch safely',
        projectRemoved: 'Project removed from Orbit; files were not deleted',
        removeProject: 'Remove project from Orbit',
        confirmRemoveProject: 'Click again to confirm removal',
        projectPathRequired: 'Enter the full project folder path',
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
        noCheckpoints: 'No restorable checkpoints.',
        noVerification: 'No verification results.',
        noAgents: 'No delegated agents for this workspace.',
        abortAgent: 'Abort agent',
        agentAborted: 'Agent abort requested',
        queued: 'Added to follow-up queue',
        queueMessage: 'Queue message',
        removeQueued: 'Remove queued message',
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
        modeAuto: 'Auto',
        modePlan: 'Plan',
      };

  if (language === 'zh-TW') {
    Object.assign(copy, {
      connected: '已連線',
      reconnecting: '正在重新連線',
      disconnected: '連線中斷',
      retry: '立即重試',
      ready: '準備就緒',
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
      projectOpened: '正在切換到所選專案',
      projectRemoved: '專案已從 Orbit 移除，磁碟檔案未刪除',
      removeProject: '從 Orbit 移除專案',
      archiveSession: '封存',
      restoreSession: '復原',
      deleteSession: '刪除',
      openActivity: '開啟任務活動',
      openChanges: '開啟變更檢視',
      openSettings: '開啟設定',
      restoreFile: '復原檔案',
      traceExported: '診斷包已匯出',
      noChanges: '目前對話尚未有檔案變更。',
      queued: '已加入待傳送佇列',
      queueMessage: '加入佇列',
      removeQueued: '移除待傳送訊息',
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
    projectDialogOpen: byId('projectDialogOpen'),
    projectDialogCreate: byId('projectDialogCreate'),
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
    customModel: byId('customModel'),
    permissionSelect: byId('permissionSelect'),
    permissionSegments: byId('permissionSegments'),
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
    projectDialogReturnFocus: null,
    promptQueue: [],
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
    const bootstrapToken = tokenFromHash || savedToken;
    if (!bootstrapToken) return;
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
    }
  }

  async function recoverSessionCookie() {
    if (sessionRecoveryPromise) return sessionRecoveryPromise;
    sessionRecoveryPromise = (async () => {
      const response = await fetch(location.pathname || '/', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'text/html' },
      });
      await response.body?.cancel().catch(() => {});
      if (!response.ok) return false;
      try { sessionStorage.removeItem(webSessionTokenKey); } catch {}
      webSessionToken = '';
      state.useBearerTransport = false;
      return true;
    })().finally(() => {
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
    if (response.status === 401 && await recoverSessionCookie()) {
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
    const firstControl = elements.sidebar.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (firstControl) firstControl.focus();
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
    )).filter((node) => !node.hidden && node.offsetParent !== null);
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
    elements.turnStatus.classList.toggle('is-working', busy);
    elements.turnStatus.textContent = label || (busy ? copy.thinking : '');
    updateSendButtonState();
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
