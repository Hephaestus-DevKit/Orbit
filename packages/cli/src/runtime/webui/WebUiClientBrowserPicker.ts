/** Text-only, short-lived controls for website date/time/color pickers. */
export const WEB_UI_CLIENT_BROWSER_PICKER_SCRIPT = String.raw`
  function initializeBrowserPicker({ panel, picture, stage, getCurrent, send, dismiss, onClose, localText }) {
    const popup = byId('browserPickerPopup'), title = byId('browserPickerTitle');
    const value = byId('browserPickerValue'), status = byId('browserPickerStatus');
    const help = byId('browserPickerHelp'), normalHelp = byId('browserPickerHelp').textContent;
    const applyButton = byId('browserPickerApply'), clearButton = byId('browserPickerClear');
    const cancelButton = byId('browserPickerCancel'), closeButton = byId('browserPickerClose');
    let active = null, pageId = '', suppressedId = '', applying = false, dirty = false;

    function isOpen() { return !popup.hidden && Boolean(active); }
    function place() {
      if (!isOpen() || picture.hidden || !picture.clientWidth || !picture.clientHeight) return;
      const panelBox = panel.getBoundingClientRect(), imageBox = picture.getBoundingClientRect();
      const current = getCurrent(); if (!current?.width || !current?.height) return;
      const x = imageBox.left - panelBox.left + active.bounds.x * imageBox.width / current.width;
      const y = imageBox.top - panelBox.top + active.bounds.y * imageBox.height / current.height;
      const edge = y + active.bounds.height * imageBox.height / current.height;
      const width = Math.min(320, panelBox.width - 20);
      const left = Math.max(10, Math.min(x, panelBox.width - width - 10));
      const canvas = stage.parentElement.getBoundingClientRect();
      const below = canvas.bottom - panelBox.top - edge - 8;
      const above = y - (canvas.top - panelBox.top) - 8;
      const downward = below >= Math.min(180, popup.scrollHeight) || below >= above;
      const room = Math.max(110, downward ? below : above);
      popup.style.width = width + 'px';
      popup.style.left = left + 'px';
      popup.style.maxHeight = Math.min(260, room) + 'px';
      popup.style.top = Math.max(canvas.top - panelBox.top + 4, downward ? edge + 3 : y - Math.min(260, room) - 3) + 'px';
      popup.dataset.placement = downward ? 'bottom' : 'top';
    }
    function controls() {
      value.disabled = applying;
      clearButton.hidden = active?.type === 'color' || Boolean(active?.required);
      clearButton.disabled = applying;
      applyButton.disabled = applying || (active?.type !== 'color' && !dirty) || !value.checkValidity();
      cancelButton.disabled = applying;
      closeButton.disabled = applying;
    }
    function hide(restoreFocus = false, revoke = true) {
      if (!active || applying && revoke) return;
      const hadFocus = popup.contains(document.activeElement);
      const old = active, oldPageId = pageId;
      active = null; popup.hidden = true; applying = false; dirty = false;
      value.value = ''; status.textContent = ''; suppressedId = old.id;
      if (revoke) void dismiss({ action: 'dismiss-picker', pageId: oldPageId, popupId: old.id });
      if ((restoreFocus || hadFocus && !revoke) && !panel.hidden) stage.focus({ preventScroll: true });
      onClose();
    }
    async function apply(nextValue) {
      if (!isOpen() || applying || !getCurrent()?.active) return;
      if (nextValue !== '' && !value.checkValidity()) {
        status.textContent = localText('Enter a valid value.', '请输入有效值。', '請輸入有效值。');
        value.focus({ preventScroll: true });
        return;
      }
      const selected = active, selectedPageId = pageId;
      applying = true; status.textContent = localText('Applying…', '正在应用…', '正在套用…'); controls();
      const succeeded = await send({ action: 'apply-picker', pageId: selectedPageId, popupId: selected.id, value: nextValue });
      if (active?.id !== selected.id) return;
      applying = false;
      if (succeeded) hide(true, false);
      else {
        status.textContent = localText('Could not apply. Open the website picker again if it changed.', '无法应用；若网页控件已变化，请重新打开。', '無法套用；若網頁控制項已變更，請重新開啟。');
        controls(); value.focus({ preventScroll: true });
      }
    }
    function render(browser, unavailable) {
      const nextPopup = !unavailable && browser?.active && !browser.dialog && browser.inputPicker?.id !== suppressedId ? browser.inputPicker : null;
      if (!nextPopup) {
        if (active) hide(false, false);
        if (browser?.inputPicker?.id !== suppressedId) suppressedId = '';
        return;
      }
      if (active?.id === nextPopup.id) { place(); return; }
      if (active) hide(false, false);
      active = nextPopup; pageId = browser.pageId; applying = false; dirty = false;
      const names = { date: localText('Date', '日期', '日期'), time: localText('Time', '时间', '時間'), 'datetime-local': localText('Date and time', '日期和时间', '日期和時間'), month: localText('Month', '月份', '月份'), week: localText('Week', '周', '週'), color: localText('Color', '颜色', '顏色') };
      title.textContent = nextPopup.label || names[nextPopup.type] || localText('Website picker', '网页选择器', '網頁選擇器');
      value.type = nextPopup.type; value.value = nextPopup.type === 'color' ? '#000000' : '';
      value.required = nextPopup.required;
      value.min = nextPopup.min; value.max = nextPopup.max; value.step = nextPopup.step;
      help.textContent = nextPopup.type === 'color' ? localText('New color starts at black. The website stays unchanged until you apply.', '新颜色从黑色开始；点击应用前，网页不会改变。', '新顏色從黑色開始；按下套用前，網頁不會改變。') : normalHelp;
      popup.hidden = false; status.textContent = '';
      controls(); place();
      if (!panel.hidden && (stage.contains(document.activeElement) || document.activeElement === stage)) {
        requestAnimationFrame(() => { if (active?.id === nextPopup.id && isOpen()) value.focus({ preventScroll: true }); });
      }
    }
    value.addEventListener('input', () => { dirty = true; status.textContent = ''; controls(); });
    value.addEventListener('change', () => { dirty = true; status.textContent = ''; controls(); });
    value.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (!applyButton.disabled) void apply(value.value); }
    });
    applyButton.addEventListener('click', () => { void apply(value.value); });
    clearButton.addEventListener('click', () => { void apply(''); });
    cancelButton.addEventListener('click', () => hide(true));
    closeButton.addEventListener('click', () => hide(true));
    document.addEventListener('pointerdown', (event) => { if (isOpen() && !popup.contains(event.target)) hide(false); }, true);
    document.addEventListener('focusin', (event) => { if (isOpen() && !popup.contains(event.target) && !stage.contains(event.target)) hide(false); });
    return { render, place, isOpen, hide };
  }
`;
