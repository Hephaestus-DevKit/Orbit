/** Searchable command palette for workspace, model, mode, and session actions. */
export const WEB_UI_CLIENT_PALETTE_SCRIPT = String.raw`  let paletteActions = [];
  let paletteSelection = 0;
  let paletteReturnFocus = null;

  function setComposerValue(value) {
    elements.prompt.value = value;
    writeLocalStorage('orbit.webui.draft', value);
    autoSizePrompt();
    updateSendButtonState();
    elements.prompt.focus();
    closeSlashCommands();
  }

  function buildPaletteActions() {
    const actions = [
      { icon: '+', label: language !== 'en' ? chinese('新建任务', '新增任務') : 'New task', detail: 'Ctrl N', keywords: 'new session task', idle: true, run: () => updateSession({ action: 'new' }) },
      { icon: '▣', label: language !== 'en' ? chinese('添加或创建项目', '加入或建立專案') : 'Add or create project', detail: language !== 'en' ? chinese('选择项目文件夹', '選擇專案資料夾') : 'Choose a project folder', keywords: 'add new open create project workspace folder', idle: true, run: openProjectDialog },
      { icon: '›', label: copy.focusComposer, detail: language !== 'en' ? chinese('发送消息', '傳送訊息') : 'Message Orbit', keywords: 'focus prompt message composer', run: () => elements.prompt.focus() },
      { icon: '◫', label: copy.openActivity, detail: language !== 'en' ? chinese('运行状态与工具', '執行狀態與工具') : 'Runtime and tools', keywords: 'activity details runtime tools', run: () => setInspector(true, 'activity') },
      { icon: '⚙', label: copy.openSettings, detail: 'Ctrl ,', keywords: 'settings preferences configuration', run: () => setInspector(true, 'settings') },
      { icon: '◧', label: language !== 'en' ? chinese('切换导航栏', '切換導覽列') : 'Toggle navigation', detail: 'Ctrl B', keywords: 'toggle sidebar navigation focus', run: toggleNavigation },
      { icon: '＋', label: language !== 'en' ? chinese('添加文件上下文', '加入檔案上下文') : 'Add file context', detail: language !== 'en' ? chinese('搜索工作区文件', '搜尋工作區檔案') : 'Search workspace files', keywords: 'add context file', idle: true, run: openContextPicker },
    ];
    for (const definition of slashCommands) {
      actions.push({
        icon: '/',
        label: definition.command + (definition.usage ? ' ' + definition.usage : ''),
        detail: definition.description,
        keywords: 'slash command ' + definition.command + ' ' + definition.description,
        idle: true,
        run: () => setComposerValue(definition.command + (definition.usage ? ' ' : '')),
      });
    }
    const status = state.status || {};
    const session = status.session || {};
    for (const item of session.recent || []) {
      if (item.active) continue;
      actions.push({
        icon: '○',
        label: item.title || copy.untitledTask,
        detail: copy.recentSession + (item.model ? ' · ' + item.model : ''),
        keywords: 'session recent history ' + item.id + ' ' + (item.model || ''),
        idle: true,
        run: () => updateSession({ action: 'resume', sessionId: item.id }),
      });
    }
    for (const model of status.modelOptions || []) {
      if (model.id === status.activeModel) continue;
      actions.push({
        icon: '◇',
        label: model.label || model.id,
        detail: copy.switchModel,
        keywords: 'model ' + model.id,
        idle: true,
        run: () => applySettings({ model: model.id }, false),
      });
    }
    for (const mode of ['strict', 'normal', 'auto', 'plan']) {
      if (status.permissions && status.permissions.mode === mode) continue;
      actions.push({
        icon: '◆',
        label: formatPermissionMode(mode),
        detail: copy.switchMode,
        keywords: 'permission mode security ' + mode,
        idle: true,
        run: () => requestPermissionMode(mode, false),
      });
    }
    return actions;
  }

  function paletteMatches(action, query) {
    if (!query) return true;
    const haystack = (action.label + ' ' + action.detail + ' ' + action.keywords).toLocaleLowerCase();
    return query.split(/\s+/).every((part) => haystack.includes(part));
  }

  function renderCommandPalette() {
    const query = elements.commandSearch.value.trim().toLocaleLowerCase();
    paletteActions = buildPaletteActions().filter((action) => paletteMatches(action, query));
    paletteSelection = Math.max(0, Math.min(paletteSelection, paletteActions.length - 1));
    elements.commandResults.replaceChildren();
    paletteActions.forEach((action, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = 'command-result-' + index;
      button.className = 'command-result';
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', index === paletteSelection ? 'true' : 'false');
      button.disabled = Boolean(action.idle && state.busy);
      const icon = document.createElement('span');
      icon.className = 'command-result-icon';
      icon.textContent = action.icon;
      const body = document.createElement('span');
      body.className = 'command-result-copy';
      const label = document.createElement('strong');
      label.textContent = action.label;
      const detail = document.createElement('small');
      detail.textContent = action.detail || copy.action;
      body.append(label, detail);
      button.append(icon, body);
      button.addEventListener('mouseenter', () => {
        paletteSelection = index;
        syncPaletteSelection();
      });
      button.addEventListener('click', () => executePaletteAction(index));
      elements.commandResults.append(button);
    });
    elements.commandEmpty.hidden = paletteActions.length !== 0;
    syncPaletteSelection();
  }

  function syncPaletteSelection() {
    let activeId = '';
    elements.commandResults.querySelectorAll('.command-result').forEach((button, index) => {
      button.setAttribute('aria-selected', index === paletteSelection ? 'true' : 'false');
      if (index === paletteSelection) {
        activeId = button.id;
        button.scrollIntoView({ block: 'nearest' });
      }
    });
    if (activeId) elements.commandSearch.setAttribute('aria-activedescendant', activeId);
    else elements.commandSearch.removeAttribute('aria-activedescendant');
  }

  function openCommandPalette() {
    if (!elements.commandPalette.hidden) return;
    paletteReturnFocus = document.activeElement;
    elements.commandPalette.hidden = false;
    elements.commandPalette.setAttribute('aria-hidden', 'false');
    syncApplicationModalState();
    elements.commandSearch.value = '';
    paletteSelection = 0;
    renderCommandPalette();
    requestAnimationFrame(() => elements.commandSearch.focus());
  }

  function closeCommandPalette() {
    if (elements.commandPalette.hidden) return;
    elements.commandPalette.hidden = true;
    elements.commandPalette.setAttribute('aria-hidden', 'true');
    syncApplicationModalState();
    const returnTarget = paletteReturnFocus;
    paletteReturnFocus = null;
    if (returnTarget && returnTarget.isConnected) returnTarget.focus();
  }

  function trapCommandPaletteFocus(event) {
    if (event.key !== 'Tab' || elements.commandPalette.hidden) return;
    const focusable = Array.from(elements.commandPalette.querySelectorAll(
      'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
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

  function executePaletteAction(index) {
    const action = paletteActions[index];
    if (!action || (action.idle && state.busy)) return;
    closeCommandPalette();
    Promise.resolve(action.run()).catch((error) => showToast(error.message || String(error), 'error'));
  }

  function movePaletteSelection(delta) {
    if (!paletteActions.length) return;
    paletteSelection = (paletteSelection + delta + paletteActions.length) % paletteActions.length;
    syncPaletteSelection();
  }
`;
