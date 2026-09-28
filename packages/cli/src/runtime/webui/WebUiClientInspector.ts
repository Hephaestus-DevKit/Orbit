type InspectorTab = "tasks" | "activity" | "changes" | "settings";

interface InspectorElements {
  inspector: HTMLElement;
  inspectorBackdrop: HTMLElement;
  inspectorButton: HTMLButtonElement;
  inspectorClose: HTMLButtonElement;
  inspectorContent: HTMLElement;
  runContent: HTMLElement;
  appShell: HTMLElement;
  menuButton: HTMLButtonElement;
  tasksTab: HTMLButtonElement;
  activityTab: HTMLButtonElement;
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
  setWorkbench: (tab: "run" | "changes" | null, moveFocus?: boolean) => void;
}

/** Typed inspector lifecycle, focus containment, and tab controller. */
function createInspectorController(runtime: InspectorRuntime) {
  const {
    elements,
    state,
    syncSidebarInteractivity,
    syncScrollAffordance,
    setWorkbench,
  } = runtime;
  const tabNames: InspectorTab[] = ["tasks", "activity"];
  const sectionButtons = Array.from(
    elements.settingsPanel.querySelectorAll<HTMLButtonElement>(
      "[data-settings-target]",
    ),
  );

  function syncSettingsSection(): void {
    if (elements.settingsPanel.hidden) return;
    const content = elements.inspectorContent;
    const index =
      elements.settingsPanel.querySelector<HTMLElement>(".settings-index");
    const threshold =
      content.getBoundingClientRect().top + (index?.offsetHeight ?? 0) + 16;
    let current = sectionButtons[0];
    for (const button of sectionButtons) {
      const target = document.getElementById(
        button.dataset.settingsTarget ?? "",
      );
      if (target && target.getBoundingClientRect().top <= threshold)
        current = button;
    }
    // The final section can be too short to reach the sticky index.
    if (
      content.scrollTop > 0 &&
      content.scrollHeight - content.clientHeight - content.scrollTop <= 2
    ) {
      current = sectionButtons[sectionButtons.length - 1];
    }
    for (const button of sectionButtons) {
      if (button === current) button.setAttribute("aria-current", "location");
      else button.removeAttribute("aria-current");
    }
  }

  function navigateSettingsSection(id: string): void {
    const target = document.getElementById(id);
    if (!target || !elements.settingsPanel.contains(target)) return;
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "start" });
    syncSettingsSection();
  }

  elements.inspectorContent.addEventListener("scroll", syncSettingsSection, {
    passive: true,
  });
  window.addEventListener("resize", syncSettingsSection, { passive: true });

  function setInspector(open: boolean, tab?: InspectorTab): void {
    if (open && tab && tab !== "settings") {
      if (elements.inspector.classList.contains("is-open")) setInspector(false);
      selectInspectorTab(tab);
      if (tab === "tasks") elements.tasksTab.focus();
      else if (tab === "activity") elements.activityTab.focus();
      return;
    }
    const wasOpen = elements.inspector.classList.contains("is-open");
    if (!open && !wasOpen) {
      setWorkbench(null);
      return;
    }
    if (open && !wasOpen) {
      state.inspectorReturnFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
    document.dispatchEvent(new Event("orbit:surface-change"));
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
    if (open) syncSettingsSection();
    if (open && !wasOpen) {
      elements.inspectorClose.focus();
    } else if (!open && wasOpen) {
      const returnTarget = state.inspectorReturnFocus?.isConnected
        ? state.inspectorReturnFocus
        : elements.inspectorButton;
      state.inspectorReturnFocus = null;
      (returnTarget.closest("[inert], [hidden]")
        ? elements.menuButton
        : returnTarget
      ).focus();
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
    if (tab === "settings") {
      setInspector(true, "settings");
      return;
    }
    if (tab === "changes") {
      setWorkbench("changes");
      return;
    }
    // Reveal the scroll container before reading or restoring its position.
    setWorkbench("run", false);
    const changed = tab !== state.activeInspectorTab;
    if (changed) {
      state.inspectorScrollPositions[state.activeInspectorTab] =
        elements.runContent.scrollTop;
      state.activeInspectorTab = tab;
    }
    const active = {
      tasks: tab === "tasks",
      activity: tab === "activity",
    };
    const tabs: Array<readonly [HTMLButtonElement, boolean]> = [
      [elements.tasksTab, active.tasks],
      [elements.activityTab, active.activity],
    ];
    for (const [button, selected] of tabs) {
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.tabIndex = selected ? 0 : -1;
    }
    elements.tasksPanel.hidden = !active.tasks;
    elements.activityPanel.hidden = !active.activity;
    if (changed)
      elements.runContent.scrollTop = state.inspectorScrollPositions[tab] || 0;
    syncScrollAffordance(elements.runContent);
  }

  function handleInspectorTabKeydown(event: KeyboardEvent): void {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const tabs = [elements.tasksTab, elements.activityTab];
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
    navigateSettingsSection,
  };
}

export const WEB_UI_CLIENT_INSPECTOR_SCRIPT =
  `  const { setInspector, trapInspectorFocus, selectInspectorTab, handleInspectorTabKeydown, navigateSettingsSection } = ` +
  `(${createInspectorController.toString()})({ elements, state, syncSidebarInteractivity, syncScrollAffordance, setWorkbench });\n\n`;
