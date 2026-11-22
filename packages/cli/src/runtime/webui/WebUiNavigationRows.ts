/** Compare Windows drive and UNC paths without folding the case of POSIX workspace names. */
export function projectPathKey(path: string): string {
  return /^(?:[A-Za-z]:|\\\\)/.test(path) ? path.replace(/\\/g, "/").toLowerCase() : path;
}

/** Show the shortest distinguishing folder suffix only for projects sharing a display name. */
export function projectFolderHints(
  projects: ReadonlyArray<{ name: string; path: string }>,
): Map<string, string> {
  const hints = new Map<string, string>();
  const parents = projects.map(({ path }) => {
    const windows = /^(?:[A-Za-z]:|\\\\)/.test(path);
    const separator = windows && path.includes("\\") ? "\\" : "/";
    const parts = (windows ? path.replace(/\\/g, "/") : path).split("/").filter(Boolean);
    return { parts: parts.slice(0, -1), separator };
  });
  for (const [index, project] of projects.entries()) {
    const others = parents.filter((_, i) => i !== index && projects[i].name === project.name);
    if (!others.length) continue;
    const { parts, separator } = parents[index];
    let count = 1;
    while (
      count < parts.length
      && others.some(parent =>
        parent.parts.slice(-count).join("/") === parts.slice(-count).join("/")
      )
    ) count++;
    hints.set(project.path, parts.slice(-count).join(separator) || separator);
  }
  return hints;
}

/** Retain unchanged navigation controls while a live session moves, updates, or disappears. */
export function createNavigationRows() {
  const signatures = new WeakMap<HTMLElement, string>();
  return function reconcile<T>(
    container: HTMLElement,
    items: T[],
    id: (item: T) => string,
    content: (item: T) => unknown[],
    render: (item: T) => HTMLElement,
  ): void {
    const old = Array.from(container.children) as HTMLElement[];
    const byId = new Map(old.map(row => [row.dataset.navigationId, row]));
    const focused = container.contains(document.activeElement)
      ? document.activeElement as HTMLElement
      : null;
    const focusedRow = focused?.closest<HTMLElement>("[data-navigation-id]");
    const action = focused?.dataset.sessionAction || focused?.dataset.projectAction;

    for (const [index, item] of items.entries()) {
      const key = id(item);
      const signature = JSON.stringify(content(item));
      let row = byId.get(key);
      if (!row || signatures.get(row) !== signature) {
        const updated = render(item);
        updated.dataset.navigationId = key;
        signatures.set(updated, signature);
        row?.replaceWith(updated);
        row = updated;
      }
      if (container.children[index] !== row)
        container.insertBefore(row, container.children[index] ?? null);
      byId.delete(key);
    }
    for (const row of byId.values()) row.remove();

    if (!focusedRow || !focused || document.activeElement === focused) return;
    const rows = Array.from(container.children) as HTMLElement[];
    const target = rows.find(row => row.dataset.navigationId === focusedRow.dataset.navigationId)
      ?? rows[Math.min(old.indexOf(focusedRow), rows.length - 1)];
    const buttons = target?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
    const equivalent = Array.from(buttons ?? []).find(button =>
      (button.dataset.sessionAction || button.dataset.projectAction) === action
    );
    (equivalent ?? buttons?.[0])?.focus({ preventScroll: true });
  };
}

/** Dismiss the current folder disclosure when focus leaves it or Escape is pressed. */
export function bindWorkspaceLocation(location: HTMLDetailsElement): void {
  const closeOutside = (event: Event) => {
    if (location.open && event.target instanceof Node && !location.contains(event.target)) {
      location.open = false;
    }
  };
  document.addEventListener("pointerdown", closeOutside);
  document.addEventListener("focusin", closeOutside);
  location.addEventListener("keydown", event => {
    if (event.key !== "Escape" || event.isComposing || event.keyCode === 229 || !location.open)
      return;
    event.preventDefault();
    location.open = false;
    location.querySelector("summary")?.focus();
  });
}
