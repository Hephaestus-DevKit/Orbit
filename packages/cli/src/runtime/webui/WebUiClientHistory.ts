/**
 * Browser-side paginated conversation history and scroll-anchor behavior.
 *
 * This remains a script fragment because Orbit serves a dependency-free,
 * CSP-compatible browser controller from the local CLI process.
 */
export const WEB_UI_CLIENT_HISTORY_SCRIPT = String.raw`
  function captureMessageAnchor() {
    const node = Array.from(elements.messages.children).find((candidate) =>
      candidate.getBoundingClientRect().bottom > elements.messageScroll.getBoundingClientRect().top,
    );
    return {
      id: node && (node.dataset.messageId || node.dataset.controlTurnId) || '',
      offset: node
        ? node.getBoundingClientRect().top - elements.messageScroll.getBoundingClientRect().top
        : 0,
      top: elements.messageScroll.scrollTop,
    };
  }

  function restoreMessageAnchor(anchor) {
    elements.messageScroll.scrollTop = anchor.top;
    const node = anchor.id
      ? Array.from(elements.messages.children).find((candidate) =>
          candidate.dataset.messageId === anchor.id ||
          candidate.dataset.controlTurnId === anchor.id,
        )
      : null;
    if (node) {
      elements.messageScroll.scrollTop +=
        node.getBoundingClientRect().top -
        elements.messageScroll.getBoundingClientRect().top -
        anchor.offset;
    }
    state.stickToBottom = false;
    updateMessageNavigation();
  }

  function rebuildMessageTimeline() {
    elements.messages.replaceChildren();
    const timeline = [];
    for (const message of state.messageCache.values()) {
      if (!message.text && (!message.blocks || !message.blocks.length)) continue;
      timeline.push({
        createdAt: message.createdAt || '',
        position: Number(message.position),
        node: createMessage(message, false).root,
      });
    }
    for (const entry of state.controlTurns.values()) {
      timeline.push({
        createdAt: entry.createdAt,
        position: Number.MAX_SAFE_INTEGER,
        node: renderControlTurn(entry),
      });
    }
    timeline
      .sort((left, right) => {
        const leftTime = Date.parse(left.createdAt);
        const rightTime = Date.parse(right.createdAt);
        if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
          return leftTime - rightTime;
        }
        return left.position - right.position;
      })
      .forEach((item) => elements.messages.append(item.node));
    setEmptyState();
  }

  function mergeMessagePage(data, reset) {
    const page = data && data.page || {};
    const sessionChanged = state.messageSessionId && page.sessionId !== state.messageSessionId;
    const historyShrank = Number(page.total) < state.messageTotal;
    if (reset || sessionChanged || historyShrank) {
      state.messageCache.clear();
    }
    state.messageSessionId = page.sessionId || '';
    state.messageTotal = Math.max(0, Number(page.total) || 0);
    const pageStart = Number(page.start);
    const pageEnd = Number(page.end);
    if (Number.isFinite(pageStart) && Number.isFinite(pageEnd)) {
      for (const [id, message] of state.messageCache) {
        const position = Number(message.position);
        if (position >= pageStart && position < pageEnd) {
          state.messageCache.delete(id);
        }
      }
    }
    for (const message of data.messages || []) {
      if (!message || typeof message.id !== 'string') continue;
      state.messageCache.set(message.id, message);
    }
    const positions = Array.from(state.messageCache.values())
      .map((message) => Number(message.position))
      .filter(Number.isFinite);
    state.earliestMessagePosition = positions.length
      ? Math.min(...positions)
      : Math.max(0, Number(page.start) || 0);
  }

  async function renderMessages(options) {
    const forceBottom = Boolean(options && options.forceBottom);
    const resetHistory = Boolean(options && options.resetHistory);
    const preservePosition = !forceBottom && !state.stickToBottom;
    const anchor = preservePosition ? captureMessageAnchor() : null;
    const data = await api('/api/messages?limit=60');
    mergeMessagePage(data, resetHistory);
    rebuildMessageTimeline();
    state.streaming = null;
    state.streamingTurnId = null;
    state.streamingTools.clear();
    if (anchor) {
      restoreMessageAnchor(anchor);
    } else {
      state.stickToBottom = true;
      scrollToBottom(true);
    }
  }

  async function loadEarlierMessages(options) {
    if (state.loadingEarlierMessages || state.earliestMessagePosition <= 0) {
      return false;
    }
    state.loadingEarlierMessages = true;
    elements.jumpEarlier.disabled = true;
    const anchor = captureMessageAnchor();
    try {
      const data = await api(
        '/api/messages?limit=60&before=' + encodeURIComponent(String(state.earliestMessagePosition)),
      );
      mergeMessagePage(data, false);
      rebuildMessageTimeline();
      if (options && options.revealStart) {
        elements.messageScroll.scrollTop = 0;
        state.stickToBottom = false;
        updateMessageNavigation();
      } else {
        restoreMessageAnchor(anchor);
      }
      return true;
    } finally {
      state.loadingEarlierMessages = false;
      elements.jumpEarlier.disabled = false;
    }
  }

`;
