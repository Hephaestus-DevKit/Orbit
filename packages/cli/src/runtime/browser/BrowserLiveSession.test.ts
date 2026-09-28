import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { Browser } from "playwright-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserLiveSession } from "./BrowserLiveSession.js";
import { BrowserFileUploadMetadataSchema } from "./BrowserLiveContracts.js";
import { launchPreviewBrowser } from "./BrowserLauncher.js";

const transport = vi.hoisted(() => ({
  start: vi.fn(async () => ({
    server: "http://127.0.0.1:1234",
    username: "fixture",
    password: "fixture",
  })),
  stop: vi.fn(async () => undefined),
  authorizeLocal: vi.fn(),
  localTicket: vi.fn(() => "ticket"),
}));
vi.mock("./BrowserNetworkProxy.js", () => ({
  BrowserNetworkProxy: vi.fn(function () {
    return transport;
  }),
}));
vi.mock("./BrowserLauncher.js", () => ({ launchPreviewBrowser: vi.fn() }));

function engine() {
  let url = "about:blank";
  const frame = {
    url: () => url,
    evaluate: vi.fn(async (): Promise<unknown> => "Selected page text"),
    evaluateHandle: vi.fn(async () => ({
      asElement: () => null,
      dispose: vi.fn(async () => undefined),
    })),
  };
  const cdp = Object.assign(new EventEmitter(), {
    send: vi.fn(async (method: string) =>
      method === "Page.getNavigationHistory"
        ? { currentIndex: 1, entries: [{}, {}] }
        : {},
    ),
    detach: vi.fn(async () => undefined),
  });
  const page = Object.assign(new EventEmitter(), {
    url: () => url,
    title: vi.fn(async () => "Fixture"),
    evaluate: vi.fn(async (): Promise<unknown> => undefined),
    mainFrame: () => frame,
    frames: () => [frame],
    opener: vi.fn(async () => null),
    goto: vi.fn(async (next: string) => {
      url = next;
      page.emit("framenavigated", frame);
    }),
    reload: vi.fn(async () => {
      await page.goto(url);
    }),
    goBack: vi.fn(async () => null),
    goForward: vi.fn(async () => null),
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    setViewportSize: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => Buffer.from("fallback frame")),
    close: vi.fn(async () => {
      page.emit("close");
    }),
    routeWebSocket: vi.fn(async () => undefined),
    keyboard: { press: vi.fn(async () => undefined) },
    locator: vi.fn(() => ({
      ariaSnapshot: vi.fn(async () => "Fixture"),
      click: vi.fn(async (): Promise<void> => undefined),
      fill: vi.fn(async (): Promise<void> => undefined),
    })),
    context: () => context,
  });
  const context = Object.assign(new EventEmitter(), {
    newPage: vi.fn(async () => page),
    route: vi.fn(async () => undefined),
    routeWebSocket: vi.fn(async () => undefined),
    grantPermissions: vi.fn(async () => undefined),
    newCDPSession: vi.fn(async () => cdp),
  });
  const close = vi.fn(async () => undefined);
  const browser = Object.assign(new EventEmitter(), {
    newContext: vi.fn(async () => context),
    close,
  }) as unknown as Browser;
  return { browser, page, frame, cdp, context, close };
}
const sessions: BrowserLiveSession[] = [];
function session() {
  const onStatus = vi.fn();
  const live = new BrowserLiveSession({ blockedPort: () => 6047, onStatus });
  sessions.push(live);
  return { live, onStatus };
}
describe("real browser lifecycle and input", () => {
  it("prompts for a website download and invalidates it on navigation", async () => {
    const fake = engine();
    vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(fake.browser);
    const { live } = session();
    await live.handle({ action: "open", address: "example.com" });
    expect(fake.browser.newContext).toHaveBeenCalledWith(
      expect.objectContaining({ acceptDownloads: true }),
    );
    const internalPage = {
      opener: vi.fn(async () => null),
      url: () => "edge://downloads-hub/",
      close: vi.fn(async () => undefined),
    };
    fake.context.emit("page", internalPage);
    await vi.waitFor(() => expect(internalPage.close).toHaveBeenCalledOnce());
    expect((await live.read()).tabs).toHaveLength(1);
    const download = {
      suggestedFilename: () => "report.txt",
      createReadStream: vi.fn(async () =>
        Readable.from([Buffer.from("report")]),
      ),
      cancel: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };
    fake.page.emit("download", download);
    await vi.waitFor(async () =>
      expect((await live.read()).download?.status).toBe("ready"),
    );
    const initial = await live.read();
    await fake.page.goto("");
    expect((await live.read()).download?.id).toBe(initial.download!.id);
    expect(
      live.takeDownload({
        pageId: initial.pageId,
        downloadId: initial.download!.id,
      }),
    ).toEqual({
      filename: "report.txt",
      buffer: Buffer.from("report"),
    });
    expect((await live.read()).download).toBeUndefined();
    fake.page.emit("download", download);
    const stale = await live.read();
    await live.handle({ action: "open", address: "example.org" });
    expect((await live.read()).download).toBeUndefined();
    expect(() =>
      live.takeDownload({
        pageId: stale.pageId,
        downloadId: stale.download!.id,
      }),
    ).toThrow("page changed");
  });
  it("uploads user-selected bytes only to the active file request", async () => {
    const fake = engine();
    vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(fake.browser);
    const { live } = session();
    await live.handle({ action: "open", address: "example.com" });
    const setFiles = vi.fn(async () => undefined);
    fake.page.emit("filechooser", { isMultiple: () => true, setFiles });
    const state = await live.read();
    expect(state.fileChooser?.multiple).toBe(true);
    const metadata = BrowserFileUploadMetadataSchema.parse({
      pageId: state.pageId,
      chooserId: state.fileChooser!.id,
      files: [
        { name: "empty.txt", mimeType: "text/plain", size: 0 },
        { name: "data.txt", mimeType: "text/plain", size: 4 },
      ],
    });
    await expect(
      live.applyUpload(metadata, Buffer.from("bad")),
    ).rejects.toThrow("did not match");
    expect((await live.read()).fileChooser?.id).toBe(state.fileChooser!.id);
    await live.applyUpload(metadata, Buffer.from("data"));
    expect(setFiles).toHaveBeenCalledWith([
      { name: "empty.txt", mimeType: "text/plain", buffer: Buffer.alloc(0) },
      { name: "data.txt", mimeType: "text/plain", buffer: Buffer.from("data") },
    ]);
    expect((await live.read()).fileChooser).toBeUndefined();
    await expect(
      live.applyUpload(metadata, Buffer.from("data")),
    ).rejects.toThrow("expired");
    fake.page.emit("filechooser", { isMultiple: () => false, setFiles });
    const stale = await live.read();
    await live.handle({ action: "open", address: "example.org" });
    expect((await live.read()).fileChooser).toBeUndefined();
    await expect(
      live.handle({
        action: "dismiss-upload",
        pageId: stale.pageId,
        chooserId: stale.fileChooser!.id,
      }),
    ).rejects.toThrow("expired");
  });
  it("keeps idle reads passive and renews only an explicit current-page action", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    try {
      const fake = engine();
      vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(fake.browser);
      const { live, onStatus } = session();
      await live.handle({ action: "open", address: "example.com" });
      const initial = await live.read();
      expect(initial.idleExpiresAt).toBe(Date.now() + 30 * 60_000);
      await vi.advanceTimersByTimeAsync(29 * 60_000);
      expect((await live.read()).idleExpiresAt).toBe(initial.idleExpiresAt);
      await live.handle({ action: "keep-alive", pageId: initial.pageId });
      const renewed = await live.read();
      expect(renewed.idleExpiresAt).toBe(Date.now() + 30 * 60_000);
      expect(renewed.pageId).toBe(initial.pageId);
      expect(renewed.tabs).toEqual(initial.tabs);
      expect(fake.page.goto).toHaveBeenCalledOnce();
      expect(fake.page.reload).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(await live.read()).toMatchObject({
        active: false,
        closedReason: "idle",
        tabs: [],
      });
      expect((await live.read()).idleExpiresAt).toBeUndefined();
      expect(fake.close).toHaveBeenCalledOnce();
      expect(transport.stop).toHaveBeenCalled();
      expect(onStatus).toHaveBeenCalledWith("browser_preview_idle_closed");
      await expect(
        live.handle({
          action: "resize",
          pageId: initial.pageId,
          width: 1100,
          height: 760,
        }),
      ).rejects.toThrow("page changed");
      await expect(
        live.handle({
          action: "input",
          pageId: initial.pageId,
          events: [{ type: "text", text: "late draft" }],
        }),
      ).rejects.toThrow("page changed");
      expect((await live.read()).message).toBe("");
      expect((await live.read()).closedReason).toBe("idle");
      expect(onStatus).not.toHaveBeenCalledWith("browser_preview_error");
      vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(engine().browser);
      await live.handle({ action: "open", address: "example.com" });
      expect((await live.read()).closedReason).toBeUndefined();
      await live.reset();
      expect((await live.read()).closedReason).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
  it("does not renew or launch a browser for an invalid keep-alive", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    try {
      const { live } = session();
      const staleId = "00000000-0000-4000-8000-000000000001";
      await expect(
        live.handle({ action: "keep-alive", pageId: staleId }),
      ).rejects.toThrow("page changed");
      expect(launchPreviewBrowser).not.toHaveBeenCalled();
      const fake = engine();
      vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(fake.browser);
      await live.handle({ action: "open", address: "example.com" });
      const initial = await live.read();
      await vi.advanceTimersByTimeAsync(29 * 60_000);
      await expect(
        live.handle({ action: "keep-alive", pageId: staleId }),
      ).rejects.toThrow("page changed");
      expect((await live.read()).idleExpiresAt).toBe(initial.idleExpiresAt);
      expect((await live.read()).message).toBe("");
      fake.page.emit("dialog", {
        type: () => "confirm",
        message: () => "Respond before keeping open",
        defaultValue: () => "",
      });
      await expect(
        live.handle({ action: "keep-alive", pageId: initial.pageId }),
      ).rejects.toThrow("dialog first");
      expect((await live.read()).idleExpiresAt).toBe(initial.idleExpiresAt);
      await vi.advanceTimersByTimeAsync(60_000);
      expect((await live.read()).closedReason).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });
  it("rejects an Agent action after the attached tab changes", async () => {
    const fake = engine();
    const popup = engine();
    vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(fake.browser);
    const { live } = session();
    await live.handle({ action: "open", address: "example.com" });
    const attachedTabId = live.activeTabId;
    await popup.page.goto("https://example.com/other");
    fake.context.emit("page", popup.page);
    await vi.waitFor(() => expect(live.activeTabId).not.toBe(attachedTabId));
    await expect(
      live.execute({ action: "snapshot" }, undefined, attachedTabId),
    ).rejects.toThrow("no longer active");
    expect(fake.page.locator).not.toHaveBeenCalled();
    expect(popup.page.locator).not.toHaveBeenCalled();
  });
  it("tracks failed styles and scripts per page without treating cancelled or image requests as broken layout", async () => {
    const fake = engine();
    vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(fake.browser);
    const { live } = session();
    await live.handle({ action: "open", address: "example.com" });
    const request = (type: string, error = "net::ERR_CONNECTION_CLOSED") => ({
      resourceType: () => type,
      url: () => "https://example.com/" + type,
      failure: () => ({ errorText: error }),
    });
    fake.page.emit("requestfailed", request("stylesheet"));
    fake.page.emit("requestfailed", request("stylesheet"));
    fake.page.emit("requestfailed", request("image"));
    fake.page.emit("requestfailed", request("script", "net::ERR_ABORTED"));
    expect((await live.read()).resourceErrors).toBe(1);
    fake.page.emit("response", {
      status: () => 503,
      request: () => request("script"),
    });
    expect((await live.read()).resourceErrors).toBe(2);
    await fake.page.goto("https://example.com/recovered");
    expect((await live.read()).resourceErrors).toBe(0);
    await live.reset();
    fake.page.emit("requestfailed", request("stylesheet"));
    expect((await live.read()).resourceErrors).toBe(0);
  });
  it("registers noopener pages once and retains their already loaded URL", async () => {
    const fake = engine(),
      popup = engine();
    vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(fake.browser);
    const { live } = session();
    await live.handle({ action: "open", address: "example.com" });
    await popup.page.goto("https://example.com/popup");
    fake.context.emit("page", popup.page);
    await vi.waitFor(async () =>
      expect((await live.read()).tabs).toHaveLength(2),
    );
    await vi.waitFor(async () =>
      expect((await live.read()).url).toBe("https://example.com/popup"),
    );
    fake.context.emit("page", popup.page);
    expect((await live.read()).tabs).toHaveLength(2);
  });
  afterEach(async () => {
    await Promise.all(sessions.splice(0).map((live) => live.reset()));
    vi.clearAllMocks();
  });
  it("does not start on construction or invalid input", async () => {
    const { live } = session();
    expect((await live.read()).active).toBe(false);
    await expect(
      live.handle({ action: "open", address: "javascript:alert(1)" }),
    ).rejects.toThrow("HTTP");
    expect(transport.start).not.toHaveBeenCalled();
    expect(launchPreviewBrowser).not.toHaveBeenCalled();
  });
  it("closes a launch that arrives after stop, without resurrecting the session", async () => {
    const fake = engine();
    let release!: (browser: Browser) => void;
    vi.mocked(launchPreviewBrowser).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { live } = session();
    const opening = live.handle({ action: "open", address: "example.com" });
    const rejected = expect(opening).rejects.toThrow("stopped");
    await vi.waitFor(() => expect(launchPreviewBrowser).toHaveBeenCalledOnce());
    await live.reset();
    release(fake.browser);
    await rejected;
    expect(fake.close).toHaveBeenCalledOnce();
    expect((await live.read()).active).toBe(false);
  });
  it("does not swallow partial-start failures or strand a browser", async () => {
    const fake = engine();
    vi.spyOn(fake.browser, "newContext").mockRejectedValueOnce(
      new Error("Context failed"),
    );
    vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(fake.browser);
    const { live } = session();
    await expect(
      live.handle({ action: "open", address: "example.com" }),
    ).rejects.toThrow("Context failed");
    expect(fake.close).toHaveBeenCalledOnce();
    expect(live.isActive).toBe(false);
  });
  it("keeps the old page address and local grant after a pre-commit navigation failure", async () => {
    const fake = engine();
    vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(fake.browser);
    const { live } = session();
    await live.handle({ action: "open", address: "https://example.com/old" });
    fake.page.goto.mockRejectedValueOnce(new Error("Navigation failed"));
    await expect(
      live.handle({ action: "open", address: "http://127.0.0.1:5173" }),
    ).rejects.toThrow("Navigation failed");
    expect((await live.read()).url).toBe("https://example.com/old");
    expect(fake.page.url()).toBe("https://example.com/old");
    expect(live.isActive).toBe(true);
    const routeHandler = fake.context.route.mock.calls[0]?.[1];
    expect(routeHandler).toBeTypeOf("function");
    const abort = vi.fn(async () => undefined);
    const route = {
      abort,
      request: () => ({
        url: () => "http://127.0.0.1:5173/private",
        headers: () => ({}),
        frame: () => ({ page: () => fake.page }),
        isNavigationRequest: () => true,
        method: () => "GET",
      }),
    };
    await routeHandler(route);
    expect(abort).toHaveBeenCalledOnce();
  });
  it("keeps a committed page usable when DOM-ready times out", async () => {
    const fake = engine();
    vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(fake.browser);
    const navigate = fake.page.goto.getMockImplementation()!;
    fake.page.goto.mockImplementationOnce(async (next: string) => {
      await navigate(next);
      throw Object.assign(new Error("page.goto: Timeout 12000ms exceeded."), {
        name: "TimeoutError",
      });
    });
    const { live } = session();

    await live.handle({
      action: "open",
      address: "https://example.com/search",
    });

    expect(await live.read()).toMatchObject({
      active: true,
      url: "https://example.com/search",
      loading: false,
      busy: false,
      resourceErrors: 1,
      message: "",
    });
  });
  it("keeps committed reload and history pages usable after DOM-ready timeouts", async () => {
    const fake = engine();
    vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(fake.browser);
    const { live } = session();
    await live.handle({ action: "open", address: "https://example.com/old" });
    await live.handle({ action: "open", address: "https://example.com/new" });
    const timeout = () =>
      Object.assign(new Error("Navigation timed out."), {
        name: "TimeoutError",
      });

    fake.page.reload.mockImplementationOnce(async () => {
      await fake.page.goto("https://example.com/new");
      throw timeout();
    });
    fake.page.evaluate.mockResolvedValueOnce(false).mockResolvedValueOnce([]);
    await live.execute({ action: "reload" });
    expect(await live.read()).toMatchObject({
      url: "https://example.com/new",
      loading: false,
      resourceErrors: 1,
      message: "",
    });

    fake.page.goBack.mockImplementationOnce(async () => {
      await fake.page.goto("https://example.com/old");
      throw timeout();
    });
    await live.handle({ action: "history", direction: "back" });
    expect(await live.read()).toMatchObject({
      url: "https://example.com/old",
      loading: false,
      resourceErrors: 1,
      message: "",
    });

    fake.page.goForward.mockImplementationOnce(async () => {
      await fake.page.goto("https://example.com/new");
      throw timeout();
    });
    await live.handle({ action: "history", direction: "forward" });
    expect(await live.read()).toMatchObject({
      url: "https://example.com/new",
      loading: false,
      resourceErrors: 1,
      message: "",
    });

    fake.page.reload.mockRejectedValueOnce(timeout());
    await expect(live.execute({ action: "reload" })).rejects.toThrow(
      "Navigation timed out.",
    );
  });
  it("finds only within the current page and rejects stale-page searches", async () => {
    const fake = engine();
    vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(fake.browser);
    const { live } = session();
    await live.handle({ action: "open", address: "https://example.com" });
    const pageId = (await live.read()).pageId;
    fake.page.evaluate.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(
      live.handle({
        action: "find",
        pageId,
        query: "  Orbit  ",
        direction: "next",
      }),
    ).resolves.toBe("found");
    expect((await live.read()).image).toBe(
      Buffer.from("fallback frame").toString("base64"),
    );
    expect(fake.page.evaluate).toHaveBeenLastCalledWith(expect.any(Function), {
      query: "Orbit",
      backwards: false,
    });
    await expect(
      live.handle({
        action: "find",
        pageId,
        query: "missing",
        direction: "previous",
      }),
    ).resolves.toBe("no-match");
    expect(fake.page.evaluate).toHaveBeenLastCalledWith(expect.any(Function), {
      query: "missing",
      backwards: true,
    });

    await fake.page.goto("https://example.com/next");
    fake.page.evaluate.mockClear();
    await expect(
      live.handle({
        action: "find",
        pageId,
        query: "Orbit",
        direction: "next",
      }),
    ).rejects.toThrow("page changed");
    expect(fake.page.evaluate).not.toHaveBeenCalled();
  });
  it("does not publish a find screenshot after the page changes", async () => {
    const fake = engine();
    vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(fake.browser);
    const { live, onStatus } = session();
    await live.handle({ action: "open", address: "https://example.com/old" });
    onStatus.mockClear();
    const pageId = (await live.read()).pageId;
    fake.page.evaluate.mockResolvedValueOnce(true);
    let releaseScreenshot!: () => void;
    const screenshotGate = new Promise<void>((resolve) => {
      releaseScreenshot = resolve;
    });
    fake.page.screenshot.mockImplementationOnce(async () => {
      await screenshotGate;
      return Buffer.from("stale find frame");
    });

    const finding = live.handle({
      action: "find",
      pageId,
      query: "Orbit",
      direction: "next",
    });
    await vi.waitFor(() => expect(fake.page.screenshot).toHaveBeenCalled());
    await fake.page.goto("https://example.com/new");
    releaseScreenshot();

    await expect(finding).rejects.toThrow("page changed");
    expect((await live.read()).image).toBeUndefined();
    expect((await live.read()).message).toBe("");
    expect(onStatus).not.toHaveBeenCalled();
  });
  it("still rejects timeouts before commit and other committed navigation errors", async () => {
    const fake = engine();
    vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(fake.browser);
    const { live } = session();
    await live.handle({ action: "open", address: "https://example.com/old" });
    const timeout = Object.assign(
      new Error("page.goto: Timeout 12000ms exceeded."),
      { name: "TimeoutError" },
    );
    fake.page.goto.mockRejectedValueOnce(timeout);
    await expect(
      live.handle({ action: "open", address: "https://example.com/new" }),
    ).rejects.toThrow("Timeout 12000ms");
    expect((await live.read()).url).toBe("https://example.com/old");

    const navigate = fake.page.goto.getMockImplementation()!;
    fake.page.goto.mockImplementationOnce(async (next: string) => {
      await navigate(next);
      throw new Error("Certificate failed");
    });
    await expect(
      live.handle({ action: "open", address: "https://example.com/next" }),
    ).rejects.toThrow("Certificate failed");
    expect((await live.read()).url).toBe("https://example.com/next");
  });
  it("streams only fresh correctly sized frames and rejects stale-page input", async () => {
    const fake = engine();
    vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(fake.browser);
    const { live, onStatus } = session();
    await live.handle({ action: "open", address: "example.com" });
    const first = await live.read();
    fake.cdp.emit("Page.screencastFrame", {
      data: "image",
      sessionId: 1,
      metadata: { deviceWidth: 1280, deviceHeight: 800 },
    });
    const frame = await live.read();
    expect(frame.image).toBe("image");
    expect((await live.read(frame.frame)).image).toBeUndefined();
    onStatus.mockClear();
    await live.handle({
      action: "input",
      pageId: first.pageId,
      events: [
        { type: "text", text: "你好" },
        {
          type: "pointer",
          phase: "down",
          x: 12,
          y: 20,
          button: "left",
          clicks: 1,
          modifiers: 2,
        },
        {
          type: "pointer",
          phase: "move",
          x: 30,
          y: 40,
          button: "left",
          clicks: 1,
        },
      ],
    });
    expect(fake.cdp.send).toHaveBeenCalledWith("Input.insertText", {
      text: "你好",
    });
    expect(fake.cdp.send).toHaveBeenCalledWith(
      "Input.dispatchMouseEvent",
      expect.objectContaining({ type: "mouseMoved", buttons: 1 }),
    );
    expect(fake.cdp.send).toHaveBeenCalledWith(
      "Input.dispatchMouseEvent",
      expect.objectContaining({ type: "mousePressed", modifiers: 2 }),
    );
    expect(onStatus).not.toHaveBeenCalled();
    await fake.page.goto("https://example.com/next");
    await expect(
      live.handle({
        action: "input",
        pageId: first.pageId,
        events: [{ type: "key", key: "Enter" }],
      }),
    ).rejects.toThrow("page changed");
    await live.reset();
    fake.cdp.emit("Page.screencastFrame", {
      data: "late",
      sessionId: 2,
      metadata: { deviceWidth: 1280, deviceHeight: 800 },
    });
    expect((await live.read()).image).toBeUndefined();
  });
  it("publishes a fresh fallback frame when a static page emits no resize screencast", async () => {
    const fake = engine();
    vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(fake.browser);
    const { live } = session();
    await live.handle({ action: "open", address: "example.com" });
    const oldPageId = (await live.read()).pageId;
    await live.handle({
      action: "resize",
      pageId: oldPageId,
      width: 1000,
      height: 700,
    });
    const state = await live.read();
    expect(state.pageId).not.toBe(oldPageId);
    expect(state.image).toBe(Buffer.from("fallback frame").toString("base64"));
    expect(fake.page.screenshot).toHaveBeenCalledWith({
      type: "jpeg",
      quality: 85,
      timeout: 5000,
    });
  });
  it("does not publish a late resize screenshot after browser shutdown", async () => {
    const fake = engine();
    vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(fake.browser);
    const { live } = session();
    await live.handle({ action: "open", address: "example.com" });
    const oldPageId = (await live.read()).pageId;
    let release!: (frame: Buffer) => void;
    fake.page.screenshot.mockImplementationOnce(
      () => new Promise<Buffer>((resolve) => (release = resolve)),
    );
    const resizing = live.handle({
      action: "resize",
      pageId: oldPageId,
      width: 1000,
      height: 700,
    });
    await vi.waitFor(() => expect(fake.page.screenshot).toHaveBeenCalledOnce());
    await live.reset();
    release(Buffer.from("late frame"));
    await expect(resizing).rejects.toThrow("stopped");
    expect((await live.read()).image).toBeUndefined();
  });
  it("exposes dialogs without evaluating the blocked page and never auto-confirms", async () => {
    const fake = engine();
    vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(fake.browser);
    const { live } = session();
    await live.handle({ action: "open", address: "example.com" });
    const accept = vi.fn(),
      dismiss = vi.fn();
    fake.page.emit("dialog", {
      type: () => "prompt",
      message: () => "Continue?",
      defaultValue: () => "",
      accept,
      dismiss,
    });
    fake.page.title.mockClear();
    expect((await live.read()).dialog?.message).toBe("Continue?");
    expect(fake.page.title).not.toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();
    await live.handle({ action: "dialog", accept: false });
    expect(dismiss).toHaveBeenCalledOnce();
    expect(accept).not.toHaveBeenCalled();
  });
  it("returns only an explicitly requested selection without publishing it in browser state", async () => {
    const fake = engine();
    vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(fake.browser);
    const { live } = session();
    await live.handle({ action: "open", address: "example.com" });
    expect(await live.handle({ action: "copy-selection" })).toBe(
      "Selected page text",
    );
    expect(JSON.stringify(await live.read())).not.toContain(
      "Selected page text",
    );
    expect(fake.frame.evaluate).toHaveBeenCalledOnce();
  });
  it("reads a bounded, redacted page outline only for the current page", async () => {
    const fake = engine();
    vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(fake.browser);
    const { live } = session();
    await live.handle({ action: "open", address: "example.com" });
    const pageId = (await live.read()).pageId;
    fake.page.locator.mockReturnValue({
      ariaSnapshot: vi.fn(
        async () => "- heading: Fixture\n- text: API_KEY=supersecretvalue",
      ),
      count: vi.fn(async () => 0),
      click: vi.fn(),
      fill: vi.fn(),
    });
    fake.page.evaluate.mockResolvedValueOnce(false).mockResolvedValueOnce([]);
    const outline = await live.handle({ action: "read-page", pageId });
    expect(outline).toMatchObject({ controls: [] });
    expect(JSON.stringify(outline)).toContain("heading: Fixture");
    expect(JSON.stringify(outline)).not.toContain("supersecretvalue");
    expect(JSON.stringify(outline)).toContain("***REDACTED***");
    expect(JSON.stringify(await live.read())).not.toContain("heading: Fixture");
    await fake.page.goto("https://example.com/next");
    await expect(live.handle({ action: "read-page", pageId })).rejects.toThrow(
      "page changed",
    );
  });
  it("focuses only a captured current-page control and releases its handle", async () => {
    const fake = engine();
    vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(fake.browser);
    const { live } = session();
    await live.handle({ action: "open", address: "example.com" });
    const pageId = (await live.read()).pageId;
    const handle = {
      evaluate: vi
        .fn()
        .mockResolvedValueOnce({
          label: "Search",
          kind: "field",
          disabled: false,
        })
        .mockResolvedValueOnce({
          label: "Different field",
          kind: "field",
          disabled: false,
        })
        .mockResolvedValueOnce({
          label: "Search",
          kind: "field",
          disabled: false,
        }),
      focus: vi.fn(async () => undefined),
      click: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    fake.page.locator.mockReturnValue({
      ariaSnapshot: vi.fn(async () => "- textbox: Search"),
      count: vi.fn(async () => 1),
      nth: vi.fn(() => ({ elementHandle: vi.fn(async () => handle) })),
    });
    fake.page.evaluate.mockResolvedValueOnce(false).mockResolvedValueOnce([]);
    const outline = await live.handle({ action: "read-page", pageId });
    if (!outline || typeof outline === "string")
      throw new Error("Expected a structured page outline");
    expect(outline.controls).toMatchObject([
      { label: "Search", kind: "field", disabled: false },
    ]);
    const controlId = outline.controls[0]!.id;
    await expect(
      live.handle({
        action: "control",
        pageId,
        controlId,
        operation: "activate",
      }),
    ).rejects.toThrow("does not support");
    await expect(
      live.handle({ action: "control", pageId, controlId, operation: "focus" }),
    ).rejects.toThrow("Control changed");
    expect(handle.focus).not.toHaveBeenCalled();
    await live.handle({
      action: "control",
      pageId,
      controlId,
      operation: "focus",
    });
    expect(handle.focus).toHaveBeenCalledOnce();
    expect(handle.click).not.toHaveBeenCalled();
    expect(handle.dispose).toHaveBeenCalledOnce();
    await expect(
      live.handle({ action: "control", pageId, controlId, operation: "focus" }),
    ).rejects.toThrow("Refresh");
  });
  it("revokes captured controls when the page navigates", async () => {
    const fake = engine();
    vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(fake.browser);
    const { live } = session();
    await live.handle({ action: "open", address: "example.com" });
    const pageId = (await live.read()).pageId;
    const handle = {
      evaluate: vi.fn(async () => ({
        label: "Open next",
        kind: "link",
        disabled: false,
      })),
      focus: vi.fn(async () => undefined),
      click: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    fake.page.locator.mockReturnValue({
      ariaSnapshot: vi.fn(async () => '- link "Open next"'),
      count: vi.fn(async () => 1),
      nth: vi.fn(() => ({ elementHandle: vi.fn(async () => handle) })),
    });
    fake.page.evaluate.mockResolvedValueOnce(false).mockResolvedValueOnce([]);
    const outline = await live.handle({ action: "read-page", pageId });
    if (!outline || typeof outline === "string")
      throw new Error("Expected a structured page outline");
    const controlId = outline.controls[0]!.id;
    await fake.page.goto("https://example.com/next");
    await expect(
      live.handle({
        action: "control",
        pageId,
        controlId,
        operation: "activate",
      }),
    ).rejects.toThrow("page changed");
    expect(handle.dispose).toHaveBeenCalledOnce();
    expect(handle.click).not.toHaveBeenCalled();
  });
  it("revokes captured controls after direct page input but not passive hover", async () => {
    const fake = engine();
    vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(fake.browser);
    const { live } = session();
    await live.handle({ action: "open", address: "example.com" });
    const pageId = (await live.read()).pageId;
    const handle = {
      evaluate: vi.fn(async () => ({
        label: "Open next",
        kind: "link",
        disabled: false,
      })),
      focus: vi.fn(async () => undefined),
      click: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    fake.page.locator.mockReturnValue({
      ariaSnapshot: vi.fn(async () => '- link "Open next"'),
      count: vi.fn(async () => 1),
      nth: vi.fn(() => ({ elementHandle: vi.fn(async () => handle) })),
    });
    fake.page.evaluate.mockResolvedValueOnce(false).mockResolvedValueOnce([]);
    const outline = await live.handle({ action: "read-page", pageId });
    if (!outline || typeof outline === "string")
      throw new Error("Expected a structured page outline");
    const controlId = outline.controls[0]!.id;
    await live.handle({
      action: "input",
      pageId,
      events: [
        {
          type: "pointer",
          phase: "move",
          x: 10,
          y: 12,
          button: "left",
          clicks: 1,
        },
      ],
    });
    expect(handle.dispose).not.toHaveBeenCalled();
    await live.handle({
      action: "input",
      pageId,
      events: [
        {
          type: "pointer",
          phase: "down",
          x: 10,
          y: 12,
          button: "left",
          clicks: 1,
        },
      ],
    });
    await expect(
      live.handle({
        action: "control",
        pageId,
        controlId,
        operation: "activate",
      }),
    ).rejects.toThrow("Refresh");
    expect(handle.dispose).toHaveBeenCalledOnce();
    expect(handle.click).not.toHaveBeenCalled();
    expect((await live.read()).pageId).toBe(pageId);
  });
  it("cancels a read-only Agent snapshot without closing the shared browser", async () => {
    const fake = engine();
    vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(fake.browser);
    const { live } = session();
    await live.handle({ action: "open", address: "example.com" });
    let started!: () => void;
    fake.page.locator.mockReturnValue({
      ariaSnapshot: vi.fn(
        () =>
          new Promise<string>(() => {
            started();
          }),
      ),
      click: vi.fn(),
      fill: vi.fn(),
    });
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const controller = new AbortController();
    const operation = live.execute({ action: "snapshot" }, controller.signal);
    await began;
    controller.abort();
    await expect(operation).rejects.toThrow("cancelled");
    expect((await live.read()).tabs).toHaveLength(1);
    expect((await live.read()).active).toBe(true);
    expect(fake.page.close).not.toHaveBeenCalled();
    expect(fake.close).not.toHaveBeenCalled();
  });
  it("isolates a cancelled Agent mutation to its tab", async () => {
    const fake = engine();
    const popup = engine();
    vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(fake.browser);
    const { live } = session();
    await live.handle({ action: "open", address: "example.com" });
    await popup.page.goto("https://example.com/other");
    fake.context.emit("page", popup.page);
    await vi.waitFor(async () =>
      expect((await live.read()).tabs).toHaveLength(2),
    );
    let started!: () => void;
    popup.page.locator.mockReturnValue({
      ariaSnapshot: vi.fn(),
      click: vi.fn(),
      fill: vi.fn(
        () =>
          new Promise<void>(() => {
            started();
          }),
      ),
    });
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const controller = new AbortController();
    const operation = live.execute(
      { action: "fill", selector: "#draft", value: "private draft" },
      controller.signal,
    );
    await began;
    controller.abort();
    await expect(operation).rejects.toThrow("cancelled");
    expect(popup.page.close).toHaveBeenCalledOnce();
    expect(fake.page.close).not.toHaveBeenCalled();
    expect(fake.close).not.toHaveBeenCalled();
    expect((await live.read()).tabs).toHaveLength(1);
    expect((await live.read()).url).toBe("https://example.com/");
  });
  it("keeps the browser session usable after cancelling its only mutating tab", async () => {
    const fake = engine();
    const replacement = engine();
    vi.mocked(launchPreviewBrowser).mockResolvedValueOnce(fake.browser);
    const { live } = session();
    await live.handle({ action: "open", address: "example.com" });
    fake.context.newPage.mockResolvedValueOnce(replacement.page);
    let started!: () => void;
    fake.page.locator.mockReturnValue({
      ariaSnapshot: vi.fn(),
      click: vi.fn(
        () =>
          new Promise<void>(() => {
            started();
          }),
      ),
      fill: vi.fn(),
    });
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const controller = new AbortController();
    const operation = live.execute(
      { action: "click", selector: "#submit" },
      controller.signal,
    );
    await began;
    controller.abort();
    await expect(operation).rejects.toThrow("cancelled");
    expect(fake.page.close).toHaveBeenCalledOnce();
    expect(fake.close).not.toHaveBeenCalled();
    expect((await live.read()).tabs).toHaveLength(1);
    expect((await live.read()).active).toBe(true);
    expect((await live.read()).url).toBe("");
    expect((await live.read()).message).toContain("affected tab was closed");
  });
});
