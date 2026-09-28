import type { Browser, Page } from "playwright-core";
import { redactSecrets } from "@orbit-build/shared";
import {
  BrowserPreviewActionSchema,
  type BrowserPreviewAction,
  type BrowserPreviewService,
  type BrowserPreviewSnapshot,
} from "@orbit-build/core";
import {
  isPreviewRequestAllowed,
  parsePreviewUrl,
} from "./BrowserPreviewPolicy.js";
import { launchPreviewBrowser } from "./BrowserLauncher.js";
import { BrowserLiveSession } from "./BrowserLiveSession.js";
import { redactBrowserSnapshot } from "./BrowserSnapshotRedaction.js";
export { launchPreviewBrowser } from "./BrowserLauncher.js";

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};

/** One isolated, explicitly connected local browser per WebUI runtime. */
export class BrowserPreviewRuntime implements BrowserPreviewService {
  readonly live: BrowserLiveSession;
  private browser?: Browser;
  private page?: Page;
  private generation = 0;
  private busy = false;
  private origin = "";
  private errors: string[] = [];
  private idleTimer?: ReturnType<typeof setTimeout>;
  private turnTabPin?: { id: string };
  private snapshot: BrowserPreviewSnapshot = {
    revision: 0,
    status: "closed",
    viewport: "desktop",
    url: "",
    title: "",
    text: "",
    errors: [],
    message: "",
  };

  constructor(
    private readonly options: {
      blockedPort: () => number | undefined;
      launch?: () => Promise<Browser>;
      onStatus?: (status: string) => void;
    },
  ) {
    this.live = new BrowserLiveSession(options);
  }

  getSnapshot(): BrowserPreviewSnapshot {
    return { ...this.snapshot, errors: [...this.snapshot.errors] };
  }

  /** Require Agent browser tools in this WebUI turn to stay on the attached tab. */
  pinTabForTurn(tabId: string, expectedUrl?: string): () => void {
    if (this.live.activeTabId !== tabId)
      throw new Error(
        "The attached browser tab changed. Select it and add it to the question again.",
      );
    if (expectedUrl && this.live.activeTabUrl !== expectedUrl)
      throw new Error(
        "The attached browser page changed. Add the current page to the question again.",
      );
    const pin = { id: tabId };
    this.turnTabPin = pin;
    return () => {
      if (this.turnTabPin === pin) this.turnTabPin = undefined;
    };
  }

  async connect(input: string): Promise<BrowserPreviewSnapshot> {
    const url = parsePreviewUrl(input, this.options.blockedPort());
    if (this.busy)
      throw new Error("Browser preview is busy. Stop it before reconnecting.");
    const closing = this.reset();
    const generation = this.generation;
    await closing;
    this.assertCurrent(generation);
    return this.run(async (generation) => {
      const browser = await (this.options.launch ?? launchPreviewBrowser)();
      if (generation !== this.generation) {
        await browser.close();
        throw new Error("Browser preview was stopped.");
      }
      this.browser = browser;
      this.origin = url.origin;
      const context = await browser.newContext({
        viewport: VIEWPORTS.desktop,
        serviceWorkers: "block",
        acceptDownloads: false,
        permissions: [],
        locale: "en-US",
      });
      // Chromium treats intercepted documents as public-network responses.
      // Grant LNA only to this origin; request and socket routes still pin the
      // destination to the one user-connected loopback port.
      await context
        .grantPermissions(["local-network-access"], { origin: url.origin })
        .catch(() => {
          this.recordError(
            "This browser may block local hot reload. Use Reload or update the browser.",
            generation,
          );
        });
      await context.route("**/*", async (route) => {
        if (
          generation !== this.generation ||
          !isPreviewRequestAllowed(route.request().url(), url.origin)
        ) {
          this.recordError(
            "Blocked a request outside the connected project origin.",
            generation,
          );
          await route.abort().catch(() => undefined);
          return;
        }
        try {
          // Handle redirects ourselves; automatic redirect following must never
          // reach another local service or an external host.
          const response = await route.fetch({
            maxRedirects: 0,
            timeout: 8000,
          });
          try {
            if (
              response.status() >= 300 &&
              response.status() < 400 &&
              response.status() !== 304
            ) {
              this.recordError(
                "Redirect blocked. Connect the final local project URL directly.",
                generation,
              );
              await route.abort();
            } else if (generation === this.generation)
              await route.fulfill({ response });
            else await route.abort();
          } finally {
            await response.dispose();
          }
        } catch {
          await route.abort().catch(() => undefined);
        }
      });
      await context.routeWebSocket("**/*", (socket) => {
        if (
          generation === this.generation &&
          isPreviewRequestAllowed(socket.url(), url.origin, true)
        )
          socket.connectToServer();
        else {
          this.recordError(
            "Blocked a WebSocket outside the connected project origin.",
            generation,
          );
          socket.close();
        }
      });
      const page = await context.newPage();
      if (generation !== this.generation) {
        await browser.close();
        throw new Error("Browser preview was stopped.");
      }
      this.page = page;
      context.on("page", (popup) => {
        if (popup !== page) void popup.close().catch(() => undefined);
      });
      page.on("dialog", (dialog) => {
        this.recordError(
          "Page dialog dismissed; automatic confirmation is disabled.",
          generation,
        );
        void dialog.dismiss().catch(() => undefined);
      });
      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning")
          this.recordError(message.text(), generation);
      });
      page.on("pageerror", (error) =>
        this.recordError(error.message, generation),
      );
      page.on("response", (response) => {
        if (response.status() >= 400)
          this.recordError(
            `HTTP ${response.status()} from the connected project.`,
            generation,
          );
      });
      page.on("crash", () => {
        if (generation === this.generation) void this.reset();
      });
      page.setDefaultTimeout(5000);
      page.setDefaultNavigationTimeout(12_000);
      await page.goto(url.href, { waitUntil: "domcontentloaded" });
    });
  }

  async execute(
    input: BrowserPreviewAction,
    signal?: AbortSignal,
  ): Promise<BrowserPreviewSnapshot> {
    if (this.turnTabPin && this.live.activeTabId !== this.turnTabPin.id)
      throw new Error(
        "The attached browser tab is no longer active. Stop this turn and attach the intended tab again.",
      );
    if (this.live.isActive)
      return this.live.execute(input, signal, this.turnTabPin?.id);
    const action = BrowserPreviewActionSchema.parse(input);
    if (!this.page)
      throw new Error("Connect a website using Browser in Orbit WebUI first.");
    return this.run(async (generation) => {
      const page = this.page!;
      switch (action.action) {
        case "reload":
          this.errors = [];
          await page.reload({ waitUntil: "domcontentloaded" });
          break;
        case "viewport":
          await page.setViewportSize(VIEWPORTS[action.viewport]);
          this.assertCurrent(generation);
          this.snapshot.viewport = action.viewport;
          break;
        case "click":
          await page.locator(action.selector).click();
          break;
        case "fill":
          await page.locator(action.selector).fill(action.value);
          break;
        case "press":
          await page.keyboard.press(action.key);
          break;
        case "scroll":
          await page.mouse.wheel(0, action.direction === "down" ? 560 : -560);
          break;
        case "snapshot":
          break;
      }
    }, signal);
  }

  /** Revoke ownership synchronously; late operations cannot publish into a new session. */
  async reset(): Promise<void> {
    const closingLive = this.live.reset();
    clearTimeout(this.idleTimer);
    this.generation += 1;
    this.busy = false;
    const browser = this.browser;
    this.browser = undefined;
    this.page = undefined;
    this.origin = "";
    this.errors = [];
    this.snapshot = {
      revision: this.snapshot.revision + 1,
      status: "closed",
      viewport: "desktop",
      url: "",
      title: "",
      text: "",
      errors: [],
      message: "",
    };
    await browser?.close().catch(() => undefined);
    await closingLive;
  }

  private async run(
    operation: (generation: number) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<BrowserPreviewSnapshot> {
    if (signal?.aborted) throw new Error("Browser preview was cancelled.");
    if (this.busy)
      throw new Error(
        "Browser preview is busy. Wait for the current action or stop it.",
      );
    const generation = this.generation;
    clearTimeout(this.idleTimer);
    this.busy = true;
    this.snapshot = {
      ...this.snapshot,
      status: "working",
      message: "",
      revision: this.snapshot.revision + 1,
    };
    this.options.onStatus?.("browser_preview_running");
    const abort = () => {
      void this.reset();
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await operation(generation);
      this.assertCurrent(generation);
      const page = this.page!;
      if (!isPreviewRequestAllowed(page.url(), this.origin))
        throw new Error(
          "The page left the connected project. Reconnect the local preview.",
        );
      const title = await page.title();
      const text = await page.locator("body").ariaSnapshot({ timeout: 5000 });
      const horizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      const controls = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll<HTMLElement>(
            'button, a, input, textarea, select, [role="button"]',
          ),
        )
          .filter((element) => element.getClientRects().length > 0)
          .slice(0, 60)
          .map((element) => ({
            selector: element.id
              ? "#" + CSS.escape(element.id)
              : element.tagName.toLowerCase() +
                " >> nth=" +
                Array.from(document.querySelectorAll(element.tagName)).indexOf(
                  element,
                ),
            label: (() => {
              const labelledBy = (element.getAttribute("aria-labelledby") || "")
                .split(/\s+/)
                .filter(Boolean)
                .map((id) => document.getElementById(id)?.textContent || "")
                .join(" ");
              const field =
                element instanceof HTMLInputElement ||
                element instanceof HTMLTextAreaElement ||
                element instanceof HTMLSelectElement
                  ? element
                  : null;
              const labels = Array.from(field?.labels || [])
                .map((label) => label.textContent || "")
                .join(" ");
              const editable = Boolean(field || element.isContentEditable);
              return (
                element.getAttribute("aria-label") ||
                labelledBy ||
                labels ||
                (editable ? "" : element.textContent) ||
                element.getAttribute("title") ||
                element.getAttribute("placeholder") ||
                ""
              )
                .trim()
                .slice(0, 120);
            })(),
            type: element.getAttribute("type") || element.tagName.toLowerCase(),
          })),
      );
      const bytes = await page.screenshot({
        type: "jpeg",
        quality: 70,
        timeout: 5000,
        animations: "disabled",
        mask: [page.locator('input[type="password"]')],
      });
      this.assertCurrent(generation);
      if (bytes.length > 3 * 1024 * 1024)
        throw new Error("Preview image exceeded the size limit.");
      const currentUrl = new URL(page.url());
      currentUrl.search = "";
      currentUrl.hash = "";
      this.snapshot = {
        ...this.snapshot,
        revision: this.snapshot.revision + 1,
        status: "ready",
        url: currentUrl.href,
        title: redactSecrets(title).slice(0, 200),
        text: redactSecrets(redactBrowserSnapshot(text)).slice(0, 16_000),
        errors: [...this.errors],
        message: "",
        image: bytes.toString("base64"),
        capturedAt: new Date().toISOString(),
        horizontalOverflow,
        controls: controls.map((control) => ({
          ...control,
          label: redactSecrets(control.label),
        })),
      };
      this.options.onStatus?.("browser_preview_ready");
      return this.getSnapshot();
    } catch (error: unknown) {
      if (generation === this.generation) {
        const message = redactSecrets(
          error instanceof Error ? error.message : "Browser preview failed.",
        )
          .split("\n")[0]
          .slice(0, 350);
        this.snapshot = {
          ...this.snapshot,
          status: "error",
          message,
          controls: undefined,
          horizontalOverflow: undefined,
          text: "",
          errors: [...this.errors],
          revision: this.snapshot.revision + 1,
        };
        this.options.onStatus?.("browser_preview_error");
        // A failed initial connection must not strand a background browser.
        if (!this.snapshot.url) {
          const browser = this.browser;
          this.browser = undefined;
          this.page = undefined;
          await browser?.close().catch(() => undefined);
        }
      }
      throw new Error(
        generation === this.generation
          ? this.snapshot.message
          : "Browser preview was stopped.",
      );
    } finally {
      signal?.removeEventListener("abort", abort);
      if (generation === this.generation) {
        this.busy = false;
        if (this.browser) {
          this.idleTimer = setTimeout(() => {
            void this.reset();
          }, 10 * 60_000);
          this.idleTimer.unref();
        }
      }
    }
  }

  private assertCurrent(generation: number): void {
    if (generation !== this.generation)
      throw new Error("Browser preview was stopped.");
  }
  private recordError(message: string, generation: number): void {
    if (generation !== this.generation) return;
    const safe = redactSecrets(message).slice(0, 350);
    if (this.errors[this.errors.length - 1] !== safe) this.errors.push(safe);
    if (this.errors.length > 20) this.errors.shift();
  }
}
