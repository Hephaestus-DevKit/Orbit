import { renderUiIcon } from "./WebUiIcon.js";

/** Render the keyboard and pointer controls shared by commands and project navigation. */
export function renderCommandPaletteMarkup(copy: {
  commands: string;
  commandSearch: string;
  commandHint: string;
  noCommands: string;
  close: string;
}): string {
  return `<div class="command-palette" id="commandPalette" aria-hidden="true" hidden>
    <button class="command-palette-backdrop" id="commandPaletteBackdrop" type="button" aria-label="${copy.close}" tabindex="-1"></button>
    <section class="command-palette-dialog" role="dialog" aria-modal="true" aria-labelledby="commandPaletteTitle">
      <h2 class="sr-only" id="commandPaletteTitle">${copy.commands}</h2>
      <div class="command-search">
        <span aria-hidden="true" class="command-search-glyph">⌘</span>
        <span aria-hidden="true" class="command-search-lens">${renderUiIcon("search")}</span>
        <input id="commandSearch" type="search" aria-label="${copy.commandSearch}" aria-controls="commandResults" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="${copy.commandSearch}" />
        <button id="commandPaletteClose" class="icon-button" type="button" aria-label="${copy.close}">${
          renderUiIcon("close")
        }</button>
      </div>
      <div class="command-results" id="commandResults" role="listbox"></div>
      <p class="command-empty" id="commandEmpty" data-default="${copy.noCommands}" hidden>${copy.noCommands}</p>
      <footer class="command-palette-footer">${copy.commandHint}</footer>
    </section>
  </div>`;
}

function paletteMatches(
  action: { label: string; detail: string; keywords: string },
  query: string,
): boolean {
  if (!query) return true;
  const haystack = (action.label + " " + action.detail + " " + action.keywords).toLocaleLowerCase();
  return query.split(/\s+/).every((part) => haystack.includes(part));
}

/** Searchable command palette for workspace, model, mode, and session actions. */
export const WEB_UI_CLIENT_PALETTE_SCRIPT = String
  .raw`  const paletteMatches = ${paletteMatches.toString()};
  let paletteActions = [];
  let paletteSelection = 0;
  let paletteReturnFocus = null;
  let navigationPalette = false;
  const commandSearchLabel = elements.commandSearch.placeholder;
  const commandDialogLabel = byId('commandPaletteTitle').textContent;

  function focusMessageComposer() {
    closeSidebar();
    if (elements.inspector.classList.contains('is-open')) setInspector(false);
    showConversation();
    elements.prompt.focus();
  }

  function setComposerValue(value) {
    elements.prompt.value = value;
    drafts.save(value);
    autoSizePrompt();
    updateSendButtonState();
    focusMessageComposer();
    closeSlashCommands();
  }

  function buildPaletteActions() {
    const actions = [
      { icon: '+', label: language !== 'en' ? chinese('新建任务', '新增任務') : 'New task', detail: controlShortcut('N'), keywords: 'new session task', idle: true, run: () => updateSession({ action: 'new' }) },
      { icon: '▣', label: language !== 'en' ? chinese('添加或创建项目', '加入或建立專案') : 'Add or create project', detail: language !== 'en' ? chinese('选择项目文件夹', '選擇專案資料夾') : 'Choose a project folder', keywords: 'add new open create project workspace folder', idle: true, run: openProjectDialog },
      { icon: '›', label: copy.focusComposer, detail: language !== 'en' ? chinese('发送消息', '傳送訊息') : 'Message Orbit', keywords: 'focus prompt message composer', run: focusMessageComposer },
      { icon: '◫', label: copy.openActivity, detail: language !== 'en' ? chinese('运行状态与工具', '執行狀態與工具') : 'Runtime and tools', keywords: 'activity details runtime tools', run: () => setInspector(true, 'activity') },
      { icon: '⚙', label: copy.openSettings, detail: controlShortcut(','), keywords: 'settings preferences configuration', run: () => setInspector(true, 'settings') },
      { icon: '◧', label: language !== 'en' ? chinese('切换导航栏', '切換導覽列') : 'Toggle navigation', detail: controlShortcut('B'), keywords: 'toggle sidebar navigation focus', run: toggleNavigation },
      { icon: '＋', label: language !== 'en' ? chinese('添加文件上下文', '加入檔案上下文') : 'Add file context', detail: language !== 'en' ? chinese('搜索工作区文件', '搜尋工作區檔案') : 'Search workspace files', keywords: 'add context file', idle: true, run: openContextPicker },
    ];
    for (const preset of elements.reviewPresets.querySelectorAll('[data-review-preset]')) {
      actions.push({ icon: '◇', label: (language === 'en' ? 'Review' : chinese('审查', '審查')) + ' · ' + preset.textContent,
        detail: '/review ' + preset.dataset.reviewPreset, keywords: 'review project', idle: true,
        run: () => setComposerValue('/review ' + preset.dataset.reviewPreset) });
    }
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
    for (const button of elements.projectList.querySelectorAll('[data-project-path]')) {
      actions.push({
        navigation: 'project', icon: '▱', label: button.querySelector('strong').textContent, detail: button.title,
        keywords: 'project workspace folder 项目 專案 ' + button.dataset.projectPath,
        idle: true, run: () => button.click(),
      });
    }
    const session = status.session || {};
    for (const item of session.recent || []) {
      if (item.active && !navigationPalette) continue;
      actions.push({
        navigation: 'chat', current: item.active, icon: '○',
        label: item.title || copy.untitledTask,
        detail: navigationPalette
          ? [item.active ? stageCopy('Current chat', '当前聊天', '目前對話') : '', item.model, relativeSessionTime(item.updatedAt)].filter(Boolean).join(' · ')
          : copy.recentSession + ' · ' + workspaceName(status.workspace),
        keywords: 'session recent history ' + item.id + ' ' + (item.model || ''),
        idle: true,
        run: () => item.active ? focusMessageComposer() : updateSession({ action: 'resume', sessionId: item.id }),
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

  function renderCommandPalette() {
    const query = elements.commandSearch.value.trim().toLocaleLowerCase();
    paletteActions = buildPaletteActions().filter((action) => (!navigationPalette || action.navigation) && paletteMatches(action, query));
    paletteSelection = Math.max(0, Math.min(paletteSelection, paletteActions.length - 1));
    elements.commandResults.replaceChildren();
    let container = elements.commandResults, groupKind;
    paletteActions.forEach((action, index) => {
      if (navigationPalette && groupKind !== action.navigation) {
        groupKind = action.navigation;
        container = document.createElement('div');
        container.className = 'navigation-results-group';
        container.setAttribute('role', 'group');
        const heading = document.createElement('div');
        heading.className = 'navigation-results-heading';
        heading.id = 'navigation-' + groupKind;
        heading.textContent = groupKind === 'project' ? stageCopy('Projects', '项目', '專案')
          : stageCopy('Chats', '聊天', '對話') + ' · ' + workspaceName(state.status?.workspace);
        container.setAttribute('aria-labelledby', heading.id);
        container.append(heading);
        elements.commandResults.append(container);
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.id = 'command-result-' + index;
      button.className = 'command-result';
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', index === paletteSelection ? 'true' : 'false');
      button.disabled = Boolean(action.idle && state.busy);
      const icon = document.createElement('span');
      icon.className = 'command-result-icon';
      if (action.navigation) {
        icon.innerHTML = action.navigation === 'project' ? '${renderUiIcon("folder")}' : '${
          renderUiIcon("chat")
        }';
        if (action.current) button.setAttribute('aria-current', 'page');
      } else icon.textContent = action.icon;
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
      container.append(button);
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

  function openCommandPalette(mode, trigger) {
    if (!elements.commandPalette.hidden) return;
    navigationPalette = mode === 'navigation';
    const label = navigationPalette ? byId('findConversation').title : commandSearchLabel;
    elements.commandPalette.classList.toggle('is-navigation', navigationPalette);
    elements.commandEmpty.textContent = navigationPalette ? stageCopy('No matching projects or chats', '没有匹配的项目或聊天', '沒有相符的專案或對話') : elements.commandEmpty.dataset.default;
    elements.commandSearch.placeholder = label;
    elements.commandSearch.setAttribute('aria-label', label);
    byId('commandPaletteTitle').textContent = navigationPalette ? label : commandDialogLabel;
    paletteReturnFocus = trigger || document.activeElement;
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
