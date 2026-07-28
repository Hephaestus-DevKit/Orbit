/** Skill and workflow catalog rendering, controls, and refresh lifecycle. */
export const WEB_UI_CLIENT_CAPABILITIES_SCRIPT = String.raw`  function syncSkillControls(enabled) {
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
      const activation = skill.allowImplicitInvocation ? copy.skillAuto : copy.skillExplicit;
      path.textContent = '$' + skill.name + ' · ' + activation + ' · ' + skill.path + (skill.truncated ? (language !== 'en' ? chinese(' · 已截断', ' · 已截斷') : ' · truncated') : '');
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
        input.disabled = true;
        applySettings({ skillsDisabled: Array.from(disabled) })
          .catch(() => {})
          .finally(() => {
            if (input.isConnected) input.disabled = state.busy || !Boolean(state.skills && state.skills.enabled);
          });
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
    const requestId = ++state.skillRequestId;
    elements.refreshSkills.disabled = true;
    elements.refreshSkills.setAttribute('aria-busy', 'true');
    elements.skillList.setAttribute('aria-busy', 'true');
    const request = api('/api/skills')
      .then((data) => {
        if (requestId === state.skillRequestId) renderSkills(data);
        return data;
      })
      .catch((error) => {
        if (requestId !== state.skillRequestId) return state.skills;
        throw error;
      })
      .finally(() => {
        if (requestId !== state.skillRequestId) return;
        state.skillsPromise = null;
        elements.refreshSkills.disabled = state.busy;
        elements.refreshSkills.removeAttribute('aria-busy');
        elements.skillList.removeAttribute('aria-busy');
      });
    state.skillsPromise = request;
    return request;
  }

`;
