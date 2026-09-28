/** Confirmed website downloads use the user's browser save flow, not the workspace. */
export const WEB_UI_CLIENT_BROWSER_DOWNLOAD_SCRIPT = String.raw`
  function initializeBrowserDownload({ panel, stage, save, dismiss, onClose, localText }) {
    const popup = byId('browserDownloadPopup'), name = byId('browserDownloadName');
    const status = byId('browserDownloadStatus'), saveButton = byId('browserDownloadSave');
    const discardButton = byId('browserDownloadDiscard'), closeButton = byId('browserDownloadClose');
    let active = null, pageId = '', suppressedId = '', saving = false;
    function isOpen() { return !popup.hidden && Boolean(active); }
    function controls() {
      saveButton.disabled = saving || active?.status !== 'ready';
      discardButton.disabled = saving; closeButton.disabled = saving;
    }
    function hide(restoreFocus = false, revoke = true) {
      if (!active || saving && revoke) return;
      const hadFocus = popup.contains(document.activeElement);
      const old = active, oldPageId = pageId;
      active = null; popup.hidden = true; saving = false; status.textContent = '';
      suppressedId = old.id;
      if (revoke) void dismiss({ action: 'dismiss-download', pageId: oldPageId, downloadId: old.id });
      if ((restoreFocus || hadFocus) && !panel.hidden) stage.focus({ preventScroll: true });
      onClose();
    }
    async function confirm() {
      if (!isOpen() || saving || active.status !== 'ready') return;
      const selected = active, selectedPageId = pageId;
      saving = true; status.textContent = localText('Opening browser save…', '正在打开浏览器保存…', '正在開啟瀏覽器儲存…'); controls();
      try {
        await save({ pageId: selectedPageId, downloadId: selected.id }, selected.filename);
        if (active?.id === selected.id) hide(true, false);
      } catch (error) {
        if (active?.id !== selected.id) return;
        status.textContent = localText('Could not save. Request the file again from the website.', '保存失败。请在网页中重新请求该文件。', '儲存失敗。請在網頁中重新要求該檔案。') + (error?.message ? ' ' + error.message : '');
      } finally { saving = false; controls(); }
    }
    function render(browser, unavailable) {
      const next = !unavailable && browser?.active && !browser.dialog && browser.download?.id !== suppressedId ? browser.download : null;
      if (!next) {
        if (active) hide(false, false);
        if (browser?.download?.id !== suppressedId) suppressedId = '';
        return;
      }
      if (active?.id !== next.id) {
        if (active) hide(false, false);
        active = next; pageId = browser.pageId; saving = false;
        popup.hidden = false; name.textContent = next.filename;
        if (!panel.hidden && (stage.contains(document.activeElement) || document.activeElement === stage)) {
          requestAnimationFrame(() => { if (active?.id === next.id) discardButton.focus({ preventScroll: true }); });
        }
      } else active = next;
      if (!saving) status.textContent = next.status === 'preparing'
        ? localText('Preparing file…', '正在准备文件…', '正在準備檔案…')
        : next.status === 'error' ? next.message || localText('Download failed.', '下载失败。', '下載失敗。')
        : localText('Ready to save · ', '可以保存 · ', '可以儲存 · ') + (next.size || 0).toLocaleString() + localText(' bytes', ' 字节', ' 位元組');
      controls();
    }
    saveButton.addEventListener('click', () => { void confirm(); });
    discardButton.addEventListener('click', () => hide(true));
    closeButton.addEventListener('click', () => hide(true));
    popup.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); hide(true); } });
    return { render, isOpen, hide };
  }
`;
