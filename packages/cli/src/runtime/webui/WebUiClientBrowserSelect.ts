/** Controlled, text-only chrome for folded website selects that screencasts omit. */
export const WEB_UI_CLIENT_BROWSER_SELECT_SCRIPT = String.raw`
  function initializeBrowserSelect({ panel, picture, stage, getCurrent, send, dismiss, onClose, localText }) {
    const popup = byId('browserSelectPopup'), title = byId('browserSelectTitle');
    const search = byId('browserSelectSearch'), list = byId('browserSelectOptions');
    const status = byId('browserSelectStatus'), empty = byId('browserSelectEmpty');
    const previous = byId('browserSelectPrevious'), next = byId('browserSelectNext');
    const pageSize = 80;
    let active = null, pageId = '', pageIndex = 0, suppressedId = '', choosing = false, activeOptionId = '';

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
      const downward = below >= Math.min(220, popup.scrollHeight) || below >= above;
      const room = Math.max(96, downward ? below : above);
      popup.style.width = width + 'px';
      popup.style.left = left + 'px';
      popup.style.maxHeight = Math.min(360, room) + 'px';
      popup.style.top = Math.max(canvas.top - panelBox.top + 4, downward ? edge + 3 : y - Math.min(360, room) - 3) + 'px';
      popup.dataset.placement = downward ? 'bottom' : 'top';
    }
    function filtered() {
      const query = search.value.trim().toLocaleLowerCase();
      return active.options.map((option, index) => ({ option, index }))
        .filter(({ option }) => !query || (option.label + ' ' + option.group).toLocaleLowerCase().includes(query));
    }
    function focusIndex(index) {
      const matches = filtered().filter(({ option }) => !option.disabled);
      if (!matches.length) return;
      const target = matches[Math.max(0, Math.min(index, matches.length - 1))];
      activeOptionId = target.option.id;
      pageIndex = Math.floor(filtered().findIndex((item) => item.index === target.index) / pageSize);
      draw();
      list.querySelector('[data-option-id="' + target.option.id + '"]')?.focus({ preventScroll: true });
    }
    function draw() {
      if (!active) return;
      const matches = filtered();
      const pages = Math.max(1, Math.ceil(matches.length / pageSize));
      pageIndex = Math.max(0, Math.min(pageIndex, pages - 1));
      const first = pageIndex * pageSize;
      const visible = matches.slice(first, first + pageSize);
      if (!visible.some(({ option }) => option.id === activeOptionId && !option.disabled))
        activeOptionId = (visible.find(({ option }) => option.selected && !option.disabled) || visible.find(({ option }) => !option.disabled))?.option.id || '';
      list.replaceChildren();
      for (const { option } of visible) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'browser-select-option';
        button.dataset.optionId = option.id; button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', String(option.selected));
        button.disabled = option.disabled || choosing;
        button.tabIndex = option.id === activeOptionId ? 0 : -1;
        const label = document.createElement('span'); label.textContent = option.label || localText('Unnamed option', '未命名选项', '未命名選項');
        button.append(label);
        if (option.group) {
          const group = document.createElement('span'); group.className = 'browser-select-option-group';
          group.textContent = option.group; button.append(group);
        }
        button.addEventListener('click', () => { void choose(option.id); });
        list.append(button);
      }
      empty.hidden = matches.length > 0;
      previous.disabled = choosing || pageIndex === 0;
      next.disabled = choosing || pageIndex >= pages - 1;
      status.textContent = choosing ? localText('Selecting…', '正在选择…', '正在選擇…') :
        matches.length ? (first + 1) + '–' + Math.min(first + pageSize, matches.length) + ' / ' + matches.length : '0 / 0';
      place();
    }
    function hide(restoreFocus = false, revoke = true) {
      if (!active) return;
      const hadFocus = popup.contains(document.activeElement);
      const old = active, oldPageId = pageId;
      active = null; popup.hidden = true; choosing = false;
      list.replaceChildren(); search.value = ''; status.textContent = '';
      if (revoke) {
        suppressedId = old.id;
        void dismiss({ action: 'dismiss-options', pageId: oldPageId, popupId: old.id });
      }
      if ((restoreFocus || hadFocus && !revoke) && !panel.hidden) stage.focus({ preventScroll: true });
      onClose();
    }
    async function choose(optionId) {
      if (!isOpen() || choosing || !getCurrent()?.active) return;
      const selected = active, selectedPageId = pageId;
      choosing = true; draw();
      const succeeded = await send({ action: 'choose-option', pageId: selectedPageId, popupId: selected.id, optionId });
      if (active?.id !== selected.id) return;
      choosing = false;
      if (succeeded) hide(true, false);
      else { draw(); list.querySelector('[tabindex="0"]:not(:disabled)')?.focus({ preventScroll: true }); }
    }
    function render(browser, unavailable) {
      const nextPopup = !unavailable && browser?.active && !browser.dialog && browser.selectPopup?.id !== suppressedId ? browser.selectPopup : null;
      if (!nextPopup) {
        if (active) hide(false, false);
        if (browser?.selectPopup?.id !== suppressedId) suppressedId = '';
        return;
      }
      if (active?.id === nextPopup.id) { place(); return; }
      if (active) hide(false, false);
      active = nextPopup; pageId = browser.pageId; pageIndex = 0; choosing = false;
      title.textContent = nextPopup.label || localText('Choose an option', '选择网页选项', '選擇網頁選項');
      search.value = ''; popup.hidden = false;
      const selectedIndex = active.options.findIndex((option) => option.selected);
      pageIndex = Math.floor(Math.max(0, selectedIndex) / pageSize);
      activeOptionId = active.options[selectedIndex]?.id || '';
      draw();
      if (!panel.hidden && (stage.contains(document.activeElement) || document.activeElement === stage)) {
        requestAnimationFrame(() => {
          if (!isOpen() || active?.id !== nextPopup.id) return;
          const target = list.querySelector('[aria-selected="true"]:not(:disabled)') || list.querySelector('.browser-select-option:not(:disabled)');
          (target || search).focus({ preventScroll: true });
        });
      }
    }
    search.addEventListener('input', () => { pageIndex = 0; draw(); });
    search.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); focusIndex(0); }
    });
    list.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const enabled = filtered().filter(({ option }) => !option.disabled);
      const index = enabled.findIndex(({ option }) => option.id === document.activeElement?.dataset?.optionId);
      focusIndex(event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : index + (event.key === 'ArrowUp' ? -1 : 1));
    });
    previous.addEventListener('click', () => { pageIndex--; activeOptionId = ''; draw(); list.querySelector('[tabindex="0"]:not(:disabled)')?.focus(); });
    next.addEventListener('click', () => { pageIndex++; activeOptionId = ''; draw(); list.querySelector('[tabindex="0"]:not(:disabled)')?.focus(); });
    byId('browserSelectClose').addEventListener('click', () => hide(true));
    document.addEventListener('pointerdown', (event) => {
      if (isOpen() && !popup.contains(event.target)) hide(false);
    }, true);
    document.addEventListener('focusin', (event) => {
      if (isOpen() && !popup.contains(event.target) && !stage.contains(event.target)) hide(false);
    });
    return { render, place, isOpen, hide };
  }
`;
