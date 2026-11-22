export type UiIcon =
  | "add"
  | "tasks"
  | "diagnostics"
  | "changes"
  | "context"
  | "image"
  | "commands"
  | "menu"
  | "panel"
  | "back"
  | "close"
  | "up"
  | "down"
  | "restore"
  | "delete"
  | "archive"
  | "search"
  | "folder"
  | "review"
  | "fix"
  | "explain"
  | "improve";

export function renderUiIcon(name: UiIcon): string {
  const paths: Record<UiIcon, string> = {
    add: '<path d="M12 5v14M5 12h14" />',
    tasks:
      '<rect x="5" y="4.5" width="14" height="15" rx="2" /><path d="m8 9 1.5 1.5L12 8M13.5 10h2.5M8 14h8M8 17h5" />',
    diagnostics: '<path d="M4.5 12h3l1.7-4 3.1 8 1.7-4h5.5" /><path d="M6 5.5h12v13H6z" />',
    changes: '<path d="M5 7h14M5 12h14M5 17h14" /><path d="M8 5v4M15 10v4M11 15v4" />',
    context: '<path d="M7 4.5h7l3 3v12H7z" /><path d="M14 4.5v3h3M9.5 12h5M12 9.5v5" />',
    image:
      '<rect x="4.5" y="5" width="15" height="14" rx="2" /><circle cx="9" cy="9.5" r="1.5" /><path d="m6.5 17 4-4 2.5 2 2.5-3 2.5 5" />',
    commands:
      '<rect x="4.5" y="5.5" width="15" height="13" rx="2" /><path d="m8 10 2 2-2 2M12.5 14h3.5" />',
    menu: '<path d="M5 7h14M5 12h14M5 17h14" />',
    panel: '<rect x="4.5" y="5" width="15" height="14" rx="2" /><path d="M14 5v14" />',
    close: '<path d="m7 7 10 10M17 7 7 17" />',
    back: '<path d="m10 6-6 6 6 6M4 12h16" />',
    up: '<path d="m7 14 5-5 5 5" />',
    down: '<path d="m7 10 5 5 5-5" />',
    archive: '<path d="M5.5 8.5h13v10h-13zM4.5 5h15v3.5h-15zM9.5 12h5" />',
    restore: '<path d="M8 8H4V4M4.5 8a8 8 0 1 1-.2 7" />',
    delete: '<path d="M8 7v11M12 7v11M16 7v11M5 5h14M9 5V3h6v2M6.5 5l1 16h9l1-16" />',
    search: '<circle cx="10.5" cy="10.5" r="5.5" /><path d="m14.7 14.7 4.3 4.3" />',
    folder:
      '<path d="M3.5 7V6a1 1 0 0 1 1-1H10l2 2h7.5a1 1 0 0 1 1 1v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17V7z" />',
    review:
      '<circle cx="10.5" cy="10.5" r="5.5" /><path d="m14.7 14.7 4.3 4.3M10.5 8v5M8 10.5h5" />',
    fix:
      '<path d="M14.5 5.5a4 4 0 0 0-4.8 5.2L5 15.4 8.6 19l4.7-4.7a4 4 0 0 0 5.2-4.8l-2.7 2.7-3-3z" />',
    explain: '<path d="m9 7-5 5 5 5M15 7l5 5-5 5M13 5l-2 14" />',
    improve:
      '<path d="M12 4l1.2 4.1L17 10l-3.8 1.9L12 16l-1.2-4.1L7 10l3.8-1.9zM18 16v4M16 18h4M5 4v3M3.5 5.5h3" />',
  };
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">${
    paths[name]
  }</svg>`;
}
