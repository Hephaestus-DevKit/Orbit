import { BUILTIN_SLASH_COMMANDS } from "../SlashCommandCatalog.js";

const WEB_UI_CONTROL_COMMANDS = JSON.stringify(BUILTIN_SLASH_COMMANDS);

/** Runtime status, settings mutations, turn lifecycle, and server-sent events. */
export const WEB_UI_CLIENT_SESSION_SCRIPT = String.raw`  const controlCommands = ${WEB_UI_CONTROL_COMMANDS};

  function formatPermissionMode(value) {
    return {
      strict: copy.modeStrict,
      normal: copy.modeNormal,
      auto: copy.modeAuto,
      plan: copy.modePlan,
    }[value] || value;
  }

  function fillRuntime(data) {
    const context = data.context || {};
    const metric = (value) => Number(value || 0).toLocaleString();
    const contextUsage = context.maxContextTokens
      ? metric(context.estimatedHistoryTokens) + ' / ' + metric(context.maxContextTokens)
      : '—';
    const rows = [
      [copy.models, (data.modelRouting === 'auto' ? 'Auto · ' : '') + (data.activeModel || '—')],
      [copy.mode, formatPermissionMode(data.permissions && data.permissions.mode || '') || '—'],
      ...(data.session && data.session.goal ? [[copy.goal, data.session.goal]] : []),
      [language !== 'en' ? chinese('项目记忆', '專案記憶') : 'Project memory', String(data.memory && data.memory.count || 0) + (data.memory && data.memory.enabled === false ? (language !== 'en' ? chinese(' · 已暂停', ' · 已暫停') : ' · paused') : '')],
      [language !== 'en' ? chinese('任务计划', '任務計畫') : 'Task plan', String(data.plan && data.plan.completed || 0) + ' / ' + String(data.plan && data.plan.count || 0)],
      [copy.messages, metric(data.session && data.session.historyMessages)],
      [copy.tokens, metric(data.session && data.session.inputTokens) + ' / ' + metric(data.session && data.session.outputTokens)],
      [copy.contextWindow, contextUsage],
      [copy.cache, metric(data.session && data.session.cacheReadTokens)],
      [copy.cost, '$' + Number(data.session && data.session.cost || 0).toFixed(4)],
    ];
    const metrics = data.session && data.session.metrics;
    if (metrics) {
      rows.push([
        language !== 'en' ? chinese('工具可靠性', '工具可靠性') : 'Tool reliability',
        String(metrics.toolRuns - metrics.toolFailures) + ' / ' + String(metrics.toolRuns),
      ]);
      rows.push([
        language !== 'en' ? chinese('文件修改 / 压缩', '檔案變更 / 壓縮') : 'File changes / compactions',
        String(metrics.filesChanged) + ' / ' + String(metrics.compactions),
      ]);
      rows.push([
        language !== 'en' ? chinese('路由（快速 / 质量）', '路由（快速 / 品質）') : 'Routes (fast / quality)',
        String(Number(metrics.fastRoutes || 0)) + ' / ' + String(Number(metrics.qualityRoutes || 0)),
      ]);
    }
    elements.runtime.replaceChildren();
    for (const row of rows) {
      const wrapper = document.createElement('div');
      wrapper.className = 'runtime-item';
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = row[0];
      dd.textContent = String(row[1]);
      dd.title = String(row[1]);
      wrapper.append(dt, dd);
      elements.runtime.append(wrapper);
    }
    const compactAt = Number(context.compactAtTokens || 0);
    const estimated = Number(context.estimatedHistoryTokens || 0);
    const usagePercent = compactAt > 0 ? Math.max(0, (estimated / compactAt) * 100) : 0;
    const ringPercent = Math.min(100, usagePercent);
    elements.contextMeter.style.setProperty('--context-pct', ringPercent + '%');
    elements.contextPercent.textContent = Math.round(usagePercent) + '%';
    elements.contextMeter.classList.toggle('is-warm', usagePercent >= 72 && usagePercent < 90);
    elements.contextMeter.classList.toggle('is-hot', usagePercent >= 90);
    const meterLimit = compactAt || Number(context.maxContextTokens || 0);
    const meterDetail = estimated.toLocaleString() + ' / ' + meterLimit.toLocaleString() + ' tokens';
    elements.contextMeter.title = meterDetail;
    elements.contextMeter.setAttribute('aria-label', copy.contextWindow + ': ' + meterDetail);
    renderWorkspaceState(data);
    renderTaskOverview(data);
    renderAgentRuns(data.agentRuns);
    renderChangeReview(data.review || {});
    renderToolHistory(data.review || {});
  }

  function renderTaskOverview(data) {
    const session = data.session || {};
    const plan = data.plan || {};
    const runs = Array.isArray(data.agentRuns) ? data.agentRuns : [];
    const agents = runs.flatMap((run) => Array.isArray(run.agents) ? run.agents : []);
    const activeAgents = agents.filter((agent) => agent.status === 'running').length;
    const activeSession = (Array.isArray(session.recent) ? session.recent : [])
      .find((candidate) => candidate.active);
    const active = Boolean(data.turn && data.turn.active);
    const workActive = active || activeAgents > 0;
    const statusLabel = workActive
      ? copy.running
      : agents.some((agent) => agent.status === 'blocked')
        ? (language === 'en' ? 'Blocked' : chinese('已阻塞', '已阻塞'))
        : copy.ready;
    const titleText = activeSession && activeSession.title
      ? activeSession.title
      : copy.untitledTask;
    const goalText = session.goal || (language === 'en'
      ? 'Add a durable goal with /goal so Orbit can keep long work aligned.'
      : chinese(
          '使用 /goal 添加持续目标，让 Orbit 在长任务中保持方向。',
          '使用 /goal 加入持續目標，讓 Orbit 在長任務中保持方向。',
        ));
    const progress = Number(plan.count || 0) > 0
      ? Math.round((Number(plan.completed || 0) / Number(plan.count)) * 100)
      : 0;

    const card = document.createElement('article');
    card.className = 'task-overview-card' + (workActive ? ' is-running' : '');
    const heading = document.createElement('div');
    heading.className = 'task-overview-title';
    const title = document.createElement('strong');
    title.textContent = titleText;
    title.title = titleText;
    const status = document.createElement('span');
    status.className = 'task-overview-status';
    status.textContent = statusLabel;
    heading.append(title, status);
    const goal = document.createElement('p');
    goal.textContent = goalText;
    const stats = document.createElement('dl');
    stats.className = 'task-overview-stats';
    const rows = [
      [language === 'en' ? 'Plan' : chinese('计划', '計畫'), Number(plan.completed || 0) + ' / ' + Number(plan.count || 0), progress + '%'],
      [language === 'en' ? 'Agents' : chinese('智能体', '智慧體'), activeAgents + ' / ' + agents.length, activeAgents ? copy.running : copy.ready],
      [copy.cost, '$' + Number(session.cost || 0).toFixed(4), data.activeModel || '—'],
    ];
    for (const [label, value, detail] of rows) {
      const item = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      const small = document.createElement('small');
      dt.textContent = label;
      dd.textContent = value;
      small.textContent = detail;
      item.append(dt, dd, small);
      stats.append(item);
    }
    card.append(heading, goal, stats);
    elements.taskOverview.replaceChildren(card);
  }

  function renderAgentRuns(value) {
    const runs = Array.isArray(value) ? value : [];
    const agents = runs.flatMap((run) =>
      (Array.isArray(run.agents) ? run.agents : []).map((agent) => ({
        ...agent,
        runStatus: run.status,
      })),
    );
    elements.agentRunCount.textContent = String(agents.length);
    elements.agentRunList.replaceChildren();
    if (!agents.length) {
      const empty = document.createElement('p');
      empty.className = 'review-empty';
      empty.textContent = copy.noAgents;
      elements.agentRunList.append(empty);
      return;
    }
    for (const agent of agents.slice(0, 24)) {
      const card = document.createElement('article');
      card.className = 'agent-card is-' + String(agent.status || 'pending');
      const heading = document.createElement('div');
      heading.className = 'agent-card-heading';
      const title = document.createElement('strong');
      title.textContent = agent.role || 'agent';
      const status = document.createElement('span');
      status.className = 'agent-status';
      status.textContent = agent.status || 'pending';
      heading.append(title, status);
      const task = document.createElement('p');
      task.textContent = agent.task || '';
      task.title = agent.task || '';
      const meta = document.createElement('div');
      meta.className = 'agent-meta';
      meta.textContent = [
        agent.model,
        agent.access,
        '$' + Number(agent.costUsd || 0).toFixed(4) + ' / $' + Number(agent.budgetUsd || 0).toFixed(2),
      ].filter(Boolean).join(' · ');
      card.append(heading, task, meta);
      if (agent.status === 'running') {
        const abort = document.createElement('button');
        abort.type = 'button';
        abort.className = 'agent-abort';
        abort.dataset.agentAbort = agent.id;
        abort.textContent = copy.abortAgent;
        abort.setAttribute('aria-label', copy.abortAgent + ': ' + (agent.role || 'agent'));
        card.append(abort);
      }
      elements.agentRunList.append(card);
    }
  }

  function renderToolHistory(review) {
    const tools = Array.isArray(review.toolCalls) ? review.toolCalls : [];
    elements.toolHistoryCount.textContent = String(tools.length);
    elements.toolHistory.replaceChildren();
    if (!tools.length) {
      const empty = document.createElement('p');
      empty.className = 'review-empty';
      empty.textContent = copy.noActivity;
      elements.toolHistory.append(empty);
      return;
    }
    for (const tool of tools) {
      const row = document.createElement('div');
      row.className = 'tool-history-row is-' + tool.status;
      const stateMark = document.createElement('span');
      stateMark.className = 'tool-history-mark';
      stateMark.textContent = tool.status === 'success' ? '✓' : tool.status === 'denied' ? '−' : tool.status === 'pending' ? '●' : '×';
      const content = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = tool.name || 'tool';
      const meta = document.createElement('small');
      const timing = Number.isFinite(tool.durationMs) ? (tool.durationMs < 1000 ? tool.durationMs + ' ms' : (tool.durationMs / 1000).toFixed(1) + ' s') : '—';
      meta.textContent = [tool.status, tool.risk, tool.decision, timing].filter(Boolean).join(' · ');
      content.append(title, meta);
      const time = document.createElement('time');
      time.textContent = relativeSessionTime(tool.startedAt);
      row.append(stateMark, content, time);
      elements.toolHistory.append(row);
    }
  }

  function renderWorkspaceState(data) {
    const plan = data.plan || {};
    const memory = data.memory || {};
    const render = (container, items, emptyText, kind) => {
      container.replaceChildren();
      if (!items.length) {
        const empty = document.createElement('p');
        empty.className = 'review-empty';
        empty.textContent = emptyText;
        container.append(empty);
        return;
      }
      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'review-row' + (item.status ? ' is-' + item.status : '');
        const marker = document.createElement('span');
        marker.className = 'review-marker';
        marker.textContent = item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '●' : '○';
        const text = document.createElement('span');
        text.className = 'review-text';
        text.textContent = item.text || '';
        text.title = item.text || '';
        row.append(marker, text);
        if (kind === 'memory') {
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'review-action';
          remove.dataset.memoryRemove = item.id;
          remove.textContent = '×';
          remove.title = language !== 'en' ? chinese('删除记忆', '刪除記憶') : 'Remove memory';
          remove.setAttribute('aria-label', remove.title);
          row.append(remove);
        }
        container.append(row);
      }
    };
    const planItems = Array.isArray(plan.items) ? plan.items : [];
    const memoryItems = Array.isArray(memory.entries) ? memory.entries : [];
    elements.planCount.textContent = String(planItems.length);
    elements.memoryCount.textContent = String(memoryItems.length) + (memory.enabled === false ? (language !== 'en' ? chinese(' · 已暂停', ' · 已暫停') : ' · paused') : '');
    render(elements.planReview, planItems, language !== 'en' ? chinese('当前对话暂无计划步骤。', '目前對話尚無計畫步驟。') : 'No plan steps for this chat.', 'plan');
    render(elements.memoryReview, memoryItems, language !== 'en' ? chinese('暂无显式项目记忆。', '尚無明確的專案記憶。') : 'No explicit project memory.', 'memory');
  }

  function renderChangeReview(review) {
    state.changeReview = review;
    const rawChanges = Array.isArray(review.fileChanges) ? review.fileChanges : [];
    const latestByPath = new Map();
    for (const change of rawChanges) {
      if (change && change.path && !latestByPath.has(change.path)) latestByPath.set(change.path, change);
    }
    const allChanges = Array.from(latestByPath.values());
    const query = state.changeQuery.trim().toLowerCase();
    const changes = query
      ? allChanges.filter((change) => String(change.path || '').toLowerCase().includes(query))
      : allChanges;
    elements.changeCount.textContent = query
      ? String(changes.length) + '/' + String(allChanges.length)
      : String(allChanges.length);
    elements.changesList.replaceChildren();
    if (!changes.length) {
      const empty = document.createElement('p');
      empty.className = 'review-empty';
      empty.textContent = copy.noChanges;
      elements.changesList.append(empty);
    } else {
      for (const change of changes) {
        const card = document.createElement('details');
        card.className = 'change-card';
        const summary = document.createElement('summary');
        const path = document.createElement('strong');
        path.textContent = change.path;
        path.title = change.path;
        const time = document.createElement('span');
        time.textContent = relativeSessionTime(change.createdAt);
        summary.append(path, time);
        const diff = document.createElement('pre');
        diff.className = 'change-diff';
        for (const line of String(change.diff || '').split('\n')) {
          const row = document.createElement('span');
          row.className = 'change-diff-line';
          if (line.startsWith('+') && !line.startsWith('+++')) row.classList.add('is-added');
          else if (line.startsWith('-') && !line.startsWith('---')) row.classList.add('is-deleted');
          else if (line.startsWith('@@')) row.classList.add('is-hunk');
          row.textContent = line || ' ';
          diff.append(row);
        }
        const actions = document.createElement('div');
        actions.className = 'change-actions';
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.className = 'secondary-button change-restore';
        restore.dataset.rollbackFile = change.path;
        restore.textContent = copy.restoreFile;
        const copyDiff = document.createElement('button');
        copyDiff.type = 'button';
        copyDiff.className = 'secondary-button change-copy';
        copyDiff.textContent = copy.copyDiff;
        copyDiff.addEventListener('click', async () => {
          await navigator.clipboard.writeText(change.diff || '');
          showToast(copy.diffCopied, 'success');
        });
        actions.append(copyDiff, restore);
        card.append(summary, diff, actions);
        elements.changesList.append(card);
      }
    }

    const checkpoints = Array.isArray(review.checkpoints) ? review.checkpoints : [];
    elements.checkpointCount.textContent = String(checkpoints.length);
    elements.checkpointList.replaceChildren();
    if (!checkpoints.length) {
      const empty = document.createElement('p');
      empty.className = 'review-empty';
      empty.textContent = copy.noCheckpoints;
      elements.checkpointList.append(empty);
    } else {
      for (const checkpoint of checkpoints) {
        const row = document.createElement('div');
        row.className = 'checkpoint-row';
        const content = document.createElement('span');
        const title = document.createElement('strong');
        title.textContent = checkpoint.files && checkpoint.files.length
          ? checkpoint.files.slice(0, 2).join(', ')
          : checkpoint.id.slice(0, 12);
        title.title = (checkpoint.files || []).join(', ');
        const meta = document.createElement('small');
        meta.textContent = relativeSessionTime(checkpoint.timestamp) + ' · ' + checkpoint.id.slice(0, 12);
        content.append(title, meta);
        const rewind = document.createElement('button');
        rewind.type = 'button';
        rewind.className = 'secondary-button checkpoint-rewind';
        rewind.dataset.rewindCheckpoint = checkpoint.id;
        rewind.textContent = copy.rewindCheckpoint;
        row.append(content, rewind);
        elements.checkpointList.append(row);
      }
    }

    const verification = Array.isArray(review.verification) ? review.verification : [];
    elements.verificationCount.textContent = String(verification.length);
    elements.verificationList.replaceChildren();
    if (!verification.length) {
      const empty = document.createElement('p');
      empty.className = 'review-empty';
      empty.textContent = copy.noVerification;
      elements.verificationList.append(empty);
    } else {
      for (const result of verification) {
        const row = document.createElement('div');
        row.className = 'verification-row ' + (result.success ? 'is-success' : 'is-error');
        const marker = document.createElement('span');
        marker.textContent = result.success ? '✓' : '×';
        const content = document.createElement('span');
        const title = document.createElement('strong');
        title.textContent = result.success
          ? (language !== 'en' ? chinese('验证通过', '驗證通過') : 'Verification passed')
          : (language !== 'en' ? chinese('验证失败', '驗證失敗') : 'Verification failed');
        const detail = document.createElement('small');
        detail.textContent = result.detail || relativeSessionTime(result.timestamp);
        content.append(title, detail);
        row.append(marker, content);
        elements.verificationList.append(row);
      }
    }
  }

  async function applyReviewAction(action, button) {
    if (state.busy || button.disabled) return;
    if (button.dataset.confirmReview !== 'true') {
      button.dataset.confirmReview = 'true';
      button.textContent = copy.restoreConfirm;
      window.setTimeout(() => {
        if (button.isConnected) {
          delete button.dataset.confirmReview;
          button.textContent = action.action === 'rewind' ? copy.rewindCheckpoint : copy.restoreFile;
        }
      }, 3500);
      return;
    }
    button.disabled = true;
    const controlId = 'review-' + String(
      action.action === 'rewind' ? action.checkpointId : action.path,
    ).replace(/[^a-zA-Z0-9_-]/g, '-');
    const controlPrompt = action.action === 'rewind'
      ? '/rewind ' + action.checkpointId
      : '/rollback ' + action.path;
    upsertControlTurn(controlId, controlPrompt, 'running', false);
    try {
      const result = await api('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      });
      upsertControlTurn(controlId, controlPrompt, 'completed', false);
      showToast(result.message || copy.restored, 'success');
      await Promise.all([renderMessages(), loadStatus()]);
    } catch (error) {
      upsertControlTurn(controlId, controlPrompt, 'failed', false);
      showToast(error.message || String(error), 'error');
    } finally {
      button.disabled = false;
      delete button.dataset.confirmReview;
    }
  }

  async function exportDiagnostics() {
    elements.exportTraceButton.disabled = true;
    try {
      const trace = await api('/api/trace?history=1');
      const blob = new Blob([JSON.stringify(trace, null, 2) + '\n'], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'orbit-diagnostics-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast(copy.traceExported, 'success');
    } catch (error) {
      showToast(error.message || String(error), 'error');
    } finally {
      elements.exportTraceButton.disabled = false;
    }
  }

  function workspaceName(path) {
    const parts = String(path || '').replace(/\\/g, '/').split('/').filter(Boolean);
    return parts[parts.length - 1] || 'Orbit';
  }

  function syncProviderOptions(data) {
    const provider = data.provider || {};
    const current = provider.id || '';
    elements.providerSelect.replaceChildren();
    for (const option of provider.options || []) {
      const node = document.createElement('option');
      node.value = option.id;
      node.textContent = option.label + (option.modelCount ? ' · ' + option.modelCount : '');
      node.title = option.baseUrl || option.id;
      elements.providerSelect.append(node);
    }
    elements.providerSelect.value = current;
    syncSelectControl(elements.providerSelect);
  }

  function syncModelOptions(data) {
    const current = data.modelSelection || data.activeModel || '';
    elements.modelSelect.replaceChildren();
    for (const option of data.modelOptions || []) {
      const node = document.createElement('option');
      node.value = option.id;
      node.textContent = option.label;
      elements.modelSelect.append(node);
    }
    if (![...elements.modelSelect.options].some((option) => option.value === current)) {
      const custom = document.createElement('option');
      custom.value = current;
      custom.textContent = current || 'custom';
      elements.modelSelect.prepend(custom);
    }
    elements.modelSelect.value = current;
    syncSelectControl(elements.modelSelect);
  }

  function relativeSessionTime(value) {
    const timestamp = Date.parse(value || '');
    if (!Number.isFinite(timestamp)) return '';
    const delta = Math.max(0, Date.now() - timestamp);
    const minutes = Math.floor(delta / 60000);
    if (minutes < 1) return language !== 'en' ? chinese('刚刚', '剛剛') : 'now';
    if (minutes < 60) return language !== 'en' ? minutes + chinese(' 分钟', ' 分鐘') : minutes + 'm';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return language !== 'en' ? hours + chinese(' 小时', ' 小時') : hours + 'h';
    const days = Math.floor(hours / 24);
    return language !== 'en' ? days + ' 天' : days + 'd';
  }

  function appendSessionActionIcon(button, action) {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');
    svg.setAttribute('class', 'ui-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(namespace, 'path');
    path.setAttribute('d', {
      archive: 'M5.5 8.5h13v10h-13zM4.5 5h15v3.5h-15zM9.5 12h5',
      restore: 'M8 8H4V4M4.5 8a8 8 0 1 1-.2 7',
      delete: 'M8 7v11M12 7v11M16 7v11M5 5h14M9 5V3h6v2M6.5 5l1 16h9l1-16',
    }[action] || 'M6 12h12');
    svg.append(path);
    button.append(svg);
  }

  function renderSessionNavigation(sessionData) {
    state.sessionData = sessionData || {};
    const sessions = Array.isArray(sessionData && sessionData.recent)
      ? sessionData.recent
      : [];
    const archivedSessions = Array.isArray(sessionData && sessionData.archived)
      ? sessionData.archived
      : [];
    const active = sessions.find((session) => session.active);
    const activeTitle = active && active.title || copy.untitledTask;
    byId('workspaceName').textContent = activeTitle;
    byId('workspaceName').title = activeTitle;
    const query = state.sessionQuery.trim().toLocaleLowerCase();
    const matchingSessions = query
      ? sessions.filter((session) => [session.title, session.model]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase().includes(query)))
      : sessions;
    const visibleSessions = matchingSessions.slice(0, state.sessionLimit);
    const renderList = (container, items, archived) => {
      container.replaceChildren();
      for (const session of items) {
        const isActive = Boolean(session.active);
        const row = document.createElement('div');
        row.className = 'session-row'
          + (archived ? ' is-archived' : '')
          + (isActive ? ' is-active' : '');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'recent-session';
        button.dataset.sessionId = session.id;
        button.setAttribute('aria-label', copy.recentSession + ': ' + (session.title || copy.untitledTask));
        if (isActive) button.setAttribute('aria-current', 'page');
        const title = document.createElement('span');
        title.className = 'recent-session-title';
        title.textContent = session.title || copy.untitledTask;
        const meta = document.createElement('span');
        meta.className = 'recent-session-meta';
        meta.textContent = [relativeSessionTime(session.updatedAt), session.model].filter(Boolean).join(' · ');
        button.append(title, meta);
        row.append(button);
        if (!isActive) {
          const actions = document.createElement('span');
          actions.className = 'session-actions';
          const secondaryAction = document.createElement('button');
          secondaryAction.type = 'button';
          secondaryAction.className = 'session-action';
          secondaryAction.dataset.sessionAction = archived ? 'restore' : 'archive';
          secondaryAction.dataset.sessionId = session.id;
          appendSessionActionIcon(secondaryAction, archived ? 'restore' : 'archive');
          secondaryAction.title = archived ? copy.restoreSession : copy.archiveSession;
          secondaryAction.setAttribute('aria-label', secondaryAction.title);
          const deleteAction = document.createElement('button');
          deleteAction.type = 'button';
          deleteAction.className = 'session-action is-danger';
          deleteAction.dataset.sessionAction = 'delete';
          deleteAction.dataset.sessionId = session.id;
          appendSessionActionIcon(deleteAction, 'delete');
          deleteAction.title = copy.deleteSession;
          deleteAction.setAttribute('aria-label', copy.deleteSession);
          actions.append(secondaryAction, deleteAction);
          row.append(actions);
        }
        container.append(row);
      }
    };
    renderList(elements.recentSessions, visibleSessions, false);
    renderList(elements.archivedSessions, archivedSessions, true);
    elements.sessionSearchField.hidden = sessions.length < 12;
    elements.sessionShowMore.hidden = visibleSessions.length >= matchingSessions.length;
    elements.recentEmpty.textContent = query ? copy.noMatchingChats : copy.noRecentTasks;
    elements.recentEmpty.hidden = matchingSessions.length > 0;
    elements.archivedEmpty.hidden = elements.archivedSessions.childElementCount > 0;
    elements.archiveCount.textContent = String(archivedSessions.length);
    elements.archiveToggle.classList.toggle('has-items', archivedSessions.length > 0);
    const sessionCount = Number(sessionData && sessionData.count || sessions.length + archivedSessions.length);
    elements.projectChatCount.textContent = String(sessionCount);
    elements.projectChatCount.setAttribute('aria-label', String(sessionCount));
  }

  function renderProjectNavigation(projects, currentWorkspace) {
    elements.projectList.replaceChildren();
    const normalizePath = (value) => String(value || '').replace(/\\/g, '/').toLocaleLowerCase();
    const current = normalizePath(currentWorkspace);
    const recentProjects = (Array.isArray(projects) ? projects : [])
      .filter((item) => item.available === true && normalizePath(item.path) !== current)
      .slice(0, 6);
    for (const project of recentProjects) {
      const row = document.createElement('div');
      row.className = 'registered-project';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'registered-project-open';
      button.dataset.projectPath = project.path || '';
      button.setAttribute('aria-label', (language !== 'en' ? chinese('打开项目：', '開啟專案：') : 'Open project: ') + (project.name || 'Orbit'));
      const icon = document.createElement('span');
      icon.className = 'registered-project-icon project-folder-icon';
      icon.innerHTML = '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v10h-17z"/></svg>';
      const copyNode = document.createElement('span');
      copyNode.className = 'project-copy';
      const name = document.createElement('strong');
      name.textContent = project.name || workspaceName(project.path);
      const path = document.createElement('small');
      path.textContent = project.path || '';
      copyNode.append(name, path);
      button.append(icon, copyNode);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'registered-project-remove';
      remove.dataset.projectAction = 'remove';
      remove.dataset.projectId = project.id || '';
      remove.title = copy.removeProject;
      remove.setAttribute('aria-label', copy.removeProject + ': ' + (project.name || 'Orbit'));
      remove.textContent = '×';
      row.append(button, remove);
      elements.projectList.append(row);
    }
    elements.recentProjectsShell.hidden = elements.projectList.childElementCount === 0;
  }

  async function updateSession(action) {
    if (state.busy) return;
    state.busy = true;
    elements.newTaskButton.disabled = true;
    elements.recentSessions.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    elements.archivedSessions.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try {
      await api('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      });
      const navigates = action.action === 'new' || action.action === 'resume';
      if (navigates) {
        clearActivity();
        state.controlTurns.clear();
        await Promise.all([
          renderMessages({ forceBottom: true, resetHistory: true }),
          loadStatus(),
        ]);
      } else {
        await loadStatus();
      }
      const notice = {
        new: copy.sessionCreated,
        resume: copy.sessionSwitched,
        archive: copy.sessionArchived,
        restore: copy.sessionRestored,
        delete: copy.sessionDeleted,
      }[action.action] || copy.sessionSwitched;
      showToast(notice, 'success');
      if (navigates) {
        closeSidebar();
        elements.prompt.focus();
      }
    } catch (error) {
      showToast(error.message || String(error), 'error');
    } finally {
      state.busy = false;
      elements.newTaskButton.disabled = false;
      elements.recentSessions.querySelectorAll('button').forEach((button) => { button.disabled = false; });
      elements.archivedSessions.querySelectorAll('button').forEach((button) => { button.disabled = false; });
    }
  }

  async function loadStatus() {
    const data = await api('/api/status');
    state.status = data;
    const recovery = data.session && data.session.recovery;
    if (recovery) {
      const recoveryKey = recovery.sessionId + ':' + recovery.recoveryCount;
      if (state.lastRecoveryKey !== recoveryKey) {
        state.lastRecoveryKey = recoveryKey;
        const details = [];
        if (recovery.repairedToolCalls) details.push(String(recovery.repairedToolCalls) + (language !== 'en' ? chinese(' 个工具调用已封口', ' 個工具呼叫已封口') : ' tool call(s) sealed'));
        if (recovery.resetPlanItems) details.push(String(recovery.resetPlanItems) + (language !== 'en' ? chinese(' 个计划项已退回待办', ' 個計畫項目已退回待辦') : ' plan item(s) returned to pending'));
        upsertControlTurn(
          'recovery-' + recoveryKey.replace(/[^a-zA-Z0-9_-]/g, '-'),
          copy.sessionRecovered,
          'completed',
          false,
        );
        showToast(copy.sessionRecovered + (details.length ? ' · ' + details.join(' · ') : ''), 'warning');
      }
    }
    const name = workspaceName(data.workspace);
    byId('workspaceName').textContent = name;
    byId('workspacePath').textContent = data.workspace || '';
    byId('sidebarWorkspace').textContent = name;
    byId('sidebarWorkspace').title = data.workspace || '';
    byId('sidebarSession').textContent = data.workspace || 'local';
    byId('sidebarSession').title = data.workspace || '';
    renderProjectNavigation(data.projects || [], data.workspace);
    renderSessionNavigation(data.session || {});
    elements.runtimeUpdated.textContent = formatTime(data.updatedAt);
    fillRuntime(data);
    syncProviderOptions(data);
    syncModelOptions(data);
    const contextCount = Number(data.context && data.context.relevantFiles || 0);
    elements.contextChipCount.textContent = String(contextCount);
    elements.contextChipCount.hidden = contextCount === 0;
    elements.contextChipCount.setAttribute('aria-label', String(contextCount));
    elements.contextPickerButton.setAttribute(
      'aria-label',
      copy.context + (contextCount ? ' · ' + contextCount : ''),
    );
    renderContextShelf(data.context || {});
    renderPendingApproval(data.approval);

    const activeLanguage = data.language || language;
    elements.languageOptions.querySelectorAll('[data-language-value]').forEach((button) => {
      const active = button.dataset.languageValue === activeLanguage;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const mode = data.permissions && data.permissions.mode || 'normal';
    elements.permissionSelect.value = mode;
    syncSelectControl(elements.permissionSelect);
    elements.permissionSegments.querySelectorAll('[data-mode]').forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const webSearch = data.tools && data.tools.webSearch || {};
    elements.searchProvider.value = webSearch.provider || 'auto';
    syncSelectControl(elements.searchProvider);
    elements.searchMax.value = webSearch.maxResults || 8;
    syncSearchSettings(Boolean(webSearch.enabled));
    const skills = data.skills || {};
    elements.skillsEnabled.checked = Boolean(skills.enabled);
    elements.skillsMaxActive.value = String(skills.maxActive == null ? 3 : skills.maxActive);
    elements.skillActivationSegments.querySelectorAll('[data-skill-activation]').forEach((button) => {
      const active = button.dataset.skillActivation === (skills.activation || 'auto');
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    syncSkillControls(Boolean(skills.enabled));
    if (!state.skills) await loadSkills();
    elements.cache.textContent = data.cacheDiagnostics || '—';
    const hitTokens = data.session && data.session.cacheReadTokens || 0;
    elements.cacheSummary.textContent = hitTokens ? String(hitTokens) + ' tokens' : '—';

    if (data.turn && data.turn.active) {
      state.activeTurnId = data.turn.id;
      setBusy(true, copy.working);
      ensureStreamingTurn(data.turn.id);
    } else if (state.busy && !state.submitting) {
      if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
      flushStream();
      state.activeTurnId = null;
      setBusy(false, '');
      await renderMessages();
    }
    return data;
  }

  function syncSearchSettings(enabled) {
    elements.searchEnabled.checked = enabled;
    elements.searchToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    const disabled = !enabled || state.busy;
    elements.searchDependencies.classList.toggle('is-disabled', !enabled);
    elements.searchDependencies.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    elements.searchProvider.disabled = disabled;
    syncSelectControl(elements.searchProvider);
    elements.searchMax.disabled = disabled;
  }

  function syncSkillControls(enabled) {
    elements.skillControls.classList.toggle('is-disabled', !enabled);
    elements.skillControls.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    elements.skillsMaxActive.disabled = !enabled || state.busy;
    elements.skillActivationSegments.querySelectorAll('button').forEach((button) => {
      button.disabled = !enabled || state.busy;
    });
    elements.skillList.querySelectorAll('input').forEach((input) => {
      input.disabled = !enabled || state.busy;
    });
    elements.skillList.querySelectorAll('.skill-use').forEach((button) => {
      button.disabled =
        !enabled || state.busy || button.dataset.skillDisabled === 'true';
    });
  }

  function renderSkills(data) {
    state.skills = data;
    const skills = Array.isArray(data.skills) ? data.skills : [];
    const workflows = Array.isArray(data.workflows) ? data.workflows : [];
    const diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics : [];
    const enabledCount = skills.filter((skill) => !skill.disabled).length;
    elements.skillSummary.textContent = language !== 'en'
      ? String(enabledCount) + chinese(' 个启用 · ', ' 個啟用 · ') + String(skills.length) + chinese(' 个已发现', ' 個已找到')
      : String(enabledCount) + ' enabled · ' + String(skills.length) + ' discovered';
    elements.skillList.replaceChildren();
    if (!skills.length) {
      const empty = document.createElement('p');
      empty.className = 'review-empty';
      empty.textContent = language !== 'en' ? chinese('配置目录中尚未发现有效 Skill。', '設定目錄中尚未找到有效 Skill。') : 'No valid skills found in configured directories.';
      elements.skillList.append(empty);
    }
    for (const skill of skills) {
      const row = document.createElement('article');
      row.className = 'skill-row' + (skill.disabled ? ' is-disabled' : '');
      const copyBlock = document.createElement('span');
      copyBlock.className = 'skill-row-copy';
      const title = document.createElement('strong');
      title.textContent = skill.displayName || skill.name;
      const description = document.createElement('span');
      description.textContent = skill.shortDescription || skill.description;
      const path = document.createElement('small');
      path.textContent = '$' + skill.name + ' · ' + skill.path + (skill.truncated ? (language !== 'en' ? chinese(' · 已截断', ' · 已截斷') : ' · truncated') : '');
      copyBlock.append(title, description, path);
      const actions = document.createElement('span');
      actions.className = 'skill-row-actions';
      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'skill-use';
      use.textContent = copy.useSkill;
      use.setAttribute('aria-label', copy.useSkill + ': ' + (skill.displayName || skill.name));
      use.dataset.skillDisabled = String(Boolean(skill.disabled));
      use.disabled = skill.disabled || !data.enabled;
      use.addEventListener('click', () => {
        setComposerValue(skill.defaultPrompt || ('$' + skill.name + ' '));
        setInspector(false);
      });
      const toggle = document.createElement('label');
      toggle.className = 'switch';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !skill.disabled;
      input.setAttribute('aria-label', (skill.displayName || skill.name) + ': ' + (language !== 'en' ? chinese('启用', '啟用') : 'enabled'));
      input.addEventListener('change', () => {
        const disabled = new Set(
          (state.skills.skills || []).filter((item) => item.disabled).map((item) => item.name),
        );
        if (input.checked) disabled.delete(skill.name);
        else disabled.add(skill.name);
        applySettings({ skillsDisabled: Array.from(disabled) }).catch(() => {});
      });
      const track = document.createElement('span');
      track.className = 'switch-track';
      track.setAttribute('aria-hidden', 'true');
      toggle.append(input, track);
      actions.append(use, toggle);
      row.append(copyBlock, actions);
      elements.skillList.append(row);
    }
    elements.workflowList.replaceChildren();
    elements.workflowCount.textContent = String(workflows.length);
    if (!workflows.length) {
      const empty = document.createElement('p');
      empty.className = 'review-empty';
      empty.textContent = language !== 'en'
        ? chinese('当前工程还没有工作流。', '目前專案尚無工作流程。')
        : 'No project workflows yet.';
      elements.workflowList.append(empty);
    }
    for (const workflow of workflows) {
      const row = document.createElement('article');
      row.className = 'workflow-row';
      const content = document.createElement('span');
      content.className = 'skill-row-copy';
      const title = document.createElement('strong');
      title.textContent = '/' + workflow.name;
      const description = document.createElement('span');
      description.textContent = workflow.description;
      const path = document.createElement('small');
      path.textContent = workflow.argumentHint
        ? workflow.argumentHint + ' · ' + workflow.path
        : workflow.path;
      content.append(title, description, path);
      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'skill-use';
      use.textContent = copy.useWorkflow;
      use.setAttribute('aria-label', copy.useWorkflow + ': ' + workflow.name);
      use.addEventListener('click', () => {
        setComposerValue('/' + workflow.name + ' ');
        setInspector(false);
      });
      row.append(content, use);
      elements.workflowList.append(row);
    }
    elements.skillDiagnostics.replaceChildren();
    for (const diagnostic of diagnostics) {
      const item = document.createElement('div');
      item.className = 'skill-diagnostic is-' + diagnostic.severity;
      item.textContent = diagnostic.message + ' · ' + diagnostic.path;
      elements.skillDiagnostics.append(item);
    }
    syncSkillControls(Boolean(data.enabled));
  }

  async function loadSkills(force) {
    if (state.skillsPromise && !force) return state.skillsPromise;
    const request = api('/api/skills').then((data) => {
      renderSkills(data);
      return data;
    }).finally(() => {
      if (state.skillsPromise === request) state.skillsPromise = null;
    });
    state.skillsPromise = request;
    return request;
  }

  function reconcileStatus() {
    if (state.statusRefresh) return state.statusRefresh;
    const refresh = loadStatus()
      .catch((error) => showToast(error.message || String(error), 'error'))
      .finally(() => {
        if (state.statusRefresh === refresh) state.statusRefresh = null;
      });
    state.statusRefresh = refresh;
    return refresh;
  }

  function addActivity(message, kind, key) {
    elements.activityEmpty.hidden = true;
    if (key) {
      const existing = key === 'thinking' ? state.currentThinkingRow : state.toolRows.get(key);
      if (existing) {
        existing.querySelector('span').textContent = message;
        existing.className = 'activity-row' + (kind ? ' is-' + kind : '');
        existing.dataset.activityKind = kind || 'running';
        applyActivityFilter();
        return existing;
      }
    }
    const row = document.createElement('div');
    row.className = 'activity-row' + (kind ? ' is-' + kind : '');
    row.dataset.activityKind = kind || 'running';
    const text = document.createElement('span');
    text.textContent = message;
    const time = document.createElement('time');
    time.className = 'activity-time';
    time.textContent = formatTime();
    row.append(text, time);
    elements.events.append(row);
    state.activityRows += 1;
    if (key === 'thinking') state.currentThinkingRow = row;
    else if (key) state.toolRows.set(key, row);
    while (state.activityRows > 80) {
      const first = elements.events.querySelector('.activity-row');
      if (!first) break;
      if (state.currentThinkingRow === first) state.currentThinkingRow = null;
      for (const [rowKey, row] of state.toolRows) {
        if (row === first) state.toolRows.delete(rowKey);
      }
      first.remove();
      state.activityRows -= 1;
    }
    applyActivityFilter();
    return row;
  }

  function applyActivityFilter() {
    elements.activityFilters.querySelectorAll('[data-activity-filter]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.activityFilter === state.activityFilter));
    });
    elements.events.querySelectorAll('.activity-row').forEach((row) => {
      const kind = row.dataset.activityKind || 'running';
      row.hidden = state.activityFilter === 'issues'
        ? !['error', 'warning'].includes(kind)
        : state.activityFilter === 'running'
          ? ['success', 'error'].includes(kind)
          : false;
    });
  }

  function clearActivity() {
    elements.events.querySelectorAll('.activity-row').forEach((row) => row.remove());
    elements.activityEmpty.hidden = false;
    state.activityRows = 0;
    state.currentThinkingRow = null;
    state.toolRows.clear();
  }

  async function applySettings(patch, quiet) {
    const request = (async () => {
      await api('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      await loadStatus();
      if (Object.keys(patch).some((key) => key.startsWith('skills'))) {
        await loadSkills(true);
      }
      if (!quiet) showToast(copy.settingsSaved, 'success');
    })();
    state.settingsPromise = request;
    try {
      await request;
    } catch (error) {
      await loadStatus().catch(() => {});
      showToast(error.message || String(error), 'error');
      throw error;
    } finally {
      if (state.settingsPromise === request) state.settingsPromise = null;
    }
  }

  function isControlCommand(value) {
    if (value.startsWith('!')) return true;
    const name = value.split(/\s+/, 1)[0].toLowerCase();
    return controlCommands.includes(name);
  }

  function persistPromptQueue() {
    writeLocalStorage('orbit.webui.queue', state.promptQueue.length ? JSON.stringify(state.promptQueue) : '');
  }

  function renderPromptQueue() {
    elements.promptQueueList.replaceChildren();
    elements.promptQueue.hidden = state.promptQueue.length === 0;
    for (let index = 0; index < state.promptQueue.length; index += 1) {
      const row = document.createElement('div');
      row.className = 'prompt-queue-row';
      const number = document.createElement('span');
      number.textContent = String(index + 1);
      const text = document.createElement('span');
      const item = state.promptQueue[index];
      text.textContent = item.prompt + (item.attachmentIds && item.attachmentIds.length ? ' · 📎 ' + item.attachmentIds.length : '');
      text.title = item.prompt;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.queueRemove = String(index);
      remove.textContent = '×';
      remove.setAttribute('aria-label', copy.removeQueued);
      row.append(number, text, remove);
      elements.promptQueueList.append(row);
    }
  }

  function restorePromptQueue() {
    try {
      const parsed = JSON.parse(readLocalStorage('orbit.webui.queue', '[]'));
      state.promptQueue = Array.isArray(parsed)
        ? parsed.map((item) => typeof item === 'string' ? { prompt: item, attachmentIds: [] } : item)
          .filter((item) => item && typeof item.prompt === 'string' && item.prompt.trim())
          .map((item) => ({
            prompt: item.prompt.trim(),
            attachmentIds: Array.isArray(item.attachmentIds) ? item.attachmentIds.filter((id) => typeof id === 'string').slice(0, 4) : [],
          }))
          .slice(0, 12)
        : [];
    } catch {
      state.promptQueue = [];
    }
    renderPromptQueue();
  }

  function queuePrompt(prompt) {
    const value = String(prompt || '').trim();
    if (!value || state.promptQueue.length >= 12) return;
    const attachmentIds = state.attachments.map((attachment) => attachment.id);
    state.promptQueue.push({ prompt: value, attachmentIds });
    consumeAttachments(attachmentIds);
    persistPromptQueue();
    renderPromptQueue();
    elements.prompt.value = '';
    writeLocalStorage('orbit.webui.draft', '');
    autoSizePrompt();
    updateSendButtonState();
    showToast(copy.queued, 'success');
    elements.prompt.focus();
  }

  function removeQueuedPrompt(index) {
    if (!Number.isInteger(index) || index < 0 || index >= state.promptQueue.length) return;
    const removed = state.promptQueue.splice(index, 1)[0];
    for (const id of removed.attachmentIds || []) {
      void api('/api/attachment?id=' + encodeURIComponent(id), { method: 'DELETE' }).catch(() => {});
    }
    persistPromptQueue();
    renderPromptQueue();
  }

  function clearPromptQueue() {
    for (const item of state.promptQueue) {
      for (const id of item.attachmentIds || []) {
        void api('/api/attachment?id=' + encodeURIComponent(id), { method: 'DELETE' }).catch(() => {});
      }
    }
    state.promptQueue = [];
    persistPromptQueue();
    renderPromptQueue();
  }

  function runNextQueuedPrompt() {
    if (state.busy || !state.ready || !state.promptQueue.length) return;
    const next = state.promptQueue.shift();
    persistPromptQueue();
    renderPromptQueue();
    void submitTurn(next.prompt, { attachmentIds: next.attachmentIds });
  }

  async function submitTurn(prompt, options) {
    const value = String(prompt || '').trim();
    if (!value || state.busy) return;
    if (!state.ready) {
      showToast(copy.waitForConnection, 'warning');
      elements.prompt.focus();
      return;
    }
    if (state.settingsPromise) {
      setBusy(true, copy.settingsSaving);
      try {
        await state.settingsPromise;
      } catch {
        setBusy(false, '');
        elements.prompt.focus();
        return;
      }
      setBusy(false, '');
    }
    closeContextPicker({ skipRestore: true });
    closeSlashCommands();
    const turnId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    const previousDraft = elements.prompt.value;
    const restoreDraft = String(options && options.restoreDraft || '');
    const attachmentIds = Array.isArray(options && options.attachmentIds)
      ? options.attachmentIds.slice(0, 4)
      : state.attachments.map((attachment) => attachment.id);
    const controlCommand = isControlCommand(value);
    state.submitting = true;
    state.activeTurnId = turnId;
    state.controlTurnId = controlCommand ? turnId : null;
    state.controlPrompt = controlCommand ? value : '';
    state.externalTurn = false;
    setBusy(true, copy.thinking);
    if (controlCommand) {
      upsertControlTurn(turnId, value, 'running', true);
      addActivity(value + ' · ' + copy.running, '', 'control');
    } else {
      createStreamingTurn(value, turnId);
    }
    elements.prompt.value = '';
    writeLocalStorage('orbit.webui.draft', '');
    autoSizePrompt();
    updateSendButtonState();
    closeSidebar();
    try {
      const result = await api('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: value, turnId, attachmentIds }),
      });
      if (result.turnId) state.activeTurnId = result.turnId;
      consumeAttachments(attachmentIds);
      if (restoreDraft) {
        elements.prompt.value = restoreDraft;
        writeLocalStorage('orbit.webui.draft', restoreDraft);
        autoSizePrompt();
        updateSendButtonState();
      }
      state.submitting = false;
      void reconcileStatus();
    } catch (error) {
      state.submitting = false;
      setBusy(false, '');
      state.activeTurnId = null;
      state.controlTurnId = null;
      state.controlPrompt = '';
      if (controlCommand) upsertControlTurn(turnId, value, 'failed', false);
      elements.prompt.value = previousDraft || value;
      writeLocalStorage('orbit.webui.draft', elements.prompt.value);
      autoSizePrompt();
      updateSendButtonState();
      await renderMessages().catch(() => {});
      showToast(error.message || String(error), 'error');
    }
  }

  async function startTaskAction(button) {
    if (state.busy) return;
    if (!state.ready) {
      showToast(copy.waitForConnection, 'warning');
      return;
    }
    const action = button && button.dataset.taskAction;
    const label = button && button.dataset.taskLabel || copy.working;
    if (!['plan', 'parallel-improve'].includes(action)) return;
    if (state.settingsPromise) {
      setBusy(true, copy.settingsSaving);
      try {
        await state.settingsPromise;
      } catch {
        setBusy(false, '');
        return;
      }
      setBusy(false, '');
    }
    const turnId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    state.submitting = true;
    state.activeTurnId = turnId;
    state.controlTurnId = null;
    state.controlPrompt = '';
    state.externalTurn = false;
    setBusy(true, label);
    createStreamingTurn('', turnId);
    setStreamingProgress(label, 'running');
    addActivity(label + ' · ' + copy.running, '', 'task-action');
    closeSidebar();
    try {
      const result = await api('/api/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, turnId }),
      });
      if (result.turnId) state.activeTurnId = result.turnId;
      state.submitting = false;
      void reconcileStatus();
    } catch (error) {
      state.submitting = false;
      setBusy(false, '');
      state.activeTurnId = null;
      state.controlTurnId = null;
      state.controlPrompt = '';
      if (state.streaming) state.streaming.root.remove();
      state.streaming = null;
      state.streamingTurnId = null;
      await renderMessages().catch(() => {});
      showToast(error.message || String(error), 'error');
    }
  }

  async function stopTurn() {
    if (!state.busy || state.stopping) return;
    state.stopping = true;
    setBusy(true, copy.stopping);
    try {
      await api('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnId: state.activeTurnId }),
      });
    } catch (error) {
      state.stopping = false;
      setBusy(true, copy.working);
      showToast(error.message || String(error), 'error');
    }
  }

  function handleOrbitEvent(event) {
    const payload = event.payload || {};
    const belongsToTurn = !event.turnId || !state.activeTurnId || event.turnId === state.activeTurnId;
    if ((event.type === 'model_delta' || event.type === 'thinking_delta') && !belongsToTurn) return;

    if (event.type === 'ui_turn_started' && payload.source === 'terminal') {
      if (state.busy) return;
      const turnId = payload.turnId || 'terminal-' + Date.now();
      state.activeTurnId = turnId;
      state.externalTurn = true;
      state.controlTurnId = null;
      setBusy(true, copy.working);
      createStreamingTurn(payload.prompt || '', turnId);
      addActivity(copy.terminalTurn + ' · ' + copy.running, '', 'external');
    } else if (event.type === 'ui_turn_completed' && payload.source === 'terminal') {
      if (!state.externalTurn || payload.turnId !== state.activeTurnId) return;
      void finishTurn({
        turnId: payload.turnId,
        status: payload.status,
        message: payload.message,
      });
    } else if (event.type === 'model_delta' && state.streaming) {
      state.pendingDelta += payload.text || '';
      scheduleStreamFlush();
    } else if (event.type === 'thinking_delta' && state.streaming) {
      state.pendingThinking += payload.text || '';
      addActivity(copy.thinking, '', 'thinking');
      setStreamingProgress(copy.thinking, 'running');
      scheduleStreamFlush();
    } else if (event.type === 'model_routing') {
      const lane = payload.lane || 'balanced';
      addActivity((payload.model || copy.models) + ' · ' + lane + ' · ' + (payload.reason || ''), '', 'routing');
    } else if (event.type === 'model_request') {
      setStreamingModel(payload.model || '');
      addActivity((payload.model || copy.models) + ' · ' + copy.running, '', 'model');
      setStreamingProgress((payload.model || copy.models) + ' · ' + copy.running, 'running');
      setBusy(true, copy.thinking);
    } else if (event.type === 'model_response') {
      addActivity((payload.model || copy.models) + ' · ' + copy.done, 'success', 'model');
      setStreamingProgress((payload.model || copy.models) + ' · ' + copy.done, 'success');
    } else if (event.type === 'tool_proposal') {
      const key = 'tool-' + (payload.toolCallId || payload.toolName || Date.now());
      addActivity((payload.toolName || copy.tool) + ' · ' + copy.running, 'warning', key);
      setStreamingProgress((payload.toolName || copy.tool) + ' · ' + copy.running, 'warning');
      upsertStreamingTool(payload, 'running');
    } else if (event.type === 'file_diff') {
      appendStreamingDiff(payload);
      if (payload.filePath) {
        addActivity(payload.filePath + ' · diff', '', 'diff-' + payload.filePath);
      }
    } else if (event.type === 'web_approval_requested') {
      addActivity(copy.approvalRequired, 'warning', 'approval');
      setBusy(true, copy.approvalRequired);
      void reconcileStatus();
    } else if (event.type === 'web_approval_resolved') {
      addActivity(payload.approved ? copy.approvalApproved : copy.approvalDenied, payload.approved ? 'success' : 'warning', 'approval');
      void reconcileStatus();
    } else if (event.type === 'tool_result') {
      const key = 'tool-' + (payload.toolCallId || payload.toolName || '');
      addActivity((payload.toolName || copy.tool) + ' · ' + (payload.error ? copy.error : copy.done), payload.error ? 'error' : 'success', key);
      setStreamingProgress(
        (payload.toolName || copy.tool) + ' · ' + (payload.error ? copy.error : copy.done),
        payload.error ? 'error' : 'success',
      );
      upsertStreamingTool(payload, payload.error ? 'error' : 'success');
    } else if (event.type === 'verification_started') {
      addActivity('Verification · ' + copy.running, '', 'verification');
      setStreamingProgress('Verification · ' + copy.running, 'running');
    } else if (event.type === 'verification_ended') {
      addActivity('Verification · ' + (payload.success ? copy.done : copy.error), payload.success ? 'success' : 'error', 'verification');
      setStreamingProgress(
        'Verification · ' + (payload.success ? copy.done : copy.error),
        payload.success ? 'success' : 'error',
      );
    } else if (['agent_start', 'agent_spawn', 'agent_status', 'agent_completed'].includes(event.type)) {
      const agentId = payload.childId || payload.taskId || payload.role || 'agent';
      const role = payload.role || payload.task || agentId;
      const status = payload.status || (event.type === 'agent_completed' ? (payload.success ? copy.done : copy.error) : copy.running);
      const kind = event.type === 'agent_completed' ? (payload.success ? 'success' : 'error') : '';
      addActivity(role + ' · ' + status, kind, 'agent-' + agentId);
      void reconcileStatus();
    } else if (event.type === 'cache_update' || event.type === 'cost_update') {
      loadStatus().catch(() => {});
    } else if (event.type === 'warning') {
      addActivity(payload.message || 'Warning', 'warning');
      setStreamingProgress(payload.message || 'Warning', 'warning');
    } else if (event.type === 'error') {
      addActivity(payload.message || copy.error, 'error');
      setStreamingProgress(payload.message || copy.error, 'error');
      showToast(payload.message || copy.failed, 'error');
    } else if (event.type === 'info' && payload.message) {
      addActivity(payload.message, '');
    }
  }

  async function finishTurn(event) {
    if (event.turnId && state.activeTurnId && event.turnId !== state.activeTurnId) return;
    if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
    flushStream();
    const status = event.status || (event.ok === false ? 'failed' : 'completed');
    const failed = status === 'failed';
    const aborted = status === 'aborted';
    const activeModel = state.status && state.status.activeModel || copy.models;
    const resultKind = aborted ? 'warning' : failed ? 'error' : 'success';
    const resultLabel = aborted ? copy.stopped : failed ? copy.error : copy.done;
    const completedControlCommand =
      state.controlTurnId && state.controlTurnId === state.activeTurnId;
    const completedControlPrompt = state.controlPrompt || 'Command';
    if (completedControlCommand) {
      upsertControlTurn(
        state.controlTurnId,
        completedControlPrompt,
        aborted ? 'aborted' : failed ? 'failed' : 'completed',
        false,
      );
      addActivity(completedControlPrompt + ' · ' + resultLabel, resultKind, 'control');
    } else if (state.externalTurn) {
      addActivity(copy.terminalTurn + ' · ' + resultLabel, resultKind, 'external');
    } else {
      addActivity(activeModel + ' · ' + resultLabel, resultKind, 'model');
    }
    addActivity(
      aborted ? copy.stopped : failed ? copy.failed : copy.completed,
      aborted ? 'warning' : failed ? 'error' : 'success',
    );
    setBusy(false, '');
    state.activeTurnId = null;
    state.controlTurnId = null;
    state.controlPrompt = '';
    state.externalTurn = false;
    state.currentThinkingRow = null;
    // Activity keys only coalesce updates within one turn. Keeping them
    // across turns rewrites old model/verification rows with new timestamps
    // and makes the audit trail claim an earlier turn used the new model.
    state.toolRows.clear();
    if (event.message && failed) showToast(event.message, 'error');
    else if (completedControlCommand && !aborted) {
      showToast(completedControlPrompt + ' · ' + copy.done, 'success');
    }
    await Promise.all([renderMessages(), loadStatus()]).catch((error) => {
      showToast(error.message || String(error), 'error');
    });
    elements.prompt.focus();
    if (!failed && !aborted) runNextQueuedPrompt();
  }

  function connectEvents() {
    if (state.shuttingDown) return;
    if (state.eventRetryTimer) {
      window.clearTimeout(state.eventRetryTimer);
      state.eventRetryTimer = 0;
    }
    if (state.eventSource) state.eventSource.close();
    setConnection('connecting', copy.reconnecting);
    const eventUrl = state.useBearerTransport && webSessionToken
      ? '/api/events?access_token=' + encodeURIComponent(webSessionToken)
      : '/api/events';
    const source = new EventSource(eventUrl, { withCredentials: true });
    state.eventSource = source;
    source.onopen = () => {
      state.eventRetryAttempt = 0;
      state.ready = true;
      updateSendButtonState();
      setConnection('connected', copy.connected);
      void reconcileStatus();
    };
    source.onerror = () => {
      if (state.eventSource !== source) return;
      state.ready = false;
      updateSendButtonState();
      source.close();
      state.eventSource = null;
      const retryAttempt = state.eventRetryAttempt;
      setConnection(
        retryAttempt < 2 ? 'connecting' : 'disconnected',
        retryAttempt < 2 ? copy.reconnecting : copy.disconnected,
      );
      const delay = Math.min(8000, 500 * Math.pow(2, state.eventRetryAttempt));
      state.eventRetryAttempt = Math.min(state.eventRetryAttempt + 1, 5);
      state.eventRetryTimer = window.setTimeout(async () => {
        state.eventRetryTimer = 0;
        try {
          await recoverSessionCookie();
        } catch {}
        connectEvents();
      }, delay);
    };
    source.onmessage = (message) => {
      let event;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      if (event.kind === 'system') {
        state.ready = true;
        updateSendButtonState();
        setConnection('connected', copy.connected);
        void reconcileStatus();
      } else if (event.kind === 'heartbeat') {
        state.ready = true;
        updateSendButtonState();
        setConnection('connected', copy.connected);
      } else if (event.kind === 'turn_started') {
        state.activeTurnId = event.turnId;
        setBusy(true, copy.working);
        if (state.controlTurnId !== event.turnId) {
          ensureStreamingTurn(event.turnId);
          addActivity(copy.working, '');
        }
      } else if (event.kind === 'turn_done') {
        finishTurn(event);
      } else if (event.kind === 'orbit_event') {
        handleOrbitEvent(event);
      }
    };
  }

`;
