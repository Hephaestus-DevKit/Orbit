/** Inspector lifecycle, focus containment, tabs, and per-tab scroll state. */
export const WEB_UI_CLIENT_INSPECTOR_SCRIPT = String.raw`
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

  function selectInspectorTab(tab) {
    if (tab !== state.activeInspectorTab) {
      state.inspectorScrollPositions[state.activeInspectorTab] = elements.inspectorContent.scrollTop;
      state.activeInspectorTab = tab;
    }
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
    elements.inspectorContent.scrollTop = state.inspectorScrollPositions[tab] || 0;
    syncScrollAffordance(elements.inspectorContent);
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

`;
