import { createPreviewGeometry } from "./WebUiBrowserPreviewLayout.js";

type WorkbenchTab = "browser" | "changes" | "run";

interface WorkbenchRuntime {
  geometry: ReturnType<typeof createPreviewGeometry>;
  readWidth: () => number;
  saveWidth: (width: number) => void;
  syncSidebarInteractivity: () => void;
  closeSidebar: () => void;
}

/** Owns the nonmodal workspace. Switching surfaces never destroys their DOM or session. */
export function createWorkbenchController(runtime: WorkbenchRuntime) {
  const get = (id: string) => document.getElementById(id)!;
  const workbench = get("workbench");
  const workspace = workbench.parentElement!;
  const shell = get("appShell");
  const conversation = get("conversation");
  const focus = get("browserPreviewFocus") as HTMLButtonElement;
  const focusLabel = get("browserPreviewFocusLabel");
  const hide = get("browserPreviewHide");
  const divider = get("browserPreviewDivider");
  const tabs: WorkbenchTab[] = ["browser", "changes", "run"];
  const panels = [
    get("browserPreviewPanel"),
    get("changesPanel"),
    get("runPanel"),
  ];
  const buttons = [get("browserTab"), get("changesTab"), get("runTab")];
  const launchers = [
    get("browserPreviewButton"),
    get("changesButton"),
    get("tasksButton"),
  ];
  let active: WorkbenchTab = "browser";
  let preferred = runtime.readWidth();
  let focused = false;
  let returnFocus: HTMLElement | null = null;
  let layout = runtime.geometry.dock(workspace.clientWidth, preferred);

  function resize(): void {
    // Yield navigation space before falling back to a single useful surface.
    const autoCollapse =
      !workbench.hidden &&
      window.innerWidth > 900 &&
      window.innerWidth < (active === "browser" ? 1340 : 1140);
    shell.classList.toggle("sidebar-workbench-collapsed", autoCollapse);
    runtime.syncSidebarInteractivity();
    layout = runtime.geometry.dock(
      workspace.clientWidth,
      preferred,
      active === "browser" ? 740 : 440,
    );
    const solo = !workbench.hidden && (focused || layout.narrow);
    workspace.style.setProperty("--preview-width", layout.percent + "%");
    workspace.classList.toggle("is-preview-focus", solo);
    if (solo && conversation.contains(document.activeElement))
      buttons[tabs.indexOf(active)].focus();
    conversation.inert = solo;
    hide.setAttribute(
      "aria-label",
      solo
        ? hide.dataset.returnLabel || "Back to chat"
        : hide.dataset.hideLabel || "Hide workspace",
    );
    hide.setAttribute(
      "title",
      solo
        ? hide.dataset.returnTitle || "Back to chat · keep tabs open"
        : hide.dataset.hideTitle || "Hide · keep tabs open",
    );
    focus.setAttribute("aria-pressed", String(solo));
    focusLabel.textContent = solo
      ? focus.dataset.splitLabel || "Split view"
      : focus.dataset.focusLabel || "Expand";
    focus.hidden = layout.narrow;
    focus.disabled = layout.narrow;
    divider.hidden = solo;
    divider.setAttribute("aria-valuemin", String(layout.min));
    divider.setAttribute("aria-valuemax", String(layout.max));
    divider.setAttribute("aria-valuenow", String(Math.round(layout.percent)));
  }

  function setWorkbench(tab: WorkbenchTab | null, moveFocus = true): void {
    document.dispatchEvent(new Event("orbit:surface-change"));
    const wasHidden = workbench.hidden;
    if (tab && wasHidden)
      returnFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    if (tab) active = tab;
    workbench.hidden = !tab;
    workspace.classList.toggle("is-preview-open", Boolean(tab));
    for (let index = 0; index < tabs.length; index++) {
      const selected = tabs[index] === active;
      panels[index].hidden = !tab || !selected;
      buttons[index].setAttribute("aria-selected", String(selected));
      buttons[index].classList.toggle("is-active", selected);
      buttons[index].tabIndex = selected ? 0 : -1;
      launchers[index].setAttribute(
        "aria-expanded",
        String(Boolean(tab) && selected),
      );
    }
    if (tab) runtime.closeSidebar();
    resize();
    workbench.dispatchEvent(
      new CustomEvent("orbit:workbench", { detail: { tab, moveFocus } }),
    );
    if (moveFocus && tab && tab !== "browser")
      buttons[tabs.indexOf(tab)].focus();
    if (!tab && !wasHidden && moveFocus) {
      const target =
        returnFocus?.isConnected && !returnFocus.closest("[inert], [hidden]")
          ? returnFocus
          : launchers[tabs.indexOf(active)];
      target.focus();
      returnFocus = null;
    }
  }

  function resizeTo(percent: number): void {
    preferred = runtime.geometry.dock(
      workspace.clientWidth,
      percent,
      active === "browser" ? 740 : 440,
    ).percent;
    resize();
    runtime.saveWidth(preferred);
  }
  buttons.forEach((button, index) => {
    button.addEventListener("click", () => setWorkbench(tabs[index], false));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? 2
            : (index + (event.key === "ArrowLeft" ? -1 : 1) + 3) % 3;
      setWorkbench(tabs[next], false);
      buttons[next].focus();
    });
  });
  get("browserPreviewButton").addEventListener("click", () =>
    setWorkbench(!workbench.hidden && active === "browser" ? null : "browser"),
  );
  hide.addEventListener("click", () => {
    const returnToDraft = conversation.inert;
    setWorkbench(null, !returnToDraft);
    if (returnToDraft) get("prompt").focus();
  });
  focus.addEventListener("click", () => {
    document.dispatchEvent(new Event("orbit:surface-change"));
    focused = !focused;
    resize();
  });
  divider.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    resizeTo(
      event.key === "Home"
        ? 54
        : event.key === "End"
          ? layout.max
          : layout.percent + (event.key === "ArrowLeft" ? 2 : -2),
    );
  });
  divider.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    divider.setPointerCapture(event.pointerId);
    workspace.classList.add("is-preview-resizing");
  });
  divider.addEventListener("pointermove", (event) => {
    if (!divider.hasPointerCapture(event.pointerId)) return;
    const rect = workspace.getBoundingClientRect();
    resizeTo(((rect.right - event.clientX) / rect.width) * 100);
  });
  const finishResize = (event: PointerEvent) => {
    if (divider.hasPointerCapture(event.pointerId))
      divider.releasePointerCapture(event.pointerId);
    workspace.classList.remove("is-preview-resizing");
  };
  divider.addEventListener("pointerup", finishResize);
  divider.addEventListener("pointercancel", finishResize);
  divider.addEventListener("lostpointercapture", () =>
    workspace.classList.remove("is-preview-resizing"),
  );
  divider.addEventListener("dblclick", () => resizeTo(54));
  const observer = new ResizeObserver(resize);
  observer.observe(workspace);
  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("beforeunload", () => observer.disconnect());
  return {
    setWorkbench,
    showConversation() {
      focused = false;
      if (layout.narrow) setWorkbench(null, false);
      else resize();
    },
  };
}

export const WEB_UI_CLIENT_WORKBENCH_SCRIPT = `const { setWorkbench, showConversation } = (${createWorkbenchController.toString()})({ geometry: (${createPreviewGeometry.toString()})(), readWidth: () => Number(readLocalStorage('orbit.webui.previewWidth', '54')), saveWidth: (width) => writeLocalStorage('orbit.webui.previewWidth', String(width)), syncSidebarInteractivity, closeSidebar });\n`;
