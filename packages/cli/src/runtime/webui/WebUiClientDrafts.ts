type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Keep unsent text with its workspace and chat, including when Safari storage is unavailable. */
export function createConversationDrafts(storage: () => DraftStorage) {
  const legacy = "orbit.webui.draft";
  const fallback = new Map<string, string>();
  let active: string | null = null;

  function key(workspace: string, session: string): string {
    return legacy + "." + JSON.stringify([workspace, session]);
  }

  function read(scope: string): string {
    if (fallback.has(scope)) return fallback.get(scope)!;
    try {
      return storage().getItem(scope) || "";
    } catch {
      return "";
    }
  }

  function write(scope: string, value: string): void {
    try {
      if (value) storage().setItem(scope, value);
      else storage().removeItem(scope);
      fallback.delete(scope);
    } catch {
      fallback.set(scope, value);
    }
  }

  return {
    get active() {
      return active;
    },
    key,
    read,
    write,
    save(value: string) {
      if (active !== null) write(active, value);
    },
    recover(scope: string, original: string, currentInput: string): string | undefined {
      const current = active === scope ? currentInput : read(scope);
      const recovered = current && current !== original ? original + "\n\n" + current : original;
      write(scope, recovered);
      return active === scope ? recovered : undefined;
    },
    activate(workspace: string, session: string, input: string): string | undefined {
      const next = key(workspace, session);
      if (active === next) return;
      const first = active === null;
      active = next;
      const saved = read(next);
      const old = first ? read(legacy) : "";
      const value = first && input ? input : saved || old;
      if (first && (input || old)) {
        write(next, value);
        if (!fallback.has(next)) write(legacy, "");
      }
      return value;
    },
  };
}

/** Bind draft ownership only after the authenticated status identifies a workspace and chat. */
export const WEB_UI_CLIENT_DRAFTS_SCRIPT = String
  .raw`  const drafts = (${createConversationDrafts.toString()})(() => localStorage);
  function activateComposerDraft(workspace, session) {
    const previousScope = drafts.active;
    const value = drafts.activate(workspace, session, elements.prompt.value);
    if (value !== undefined) {
      switchAttachmentDraft(previousScope, drafts.active);
      elements.prompt.value = value;
      autoSizePrompt();
      updateSendButtonState();
      closeSlashCommands();
      if (value && previousScope === null) showToast(copy.draftRestored);
    }
  }
`;
