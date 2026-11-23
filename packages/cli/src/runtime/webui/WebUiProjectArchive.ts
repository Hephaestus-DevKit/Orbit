import { renderUiIcon } from "./WebUiIcon.js";
import type { WebUiLanguage } from "./WebUiPage.js";

type Project = { id: string; name: string; path: string; archivedAt?: string };
type Action = "archive" | "restore";

/** Localized controls for the project archive and its confirmation dialog. */
export function projectArchiveMarkup(language: WebUiLanguage) {
  const t = (en: string, zh: string, tw: string) =>
    language === "en" ? en : language === "zh-TW" ? tw : zh;
  const archive = t("Archive project", "归档项目", "封存專案");
  const restore = t("Restore project", "恢复项目", "還原專案");
  const archived = t("Archived projects", "已归档项目", "已封存專案");
  return {
    currentAction:
      `<button type="button" id="archiveCurrentProject" class="registered-project-remove" title="${archive}" aria-label="${archive}" hidden>${
        renderUiIcon("archive")
      }</button>`,
    list: `<details class="project-archive-list" id="projectArchiveList" hidden><summary>${
      renderUiIcon("archive")
    } ${archived} <span id="projectArchiveCount"></span></summary><div id="projectArchiveRows"></div></details>`,
    landing: `<section class="archived-workspace" id="archivedWorkspace" hidden>${
      renderUiIcon("archive")
    }<h2>${t("This project is archived", "这个项目已归档", "這個專案已封存")}</h2><p>${
      t("Restore it to continue its chats.", "恢复此项目即可继续聊天。", "還原此專案即可繼續對話。")
    }</p><button type="button" class="secondary-button" id="restoreCurrentProject">${restore}</button></section>`,
    dialog:
      `<dialog class="project-archive-dialog" id="projectArchiveDialog" aria-labelledby="projectArchiveTitle" aria-describedby="projectArchiveScope projectArchivePath">
      <form method="dialog"><h2 id="projectArchiveTitle">${
        t("Archive this project?", "归档这个项目？", "封存這個專案？")
      }</h2>
      <strong id="projectArchiveName"></strong><small id="projectArchivePath"></small>
      <p id="projectArchiveScope">${
        t(
          "All chats in this project will be archived with it. Your files and conversation history stay on disk. You can restore the project and its chats together.",
          "项目及其全部聊天会一起移入「已归档项目」。文件和聊天记录会保留，之后可以一起恢复。",
          "專案及其所有對話會一起移入「已封存專案」。檔案和對話記錄會保留，之後可以一起還原。",
        )
      }</p>
      <footer><button class="secondary-button" id="cancelProjectArchive" value="cancel" autofocus>${
        t("Cancel", "取消", "取消")
      }</button><button class="primary-button" id="confirmProjectArchive" value="archive">${archive}</button></footer></form></dialog>`,
  };
}

/** Keep dialog selection bound to the original registry id across background refreshes. */
export function bindProjectArchive(
  persist: (action: Action, id: string) => Promise<void>,
  ui: {
    ready: () => boolean;
    pending: (value: boolean) => void;
    reload: () => Promise<unknown>;
    success: (action: Action) => void;
    error: (message: string) => void;
  },
) {
  const get = (id: string) => document.getElementById(id)!;
  const dialog = get("projectArchiveDialog") as HTMLDialogElement;
  const list = get("projectArchiveList") as HTMLDetailsElement;
  const landing = get("archivedWorkspace");
  const rows = get("projectArchiveRows");
  const currentButton = get("archiveCurrentProject") as HTMLButtonElement;
  const restore = get("restoreCurrentProject");
  let entries: Project[] = [];
  let currentId = "";
  let selected = "";

  async function mutate(action: Action, id: string) {
    ui.pending(true);
    try {
      await persist(action, id);
      await ui.reload();
    } catch (error) {
      ui.error(error instanceof Error ? error.message : String(error));
      return;
    } finally {
      ui.pending(false);
    }
    ui.success(action);
    if (action === "archive") {
      list.open = true;
      (landing.hidden ? list.querySelector("summary") : restore)?.focus();
    } else if (id === currentId) {
      get("projectToggle").focus();
    } else {
      const restored = Array.from(
        get("projectList").querySelectorAll<HTMLElement>("[data-project-action]"),
      )
        .find(button => button.dataset.projectId === id)?.parentElement?.querySelector<
        HTMLButtonElement
      >("[data-project-path]");
      (restored ?? get("newProjectButton")).focus();
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && ui.ready()) void ui.reload().catch(() => {});
  });
  function request(id: string) {
    const project = entries.find(p => p.id === id);
    if (!ui.ready() || !project || project.archivedAt || dialog.open) return;
    selected = id;
    get("projectArchiveName").textContent = project.name;
    get("projectArchivePath").textContent = project.path;
    dialog.returnValue = "";
    dialog.showModal();
  }
  dialog.addEventListener("keydown", event => event.stopPropagation());
  dialog.querySelector("form")!.addEventListener("submit", event => {
    if ((event.submitter as HTMLButtonElement | null)?.value !== "archive") return;
    event.preventDefault();
    dialog.close("archive");
    if (ui.ready() && selected) void mutate("archive", selected);
  });
  currentButton.addEventListener("click", () => request(currentId));
  restore.addEventListener("click", () => {
    if (ui.ready() && currentId) void mutate("restore", currentId);
  });
  rows.addEventListener("click", event => {
    const id = (event.target as Element).closest<HTMLButtonElement>("button")?.dataset.id;
    if (id && ui.ready()) void mutate("restore", id);
  });
  let signature = "";
  return {
    request,
    setBusy(busy: boolean) {
      currentButton.disabled = busy;
      (restore as HTMLButtonElement).disabled = busy;
      for (const button of rows.querySelectorAll("button")) button.disabled = busy;
    },
    render(projects: Project[], id?: string) {
      entries = projects;
      currentId = id ?? "";
      const current = entries.find(p => p.id === currentId);
      currentButton.hidden = !current || !!current.archivedAt;
      currentButton.setAttribute(
        "aria-label",
        currentButton.title + (current ? " · " + current.name : ""),
      );
      landing.hidden = !current?.archivedAt;
      get("appShell").classList.toggle("project-is-archived", !landing.hidden);
      const archived = entries.filter(p => p.archivedAt);
      list.hidden = !archived.length;
      get("projectArchiveCount").textContent = String(archived.length);
      const next = JSON.stringify(archived.map(p => [p.id, p.name, p.path]));
      if (next === signature) return;
      signature = next;
      const focus = (document.activeElement as HTMLElement | null)?.dataset.id;
      rows.replaceChildren(...archived.map(project => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.id = project.id;
        button.className = "archive-restore-row";
        button.title = project.path;
        button.setAttribute(
          "aria-label",
          restore.textContent + " · " + project.name + " · " + project.path,
        );
        const label = document.createElement("span");
        const name = document.createElement("strong");
        name.textContent = project.name;
        const path = document.createElement("small");
        path.textContent = project.path;
        label.append(name, path);
        const action = document.createElement("span");
        action.textContent = restore.textContent;
        button.append(label, action);
        return button;
      }));
      if (focus)
        (Array.from(rows.querySelectorAll("button")).find(b => b.dataset.id === focus)
          ?? (list.hidden ? get("newProjectButton") : list.querySelector("summary")))?.focus();
    },
  };
}
