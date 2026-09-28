/** Skill and workflow catalog rendering, controls, and refresh lifecycle. */
export const WEB_UI_CLIENT_CAPABILITIES_SCRIPT = String.raw`  function clearCapabilityError() {
    elements.capabilityFormError.hidden = true;
    elements.capabilityFormError.textContent = '';
    [
      elements.capabilityName,
      elements.capabilityDescription,
      elements.capabilityInstructions,
      elements.capabilitySkills,
      elements.capabilityStages,
    ].forEach((field) => {
      field.removeAttribute('aria-invalid');
      field.removeAttribute('aria-describedby');
    });
    elements.capabilityStages.setAttribute('aria-describedby', 'capabilityStagesHint capabilityStagesStatus');
  }
  function showCapabilityError(message, field) {
    clearCapabilityError();
    if (field) field.insertAdjacentElement('afterend', elements.capabilityFormError);
    else elements.createCapabilityButton.parentElement.before(elements.capabilityFormError);
    elements.capabilityFormError.textContent = message;
    elements.capabilityFormError.hidden = false;
    if (field) {
      if (field === elements.capabilityStages) elements.capabilityStagesDetails.open = true;
      field.setAttribute('aria-invalid', 'true');
      field.setAttribute('aria-describedby', field === elements.capabilityStages
        ? 'capabilityStagesHint capabilityFormError'
        : 'capabilityFormError');
      field.focus();
    }
  }
  function changeSkillSettingsPending(delta) {
    state.skillSettingsPending += delta;
    syncSkillControls(elements.skillsEnabled.checked);
  }

  function syncSkillControls(enabled) {
    const saving = state.skillSettingsPending > 0;
    elements.skillsEnabled.disabled = state.busy || saving;
    elements.refreshSkills.disabled = state.busy || saving || Boolean(state.skillsPromise);
    elements.skillControls.classList.toggle('is-disabled', !enabled);
    elements.skillList.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    elements.skillActivationSegments.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    elements.skillsMaxActive.disabled = !enabled || state.busy || saving;
    elements.skillActivationSegments.querySelectorAll('button').forEach((button) => {
      button.disabled = !enabled || state.busy || saving;
    });
    elements.skillList.querySelectorAll('input').forEach((input) => {
      input.disabled = !enabled || state.busy || saving;
    });
    elements.skillList.querySelectorAll('.skill-use').forEach((button) => {
      button.disabled =
        !enabled || state.busy || saving || (state.skills && state.skills.maxActive === 0) || button.dataset.skillDisabled === 'true';
    });
    elements.workflowList.querySelectorAll('.skill-use').forEach((button) => {
      button.disabled = state.busy || (saving && button.dataset.workflowRequiresSkills === 'true') || button.dataset.workflowBlocked === 'true';
    });
    syncCapabilityCreator();
  }

  function syncCapabilityCreator() {
    const pending = Boolean(state.capabilityPending);
    elements.capabilityCreator.setAttribute('aria-busy', String(pending));
    elements.addCapabilityButton.disabled = state.busy || pending;
    elements.capabilityCreator.querySelectorAll('input, textarea, select, button').forEach((control) => {
      control.disabled = state.busy || pending;
    });
    elements.formatCapabilityStages.disabled = state.busy || pending || !elements.capabilityStages.value.trim();
  }

  function workflowDependencyMessage(workflow) {
    const reasons = {
      missing: stageCopy('Missing Skills', '缺少 Skill', '缺少 Skill'),
      draft: stageCopy('Skills pending review', 'Skill 待审核', 'Skill 待審核'),
      disabled: stageCopy('Disabled Skills', 'Skill 已禁用', 'Skill 已停用'),
    };
    const messages = [];
    if (workflow.skillsUnavailable) messages.push(stageCopy(
      'Enable Skills and set the active limit above zero.',
      '请启用 Skill，并将同时激活上限设为大于 0。',
      '請啟用 Skill，並將同時啟用上限設為大於 0。',
    ));
    for (const [reason, label] of Object.entries(reasons)) {
      const names = (workflow.dependencyProblems || []).filter((problem) => problem.reason === reason).map((problem) => '$' + problem.name);
      if (names.length) messages.push(label + ': ' + names.join(', '));
    }
    return messages.join(' · ');
  }

  function skillActivationMessage(payload) {
    const reason = payload.activationReason === 'metadata-match'
      ? stageCopy('metadata match', '描述匹配', '描述匹配') + ' (' + (payload.matchedTerms || 0) + ')'
      : payload.activationReason === 'name-match' ? stageCopy('name match', '名称匹配', '名稱匹配')
        : payload.activation === 'explicit' ? copy.skillExplicit : copy.skillAuto;
    let message = '$' + (payload.name || 'skill') + ' · ' + reason;
    if (payload.truncated) {
      const limit = payload.truncationReason === 'context-budget'
        ? stageCopy('context budget', '上下文预算', '上下文預算')
        : payload.truncationReason === 'auto-size-limit'
          ? stageCopy('automatic Skill size limit', '自动激活大小上限', '自動啟用大小上限')
          : stageCopy('Skill size limit', 'Skill 大小上限', 'Skill 大小上限');
      message += stageCopy(' · truncated by ', ' · 已截断：', ' · 已截斷：') + limit;
      message += stageCopy('; read ', '；使用前需完整读取 ', '；使用前需完整讀取 ')
        + 'skill://' + (payload.name || 'skill') + '/SKILL.md'
        + stageCopy(' in full before use', '', '');
    }
    return message;
  }

  function renderSkills(data) {
    state.skills = data;
    const skills = Array.isArray(data.skills) ? data.skills : [];
    const workflows = Array.isArray(data.workflows) ? data.workflows : [];
    const diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics : [];
    const enabledCount = data.enabled && data.maxActive !== 0
      ? skills.filter((skill) => !skill.disabled && skill.reviewStatus !== 'draft').length
      : 0;
    elements.skillSummary.textContent = language !== 'en'
      ? String(enabledCount) + chinese(' 个可用 · ', ' 個可用 · ') + String(skills.length) + chinese(' 个已发现', ' 個已找到')
      : String(enabledCount) + ' ready · ' + String(skills.length) + ' discovered';
    if (data.skillsTruncated) elements.skillSummary.textContent += stageCopy(
      ' · showing ' + skills.length + ' of ' + data.totalSkills,
      ' · 显示 ' + skills.length + ' / ' + data.totalSkills,
      ' · 顯示 ' + skills.length + ' / ' + data.totalSkills,
    );
    if (data.enabled && data.maxActive === 0) elements.skillSummary.textContent += stageCopy(
      ' · increase the active limit to use Skills',
      ' · 请提高同时激活上限以使用 Skill',
      ' · 請提高同時啟用上限以使用 Skill',
    );
    elements.skillList.replaceChildren();
    if (!skills.length) {
      const empty = document.createElement('p');
      empty.className = 'review-empty';
      empty.textContent = language !== 'en' ? chinese('配置目录中尚未发现有效 Skill。', '設定目錄中尚未找到有效 Skill。') : 'No valid skills found in configured directories.';
      elements.skillList.append(empty);
    }
    for (const skill of skills) {
      const draft = skill.reviewStatus === 'draft';
      const row = document.createElement('article');
      row.className = 'skill-row' + (skill.disabled ? ' is-disabled' : '') + (draft ? ' is-review-pending' : '');
      const copyBlock = document.createElement('span');
      copyBlock.className = 'skill-row-copy';
      const heading = document.createElement('span');
      heading.className = 'skill-row-heading';
      const title = document.createElement('strong');
      title.textContent = skill.displayName || skill.name;
      heading.append(title);
      if (draft) {
        const badge = document.createElement('span');
        badge.className = 'skill-review-badge';
        badge.textContent = language !== 'en' ? chinese('待审核', '待審核') : 'Review required';
        heading.append(badge);
      }
      const description = document.createElement('span');
      description.textContent = skill.shortDescription || skill.description;
      const path = document.createElement('small');
      const activation = data.activation !== 'explicit' && skill.allowImplicitInvocation ? copy.skillAuto : copy.skillExplicit;
      path.textContent = '$' + skill.name + ' · ' + activation + ' · ' + skill.path + (skill.truncated ? (language !== 'en' ? chinese(' · 已截断', ' · 已截斷') : ' · truncated') : '');
      copyBlock.append(heading, description, path);
      const actions = document.createElement('span');
      actions.className = 'skill-row-actions';
      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'skill-use';
      use.textContent = copy.useSkill;
      use.setAttribute('aria-label', copy.useSkill + ': ' + (skill.displayName || skill.name));
      use.dataset.skillDisabled = String(Boolean(skill.disabled || draft));
      use.disabled = skill.disabled || draft || !data.enabled;
      use.addEventListener('click', () => {
        setInspector(false);
        setComposerValue(skill.defaultPrompt || ('$' + skill.name + ' '));
      });
      const toggle = document.createElement('label');
      toggle.className = 'switch';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !skill.disabled;
      input.setAttribute('aria-label', (skill.displayName || skill.name) + ': ' + (language !== 'en' ? chinese('启用', '啟用') : 'enabled'));
      input.addEventListener('change', () => {
        const previousDisabled = skill.disabled;
        skill.disabled = !input.checked;
        row.classList.toggle('is-disabled', skill.disabled);
        use.dataset.skillDisabled = String(skill.disabled || draft);
        use.disabled =
          skill.disabled ||
          draft ||
          state.busy ||
          !Boolean(state.skills && state.skills.enabled);
        const disabled = new Set(state.skills.disabledSkills || []);
        for (const item of state.skills.skills || []) {
          if (item.disabled) disabled.add(item.name);
          else disabled.delete(item.name);
        }
        input.disabled = true;
        applySettings({ skillsDisabled: Array.from(disabled) })
          .catch((error) => {
            // A failed recovery fetch cannot leave an optimistic toggle looking
            // saved. Do not overwrite a newer catalog that did refresh.
            if ((state.skills.skills || []).includes(skill)) {
              if (!error.settingsSaved) skill.disabled = previousDisabled;
              renderSkills(state.skills);
            }
          })
          .finally(() => {
            if (input.isConnected) input.disabled = state.busy || state.skillSettingsPending > 0 || !Boolean(state.skills && state.skills.enabled);
          });
      });
      const track = document.createElement('span');
      track.className = 'switch-track';
      track.setAttribute('aria-hidden', 'true');
      toggle.append(input, track);
      actions.append(use);
      if (!draft) actions.append(toggle);
      row.append(copyBlock, actions);
      if (draft) {
        const note = document.createElement('p');
        note.className = 'skill-review-note';
        note.id = 'skill-review-' + skill.name;
        note.textContent = language === 'en'
          ? 'Review SKILL.md, set policy.review_status to approved in agents/openai.yaml, then refresh Skills.'
          : chinese('请审核 SKILL.md，在 agents/openai.yaml 中将 policy.review_status 设为 approved，然后刷新技能。', '請審核 SKILL.md，在 agents/openai.yaml 中將 policy.review_status 設為 approved，然後重新整理技能。');
        use.setAttribute('aria-describedby', note.id);
        row.append(note);
      }
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
      if (workflow.stageCount) title.textContent += ' · ' + workflow.stageCount + (language !== 'en'
        ? chinese(' 阶段', ' 階段')
        : workflow.stageCount === 1 ? ' stage' : ' stages');
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
      const problem = workflowDependencyMessage(workflow);
      use.dataset.workflowBlocked = String(Boolean(problem));
      use.dataset.workflowRequiresSkills = String(Boolean(workflow.requiredSkills && workflow.requiredSkills.length));
      use.disabled = state.busy || Boolean(problem);
      use.addEventListener('click', () => {
        setInspector(false);
        setComposerValue('/' + workflow.name + ' ');
      });
      row.append(content, use);
      if (problem) {
        row.classList.add('is-blocked');
        const note = document.createElement('p');
        note.className = 'workflow-dependency-note';
        note.id = 'workflow-dependencies-' + workflow.name;
        note.textContent = problem;
        use.setAttribute('aria-describedby', note.id);
        row.append(note);
      }
      elements.workflowList.append(row);
    }
    elements.skillDiagnostics.replaceChildren();
    for (const diagnostic of diagnostics) {
      // The localized card already explains this gate. Keep parsing, resource
      // and policy errors visible, including malformed sidecar warnings.
      if (diagnostic.code === 'review-required' && skills.some((skill) => skill.reviewStatus === 'draft' && skill.path === diagnostic.path)) continue;
      const item = document.createElement('div');
      item.className = 'skill-diagnostic is-' + diagnostic.severity;
      item.textContent = diagnostic.message + ' · ' + diagnostic.path;
      elements.skillDiagnostics.append(item);
    }
    syncSkillControls(Boolean(data.enabled));
  }

  function exportCapabilityCatalog() {
    const data = state.skills || { skills: [], workflows: [], diagnostics: [] };
    const manifest = {
      format: 'orbit-capability-catalog',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: { enabled: data.enabled, activation: data.activation, maxActive: data.maxActive },
      totalSkills: data.totalSkills,
      skillsTruncated: data.skillsTruncated,
      skills: (data.skills || []).map(({ name, displayName, description, shortDescription, path, disabled, reviewStatus, allowImplicitInvocation, truncated }) => ({
        name, displayName, description, shortDescription, path, disabled: Boolean(disabled), reviewStatus, allowImplicitInvocation, truncated,
      })),
      workflows: (data.workflows || []).map(({ name, description, argumentHint, path, stageCount, requiredSkills, dependencyProblems, skillsUnavailable }) => ({
        name, description, argumentHint, path, stageCount, requiredSkills, dependencyProblems, skillsUnavailable,
      })),
      diagnostics: data.diagnostics || [],
    };
    const blob = new Blob([JSON.stringify(manifest, null, 2) + '\n'], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = 'orbit-capabilities.json';
    anchor.click();
    URL.revokeObjectURL(href);
    showToast(copy.catalogExported, 'success');
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
        elements.refreshSkills.disabled = state.busy || state.skillSettingsPending > 0;
        elements.refreshSkills.removeAttribute('aria-busy');
        elements.skillList.removeAttribute('aria-busy');
      });
    state.skillsPromise = request;
    return request;
  }

`;
