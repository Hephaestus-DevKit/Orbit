/** Mission Control task summary and durable child-agent controls. */
export const WEB_UI_CLIENT_MISSION_CONTROL_SCRIPT = String.raw`  function renderTaskOverview(data) {
    const session = data.session || {};
    const plan = data.plan || {};
    const runs = Array.isArray(data.agentRuns) ? data.agentRuns : [];
    const agents = runs.flatMap((run) => Array.isArray(run.agents) ? run.agents : []);
    const activeAgents = agents.filter((agent) => agent.status === 'running').length;
    const backgroundTasks = Array.isArray(data.backgroundTasks) ? data.backgroundTasks : [];
    const activeBackgroundTasks = backgroundTasks.filter((task) => task.status === 'running').length;
    const activeSession = (Array.isArray(session.recent) ? session.recent : [])
      .find((candidate) => candidate.active);
    const active = Boolean(data.turn && data.turn.active);
    const workActive = active || activeAgents > 0 || activeBackgroundTasks > 0;
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
      [language === 'en' ? 'Agents' : chinese('智能体', '智慧體'), activeAgents + ' / ' + agents.length, [activeAgents ? copy.running : '', data.agentTeam && data.agentTeam.preset || ''].filter(Boolean).join(' · ') || copy.ready],
      [language === 'en' ? 'Background' : chinese('后台任务', '背景任務'), activeBackgroundTasks + ' / ' + backgroundTasks.length, activeBackgroundTasks ? copy.running : copy.ready],
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
    const runningAgentIds = new Set(
      agents.filter((agent) => agent.status === 'running').map((agent) => agent.id),
    );
    if (state.agentSteeringId && !runningAgentIds.has(state.agentSteeringId)) {
      state.agentSteeringId = null;
      state.agentSteeringDraft = '';
    }
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
        Number(agent.steeringCount || 0) > 0 ? copy.steeringCount + ' ' + Number(agent.steeringCount || 0) : '',
      ].filter(Boolean).join(' · ');
      card.append(heading, task, meta);
      if (agent.status === 'running') {
        const actions = document.createElement('div');
        actions.className = 'agent-actions';
        const steer = document.createElement('button');
        steer.type = 'button';
        steer.className = 'agent-steer';
        steer.dataset.agentAction = 'open-steer';
        steer.dataset.agentId = agent.id;
        steer.textContent = copy.steerAgent;
        steer.setAttribute('aria-label', copy.steerAgent + ': ' + (agent.role || 'agent'));
        const abort = document.createElement('button');
        abort.type = 'button';
        abort.className = 'agent-abort';
        abort.dataset.agentAction = 'abort';
        abort.dataset.agentId = agent.id;
        abort.textContent = copy.abortAgent;
        abort.setAttribute('aria-label', copy.abortAgent + ': ' + (agent.role || 'agent'));
        actions.append(steer, abort);
        card.append(actions);
        if (state.agentSteeringId === agent.id) {
          const editor = document.createElement('div');
          editor.className = 'agent-steer-editor';
          const textarea = document.createElement('textarea');
          textarea.className = 'agent-steer-input';
          textarea.dataset.agentSteerEditor = agent.id;
          textarea.maxLength = 8000;
          textarea.rows = 3;
          textarea.value = state.agentSteeringDraft;
          textarea.placeholder = copy.agentSteerPlaceholder;
          textarea.setAttribute('aria-label', copy.steerAgent + ': ' + (agent.role || 'agent'));
          const editorActions = document.createElement('div');
          editorActions.className = 'agent-steer-buttons';
          const send = document.createElement('button');
          send.type = 'button';
          send.className = 'agent-steer-send';
          send.dataset.agentAction = 'submit-steer';
          send.dataset.agentId = agent.id;
          send.textContent = copy.sendAgentSteering;
          const cancel = document.createElement('button');
          cancel.type = 'button';
          cancel.className = 'agent-steer-cancel';
          cancel.dataset.agentAction = 'cancel-steer';
          cancel.dataset.agentId = agent.id;
          cancel.textContent = copy.cancelAgentSteering;
          editorActions.append(send, cancel);
          editor.append(textarea, editorActions);
          card.append(editor);
        }
      }
      elements.agentRunList.append(card);
    }
  }

`;
