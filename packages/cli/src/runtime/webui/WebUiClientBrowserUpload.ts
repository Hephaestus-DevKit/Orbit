/** A user-confirmed file chooser; website bytes never enter rendered HTML. */
export const WEB_UI_CLIENT_BROWSER_UPLOAD_SCRIPT = String.raw`
  function initializeBrowserUpload({ panel, stage, getCurrent, upload, dismiss, onClose, localText }) {
    const popup = byId('browserUploadPopup'), input = byId('browserUploadFiles');
    const status = byId('browserUploadStatus'), applyButton = byId('browserUploadApply');
    const cancelButton = byId('browserUploadCancel'), closeButton = byId('browserUploadClose');
    let active = null, pageId = '', suppressedId = '', applying = false;
    function isOpen() { return !popup.hidden && Boolean(active); }
    function selection() {
      const files = [...(input.files || [])];
      const total = files.reduce((sum, file) => sum + file.size, 0);
      return { files, total, valid: files.length > 0 && files.length <= 8 && total <= 32 * 1024 * 1024 && (active?.multiple || files.length === 1) };
    }
    function controls() {
      input.disabled = applying;
      applyButton.disabled = applying || !selection().valid;
      cancelButton.disabled = applying; closeButton.disabled = applying;
    }
    function hide(restoreFocus = false, revoke = true) {
      if (!active || applying && revoke) return;
      const hadFocus = popup.contains(document.activeElement);
      const old = active, oldPageId = pageId;
      active = null; popup.hidden = true; applying = false; input.value = '';
      status.textContent = ''; suppressedId = old.id;
      if (revoke) void dismiss({ action: 'dismiss-upload', pageId: oldPageId, chooserId: old.id });
      if ((restoreFocus || hadFocus) && !panel.hidden) stage.focus({ preventScroll: true });
      onClose();
    }
    async function apply() {
      if (!isOpen() || applying) return;
      const selected = selection();
      if (!selected.valid) {
        status.textContent = localText('Choose up to 8 files, 32 MB total.', '请选择最多 8 个文件，总计不超过 32 MB。', '請選擇最多 8 個檔案，合計不超過 32 MB。');
        input.focus({ preventScroll: true }); return;
      }
      const chooser = active, selectedPageId = pageId;
      applying = true; status.textContent = localText('Uploading to website…', '正在上传到网页…', '正在上傳到網頁…'); controls();
      try {
        await upload({ pageId: selectedPageId, chooserId: chooser.id, files: selected.files.map((file) => ({ name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size })) }, selected.files);
        if (active?.id === chooser.id) hide(true, false);
      } catch (error) {
        if (active?.id !== chooser.id) return;
        status.textContent = localText('Upload failed. Reopen the website file request to try again.', '上传失败。请重新打开网页文件请求后重试。', '上傳失敗。請重新開啟網頁檔案要求後再試。') + (error?.message ? ' ' + error.message : '');
        input.focus({ preventScroll: true });
      } finally {
        applying = false; controls();
      }
    }
    function render(browser, unavailable) {
      const next = !unavailable && browser?.active && !browser.dialog && browser.fileChooser?.id !== suppressedId ? browser.fileChooser : null;
      if (!next) {
        if (active) hide(false, false);
        if (browser?.fileChooser?.id !== suppressedId) suppressedId = '';
        return;
      }
      if (active?.id === next.id) return;
      if (active) hide(false, false);
      active = next; pageId = browser.pageId; applying = false;
      input.value = ''; input.multiple = next.multiple; status.textContent = '';
      popup.hidden = false; controls();
      if (!panel.hidden && (stage.contains(document.activeElement) || document.activeElement === stage)) {
        requestAnimationFrame(() => { if (active?.id === next.id) input.focus({ preventScroll: true }); });
      }
    }
    input.addEventListener('change', () => {
      const selected = selection();
      status.textContent = selected.files.length && !selected.valid ? localText('Limit: 8 files and 32 MB total.', '上限：8 个文件，总计 32 MB。', '上限：8 個檔案，合計 32 MB。') : selected.files.length ? localText(selected.files.length + (selected.files.length === 1 ? ' file ready. Not sent yet.' : ' files ready. Not sent yet.'), '已选择 ' + selected.files.length + ' 个文件，尚未发送。', '已選擇 ' + selected.files.length + ' 個檔案，尚未傳送。') : '';
      controls();
    });
    applyButton.addEventListener('click', () => { void apply(); });
    cancelButton.addEventListener('click', () => hide(true));
    closeButton.addEventListener('click', () => hide(true));
    popup.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); hide(true); } });
    return { render, isOpen, hide };
  }
`;
