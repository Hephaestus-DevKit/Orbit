interface BrowserHistoryMessage {
  id: string;
  text?: string;
  blocks?: unknown[];
  createdAt?: string;
  position?: number;
}

interface BrowserControlTurn {
  createdAt: string;
}

interface BrowserMessagePage {
  sessionId?: string;
  total?: number;
  start?: number;
  end?: number;
}

interface BrowserHistoryResponse {
  page?: BrowserMessagePage;
  messages?: BrowserHistoryMessage[];
}

interface HistoryElements {
  messages: HTMLElement;
  messageScroll: HTMLElement;
  jumpEarlier: HTMLButtonElement;
}

interface HistoryState {
  messageCache: Map<string, BrowserHistoryMessage>;
  controlTurns: Map<string, BrowserControlTurn>;
  messageSessionId: string;
  messageTotal: number;
  earliestMessagePosition: number;
  loadingEarlierMessages: boolean;
  stickToBottom: boolean;
  streaming: unknown;
  streamingTurnId: string | null;
  streamingTools: { clear(): void };
}

interface HistoryRuntime {
  elements: HistoryElements;
  state: HistoryState;
  api: (path: string, init?: RequestInit) => Promise<unknown>;
  createMessage: (
    message: BrowserHistoryMessage,
    animate: boolean,
  ) => { root: HTMLElement };
  renderControlTurn: (entry: BrowserControlTurn) => HTMLElement;
  setEmptyState: () => void;
  updateMessageNavigation: () => void;
  scrollToBottom: (force: boolean) => void;
}

/** Typed, paginated conversation history and scroll-anchor controller. */
function createHistoryController(runtime: HistoryRuntime) {
  const {
    elements,
    state,
    api,
    createMessage,
    renderControlTurn,
    setEmptyState,
    updateMessageNavigation,
    scrollToBottom,
  } = runtime;

  function captureMessageAnchor() {
    const scrollBounds = elements.messageScroll.getBoundingClientRect();
    const node = Array.from(elements.messages.children).find(
      (candidate): candidate is HTMLElement =>
        candidate instanceof HTMLElement &&
        candidate.getBoundingClientRect().bottom > scrollBounds.top,
    );
    return {
      id: node?.dataset.messageId || node?.dataset.controlTurnId || "",
      offset: node ? node.getBoundingClientRect().top - scrollBounds.top : 0,
      top: elements.messageScroll.scrollTop,
    };
  }

  function restoreMessageAnchor(
    anchor: ReturnType<typeof captureMessageAnchor>,
  ): void {
    elements.messageScroll.scrollTop = anchor.top;
    const node = anchor.id
      ? Array.from(elements.messages.children).find(
          (candidate): candidate is HTMLElement =>
            candidate instanceof HTMLElement &&
            (candidate.dataset.messageId === anchor.id ||
              candidate.dataset.controlTurnId === anchor.id),
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

  function rebuildMessageTimeline(): void {
    elements.messages.replaceChildren();
    const timeline: Array<{
      createdAt: string;
      position: number;
      node: HTMLElement;
    }> = [];
    for (const message of state.messageCache.values()) {
      if (!message.text && (!message.blocks || !message.blocks.length))
        continue;
      const position = Number(message.position);
      timeline.push({
        createdAt: message.createdAt || "",
        position: Number.isFinite(position)
          ? position
          : Number.MAX_SAFE_INTEGER,
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
        if (
          Number.isFinite(leftTime) &&
          Number.isFinite(rightTime) &&
          leftTime !== rightTime
        ) {
          return leftTime - rightTime;
        }
        return left.position - right.position;
      })
      .forEach((item) => elements.messages.append(item.node));
    setEmptyState();
  }

  function mergeMessagePage(
    data: BrowserHistoryResponse | null | undefined,
    reset: boolean,
  ): void {
    const page = data?.page || {};
    const sessionChanged =
      Boolean(state.messageSessionId) &&
      page.sessionId !== state.messageSessionId;
    const historyShrank = Number(page.total) < state.messageTotal;
    if (reset || sessionChanged || historyShrank) state.messageCache.clear();
    state.messageSessionId = page.sessionId || "";
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
    for (const message of data?.messages || []) {
      if (!message || typeof message.id !== "string") continue;
      state.messageCache.set(message.id, message);
    }
    const positions = Array.from(state.messageCache.values())
      .map((message) => Number(message.position))
      .filter(Number.isFinite);
    state.earliestMessagePosition = positions.length
      ? Math.min(...positions)
      : Math.max(0, Number(page.start) || 0);
  }

  async function renderMessages(options?: {
    forceBottom?: boolean;
    resetHistory?: boolean;
  }): Promise<void> {
    const forceBottom = Boolean(options?.forceBottom);
    const resetHistory = Boolean(options?.resetHistory);
    const preservePosition = !forceBottom && !state.stickToBottom;
    const anchor = preservePosition ? captureMessageAnchor() : null;
    const data = (await api(
      "/api/messages?limit=60",
    )) as BrowserHistoryResponse;
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

  async function loadEarlierMessages(options?: {
    revealStart?: boolean;
  }): Promise<boolean> {
    if (state.loadingEarlierMessages || state.earliestMessagePosition <= 0) {
      return false;
    }
    state.loadingEarlierMessages = true;
    elements.jumpEarlier.disabled = true;
    const anchor = captureMessageAnchor();
    try {
      const data = (await api(
        "/api/messages?limit=60&before=" +
          encodeURIComponent(String(state.earliestMessagePosition)),
      )) as BrowserHistoryResponse;
      mergeMessagePage(data, false);
      rebuildMessageTimeline();
      if (options?.revealStart) {
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

  return { renderMessages, loadEarlierMessages };
}

export const WEB_UI_CLIENT_HISTORY_SCRIPT =
  `  const { renderMessages, loadEarlierMessages } = ` +
  `(${createHistoryController.toString()})({ elements, state, api, createMessage, renderControlTurn, setEmptyState, updateMessageNavigation, scrollToBottom });\n\n`;
