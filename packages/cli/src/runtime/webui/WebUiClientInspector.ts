type InspectorTab = "tasks" | "activity" | "changes" | "settings";

interface InspectorElements {
  inspector: HTMLElement;
  inspectorBackdrop: HTMLElement;
  inspectorButton: HTMLButtonElement;
  inspectorClose: HTMLButtonElement;
  inspectorContent: HTMLElement;
  appShell: HTMLElement;
  menuButton: HTMLButtonElement;
  tasksTab: HTMLButtonElement;
  activityTab: HTMLButtonElement;
  changesTab: HTMLButtonElement;
  settingsTab: HTMLButtonElement;
  tasksPanel: HTMLElement;
  activityPanel: HTMLElement;
  changesPanel: HTMLElement;
  settingsPanel: HTMLElement;
}

interface InspectorState {
  activeInspectorTab: InspectorTab;
  inspectorScrollPositions: Record<InspectorTab, number>;
  inspectorReturnFocus: HTMLElement | null;
}

interface InspectorRuntime {
  elements: InspectorElements;
  state: InspectorState;
  syncSidebarInteractivity: () => void;
  syncScrollAffordance: (element: HTMLElement) => void;
}

/** Typed inspector lifecycle, focus containment, and tab controller. */
function createInspectorController(runtime: InspectorRuntime) {
  const { elements, state, syncSidebarInteractivity, syncScrollAffordance } =
    runtime;
  const tabNames: InspectorTab[] = ["tasks", "activity", "changes", "settings"];

  function setInspector(open: boolean, tab?: InspectorTab): void {
    const wasOpen = elements.inspector.classList.contains("is-open");
    if (open && !wasOpen) {
      state.inspectorReturnFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
    if (open) {
      elements.appShell.classList.remove("sidebar-open");
      elements.menuButton.setAttribute("aria-expanded", "false");
    }
    elements.inspector.classList.toggle("is-open", open);
    elements.inspectorBackdrop.classList.toggle("is-open", open);
    elements.inspectorBackdrop.hidden = !open;
    elements.inspector.setAttribute("aria-hidden", open ? "false" : "true");
    elements.inspector.inert = !open;
    elements.inspectorButton.setAttribute(
      "aria-expanded",
      open ? "true" : "false",
    );
    syncSidebarInteractivity();
    if (open && tab) selectInspectorTab(tab);
    if (open && !wasOpen) {
      elements.inspectorClose.focus();
    } else if (!open && wasOpen) {
      const returnTarget = state.inspectorReturnFocus?.isConnected
        ? state.inspectorReturnFocus
        : elements.inspectorButton;
      state.inspectorReturnFocus = null;
      returnTarget.focus();
    }
  }

  function trapInspectorFocus(event: KeyboardEvent): void {
    if (
      event.key !== "Tab" ||
      !elements.inspector.classList.contains("is-open")
    ) {
      return;
    }
    const focusable = Array.from(
      elements.inspector.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(
      (node) =>
        !node.hidden &&
        node.getClientRects().length > 0 &&
        getComputedStyle(node).visibility !== "hidden",
    );
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

  function selectInspectorTab(tab: InspectorTab): void {
    if (tab !== state.activeInspectorTab) {
      state.inspectorScrollPositions[state.activeInspectorTab] =
        elements.inspectorContent.scrollTop;
      state.activeInspectorTab = tab;
    }
    const active = {
      tasks: tab === "tasks",
      activity: tab === "activity",
      changes: tab === "changes",
      settings: tab === "settings",
    };
    const tabs: Array<readonly [HTMLButtonElement, boolean]> = [
      [elements.tasksTab, active.tasks],
      [elements.activityTab, active.activity],
      [elements.changesTab, active.changes],
      [elements.settingsTab, active.settings],
    ];
    for (const [button, selected] of tabs) {
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.tabIndex = selected ? 0 : -1;
    }
    elements.tasksPanel.hidden = !active.tasks;
    elements.activityPanel.hidden = !active.activity;
    elements.changesPanel.hidden = !active.changes;
    elements.settingsPanel.hidden = !active.settings;
    elements.inspectorContent.scrollTop =
      state.inspectorScrollPositions[tab] || 0;
    syncScrollAffordance(elements.inspectorContent);
  }

  function handleInspectorTabKeydown(event: KeyboardEvent): void {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const tabs = [
      elements.tasksTab,
      elements.activityTab,
      elements.changesTab,
      elements.settingsTab,
    ];
    const currentTarget =
      event.currentTarget instanceof HTMLButtonElement
        ? event.currentTarget
        : tabs[0];
    const current = Math.max(0, tabs.indexOf(currentTarget));
    let next = current;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else {
      next =
        (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
        tabs.length;
    }
    selectInspectorTab(tabNames[next]);
    tabs[next].focus();
  }

  return {
    setInspector,
    trapInspectorFocus,
    selectInspectorTab,
    handleInspectorTabKeydown,
  };
}

export const WEB_UI_CLIENT_INSPECTOR_SCRIPT =
  `  const { setInspector, trapInspectorFocus, selectInspectorTab, handleInspectorTabKeydown } = ` +
  `(${createInspectorController.toString()})({ elements, state, syncSidebarInteractivity, syncScrollAffordance });\n\n`;
