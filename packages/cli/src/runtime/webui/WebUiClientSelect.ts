/** Custom select controls with consistent geometry and keyboard behavior. */
export const WEB_UI_CLIENT_SELECT_SCRIPT = String.raw`  const selectControls = new Map();

  function selectedOption(select) {
    return [...select.options].find((option) => option.value === select.value) || select.options[0];
  }

  function positionSelectMenu(entry) {
    const rect = entry.trigger.getBoundingClientRect();
    const viewportGap = 10;
    const menuGap = 7;
    const desiredWidth = Math.max(rect.width, entry.control.classList.contains('model-control') ? 250 : 164);
    const width = Math.min(desiredWidth, window.innerWidth - viewportGap * 2);
    entry.menu.style.width = width + 'px';
    entry.menu.style.left = Math.min(
      Math.max(viewportGap, rect.left),
      window.innerWidth - width - viewportGap,
    ) + 'px';

    const menuHeight = entry.menu.offsetHeight;
    const below = window.innerHeight - rect.bottom - viewportGap;
    const above = rect.top - viewportGap;
    const preferTop = entry.control.dataset.selectPlacement === 'top';
    const openAbove = preferTop || (menuHeight > below && above > below);
    const top = openAbove
      ? Math.max(viewportGap, rect.top - menuHeight - menuGap)
      : Math.min(window.innerHeight - menuHeight - viewportGap, rect.bottom + menuGap);
    entry.menu.style.top = Math.max(viewportGap, top) + 'px';
    entry.menu.dataset.placement = openAbove ? 'top' : 'bottom';
  }

  function closeSelectControl(entry, restoreFocus) {
    if (!entry || entry.menu.hidden) return false;
    entry.menu.hidden = true;
    entry.control.classList.remove('is-open');
    entry.trigger.setAttribute('aria-expanded', 'false');
    entry.trigger.removeAttribute('aria-activedescendant');
    if (restoreFocus) entry.trigger.focus();
    return true;
  }

  function closeOpenSelectControls(restoreFocus, except) {
    let closed = false;
    for (const entry of selectControls.values()) {
      if (entry !== except) closed = closeSelectControl(entry, restoreFocus && !closed) || closed;
    }
    return closed;
  }

  function focusSelectOption(entry, offset) {
    const options = [...entry.menu.querySelectorAll('.select-option:not(:disabled):not([hidden])')];
    if (!options.length) return;
    const current = Math.max(0, options.indexOf(document.activeElement));
    const next = Math.min(options.length - 1, Math.max(0, current + offset));
    options[next].focus();
    entry.trigger.setAttribute('aria-activedescendant', options[next].id);
  }

  function openSelectControl(entry, focusSelected) {
    if (entry.trigger.disabled) return;
    closeOpenSelectControls(false, entry);
    entry.menu.hidden = false;
    entry.control.classList.add('is-open');
    entry.trigger.setAttribute('aria-expanded', 'true');
    positionSelectMenu(entry);
    if (focusSelected) {
      const active = entry.menu.querySelector('[aria-selected="true"]') || entry.menu.querySelector('.select-option:not(:disabled)');
      if (active) {
        active.focus();
        entry.trigger.setAttribute('aria-activedescendant', active.id);
      }
    } else if (entry.control.classList.contains('model-control')) {
      const search = entry.menu.querySelector('.select-search');
      if (search) search.focus();
    }
  }

  function chooseSelectOption(entry, value) {
    if (entry.select.value !== value) {
      entry.select.value = value;
      entry.select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    syncSelectControl(entry.select);
    closeSelectControl(entry, true);
  }

  function syncSelectControl(select) {
    const entry = selectControls.get(select);
    if (!entry) return;
    const active = selectedOption(select);
    entry.value.textContent = active ? active.textContent : '—';
    entry.value.title = active ? active.textContent : '';
    entry.trigger.disabled = select.disabled;
    entry.menu.replaceChildren();
    let searchInput = null;
    if (entry.control.classList.contains('model-control') && select.options.length > 8) {
      const searchWrap = document.createElement('div');
      searchWrap.className = 'select-search-wrap';
      searchInput = document.createElement('input');
      searchInput.type = 'search';
      searchInput.className = 'select-search';
      searchInput.autocomplete = 'off';
      searchInput.spellcheck = false;
      searchInput.placeholder = document.documentElement.lang.startsWith('zh') ? '搜索模型…' : 'Search models…';
      searchInput.setAttribute('aria-label', searchInput.placeholder);
      searchWrap.append(searchInput);
      entry.menu.append(searchWrap);
    }
    const optionButtons = [];
    [...select.options].forEach((option, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = entry.menu.id + '-option-' + index;
      button.className = 'select-option';
      button.dataset.value = option.value;
      button.disabled = option.disabled;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', option.value === select.value ? 'true' : 'false');
      const label = document.createElement('span');
      label.textContent = option.textContent;
      button.append(label);
      optionButtons.push(button);
      button.addEventListener('click', () => chooseSelectOption(entry, option.value));
      button.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          focusSelectOption(entry, 1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          focusSelectOption(entry, -1);
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          const options = [...entry.menu.querySelectorAll('.select-option:not(:disabled):not([hidden])')];
          const target = event.key === 'Home' ? options[0] : options[options.length - 1];
          if (target) target.focus();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          closeSelectControl(entry, true);
        } else if (event.key === 'Tab') {
          closeSelectControl(entry, false);
        }
      });
      entry.menu.append(button);
    });
    if (searchInput) {
      const empty = document.createElement('div');
      empty.className = 'select-empty';
      empty.textContent = document.documentElement.lang.startsWith('zh') ? '没有匹配的模型' : 'No matching models';
      empty.hidden = true;
      entry.menu.append(empty);
      searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim().toLocaleLowerCase();
        let visible = 0;
        for (const button of optionButtons) {
          const matches = !query || button.textContent.toLocaleLowerCase().includes(query);
          button.hidden = !matches;
          if (matches) visible += 1;
        }
        empty.hidden = visible > 0;
        positionSelectMenu(entry);
      });
      searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          const first = entry.menu.querySelector('.select-option:not(:disabled):not([hidden])');
          if (first) first.focus();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          closeSelectControl(entry, true);
        }
      });
    }
    if (!entry.menu.hidden) positionSelectMenu(entry);
  }

  function initializeSelectControl(control) {
    const select = control.querySelector('select');
    const trigger = control.querySelector('.select-trigger');
    const value = trigger && trigger.querySelector('.select-value');
    const menu = control.querySelector('.select-menu');
    if (!select || !trigger || !value || !menu) return;
    document.body.append(menu);
    const entry = { control, select, trigger, value, menu };
    selectControls.set(select, entry);
    trigger.addEventListener('click', () => {
      if (menu.hidden) openSelectControl(entry, false);
      else closeSelectControl(entry, false);
    });
    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        openSelectControl(entry, true);
        if (event.key === 'ArrowUp') focusSelectOption(entry, -1);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeSelectControl(entry, false);
      }
    });
    syncSelectControl(select);
  }

  document.querySelectorAll('[data-select-control]').forEach(initializeSelectControl);
  document.addEventListener('pointerdown', (event) => {
    if (![...selectControls.values()].some((entry) => entry.control.contains(event.target) || entry.menu.contains(event.target))) {
      closeOpenSelectControls(false);
    }
  });
  window.addEventListener('resize', () => closeOpenSelectControls(false), { passive: true });
  document.addEventListener('scroll', (event) => {
    const insideMenu = [...selectControls.values()].some((entry) => entry.menu.contains(event.target));
    if (!insideMenu) closeOpenSelectControls(false);
  }, true);

`;
