/** Image upload, paste, drag-and-drop, preview, and removal behavior. */
export const WEB_UI_CLIENT_ATTACHMENTS_SCRIPT = String.raw`  function renderAttachments() {
    elements.attachmentList.replaceChildren();
    elements.attachmentShelf.hidden = state.attachments.length === 0;
    elements.attachmentCount.textContent = String(state.attachments.length);
    elements.attachmentCount.hidden = state.attachments.length === 0;
    elements.attachmentCount.setAttribute('aria-label', String(state.attachments.length));
    elements.attachmentButton.disabled = state.attachments.length >= 4;
    for (const attachment of state.attachments) {
      const card = document.createElement('div');
      card.className = 'attachment-card';
      const image = document.createElement('img');
      image.src = attachment.previewUrl;
      image.alt = '';
      const copyBlock = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = attachment.name;
      name.title = attachment.name;
      const size = document.createElement('small');
      size.textContent = Math.max(1, Math.round(attachment.size / 1024)) + ' KB';
      copyBlock.append(name, size);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.attachmentRemove = attachment.id;
      remove.textContent = '×';
      remove.setAttribute('aria-label', copy.removeAttachment);
      card.append(image, copyBlock, remove);
      elements.attachmentList.append(card);
    }
    updateSendButtonState();
  }

  async function uploadAttachment(file) {
    if (!file || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
      showToast(copy.attachmentLimit, 'warning');
      return;
    }
    if (file.size <= 0 || file.size > 5 * 1024 * 1024 || state.attachments.length >= 4) {
      showToast(copy.attachmentLimit, 'warning');
      return;
    }
    elements.attachmentButton.disabled = true;
    try {
      const result = await api('/api/attachment?name=' + encodeURIComponent(file.name || 'image'), {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      const attachment = result.attachment || {};
      state.attachments.push({
        id: attachment.id,
        name: attachment.name || file.name || 'image',
        mediaType: attachment.mediaType || file.type,
        size: Number(attachment.size || file.size),
        previewUrl: URL.createObjectURL(file),
      });
      renderAttachments();
      showToast(copy.attachmentAdded, 'success');
    } catch (error) {
      showToast(error.message || String(error), 'error');
    } finally {
      elements.attachmentButton.disabled = state.attachments.length >= 4;
      elements.attachmentInput.value = '';
    }
  }

  async function addAttachmentFiles(files) {
    for (const file of Array.from(files || []).slice(0, 4 - state.attachments.length)) {
      await uploadAttachment(file);
    }
  }

  async function removeAttachment(id, notify) {
    const index = state.attachments.findIndex((attachment) => attachment.id === id);
    if (index === -1) return;
    const attachment = state.attachments[index];
    const removeButton = elements.attachmentList.querySelector('[data-attachment-remove="' + CSS.escape(id) + '"]');
    if (removeButton) removeButton.disabled = true;
    try {
      await api('/api/attachment?id=' + encodeURIComponent(id), { method: 'DELETE' });
      const currentIndex = state.attachments.findIndex((item) => item.id === id);
      if (currentIndex !== -1) state.attachments.splice(currentIndex, 1);
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      renderAttachments();
      if (notify) showToast(copy.attachmentRemoved);
    } catch (error) {
      if (removeButton) removeButton.disabled = false;
      showToast(error.message || String(error), 'error');
    }
  }

  function consumeAttachments(ids) {
    const consumed = new Set(ids || []);
    for (const attachment of state.attachments) {
      if (consumed.has(attachment.id) && attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    }
    state.attachments = state.attachments.filter((attachment) => !consumed.has(attachment.id));
    renderAttachments();
  }

`;
