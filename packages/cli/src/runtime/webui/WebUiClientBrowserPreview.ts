import { WEB_UI_CLIENT_BROWSER_INPUT_SCRIPT } from "./WebUiClientBrowserInput.js";
import { WEB_UI_CLIENT_BROWSER_PICKER_SCRIPT } from "./WebUiClientBrowserPicker.js";
import { WEB_UI_CLIENT_BROWSER_SELECT_SCRIPT } from "./WebUiClientBrowserSelect.js";
import { WEB_UI_CLIENT_BROWSER_UPLOAD_SCRIPT } from "./WebUiClientBrowserUpload.js";
import { WEB_UI_CLIENT_BROWSER_DOWNLOAD_SCRIPT } from "./WebUiClientBrowserDownload.js";
import { browserFailureMessage } from "./WebUiBrowserFeedback.js";
import { browserSearchQuery } from "./WebUiBrowserSearch.js";
import { browserStageMode } from "./WebUiBrowserStage.js";
import {
  browserIdleNotice,
  browserPreservesAddressDraft,
  browserRetryRequest,
} from "./WebUiBrowserRecovery.js";

/** Desktop dock + authenticated live-frame transport. Direct input has a separate owner. */
export const WEB_UI_CLIENT_BROWSER_PREVIEW_SCRIPT =
  WEB_UI_CLIENT_BROWSER_INPUT_SCRIPT +
  WEB_UI_CLIENT_BROWSER_SELECT_SCRIPT +
  WEB_UI_CLIENT_BROWSER_PICKER_SCRIPT +
  WEB_UI_CLIENT_BROWSER_UPLOAD_SCRIPT +
  WEB_UI_CLIENT_BROWSER_DOWNLOAD_SCRIPT +
  `const browserFailureMessage = ${browserFailureMessage.toString()};\n` +
  `const browserSearchQuery = ${browserSearchQuery.toString()};\n` +
  `const browserRetryRequest = ${browserRetryRequest.toString()};\n` +
  `const browserIdleNotice = ${browserIdleNotice.toString()};\n` +
  `const browserPreservesAddressDraft = ${browserPreservesAddressDraft.toString()};\n` +
  `const browserStageMode = ${browserStageMode.toString()};\n` +
  String.raw`
  function initializeBrowserPreview() {
    const panel = byId('browserPreviewPanel'), workspace = elements.workspaceView;
    const url = byId('browserPreviewUrl');
    const picture = byId('browserPreviewImage'), stage = byId('browserPreviewStage');
    const empty = byId('browserPreviewEmpty'), emptyTitle = empty.querySelector('h3');
    const emptyBody = empty.querySelector('p'), emptyNote = empty.querySelector('.browser-preview-empty-note');
    const searchEngine = byId('browserSearchEngine');
    const searchDestination = byId('browserSearchDestination');
    const go = byId('browserPreviewStart');
    const findBar = byId('browserFindBar'), findQuery = byId('browserFindQuery'), findStatus = byId('browserFindStatus');
    const browserHelp = panel.querySelector('.browser-preview-help');
    const toastRegion = byId('toasts');
    function syncSettingsToast() {
      const popover = browserHelp.querySelector('.browser-settings-popover');
      const lift = browserHelp.open && !panel.hidden ? Math.ceil(popover.getBoundingClientRect().height) + 16 : 0;
      toastRegion.style.setProperty('--browser-settings-toast-lift', lift + 'px');
    }
    let recoveringSearch = false, recoveryReadyEngine = '', recoveryFocusUntil = 0;
    const savedEngine = readLocalStorage('orbit.webui.browserSearchEngine', 'bing');
    searchEngine.value = ['bing', 'google', 'baidu', 'duckduckgo'].includes(savedEngine) ? savedEngine : 'bing';
    searchEngine.addEventListener('change', () => {
      writeLocalStorage('orbit.webui.browserSearchEngine', searchEngine.value);
      syncSearchDestination();
      if (!recoveringSearch) { recoveryReadyEngine = ''; controls(); return; }
      recoveringSearch = false;
      recoveryReadyEngine = searchEngine.selectedOptions[0]?.textContent?.trim() || searchEngine.value;
      browserHelp.open = false;
      recoveryFocusUntil = Date.now() + 3000;
      controls();
    });
    browserHelp.addEventListener('toggle', () => { if (!browserHelp.open) recoveringSearch = false; syncSettingsToast(); });
    panel.addEventListener('pointerdown', () => { recoveryFocusUntil = 0; }, true);
    panel.addEventListener('keydown', (event) => { if (event.key === 'Tab' || event.key === 'Escape') recoveryFocusUntil = 0; }, true);
    const localText = (en, zh, tw) => language === 'en' ? en : chinese(zh, tw);
    function syncStagePlaceholder(mode) {
      empty.hidden = mode === 'hidden'; empty.dataset.state = mode;
      emptyNote.hidden = mode !== 'idle';
      if (mode === 'hidden') return;
      const copy = mode === 'opening'
        ? [localText('Opening the page…', '正在打开网页…', '正在開啟網頁…'), localText('The isolated browser is loading this website. Your address and chat draft stay here.', '独立浏览器正在加载网站；网址和未发送的对话草稿会保留。', '獨立瀏覽器正在載入網站；網址與未送出的對話草稿會保留。')]
        : mode === 'closing'
        ? [localText('Closing the browser…', '正在关闭浏览器…', '正在關閉瀏覽器…'), localText('The isolated session is shutting down. Your chat draft stays here.', '独立会话正在关闭；未发送的对话草稿会保留。', '獨立工作階段正在關閉；未送出的對話草稿會保留。')]
        : mode === 'waiting'
        ? [localText('Waiting for the page to appear', '正在等待网页画面', '正在等候網頁畫面'), localText('If it stays blank, reload or open Page actions for a text outline.', '如果画面持续空白，可刷新网页，或从“网页操作”打开文本纲要。', '如果畫面持續空白，可重新載入網頁，或從「網頁操作」開啟文字綱要。')]
        : mode === 'disconnected'
        ? [localText('Preview paused', '网页画面已暂停', '網頁畫面已暫停'), localText('Use Reconnect above. Your address and unsent text remain in place.', '请使用上方的“重新连接”；网址和未发送的文字仍会保留。', '請使用上方的「重新連線」；網址與未送出的文字仍會保留。')]
        : mode === 'error'
        ? [localText('Page unavailable', '网页暂不可用', '網頁暫不可用'), localText('Review the message above, then retry or enter another address.', '查看上方提示后重试，或输入其他网址。', '查看上方提示後重試，或輸入其他網址。')]
        : [localText('The web, right beside your work.', '在工作台里，直接浏览。', '在工作台裡，直接瀏覽。'), localText('Enter a website or search above. Click, type and scroll right here.', '输入网址或搜索词。直接点击、输入和滚动。', '輸入網址或搜尋詞。直接點擊、輸入與捲動。')];
      if (emptyTitle.textContent !== copy[0]) emptyTitle.textContent = copy[0];
      if (emptyBody.textContent !== copy[1]) emptyBody.textContent = copy[1];
    }
    function syncSearchDestination() {
      const engine = searchEngine.selectedOptions[0]?.textContent?.trim() || searchEngine.value;
      searchDestination.textContent = localText('Search: ', '搜索：', '搜尋：') + engine;
    }
    syncSearchDestination();
    const readableError = (message) => browserFailureMessage(message, language);
    const menu = byId('browserPageContextMenu'), pageActions = byId('browserPageActions');
    const reader = byId('browserPageReader'), readerText = byId('browserPageReaderText'), readerStatus = byId('browserPageReaderStatus'), readerRefresh = byId('browserPageReaderRefresh'), readerCanvas = reader.parentElement;
    const readerControls = byId('browserPageReaderControls'), readerControlList = byId('browserPageReaderControlList');
    const inputSink = byId('browserPageInput');
    const idleNotice = byId('browserIdleNotice'), idleAction = byId('browserIdleAction');
    function placeIdleNotice() {
      const parent = reader.hidden ? readerCanvas : reader;
      const before = reader.hidden ? stage : readerText;
      if (idleNotice.parentElement !== parent) parent.insertBefore(idleNotice, before);
    }
    let current = null, version = 0, pending = false, directInputPending = false, directInputEpoch = 0, polling = false, disposed = false, findBusy = false, findRequest = 0;
    let lastFrame = -1, sessionId = state.status?.session?.activeId, error = '', connectionError = '', tabsKey = '', resizeTimer, stopping = false, transport = Promise.resolve(), pollController;
    let pollFailures = 0, nextPollAt = 0;
    let addressDirty = false, menuReturnFocus = stage, dialogReturnFocus = stage, readerRequest = 0;
    let failedAction = null, renewing = false;
    function interactionBlocked() { return pending || state.busy || Boolean(current?.busy && !directInputPending) || Boolean(current?.dialog) || Boolean(connectionError); }
    const input = initializeBrowserPageInput({ picture, stage, panel, url, getCurrent: () => current, blocked: () => interactionBlocked() || select.isOpen() || picker.isOpen() || upload.isOpen() || download.isOpen(), send: act, onContextMenu: openContextMenu, copySelection });
    const select = initializeBrowserSelect({ panel, picture, stage, getCurrent: () => current, send: act, dismiss: (action) => api('/api/browser-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) }).catch(() => undefined), onClose: sizeDock, localText });
    const picker = initializeBrowserPicker({ panel, picture, stage, getCurrent: () => current, send: act, dismiss: (action) => api('/api/browser-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) }).catch(() => undefined), onClose: sizeDock, localText });
    const upload = initializeBrowserUpload({ panel, stage, getCurrent: () => current, upload: sendUpload, dismiss: (action) => api('/api/browser-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) }).catch(() => undefined), onClose: sizeDock, localText });
    const download = initializeBrowserDownload({ panel, stage, save: saveDownload, dismiss: (action) => api('/api/browser-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) }).catch(() => undefined), onClose: sizeDock, localText });
    inputSink.addEventListener('blur', () => { if (!disposed && !stopping && !panel.hidden) sizeDock(); });
    function closeFind(restoreFocus = false) {
      const hadFocus = findBar.contains(document.activeElement);
      findRequest++; findBusy = false; findBar.hidden = true; findQuery.value = ''; findStatus.textContent = '';
      if (restoreFocus || (hadFocus && !panel.hidden)) stage.focus({ preventScroll: true });
      sizeDock();
    }
    function openFind() {
      if (!current?.active) { url.focus(); return; }
      if (connectionError) { byId('browserPreviewRetry').focus({ preventScroll: true }); return; }
      closeMenu(); closeReader(); findBar.hidden = false;
      findQuery.focus({ preventScroll: true }); findQuery.select(); controls(); sizeDock();
    }
    function closeMenu(restoreFocus = false) {
      const hadFocus = menu.contains(document.activeElement);
      menu.hidden = true; pageActions.setAttribute('aria-expanded', 'false');
      if (restoreFocus) (menuReturnFocus?.isConnected ? menuReturnFocus : stage).focus({ preventScroll: true });
      else if (hadFocus && !panel.hidden) stage.focus({ preventScroll: true });
    }
    function closeReader(restoreFocus = false) {
      const hadFocus = reader.contains(document.activeElement);
      readerRequest++;
      reader.hidden = true; readerCanvas.classList.remove('is-reading-page'); reader.setAttribute('aria-busy', 'false');
      placeIdleNotice();
      readerText.textContent = ''; readerStatus.textContent = ''; readerRefresh.disabled = false;
      readerControlList.replaceChildren(); readerControls.hidden = true;
      sizeDock();
      if (restoreFocus) pageActions.focus({ preventScroll: true });
      else if (hadFocus && !panel.hidden) stage.focus({ preventScroll: true });
    }
    function markReaderStale() {
      if (reader.hidden || getComputedStyle(stage).visibility === 'hidden') return;
      readerControlList.replaceChildren(); readerControls.hidden = true;
      readerStatus.textContent = localText('The page was used. Refresh the outline for current text and controls.', '网页已被操作。刷新纲要以获取当前文字和控件。', '網頁已被操作。重新整理綱要以取得目前文字與控制項。');
    }
    function controlKindLabel(kind) {
      if (kind === 'link') return localText('Link', '链接', '連結');
      if (kind === 'field') return localText('Text field', '输入框', '輸入欄');
      if (kind === 'select') return localText('Select', '选择框', '選擇欄');
      if (kind === 'toggle') return localText('Toggle', '切换项', '切換項');
      return localText('Button', '按钮', '按鈕');
    }
    async function operateReaderControl(control, pageId, button) {
      if (interactionBlocked() || current?.loading || reader.hidden || current?.pageId !== pageId) return;
      const request = readerRequest, focusField = control.kind === 'field' || control.kind === 'select';
      reader.setAttribute('aria-busy', 'true');
      readerStatus.textContent = localText('Using page control…', '正在操作网页控件…', '正在操作網頁控制項…');
      const buttons = [...readerControlList.querySelectorAll('button')];
      buttons.forEach((item) => { item.disabled = true; });
      const succeeded = await act({ action: 'control', pageId, controlId: control.id, operation: focusField ? 'focus' : 'activate' });
      if (request !== readerRequest || reader.hidden) return;
      reader.setAttribute('aria-busy', 'false');
      if (succeeded) {
        closeReader(!focusField);
        if (focusField) input.focusControl(localText('Type into ', '输入到', '輸入到') + (control.label || controlKindLabel(control.kind)) + localText('. Escape returns to browser controls.', '。按 Escape 返回浏览器工具栏。', '。按 Escape 返回瀏覽器工具列。'));
      } else {
        readerStatus.textContent = readableError(error || '') || localText('Control changed. Refresh the outline.', '控件已变化，请刷新纲要。', '控制項已變更，請重新整理綱要。');
        buttons.forEach((item) => { item.disabled = item.dataset.unavailable === 'true'; });
        button.focus({ preventScroll: true });
      }
    }
    function renderReaderControls(items, pageId) {
      readerControlList.replaceChildren(); readerControls.hidden = true;
      if (!Array.isArray(items)) return;
      items.slice(0, 60).forEach((control, index) => {
        if (!control || typeof control.id !== 'string' || typeof control.kind !== 'string') return;
        const kind = controlKindLabel(control.kind), name = String(control.label || '').trim() || localText('Unnamed control', '未命名控件', '未命名控制項') + ' ' + (index + 1);
        const row = document.createElement('div'); row.className = 'browser-page-reader-control'; row.setAttribute('role', 'listitem');
        const button = document.createElement('button'); button.type = 'button'; button.className = 'text-button'; button.textContent = name; button.disabled = Boolean(control.disabled); button.dataset.unavailable = String(Boolean(control.disabled));
        button.setAttribute('aria-label', (control.kind === 'field' || control.kind === 'select' ? localText('Focus', '聚焦', '聚焦') : localText('Activate', '操作', '操作')) + ' ' + name + ' · ' + kind);
        button.addEventListener('click', () => { void operateReaderControl(control, pageId, button); });
        const badge = document.createElement('span'); badge.textContent = kind;
        row.append(button, badge); readerControlList.append(row);
      });
      readerControls.hidden = !readerControlList.childElementCount;
    }
    async function readPage() {
      const pageId = current?.pageId;
      if (!pageId || !current?.active || current.loading || interactionBlocked()) return;
      closeFind();
      const request = ++readerRequest;
      reader.hidden = false; readerCanvas.classList.add('is-reading-page'); reader.setAttribute('aria-busy', 'true'); readerRefresh.disabled = true;
      sizeImage();
      readerText.textContent = ''; readerControlList.replaceChildren(); readerControls.hidden = true;
      readerStatus.textContent = localText('Reading the current page…', '正在读取当前网页…', '正在讀取目前網頁…');
      readerText.focus({ preventScroll: true });
      const outline = await act({ action: 'read-page', pageId });
      if (request !== readerRequest || reader.hidden || current?.pageId !== pageId) return;
      reader.setAttribute('aria-busy', 'false'); readerRefresh.disabled = false;
      if (outline && typeof outline.text === 'string') {
        readerText.textContent = outline.text || localText('No readable text was found on this page.', '当前网页没有可读取的文字。', '目前網頁沒有可讀取的文字。');
        renderReaderControls(outline.controls, pageId);
        readerStatus.textContent = readerControls.hidden ? localText('Outline ready. Use arrow keys to read it.', '纲要已就绪，可用方向键阅读。', '綱要已就緒，可用方向鍵閱讀。') : localText('Outline ready. Tab to the page controls below.', '纲要已就绪，按 Tab 可进入下方网页控件。', '綱要已就緒，按 Tab 可進入下方網頁控制項。');
      } else {
        readerStatus.textContent = readableError(error || '') || localText('Could not read this page. Try again.', '无法读取网页，请重试。', '無法讀取網頁，請重試。');
      }
    }
    function openContextMenu(clientX, clientY) {
      if (!current?.active || current.loading || interactionBlocked()) return;
      menuReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : stage;
      menu.hidden = false; pageActions.setAttribute('aria-expanded', 'true');
      const bounds = panel.getBoundingClientRect(), anchor = pageActions.getBoundingClientRect();
      const x = clientX ?? anchor.right, y = clientY ?? anchor.bottom;
      menu.style.left = Math.max(8, Math.min(bounds.width - menu.offsetWidth - 8, x - bounds.left)) + 'px';
      menu.style.top = Math.max(8, Math.min(bounds.height - menu.offsetHeight - 8, y - bounds.top)) + 'px';
      menu.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
    }
    async function copySelection() {
      const selection = await act({ action: 'copy-selection' }, true);
      if (typeof selection !== 'string') return;
      if (!selection) { showToast(localText('Select text on the page first.', '请先在网页中选择文字。', '請先在網頁中選取文字。'), 'error'); return; }
      try { await navigator.clipboard.writeText(selection); showToast(localText('Selected text copied.', '已复制所选文字。', '已複製所選文字。'), 'success'); }
      catch { showToast(localText('Could not access the clipboard.', '无法访问剪贴板。', '無法存取剪貼簿。'), 'error'); }
    }
    function showFindReconnect() {
      const message = localText('Reconnect to find', '重新连接后查找', '重新連線後尋找');
      if (findStatus.textContent !== message) findStatus.textContent = message;
    }
    async function runFind(direction) {
      const query = findQuery.value.trim(), pageId = current?.pageId;
      if (!query || !pageId || !current?.active || findBusy || findBar.hidden || current.dialog) return;
      if (connectionError) { showFindReconnect(); byId('browserPreviewRetry').focus({ preventScroll: true }); return; }
      if (pending || state.busy || current.busy || current.loading) {
        findStatus.textContent = localText('Wait for page…', '请等待网页…', '請等候網頁…');
        return;
      }
      const request = ++findRequest;
      findBusy = true; findStatus.textContent = localText('Finding…', '正在查找…', '正在尋找…'); controls();
      const result = await act({ action: 'find', pageId, query, direction }, true);
      if (request !== findRequest) return;
      findBusy = false; controls();
      if (findBar.hidden || current?.pageId !== pageId || findQuery.value.trim() !== query) return;
      if (connectionError) { showFindReconnect(); return; }
      findStatus.textContent = result && typeof result.found === 'boolean'
        ? result.found ? localText('Found', '已找到', '已找到') : localText('No match', '无匹配', '無符合')
        : localText('Find failed', '查找失败', '尋找失敗');
    }
    function currentSearchQuery() { return browserSearchQuery(current?.url || ''); }
    function controls() {
      const busy = pending || Boolean(current?.busy && !directInputPending) || state.busy;
      const dialogOpen = Boolean(current?.dialog);
      const controlsLocked = busy || dialogOpen;
      const interactionLocked = interactionBlocked();
      const active = Boolean(current?.active);
      const incomplete = Boolean(current?.resourceErrors);
      const retry = browserRetryRequest(failedAction, current);
      const idle = browserIdleNotice(current, Date.now());
      placeIdleNotice();
      idleNotice.hidden = !idle || pending || Boolean(connectionError) || active && (dialogOpen || state.busy || Boolean(current?.loading) || busy && !renewing);
      idleAction.disabled = renewing || pending || idle === 'expiring' && (interactionLocked || Boolean(current?.loading));
      for (const [id, text] of [
        ['browserIdleTitle', idle === 'closed' ? localText('Idle session closed', '已因闲置关闭', '已因閒置關閉') : localText('This session will close soon', '会话即将因闲置关闭', '工作階段即將因閒置關閉')],
        ['browserIdleText', idle === 'closed' ? localText('Tabs and cookies were cleared after 30 minutes without an action. Enter an address to start a new session.', '30 分钟未操作，页面和 Cookie 已清除。输入网址可开始新会话。', '30 分鐘未操作，分頁與 Cookie 已清除。輸入網址可開始新的工作階段。') : localText('Less than two minutes until tabs and cookies are cleared. Keep open without reloading the page.', '不到两分钟后将清除页面和 Cookie。可继续保留，不会刷新网页。', '不到兩分鐘後將清除分頁與 Cookie。可繼續保留，不會重新載入網頁。')],
        ['browserIdleAction', idle === 'closed' ? localText('Enter address', '输入网址', '輸入網址') : renewing ? localText('Keeping open…', '正在保留…', '正在保留…') : localText('Keep open', '继续保留', '繼續保留')],
      ]) { const element = byId(id); if (element.textContent !== text) element.textContent = text; }
      go.disabled = interactionLocked || !url.value.trim();
      byId('browserPreviewReload').disabled = interactionLocked || !active;
      byId('browserBack').disabled = interactionLocked || !current?.canGoBack;
      byId('browserForward').disabled = interactionLocked || !current?.canGoForward;
      byId('browserNewTab').disabled = interactionLocked || !active || current.tabs.length >= 8;
      for (const tabButton of byId('browserTabs').querySelectorAll('button')) {
        tabButton.disabled = dialogOpen;
        tabButton.setAttribute('aria-disabled', String(interactionLocked));
      }
      pageActions.disabled = controlsLocked || Boolean(connectionError) || !active || Boolean(current?.loading);
      byId('browserPreviewStop').disabled = stopping || !active && !pending;
      byId('browserPreviewAsk').disabled = controlsLocked || Boolean(connectionError) || !active || !current.url || Boolean(current?.loading);
      byId('browserPreviewRetry').disabled = dialogOpen || (connectionError ? false : busy);
      byId('browserPreviewRetry').hidden = !connectionError && !(incomplete && !error && !current?.message) && !retry;
      url.disabled = pending || dialogOpen;
      searchEngine.disabled = pending || dialogOpen;
      byId('browserPreviewChangeEngine').disabled = dialogOpen;
      // Keep the local find draft editable while frame polling is disconnected.
      findQuery.disabled = !active || dialogOpen;
      byId('browserFindPrevious').disabled = !findQuery.value.trim() || findBusy || !active || controlsLocked || Boolean(current?.loading) || Boolean(connectionError);
      byId('browserFindNext').disabled = !findQuery.value.trim() || findBusy || !active || controlsLocked || Boolean(current?.loading) || Boolean(connectionError);
      const readerLocked = interactionLocked || Boolean(current?.loading);
      readerRefresh.setAttribute('aria-disabled', String(readerLocked));
      for (const readerButton of readerControlList.querySelectorAll('button')) readerButton.setAttribute('aria-disabled', String(readerLocked));
      byId('browserReadPage').setAttribute('aria-disabled', String(interactionLocked || !active || Boolean(current?.loading)));
      byId('browserCopySelection').setAttribute('aria-disabled', String(interactionLocked || !active));
      const searchQuery = currentSearchQuery();
      const incompleteSearch = incomplete && !error && !connectionError && !current?.message && Boolean(searchQuery);
      const searchRecoveryReady = incompleteSearch && Boolean(recoveryReadyEngine) && url.value.trim() === searchQuery;
      const problem = !stopping && Boolean(error || connectionError || current?.message || incomplete);
      panel.dataset.status = stopping || busy || current?.loading ? 'working' : problem ? 'error' : active ? 'ready' : 'closed';
      panel.setAttribute('aria-busy', String(pending || Boolean(current?.loading)));
      syncStagePlaceholder(browserStageMode({ active, loading: Boolean(current?.loading), pending, closing: stopping, hasImage: !picture.hidden, disconnected: Boolean(connectionError), failed: problem, idleNotice: !idleNotice.hidden }));
      byId('browserPreviewWorking').hidden = picture.hidden || !pending && !current?.loading;
      const status = stopping ? localText('Closing', '关闭中', '關閉中') : connectionError ? localText('Disconnected', '连接中断', '連線中斷') : state.busy ? localText('Agent active', 'Agent 操作中', 'Agent 操作中') : pending || current?.loading ? localText('Loading', '加载中', '載入中') : current?.busy ? localText('Browser busy', '浏览器操作中', '瀏覽器操作中') : problem ? localText('Needs attention', '需要检查', '需要檢查') : active ? localText('Live', '实时', '即時') : idle === 'closed' ? localText('Idle session closed', '已因闲置关闭', '已因閒置關閉') : localText('Not open', '未打开', '未開啟');
      let message = connectionError ? localText('The browser connection was interrupted. Reconnecting keeps your tabs and page input; it does not reload the website.', '浏览器连接中断。重新连接会保留标签页和页面输入，不会重新加载网站。', '瀏覽器連線中斷。重新連線會保留分頁與頁面輸入，不會重新載入網站。') : readableError(error || current?.message || '');
      if (!message && searchRecoveryReady) message = localText(recoveryReadyEngine + ' selected. Press Go to search the saved query; nothing has been submitted yet.', '已选择 ' + recoveryReadyEngine + '。点击“访问”才会提交保留的搜索词；目前尚未发送。', '已選擇 ' + recoveryReadyEngine + '。點擊「開啟」才會送出保留的搜尋詞；目前尚未送出。');
      else if (!message && incompleteSearch) message = localText('Some search resources could not load. Reload, or choose another search engine and submit the query again.', '部分搜索资源未能加载。请刷新，或更换搜索引擎后重新提交查询。', '部分搜尋資源未能載入。請重新載入，或更換搜尋引擎後重新送出查詢。');
      else if (!message && incomplete) message = localText('Some page resources could not load. The page may look incomplete. Check your connection and reload.', '部分网页资源未能加载，页面可能显示不完整。请检查网络并刷新。', '部分網頁資源未能載入。頁面可能顯示不完整。請檢查網路並重新載入。');
      const title = connectionError ? localText('Connection interrupted', '连接已中断', '連線已中斷') : incomplete && !error && !current?.message ? localText('Page incomplete', '页面未完整加载', '頁面未完整載入') : localText('Could not complete this action', '未能完成此操作', '未能完成此操作');
      for (const [id, text] of [['browserPreviewStatus', status], ['browserPreviewError', message], ['browserPreviewErrorTitle', title], ['browserPreviewRetry', connectionError ? localText('Reconnect', '重新连接', '重新連線') : incomplete && !error && !current?.message ? localText('Reload page', '刷新页面', '重新載入') : localText('Retry', '重试', '重試')]]) {
        const element = byId(id); if (element.textContent !== text) element.textContent = text;
      }
      byId('browserPreviewNotice').hidden = !problem;
      byId('browserPreviewChangeEngine').hidden = !incompleteSearch;
      stage.classList.toggle('is-input-blocked', busy || Boolean(connectionError));
      stage.classList.toggle('is-disconnected', Boolean(connectionError));
      if (recoveryFocusUntil && !go.disabled && !panel.hidden) {
        const shouldFocus = Date.now() <= recoveryFocusUntil;
        recoveryFocusUntil = 0;
        if (shouldFocus) go.focus({ preventScroll: true });
      }
    }
    function sizeImage() {
      if (picture.hidden) return;
      const fit = Math.min(stage.clientWidth / (current?.width || 1), stage.clientHeight / (current?.height || 1), 1);
      const scale = readerDocked() ? Math.max(fit, Math.min(.85, fit * 1.3)) : fit;
      picture.style.width = Math.floor((current?.width || 0) * scale) + 'px';
      picture.style.height = Math.floor((current?.height || 0) * scale) + 'px';
      select.place();
      picker.place();
    }
    function readerDocked() { return !reader.hidden && getComputedStyle(stage).visibility === 'visible'; }
    function sizeDock() {
      syncSettingsToast();
      sizeImage();
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = undefined;
        if (disposed || stopping || panel.hidden || !reader.hidden || select.isOpen() || picker.isOpen() || upload.isOpen() || download.isOpen() || document.activeElement === inputSink || !current?.active || interactionBlocked()) return;
        const width = Math.max(320, Math.min(2560, Math.floor(stage.clientWidth)));
        const height = Math.max(200, Math.min(1600, Math.floor(stage.clientHeight)));
        if (Math.abs(width - current.width) > 2 || Math.abs(height - current.height) > 2) void act({ action: 'resize', pageId: current.pageId, width, height }, true);
      }, 250);
    }
    function render(browser) {
      if (!browser || stopping || browser.frame < (current?.frame ?? -1)) return;
      const changedPage = browser.pageId !== current?.pageId;
      const changedTab = browser.tabs.find((tab) => tab.active)?.id !== current?.tabs?.find((tab) => tab.active)?.id;
      // Navigation may publish its destination before Chromium commits a new page ID.
      const changedDocument = browser.url !== current?.url || changedTab || browser.active !== current?.active;
      if (changedPage || changedDocument) {
        if (browser.closedReason === 'idle' || failedAction?.action !== 'open') { error = ''; failedAction = null; }
        if (changedDocument) { recoveryReadyEngine = ''; recoveryFocusUntil = 0; closeFind(); }
        else { findRequest++; findBusy = false; findStatus.textContent = ''; }
        closeMenu(); closeReader(); input.release();
      }
      if (changedPage) {
        picture.hidden = true; picture.removeAttribute('src'); lastFrame = -1;
      }
      if (!addressDirty && url !== document.activeElement && !pending) url.value = browser.url || '';
      current = browser;
      if (state.browserHandoffTabId) {
        const attachedTab = browser.tabs.find((tab) => tab.id === state.browserHandoffTabId);
        state.browserHandoffState = attachedTab?.active && browser.url === state.browserHandoffUrl ? 'ready' : 'changed';
        renderBrowserHandoff();
      }
      if (browser.image) { picture.src = 'data:image/jpeg;base64,' + browser.image; picture.hidden = false; lastFrame = browser.frame; }
      else if (!browser.active) { picture.hidden = true; picture.removeAttribute('src'); lastFrame = -1; }
      const title = byId('browserPreviewPageTitle'); title.textContent = browser.title || localText('Live browser', '实时浏览器', '即時瀏覽器'); title.title = browser.url;
      const nextKey = JSON.stringify(browser.tabs);
      if (nextKey !== tabsKey) {
        tabsKey = nextKey;
        const list = byId('browserTabs');
        const focused = list.contains(document.activeElement) ? document.activeElement : null;
        const focusedItem = focused?.closest('.browser-live-tab');
        const focusedId = focusedItem?.dataset.tabId;
        const focusedClose = focused?.classList.contains('browser-live-tab-close');
        list.replaceChildren();
        browser.tabs.forEach((tab) => {
          const item = document.createElement('div'); item.className = 'browser-live-tab'; item.dataset.tabId = tab.id;
          const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(tab.active)); button.tabIndex = tab.active ? 0 : -1; button.textContent = tab.title === 'New tab' ? localText('New tab', '新标签页', '新增分頁') : tab.title; button.title = button.textContent;
          button.addEventListener('keydown', (event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const all = [...list.querySelectorAll('[role="tab"]')], index = all.indexOf(button); const next = event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + all.length) % all.length; all[next].focus(); all[next].click(); } });
          button.addEventListener('click', () => { if (button.getAttribute('aria-disabled') !== 'true') void act({ action: 'tab', operation: 'select', id: tab.id }); });
          const close = document.createElement('button'); close.type = 'button'; close.className = 'browser-live-tab-close'; close.textContent = '×'; close.setAttribute('aria-label', localText('Close tab: ', '关闭标签页：', '關閉分頁：') + button.textContent); close.addEventListener('click', () => { if (close.getAttribute('aria-disabled') !== 'true') void act({ action: 'tab', operation: 'close', id: tab.id }); });
          item.append(button, close); list.append(item);
        });
        if (focused) {
          const item = [...list.children].find((child) => child.dataset.tabId === focusedId);
          const target = item?.querySelector(focusedClose ? '.browser-live-tab-close' : '[role="tab"]') || list.querySelector('[aria-selected="true"]');
          target?.focus({ preventScroll: true });
        }
      }
      const dialog = byId('browserPageDialog'); const wasHidden = dialog.hidden;
      if (browser.dialog && wasHidden) { dialogReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : stage; closeMenu(); closeReader(); closeFind(); }
      dialog.hidden = !browser.dialog;
      byId('browserPageDialogBackdrop').hidden = !browser.dialog;
      if (browser.dialog) { byId('browserDialogMessage').textContent = browser.dialog.message; byId('browserDialogInput').hidden = browser.dialog.type !== 'prompt'; if (wasHidden) { byId('browserDialogInput').value = browser.dialog.defaultValue; byId('browserDialogDismiss').focus(); } }
      const restoreDialogFocus = !browser.dialog && !wasHidden && dialog.contains(document.activeElement);
      controls(); sizeImage(); select.render(browser, Boolean(connectionError || panel.hidden)); picker.render(browser, Boolean(connectionError || panel.hidden)); upload.render(browser, Boolean(connectionError || panel.hidden)); download.render(browser, Boolean(connectionError || panel.hidden));
      if (restoreDialogFocus) (dialogReturnFocus?.isConnected && !dialogReturnFocus.disabled ? dialogReturnFocus : stage).focus({ preventScroll: true });
      // A resize deferred during loading or Agent work must resume on a later frame.
      const needsResize = browser.active && reader.hidden && document.activeElement !== inputSink && (Math.abs(browser.width - Math.max(320, Math.min(2560, stage.clientWidth))) > 2 || Math.abs(browser.height - Math.max(200, Math.min(1600, stage.clientHeight))) > 2);
      if (changedPage || needsResize && resizeTimer === undefined) sizeDock();
    }
    async function refresh() {
      if (panel.hidden || document.hidden || polling || disposed || stopping) return;
      polling = true; const expected = version, inputEpoch = directInputEpoch, session = state.status?.session?.activeId;
      const controller = new AbortController(); pollController = controller;
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 10000);
      try { const result = await api('/api/browser-preview?mode=live&after=' + lastFrame, { signal: controller.signal }); if (controller === pollController && expected === version && inputEpoch === directInputEpoch && session === state.status?.session?.activeId && !panel.hidden) { const reconnected = Boolean(connectionError); connectionError = ''; pollFailures = 0; nextPollAt = 0; if (reconnected && !findBar.hidden) findStatus.textContent = ''; render(result.browser); } }
      catch (failure) { if (controller === pollController && expected === version && inputEpoch === directInputEpoch && session === state.status?.session?.activeId && !disposed && !stopping && (!controller.signal.aborted || timedOut)) { connectionError = failure.message; pollFailures = Math.min(4, pollFailures + 1); nextPollAt = Date.now() + Math.min(4000, 500 * 2 ** (pollFailures - 1)); input.release(); if (!findBar.hidden) showFindReconnect(); controls(); } }
      finally { clearTimeout(timeout); if (pollController === controller) { polling = false; pollController = undefined; } }
    }
    async function act(action, quiet = false) {
      if (interactionBlocked() && action.action !== 'disconnect' && action.action !== 'dialog') return false;
      if (action.action !== 'keep-alive') renewing = false;
      const directInput = action.action === 'input';
      const actionPageId = current?.pageId;
      const preserveAddressDraft = browserPreservesAddressDraft(action, url.value, addressDirty);
      const pageBound = ['input', 'resize', 'find', 'read-page', 'control', 'copy-selection', 'keep-alive', 'choose-option', 'apply-picker'].includes(action.action);
      if (directInput) {
        // Keep polling for website dialogs, but do not let our own input busy
        // state lock the next event or outlive this batch in a late poll.
        directInputPending = true; directInputEpoch++;
      }
      const expected = action.action === 'input' || action.action === 'resize' ? version : ++version;
      const session = state.status?.session?.activeId;
      if (!quiet) pending = true;
      if (!quiet) { error = ''; failedAction = null; }
      if (['open', 'reload', 'history', 'tab', 'disconnect'].includes(action.action)) { recoveryReadyEngine = ''; recoveryFocusUntil = 0; }
      if (['history', 'tab', 'disconnect'].includes(action.action)) addressDirty = false;
      if (action.action === 'disconnect') { stopping = true; connectionError = ''; pollFailures = 0; nextPollAt = 0; pollController?.abort(); polling = false; pollController = undefined; transport = Promise.resolve(); input.release(); picture.hidden = true; picture.removeAttribute('src'); panel.focus(); }
      controls();
      let unlock;
      const previous = transport;
      if (!['disconnect', 'dialog'].includes(action.action)) transport = new Promise((resolve) => { unlock = resolve; });
      try {
        if (unlock) await previous;
        if (expected !== version || session !== state.status?.session?.activeId) return false;
        const result = await api('/api/browser-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) });
        if (expected !== version || session !== state.status?.session?.activeId) return false;
        if (result.browser) { if (['open', 'history', 'tab'].includes(action.action) && !preserveAddressDraft) { addressDirty = false; url.value = result.browser.url; } render(result.browser); }
        if (action.action === 'input' && action.events?.some((event) => event.type !== 'pointer' || event.phase !== 'move')) markReaderStale();
        return action.action === 'copy-selection' ? result.selection : action.action === 'read-page' ? { text: result.pageText, controls: result.controls } : action.action === 'find' ? { found: result.found } : true;
      } catch (failure) { if (expected === version && session === state.status?.session?.activeId && (!pageBound || actionPageId === current?.pageId)) { if (action.action !== 'find') { error = failure.message; failedAction = { action: action.action, pageId: action.pageId || actionPageId, address: action.address, searchEngine: action.searchEngine }; } controls(); } return false; }
      finally { unlock?.(); if (directInput) { directInputPending = false; directInputEpoch++; controls(); void refresh(); } if (expected === version && !quiet) { pending = false; stopping = false; controls(); void refresh(); } }
    }
    async function sendUpload(metadata, files) {
      if (interactionBlocked() || current?.pageId !== metadata.pageId) throw new Error('Browser page changed or is busy.');
      const expected = ++version, session = state.status?.session?.activeId;
      const previous = transport;
      let unlock;
      transport = new Promise((resolve) => { unlock = resolve; });
      pending = true; controls();
      try {
        await previous;
        if (expected !== version || session !== state.status?.session?.activeId || current?.pageId !== metadata.pageId) throw new Error('Browser page changed.');
        const result = await api('/api/browser-upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Orbit-Upload': encodeURIComponent(JSON.stringify(metadata)) }, body: new Blob(files) });
        if (expected !== version || session !== state.status?.session?.activeId) throw new Error('Browser session changed.');
        if (result.browser) render(result.browser);
      } finally {
        unlock?.();
        if (expected === version) { pending = false; controls(); void refresh(); }
      }
    }
    async function saveDownload(request, filename) {
      if (interactionBlocked() || current?.pageId !== request.pageId) throw new Error('Browser page changed or is busy.');
      const expected = ++version, session = state.status?.session?.activeId;
      const previous = transport;
      let unlock;
      transport = new Promise((resolve) => { unlock = resolve; });
      pending = true; controls();
      try {
        await previous;
        if (expected !== version || session !== state.status?.session?.activeId || current?.pageId !== request.pageId) throw new Error('Browser page changed.');
        const blob = await api('/api/browser-download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), responseType: 'blob' });
        if (expected !== version || session !== state.status?.session?.activeId || current?.pageId !== request.pageId) throw new Error('Browser session changed.');
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href = objectUrl; link.download = filename;
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      } finally {
        unlock?.();
        if (expected === version) { pending = false; controls(); void refresh(); }
      }
    }
    byId('workbench').addEventListener('orbit:workbench', (event) => {
      if (panel.hidden) { recoveryFocusUntil = 0; closeMenu(); closeReader(); closeFind(); select.hide(); picker.hide(); upload.hide(); download.hide(); input.release(); }
      else { sizeDock(); if (event.detail.moveFocus) url.focus(); void refresh(); }
    });
    panel.addEventListener('keydown', (event) => {
      const command = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
      if (command && !event.altKey && ['l', 'f', 'g', 'r', 't', 'w'].includes(key)) {
        event.preventDefault(); event.stopPropagation();
        if (key === 'l') url.focus();
        else if (key === 'f') openFind();
        else if (key === 'g') { if (findBar.hidden) openFind(); else void runFind(event.shiftKey ? 'previous' : 'next'); }
        else if (key === 'r' && current?.active) void act({ action: 'reload' });
        else if (key === 't' && current?.active && current.tabs.length < 8) void act({ action: 'tab', operation: 'new' }).then((succeeded) => { if (succeeded) url.focus(); });
        else if (key === 'w' && current?.active) { const tab = current.tabs.find((item) => item.active); if (tab) void act({ action: 'tab', operation: 'close', id: tab.id }); }
      } else if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation(); void act({ action: 'history', direction: event.key === 'ArrowLeft' ? 'back' : 'forward' });
      } else if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault(); event.stopPropagation();
        if (select.isOpen()) select.hide(true);
        else if (picker.isOpen()) picker.hide(true);
        else if (upload.isOpen()) upload.hide(true);
        else if (download.isOpen()) download.hide(true);
        else if (browserHelp.open) { browserHelp.open = false; browserHelp.querySelector('summary')?.focus({ preventScroll: true }); }
        else if (!menu.hidden) closeMenu(true);
        else if (!findBar.hidden) closeFind(true);
        else if (!reader.hidden) closeReader(true);
        else if (current?.dialog) void act({ action: 'dialog', accept: false });
        else setWorkbench(null);
      }
    });
    findBar.addEventListener('submit', (event) => { event.preventDefault(); void runFind('next'); });
    findQuery.addEventListener('input', () => { findRequest++; findBusy = false; if (connectionError) showFindReconnect(); else findStatus.textContent = ''; controls(); });
    findBar.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeFind(true); }
      else if (event.key === 'Enter' && event.target === findQuery && (event.shiftKey || connectionError)) { event.preventDefault(); event.stopPropagation(); void runFind(event.shiftKey ? 'previous' : 'next'); }
    });
    byId('browserFindPrevious').addEventListener('click', () => { void runFind('previous'); });
    byId('browserFindClose').addEventListener('click', () => closeFind(true));
    byId('browserPreviewConnect').addEventListener('submit', (event) => { event.preventDefault(); if (url.value.trim()) void act({ action: 'open', address: url.value.trim(), searchEngine: searchEngine.value }); });
    url.addEventListener('input', () => { recoveryReadyEngine = ''; recoveryFocusUntil = 0; addressDirty = true; controls(); }); url.addEventListener('focus', () => url.select());
    url.addEventListener('keydown', (event) => { if (event.key === 'Escape' && addressDirty) { event.preventDefault(); event.stopPropagation(); recoveryReadyEngine = ''; addressDirty = false; url.value = current?.url || ''; url.select(); controls(); } });
    byId('browserPreviewReload').addEventListener('click', () => act({ action: 'reload' }));
    byId('browserPreviewStop').addEventListener('click', () => { closeReader(); void act({ action: 'disconnect' }); });
    byId('browserPreviewRetry').addEventListener('click', () => {
      if (connectionError) { pollController?.abort(); polling = false; pollController = undefined; pollFailures = 0; nextPollAt = 0; void refresh(); }
      else if (current?.resourceErrors && !error && !current?.message) void act({ action: 'reload' });
      else {
        const retry = browserRetryRequest(failedAction, current); if (!retry) return;
        if (retry.action === 'read-page') void readPage();
        else if (retry.action === 'copy-selection') void copySelection();
        else if (retry.action === 'reload') void act({ action: 'reload' });
        else void act(retry);
      }
    });
    idleAction.addEventListener('click', () => {
      if (browserIdleNotice(current, Date.now()) === 'closed') url.focus({ preventScroll: true });
      else if (current?.active && !renewing && !interactionBlocked() && !current.loading) {
        const pageId = current.pageId, returnFocus = document.activeElement === idleAction;
        const expected = version + 1, session = state.status?.session?.activeId;
        renewing = true; controls();
        if (failedAction?.action === 'keep-alive') { error = ''; failedAction = null; }
        void act({ action: 'keep-alive', pageId }, true).finally(() => {
          if (expected !== version || session !== state.status?.session?.activeId) return;
          renewing = false; controls();
          if (returnFocus && idleNotice.hidden && current?.pageId === pageId && document.activeElement === document.body) (reader.hidden ? stage : readerText).focus({ preventScroll: true });
        });
      }
    });
    byId('browserPreviewChangeEngine').addEventListener('click', () => {
      const query = currentSearchQuery(); if (!query) return;
      recoveryReadyEngine = '';
      url.value = query; addressDirty = true; controls();
      recoveringSearch = true; browserHelp.open = true;
      searchEngine.focus();
    });
    pageActions.addEventListener('click', () => menu.hidden ? openContextMenu() : closeMenu(true));
    byId('browserFindPage').addEventListener('click', openFind);
    byId('browserReadPage').addEventListener('click', () => { if (interactionBlocked() || current?.loading) return; closeMenu(); void readPage(); });
    byId('browserPageReaderClose').addEventListener('click', () => closeReader(true));
    readerRefresh.addEventListener('click', () => { void readPage(); });
    reader.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeReader(true); } });
    byId('browserCopySelection').addEventListener('click', () => { if (interactionBlocked()) return; closeMenu(true); void copySelection(); });
    byId('browserCopyAddress').addEventListener('click', async () => {
      closeMenu(true);
      if (!current?.url) return;
      try { await navigator.clipboard.writeText(current.url); showToast(localText('Page address copied.', '已复制网页地址。', '已複製網頁網址。'), 'success'); }
      catch { showToast(localText('Could not access the clipboard.', '无法访问剪贴板。', '無法存取剪貼簿。'), 'error'); }
    });
    menu.addEventListener('keydown', (event) => {
      const items = [...menu.querySelectorAll('[role="menuitem"]')], index = items.indexOf(document.activeElement);
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
      else if (event.key === 'Tab') {
        event.preventDefault(); event.stopPropagation();
        closeMenu();
        const targets = [...panel.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [href], [tabindex]:not([tabindex="-1"])')].filter((node) => node.tabIndex >= 0 && node.getClientRects().length && !node.closest('[hidden], [inert]'));
        const anchor = targets.indexOf(pageActions);
        (event.shiftKey ? pageActions : targets[anchor + 1] || stage).focus({ preventScroll: true });
      }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next].focus();
      }
    });
    document.addEventListener('focusin', (event) => { if (!menu.hidden && !menu.contains(event.target) && event.target !== pageActions) closeMenu(); });
    document.addEventListener('pointerdown', (event) => { if (!menu.hidden && !menu.contains(event.target) && event.target !== pageActions) closeMenu(); });
    byId('browserBack').addEventListener('click', () => act({ action: 'history', direction: 'back' }));
    byId('browserForward').addEventListener('click', () => act({ action: 'history', direction: 'forward' }));
    byId('browserNewTab').addEventListener('click', () => act({ action: 'tab', operation: 'new' }).then((succeeded) => { if (succeeded) url.focus(); }));
    byId('browserDialogAccept').addEventListener('click', () => act({ action: 'dialog', accept: true, text: byId('browserDialogInput').value }));
    byId('browserDialogDismiss').addEventListener('click', () => act({ action: 'dialog', accept: false }));
    byId('browserPageDialog').addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); void act({ action: 'dialog', accept: false }); }
      else if (event.key === 'Enter' && event.target === byId('browserDialogInput')) { event.preventDefault(); byId('browserDialogAccept').click(); }
    });
    byId('browserPreviewAsk').addEventListener('click', () => {
      if (pending || state.busy || connectionError || !current?.active || current.loading) return;
      const activeTab = current.tabs.find((tab) => tab.active); if (!activeTab) return;
      state.browserHandoffTabId = activeTab.id;
      state.browserHandoffUrl = current.url;
      state.browserHandoffTitle = activeTab.title === 'New tab' ? localText('New tab', '新标签页', '新增分頁') : activeTab.title;
      state.browserHandoffState = 'ready';
      renderBrowserHandoff(); showConversation(); elements.prompt.focus();
    });
    const observer = new ResizeObserver(sizeDock); observer.observe(workspace); observer.observe(stage);
    let timer;
    async function tick() {
      const active = state.status?.session?.activeId;
      if (!sessionId) sessionId = active;
      if (sessionId !== active) { sessionId = active; version++; pollController?.abort(); polling = false; pollController = undefined; transport = Promise.resolve(); pending = false; directInputPending = false; stopping = false; renewing = false; error = ''; failedAction = null; connectionError = ''; pollFailures = 0; nextPollAt = 0; addressDirty = false; select.hide(); picker.hide(); upload.hide(); download.hide(); input.release(); closeReader(); url.value = ''; current = null; render({ active: false, pageId: '', frame: -1, width: 1280, height: 800, tabs: [], url: '', title: '' }); }
      if (!panel.hidden) { controls(); if (Date.now() >= nextPollAt) void refresh(); }
      if (!disposed) timer = setTimeout(tick, panel.hidden ? 1000 : 120);
    }
    void tick(); controls();
    window.addEventListener('beforeunload', () => { disposed = true; pollController?.abort(); clearTimeout(timer); clearTimeout(resizeTimer); observer.disconnect(); select.hide(); picker.hide(); upload.hide(); download.hide(); input.dispose(); });
  }
`;
