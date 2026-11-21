interface BrowserAttachment {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  previewUrl: string;
}

interface AttachmentCopy {
  removeAttachment: string;
  attachmentLimit: string;
  attachmentAdded: string;
  attachmentRemoved: string;
}

interface AttachmentElements {
  attachmentList: HTMLElement;
  attachmentShelf: HTMLElement;
  attachmentCount: HTMLElement;
  attachmentButton: HTMLButtonElement;
  attachmentInput: HTMLInputElement;
}

interface AttachmentState {
  attachments: BrowserAttachment[];
}

interface AttachmentRuntime {
  copy: AttachmentCopy;
  elements: AttachmentElements;
  state: AttachmentState;
  api: (path: string, init?: RequestInit) => Promise<unknown>;
  showToast: (message: string, tone?: string) => void;
  updateSendButtonState: () => void;
}

/** Typed browser factory for image attachment lifecycle management. */
function createAttachmentController(runtime: AttachmentRuntime) {
  const { copy, elements, state, api, showToast, updateSendButtonState } = runtime;

  const inactive = new Map<string, BrowserAttachment[]>();
  const uploads = new WeakMap<BrowserAttachment[], number>();
  const discarded = new WeakSet<BrowserAttachment[]>();

  function switchAttachmentDraft(previous: string | null, next: string): void {
    if (previous === null) return;
    if (state.attachments.length || uploads.get(state.attachments)) {
      inactive.set(previous, state.attachments);
    }
    state.attachments = inactive.get(next) ?? [];
    inactive.delete(next);
    renderAttachments();
  }

  function releaseUpload(id: string): void {
    void api(`/api/attachment?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
  }

  function discardAttachmentDraft(key: string): void {
    const group = inactive.get(key);
    if (!group) return;
    inactive.delete(key);
    discarded.add(group);
    for (const attachment of group) {
      URL.revokeObjectURL(attachment.previewUrl);
      releaseUpload(attachment.id);
    }
    group.length = 0;
  }

  function renderAttachments(): void {
    elements.attachmentList.replaceChildren();
    elements.attachmentShelf.hidden = state.attachments.length === 0;
    elements.attachmentCount.textContent = String(state.attachments.length);
    elements.attachmentCount.hidden = state.attachments.length === 0;
    elements.attachmentCount.setAttribute(
      "aria-label",
      String(state.attachments.length),
    );
    elements.attachmentButton.disabled = state.attachments.length >= 4;
    for (const attachment of state.attachments) {
      const card = document.createElement("div");
      card.className = "attachment-card";
      const image = document.createElement("img");
      image.src = attachment.previewUrl;
      image.alt = "";
      const copyBlock = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = attachment.name;
      name.title = attachment.name;
      const size = document.createElement("small");
      size.textContent = `${Math.max(1, Math.round(attachment.size / 1024))} KB`;
      copyBlock.append(name, size);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.dataset.attachmentRemove = attachment.id;
      remove.textContent = "×";
      remove.setAttribute("aria-label", copy.removeAttachment);
      card.append(image, copyBlock, remove);
      elements.attachmentList.append(card);
    }
    updateSendButtonState();
  }

  async function uploadAttachment(
    file: File | null | undefined,
    group = state.attachments,
  ): Promise<void> {
    if (discarded.has(group)) return;
    if (
      !file
      || !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
        file.type,
      )
    ) {
      showToast(copy.attachmentLimit, "warning");
      return;
    }
    if (
      file.size <= 0
      || file.size > 5 * 1024 * 1024
      || group.length + (uploads.get(group) ?? 0) >= 4
    ) {
      showToast(copy.attachmentLimit, "warning");
      return;
    }
    uploads.set(group, (uploads.get(group) ?? 0) + 1);
    if (group === state.attachments) elements.attachmentButton.disabled = true;
    try {
      const result = (await api(
        `/api/attachment?name=${encodeURIComponent(file.name || "image")}`,
        {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        },
      )) as { attachment?: Partial<BrowserAttachment> };
      const attachment = result.attachment || {};
      if (discarded.has(group)) {
        if (attachment.id) releaseUpload(attachment.id);
        return;
      }
      group.push({
        id: String(attachment.id || ""),
        name: attachment.name || file.name || "image",
        mediaType: attachment.mediaType || file.type,
        size: Number(attachment.size || file.size),
        previewUrl: URL.createObjectURL(file),
      });
      if (group === state.attachments) {
        renderAttachments();
        showToast(copy.attachmentAdded, "success");
      }
    } catch (error: unknown) {
      showToast(
        error instanceof Error ? error.message : String(error),
        "error",
      );
    } finally {
      uploads.set(group, (uploads.get(group) ?? 1) - 1);
      elements.attachmentButton.disabled =
        state.attachments.length + (uploads.get(state.attachments) ?? 0) >= 4;
      elements.attachmentInput.value = "";
    }
  }

  async function addAttachmentFiles(
    files: Iterable<File> | ArrayLike<File> | null | undefined,
  ): Promise<void> {
    const group = state.attachments;
    for (
      const file of Array.from(files || []).slice(
        0,
        4 - group.length,
      )
    ) {
      await uploadAttachment(file, group);
    }
  }

  async function removeAttachment(id: string, notify: boolean): Promise<void> {
    const group = state.attachments;
    const index = group.findIndex(
      (attachment) => attachment.id === id,
    );
    if (index === -1) return;
    const attachment = group[index];
    const removeButton = elements.attachmentList.querySelector<HTMLButtonElement>(
      `[data-attachment-remove="${CSS.escape(id)}"]`,
    );
    if (removeButton) removeButton.disabled = true;
    try {
      await api(`/api/attachment?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const currentIndex = group.findIndex(
        (item) => item.id === id,
      );
      if (currentIndex !== -1) group.splice(currentIndex, 1);
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      renderAttachments();
      if (notify && group === state.attachments) showToast(copy.attachmentRemoved);
    } catch (error: unknown) {
      if (removeButton) removeButton.disabled = false;
      showToast(
        error instanceof Error ? error.message : String(error),
        "error",
      );
    }
  }

  function consumeAttachments(ids: string[] | null | undefined, group = state.attachments): void {
    const consumed = new Set(ids || []);
    for (const attachment of group.slice()) {
      if (!consumed.has(attachment.id)) continue;
      URL.revokeObjectURL(attachment.previewUrl);
      group.splice(group.indexOf(attachment), 1);
    }
    renderAttachments();
  }

  return {
    switchAttachmentDraft,
    discardAttachmentDraft,
    renderAttachments,
    uploadAttachment,
    addAttachmentFiles,
    removeAttachment,
    consumeAttachments,
  };
}

/** Image upload, paste, drag-and-drop, preview, and removal behavior. */
export const WEB_UI_CLIENT_ATTACHMENTS_SCRIPT =
  `  const { switchAttachmentDraft, discardAttachmentDraft, renderAttachments, uploadAttachment, addAttachmentFiles, removeAttachment, consumeAttachments } = `
  + `(${createAttachmentController.toString()})({ copy, elements, state, api, showToast, updateSendButtonState });\n\n`;
