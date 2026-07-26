/** Workspace file picker used by the Web UI context controls. */
export const WEB_UI_CLIENT_CONTEXT_SCRIPT = String.raw`  let contextPickerFiles = [];
  let contextPickerSelection = 0;
  let contextPickerRequest = 0;
  let contextPickerTimer = 0;
  let contextPickerReturnFocus = null;

  function contextFileParts(path) {
    const normalized = String(path || '').replace(/\\/g, '/');
    const separator = normalized.lastIndexOf('/');
    return {
      name: separator >= 0 ? normalized.slice(separator + 1) : normalized,
      directory: separator >= 0 ? normalized.slice(0, separator) : copy.workspace,
    };
  }

  function activeContextPathSet() {
    const files = state.status && state.status.context && state.status.context.files;
    return new Set((Array.isArray(files) ? files : []).map((file) => String(file.path || '')));
  }

  function isActiveContextFile(path) {
    return activeContextPathSet().has(path);
  }

  function renderContextShelf(contextData) {
    const files = Array.isArray(contextData && contextData.files) ? contextData.files : [];
    const total = Number(contextData && contextData.relevantFiles || files.length);
    elements.contextFileList.replaceChildren();
    elements.contextShelf.hidden = total === 0;
    elements.contextShelf.setAttribute('aria-label', copy.activeContext + ' · ' + total);
    elements.clearContextButton.hidden = total === 0;
    elements.clearContextButton.disabled = state.busy || total === 0;

    for (const file of files) {
      const path = String(file.path || '');
      if (!path) continue;
      const parts = contextFileParts(path);
      const chip = document.createElement('span');
      chip.className = 'context-file-chip' + (file.readOnly ? ' is-read-only' : '');
      chip.title = path;
      const icon = document.createElement('span');
      icon.className = 'context-file-chip-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = file.readOnly ? '◇' : '·';
      const name = document.createElement('strong');
      name.textContent = parts.name;
      if (file.readOnly) {
        const readOnly = document.createElement('small');
        readOnly.textContent = copy.readOnlyContext;
        chip.append(icon, name, readOnly);
      } else {
        chip.append(icon, name);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'context-file-remove';
      remove.disabled = state.busy;
      remove.setAttribute('aria-label', copy.removeContext + ': ' + path);
      remove.title = copy.removeContext;
      remove.textContent = '×';
      remove.addEventListener('click', () => removeContextFile(path));
      chip.append(remove);
      elements.contextFileList.append(chip);
    }

    if (total > files.length) {
      const overflow = document.createElement('span');
      overflow.className = 'context-file-overflow';
      overflow.textContent = '+' + (total - files.length) + ' ' + copy.contextMore;
      elements.contextFileList.append(overflow);
    }
  }

  function renderContextPicker() {
    elements.contextResults.replaceChildren();
    const activePaths = activeContextPathSet();
    for (const [index, path] of contextPickerFiles.entries()) {
      const parts = contextFileParts(path);
      const added = activePaths.has(path);
      const button = document.createElement('button');
      button.type = 'button';
      button.id = 'context-result-' + index;
      button.className = 'context-result' + (added ? ' is-added' : '');
      button.dataset.contextPath = path;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', !added && index === contextPickerSelection ? 'true' : 'false');
      button.setAttribute('aria-disabled', added ? 'true' : 'false');
      button.disabled = added;
      const icon = document.createElement('span');
      icon.className = 'context-result-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '◇';
      const body = document.createElement('span');
      body.className = 'context-result-copy';
      const name = document.createElement('strong');
      name.textContent = parts.name;
      const directory = document.createElement('small');
      directory.textContent = parts.directory;
      body.append(name, directory);
      const action = document.createElement('span');
      action.className = 'context-result-action';
      action.textContent = added ? copy.contextAdded : language !== 'en' ? chinese('添加', '加入') : 'Add';
      button.append(icon, body, action);
      button.addEventListener('mouseenter', () => {
        if (added) return;
        contextPickerSelection = index;
        syncContextPickerSelection();
      });
      button.addEventListener('click', () => addContextFile(index));
      elements.contextResults.append(button);
    }
    elements.contextEmpty.hidden = contextPickerFiles.length !== 0;
    syncContextPickerSelection();
  }

  function syncContextPickerSelection() {
    let activeId = '';
    elements.contextResults.querySelectorAll('.context-result').forEach((button, index) => {
      const selected = !button.disabled && index === contextPickerSelection;
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      if (selected) {
        activeId = button.id;
        button.scrollIntoView({ block: 'nearest' });
      }
    });
    if (activeId) elements.contextSearch.setAttribute('aria-activedescendant', activeId);
    else elements.contextSearch.removeAttribute('aria-activedescendant');
  }

  async function refreshContextPicker() {
    const requestId = ++contextPickerRequest;
    elements.contextPicker.classList.add('is-loading');
    elements.contextEmpty.hidden = false;
    elements.contextEmpty.textContent = language !== 'en' ? chinese('正在搜索工作区…', '正在搜尋工作區…') : 'Searching workspace…';
    try {
      const query = encodeURIComponent(elements.contextSearch.value.trim());
      const result = await api('/api/completions?query=' + query);
      if (requestId !== contextPickerRequest || elements.contextPicker.hidden) return;
      contextPickerFiles = Array.isArray(result.files) ? result.files : [];
      contextPickerSelection = contextPickerFiles.findIndex((path) => !isActiveContextFile(path));
      elements.contextEmpty.textContent = language !== 'en' ? chinese('没有匹配的工作区文件', '沒有相符的工作區檔案') : 'No matching workspace files';
      renderContextPicker();
    } catch (error) {
      if (requestId !== contextPickerRequest || elements.contextPicker.hidden) return;
      contextPickerFiles = [];
      elements.contextResults.replaceChildren();
      elements.contextEmpty.hidden = false;
      elements.contextEmpty.textContent = error.message || String(error);
    } finally {
      if (requestId === contextPickerRequest) elements.contextPicker.classList.remove('is-loading');
    }
  }

  function queueContextPickerRefresh() {
    if (contextPickerTimer) window.clearTimeout(contextPickerTimer);
    contextPickerTimer = window.setTimeout(() => {
      contextPickerTimer = 0;
      void refreshContextPicker();
    }, 90);
  }

  function openContextPicker() {
    if (state.busy || !state.ready) {
      if (!state.ready) showToast(copy.waitForConnection, 'warning');
      return;
    }
    if (!elements.contextPicker.hidden) {
      elements.contextSearch.focus();
      return;
    }
    contextPickerReturnFocus = document.activeElement;
    elements.contextPicker.hidden = false;
    elements.contextPicker.setAttribute('aria-hidden', 'false');
    elements.contextPickerButton.setAttribute('aria-expanded', 'true');
    elements.contextSearch.value = '';
    contextPickerFiles = [];
    contextPickerSelection = 0;
    renderContextPicker();
    closeSidebar();
    requestAnimationFrame(() => elements.contextSearch.focus());
    void refreshContextPicker();
  }

  function closeContextPicker(options) {
    if (elements.contextPicker.hidden) return;
    contextPickerRequest += 1;
    if (contextPickerTimer) window.clearTimeout(contextPickerTimer);
    contextPickerTimer = 0;
    elements.contextPicker.hidden = true;
    elements.contextPicker.setAttribute('aria-hidden', 'true');
    elements.contextPickerButton.setAttribute('aria-expanded', 'false');
    elements.contextSearch.removeAttribute('aria-activedescendant');
    const returnTarget = contextPickerReturnFocus;
    contextPickerReturnFocus = null;
    if (!(options && options.skipRestore) && returnTarget && returnTarget.isConnected) returnTarget.focus();
  }

  function moveContextPickerSelection(delta) {
    if (!contextPickerFiles.length) return;
    let next = contextPickerSelection;
    for (let attempts = 0; attempts < contextPickerFiles.length; attempts += 1) {
      next = (next + delta + contextPickerFiles.length) % contextPickerFiles.length;
      if (!isActiveContextFile(contextPickerFiles[next])) {
        contextPickerSelection = next;
        syncContextPickerSelection();
        return;
      }
    }
  }

  function setContextPickerBoundary(fromEnd) {
    const indices = contextPickerFiles.map((_, index) => index);
    if (fromEnd) indices.reverse();
    const next = indices.find((index) => !isActiveContextFile(contextPickerFiles[index]));
    contextPickerSelection = next === undefined ? -1 : next;
    syncContextPickerSelection();
  }

  function addContextFile(index) {
    const path = contextPickerFiles[index];
    if (!path || state.busy) return;
    if (isActiveContextFile(path)) {
      showToast(copy.contextAdded);
      return;
    }
    const draft = elements.prompt.value;
    closeContextPicker({ skipRestore: true });
    void submitTurn('/add ' + path, { restoreDraft: draft });
  }

  function removeContextFile(path) {
    if (!path || state.busy || !state.ready) {
      if (!state.ready) showToast(copy.waitForConnection, 'warning');
      return;
    }
    const draft = elements.prompt.value;
    void submitTurn('/drop ' + path, { restoreDraft: draft });
  }

  function clearContextFiles() {
    if (state.busy || !state.ready) {
      if (!state.ready) showToast(copy.waitForConnection, 'warning');
      return;
    }
    const draft = elements.prompt.value;
    void submitTurn('/drop all', { restoreDraft: draft });
  }
`;
