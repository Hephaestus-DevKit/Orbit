import type {
  Browser,
  BrowserContext,
  CDPSession,
  Dialog,
  ElementHandle,
  Page,
  Request,
} from "playwright-core";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { redactSecrets } from "@orbit-build/shared";
import {
  BrowserPreviewActionSchema,
  type BrowserPreviewAction,
  type BrowserPreviewSnapshot,
} from "@orbit-build/core";
import { BrowserNetworkProxy } from "./BrowserNetworkProxy.js";
import {
  browserAddress,
  BrowserLiveActionSchema,
  type BrowserInput,
  type BrowserLiveAction,
  type BrowserLiveState,
  type BrowserPageControl,
  type BrowserFileUploadMetadata,
  type BrowserDownloadRequest,
} from "./BrowserLiveContracts.js";
import { launchPreviewBrowser } from "./BrowserLauncher.js";
import { BrowserNativeFileChooser } from "./BrowserNativeFileChooser.js";
import { BrowserNativeDownload } from "./BrowserNativeDownload.js";
import { BrowserNativePicker } from "./BrowserNativePicker.js";
import { BrowserNativeSelect } from "./BrowserNativeSelect.js";
import { redactBrowserSnapshot } from "./BrowserSnapshotRedaction.js";

const FrameSchema = z.object({
  data: z.string().max(6_000_000),
  sessionId: z.number().int(),
  metadata: z.object({
    deviceWidth: z.number().positive(),
    deviceHeight: z.number().positive(),
  }),
});
const HistorySchema = z.object({
  currentIndex: z.number().int(),
  entries: z.array(z.object({ title: z.string().optional() })).max(10000),
});
interface Tab {
  id: string;
  page: Page;
  title: string;
  address?: string;
  localOrigin?: string;
  dialog?: Dialog;
  resourceErrors: Set<string>;
}

/** Runs inside the page; never returns an editable control's value. */
function readAccessibleControl(element: Node): {
  label: string;
  kind: BrowserPageControl["kind"];
  disabled: boolean;
} | null {
  if (!(element instanceof HTMLElement) || !element.isConnected) return null;
  const input = element instanceof HTMLInputElement ? element : null;
  const tag = element.tagName.toLowerCase();
  const kind: BrowserPageControl["kind"] =
    input?.type === "checkbox" || input?.type === "radio"
      ? "toggle"
      : input && ["submit", "button", "reset", "image"].includes(input.type)
        ? "button"
        : input ||
            element instanceof HTMLTextAreaElement ||
            element.isContentEditable
          ? "field"
          : tag === "select"
            ? "select"
            : tag === "a"
              ? "link"
              : "button";
  const labelledBy = (element.getAttribute("aria-labelledby") || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent || "")
    .join(" ");
  const labelElement =
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
      ? element
      : null;
  const labels = Array.from(labelElement?.labels || [])
    .map((label) => label.textContent || "")
    .join(" ");
  const label = (
    element.getAttribute("aria-label") ||
    labelledBy ||
    labels ||
    (kind === "button" ? input?.value : "") ||
    (kind === "field" || kind === "select" ? "" : element.innerText) ||
    element.getAttribute("title") ||
    element.getAttribute("placeholder") ||
    ""
  )
    .trim()
    .slice(0, 120);
  return {
    label,
    kind,
    disabled: element.matches(":disabled, [aria-disabled='true']"),
  };
}

/** Real Chromium pages shared between direct desktop input and permissioned Agent tools. */
export class BrowserLiveSession {
  private browser?: Browser;
  private context?: BrowserContext;
  private proxy?: BrowserNetworkProxy;
  private cdp?: CDPSession;
  private tabs: Tab[] = [];
  private readonly pageRegistrations = new Map<Page, Promise<void>>();
  private active?: Tab;
  private epoch = 0;
  private viewId = "";
  private frame = 0;
  private image?: string;
  private width = 1280;
  private height = 800;
  private busy = false;
  private loading = false;
  private message = "";
  private errors: string[] = [];
  private canGoBack = false;
  private canGoForward = false;
  private idle?: ReturnType<typeof setTimeout>;
  private idleExpiresAt?: number;
  private closedReason?: "idle";
  private metaAt = 0;
  private readingMeta = false;
  private mouseButtons = 0;
  private readonly nativePicker = new BrowserNativePicker();
  private readonly nativeSelect = new BrowserNativeSelect();
  private readonly nativeFileChooser = new BrowserNativeFileChooser();
  private readonly nativeDownload = new BrowserNativeDownload();
  private accessibleControls = new Map<
    string,
    {
      handle: ElementHandle;
      kind: BrowserPageControl["kind"];
      label: string;
    }
  >();
  private controlsPageId = "";
  constructor(
    private readonly options: {
      blockedPort: () => number | undefined;
      onStatus?: (status: string) => void;
    },
  ) {}

  get isActive(): boolean {
    return Boolean(this.browser);
  }
  get activeTabId(): string | undefined {
    return this.active?.id;
  }
  get activeTabUrl(): string | undefined {
    return this.active?.address;
  }
  async read(after = -1): Promise<BrowserLiveState> {
    if (
      this.active &&
      !this.active.dialog &&
      this.cdp &&
      Date.now() - this.metaAt > 700 &&
      !this.readingMeta
    ) {
      this.readingMeta = true;
      const epoch = this.epoch;
      const tab = this.active;
      try {
        const history = HistorySchema.parse(
          await this.cdp.send("Page.getNavigationHistory"),
        );
        const title = history.entries[history.currentIndex]?.title || tab.title;
        if (epoch === this.epoch && tab === this.active) {
          tab.title = title.slice(0, 200);
          this.canGoBack = history.currentIndex > 0;
          this.canGoForward = history.currentIndex < history.entries.length - 1;
          this.metaAt = Date.now();
        }
      } catch {
        /* Navigation can replace the execution context. The next poll retries. */
      } finally {
        this.readingMeta = false;
      }
    }
    const dialog = this.active?.dialog;
    return {
      active: this.isActive,
      pageId: this.viewId,
      frame: this.frame,
      ...(after !== this.frame && this.image ? { image: this.image } : {}),
      width: this.width,
      height: this.height,
      url: this.active?.address || "",
      title: this.active?.title || "",
      loading: this.loading,
      busy: this.busy,
      canGoBack: this.canGoBack,
      canGoForward: this.canGoForward,
      message: this.message,
      resourceErrors: this.active?.resourceErrors.size || 0,
      ...(this.idleExpiresAt ? { idleExpiresAt: this.idleExpiresAt } : {}),
      ...(this.closedReason ? { closedReason: this.closedReason } : {}),
      ...(this.nativeSelect.popup
        ? { selectPopup: this.nativeSelect.popup }
        : {}),
      ...(this.nativePicker.popup
        ? { inputPicker: this.nativePicker.popup }
        : {}),
      ...(this.nativeFileChooser.popup
        ? { fileChooser: this.nativeFileChooser.popup }
        : {}),
      ...(this.nativeDownload.popup
        ? { download: this.nativeDownload.popup }
        : {}),
      tabs: this.tabs.map((tab) => ({
        id: tab.id,
        title: tab.title || "New tab",
        active: tab === this.active,
      })),
      ...(dialog
        ? {
            dialog: {
              type: dialog.type(),
              message: dialog.message().slice(0, 2000),
              defaultValue: dialog.defaultValue().slice(0, 4000),
            },
          }
        : {}),
    };
  }
  async handle(
    raw: BrowserLiveAction,
  ): Promise<
    string | { text: string; controls: BrowserPageControl[] } | undefined
  > {
    const action = BrowserLiveActionSchema.parse(raw);
    if (action.action === "dismiss-download") {
      this.nativeDownload.dismiss(action.pageId, action.downloadId);
      return;
    }
    if (action.action === "dismiss-upload") {
      this.nativeFileChooser.dismiss(action.pageId, action.chooserId);
      return;
    }
    if (
      action.action === "choose-option" ||
      action.action === "dismiss-options"
    ) {
      if (!this.active || action.pageId !== this.viewId)
        throw new Error("The page changed. Open the selector again.");
      if (action.action === "dismiss-options")
        this.nativeSelect.dismiss(action.pageId, action.popupId);
      else {
        if (this.active.dialog)
          throw new Error("Respond to the page dialog first.");
        this.nativeSelect.canChoose(
          action.pageId,
          action.popupId,
          action.optionId,
        );
        await this.run(async () => {
          await this.nativeSelect.choose(
            action.pageId,
            action.popupId,
            action.optionId,
          );
          this.clearAccessibleControls();
        });
      }
      return;
    }
    if (
      action.action === "apply-picker" ||
      action.action === "dismiss-picker"
    ) {
      if (!this.active || action.pageId !== this.viewId)
        throw new Error("The page changed. Open the picker again.");
      if (action.action === "dismiss-picker")
        this.nativePicker.dismiss(action.pageId, action.popupId);
      else {
        if (this.active.dialog)
          throw new Error("Respond to the page dialog first.");
        this.nativePicker.canApply(action.pageId, action.popupId, action.value);
        await this.run(async () => {
          await this.nativePicker.apply(
            action.pageId,
            action.popupId,
            action.value,
          );
          this.clearAccessibleControls();
        });
      }
      return;
    }
    if (
      (action.action === "input" ||
        action.action === "resize" ||
        action.action === "find") &&
      (!this.active || action.pageId !== this.viewId)
    )
      throw new Error("The page changed. Try again on the current page.");
    if (action.action === "keep-alive") {
      // Invalid requests must not clear or renew the existing idle deadline.
      if (!this.active || action.pageId !== this.viewId)
        throw new Error(
          "The page changed. Keep the current session open instead.",
        );
      if (this.active.dialog)
        throw new Error("Respond to the page dialog first.");
      await this.run(async () => undefined, undefined, true);
      return;
    }
    if (action.action === "find") {
      let found = false;
      await this.run(
        async () => {
          if (action.pageId !== this.viewId || !this.active)
            throw new Error("The page changed. Search the current page again.");
          if (this.active.dialog)
            throw new Error("Respond to the page dialog first.");
          const page = this.active.page;
          found = await page.evaluate(
            ({ query, backwards }) => {
              const browserWindow = window as unknown as {
                find: (
                  text: string,
                  caseSensitive: boolean,
                  backwards: boolean,
                  wrapAround: boolean,
                ) => boolean;
              };
              const found = browserWindow.find(query, false, backwards, true);
              if (!found) window.getSelection()?.removeAllRanges();
              else {
                const node = window.getSelection()?.anchorNode;
                const element =
                  node instanceof Element ? node : node?.parentElement;
                element?.scrollIntoView({ block: "center", inline: "nearest" });
              }
              return found;
            },
            { query: action.query, backwards: action.direction === "previous" },
          );
          if (action.pageId !== this.viewId)
            throw new Error("The page changed. Search the current page again.");
          const screenshot = await page
            .screenshot({ type: "jpeg", quality: 85, timeout: 5000 })
            .catch(() => undefined);
          if (action.pageId !== this.viewId || this.active?.page !== page)
            throw new Error("The page changed. Search the current page again.");
          if (screenshot) {
            this.image = screenshot.toString("base64");
            this.frame++;
          }
        },
        undefined,
        true,
        undefined,
        false,
      );
      return found ? "found" : "no-match";
    }
    if (action.action === "read-page") {
      if (action.pageId !== this.viewId)
        throw new Error("The page changed. Read the current page again.");
      const snapshot = await this.execute({ action: "snapshot" });
      if (action.pageId !== this.viewId)
        throw new Error("The page changed. Read the current page again.");
      return {
        text: snapshot.text,
        controls: await this.captureAccessibleControls(action.pageId),
      };
    }
    if (action.action === "control") {
      if (action.pageId !== this.viewId || this.controlsPageId !== this.viewId)
        throw new Error("The page changed. Refresh the page outline.");
      const control = this.accessibleControls.get(action.controlId);
      if (!control)
        throw new Error("Control changed. Refresh the page outline.");
      if (
        (action.operation === "focus") !==
        (control.kind === "field" || control.kind === "select")
      )
        throw new Error("This control does not support that action.");
      await this.run(async () => {
        if (action.pageId !== this.viewId)
          throw new Error("The page changed. Refresh the page outline.");
        const current = await control.handle
          .evaluate(readAccessibleControl)
          .catch(() => null);
        if (
          !current ||
          current.disabled ||
          current.kind !== control.kind ||
          current.label !== control.label
        )
          throw new Error("Control changed. Refresh the page outline.");
        if (action.operation === "focus") await control.handle.focus();
        else await control.handle.click({ noWaitAfter: true });
        await this.captureNativePopup();
        this.clearAccessibleControls();
      });
      return;
    }
    if (action.action === "dialog") {
      const dialog = this.active?.dialog;
      if (!dialog) return;
      this.active!.dialog = undefined;
      if (action.accept) await dialog.accept(action.text);
      else await dialog.dismiss();
      return;
    }
    if (action.action === "copy-selection") {
      let selection = "";
      await this.run(
        async () => {
          if (!this.active) throw new Error("Open a website first.");
          if (this.active.dialog)
            throw new Error("Respond to the page dialog first.");
          selection = await this.readSelection();
        },
        undefined,
        true,
      );
      return selection;
    }
    await this.run(
      async () => {
        if (action.action === "open") {
          const url = browserAddress(action.address, action.searchEngine);
          if (!this.browser) await this.start();
          const tab = this.active!;
          const previousPageUrl = tab.page.url();
          const previousAddress = tab.address;
          const previousLocalOrigin = tab.localOrigin;
          this.proxy!.authorizeLocal(url);
          tab.localOrigin =
            url.hostname === "127.0.0.1" ? url.origin : undefined;
          if (tab.localOrigin)
            await this.context!.grantPermissions(["local-network-access"], {
              origin: url.origin,
            }).catch(() => undefined);
          try {
            await this.navigate(url);
          } catch (error: unknown) {
            // A failed pre-commit navigation leaves the old page in place.
            // Restore both its displayed URL and its origin-scoped local grant.
            // If Chromium committed a new page before failing, its frame event
            // owns the URL/grant and we must not roll that state back.
            if (tab === this.active && tab.page.url() === previousPageUrl) {
              tab.address = previousAddress;
              tab.localOrigin = previousLocalOrigin;
            }
            throw error;
          }
        } else if (!this.active || !this.cdp)
          throw new Error("Open a website first.");
        else if (action.action === "input" || action.action === "resize") {
          if (action.pageId !== this.viewId)
            throw new Error("The page changed. Try again on the current page.");
          if (action.action === "resize") {
            this.nativeSelect.invalidate();
            this.nativePicker.invalidate();
            this.nativeFileChooser.invalidate();
            this.nativeDownload.invalidate();
            const resizedPage = this.active.page;
            this.width = action.width;
            this.height = action.height;
            this.clearAccessibleControls();
            this.viewId = randomUUID();
            const resizedPageId = this.viewId;
            this.image = undefined;
            this.frame++;
            await resizedPage.setViewportSize({
              width: this.width,
              height: this.height,
            });
            // Static pages do not always emit a fresh screencast frame after resize.
            // Capture one viewport frame so the UI never stays blank after the
            // old frame was invalidated. A later screencast frame may replace it.
            if (!this.image) {
              const fallback = await resizedPage
                .screenshot({ type: "jpeg", quality: 85, timeout: 5000 })
                .catch(() => undefined);
              if (
                fallback &&
                this.active?.page === resizedPage &&
                this.viewId === resizedPageId &&
                !this.image
              ) {
                this.image = fallback.toString("base64");
                this.frame++;
              }
            }
          } else {
            if (
              action.events.some(
                (event) => event.type !== "pointer" || event.phase !== "move",
              )
            ) {
              this.nativeSelect.invalidate();
              this.nativePicker.invalidate();
              this.nativeFileChooser.invalidate();
              this.nativeDownload.invalidate();
              this.clearAccessibleControls();
            }
            for (const event of action.events) {
              if (action.pageId !== this.viewId) break;
              await this.input(event);
            }
            if (
              action.pageId === this.viewId &&
              action.events.some(
                (event) =>
                  event.type === "key" ||
                  (event.type === "pointer" && event.phase === "up"),
              )
            )
              await this.captureNativePopup();
          }
        } else if (action.action === "history") {
          await this.awaitNavigation((page) =>
            action.direction === "back"
              ? page.goBack({ waitUntil: "domcontentloaded" })
              : page.goForward({ waitUntil: "domcontentloaded" }),
          );
        } else if (action.action === "tab") {
          if (action.operation === "new") {
            if (this.tabs.length >= 8)
              throw new Error(
                "Close a tab before opening another (maximum 8).",
              );
            await this.addPage(await this.context!.newPage());
          } else {
            const tab = this.tabs.find((item) => item.id === action.id);
            if (!tab) throw new Error("This tab is no longer available.");
            if (action.operation === "select") await this.select(tab);
            else {
              this.tabs = this.tabs.filter((item) => item !== tab);
              if (tab === this.active) {
                if (this.tabs[0]) await this.select(this.tabs[0]);
                else await this.addPage(await this.context!.newPage());
              }
              await tab.page.close({ runBeforeUnload: false });
            }
          }
        }
      },
      undefined,
      action.action === "input" || action.action === "resize",
    );
  }
  /** Apply explicit user-selected bytes to the pending website file input. */
  async applyUpload(
    metadata: BrowserFileUploadMetadata,
    body: Buffer,
  ): Promise<void> {
    if (!this.active || metadata.pageId !== this.viewId)
      throw new Error("The page changed. Open the file request again.");
    if (this.active.dialog)
      throw new Error("Respond to the page dialog first.");
    const size = metadata.files.reduce((total, file) => total + file.size, 0);
    if (size !== body.length)
      throw new Error("The selected file data did not match its request.");
    await this.run(async () => {
      if (metadata.pageId !== this.viewId)
        throw new Error("The page changed. Open the file request again.");
      let offset = 0;
      const files = metadata.files.map((file) => {
        const payload = {
          name: file.name,
          mimeType: file.mimeType,
          buffer: body.subarray(offset, offset + file.size),
        };
        offset += file.size;
        return payload;
      });
      await this.nativeFileChooser.apply(
        metadata.pageId,
        metadata.chooserId,
        files,
      );
      this.clearAccessibleControls();
    });
  }
  /** Consume a confirmed download once; no website path reaches the WebUI. */
  takeDownload(request: BrowserDownloadRequest): {
    filename: string;
    buffer: Buffer;
  } {
    if (!this.active || request.pageId !== this.viewId)
      throw new Error("The page changed. Request the download again.");
    return this.nativeDownload.take(request.pageId, request.downloadId);
  }
  async execute(
    input: BrowserPreviewAction,
    signal?: AbortSignal,
    expectedTabId?: string,
  ): Promise<BrowserPreviewSnapshot> {
    const action = BrowserPreviewActionSchema.parse(input);
    let result: BrowserPreviewSnapshot | undefined;
    let changingPage: Page | undefined;
    await this.run(
      async () => {
        if (expectedTabId && this.active?.id !== expectedTabId)
          throw new Error(
            "The attached browser tab is no longer active. Stop this turn and attach the intended tab again.",
          );
        const page = this.active?.page;
        if (!page)
          throw new Error("Open a website in the built-in browser first.");
        if (this.active?.dialog)
          throw new Error(
            "The page is waiting for your dialog response in the browser.",
          );
        if (action.action !== "snapshot") changingPage = page;
        if (action.action !== "snapshot") {
          this.nativeSelect.invalidate();
          this.nativePicker.invalidate();
          this.nativeFileChooser.invalidate();
          this.nativeDownload.invalidate();
        }
        switch (action.action) {
          case "reload":
            await this.awaitNavigation((current) =>
              current.reload({ waitUntil: "domcontentloaded" }),
            );
            break;
          case "viewport":
            this.nativeSelect.invalidate();
            this.nativePicker.invalidate();
            this.nativeFileChooser.invalidate();
            this.nativeDownload.invalidate();
            this.width = action.viewport === "desktop" ? 1280 : 390;
            this.height = action.viewport === "desktop" ? 800 : 844;
            await page.setViewportSize({
              width: this.width,
              height: this.height,
            });
            break;
          case "click":
            await page.locator(action.selector).click({ noWaitAfter: true });
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
        changingPage = undefined;
        const text = await page.locator("body").ariaSnapshot({ timeout: 5000 });
        const title = await page.title();
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
                  Array.from(
                    document.querySelectorAll(element.tagName),
                  ).indexOf(element),
              label: (() => {
                const labelledBy = (
                  element.getAttribute("aria-labelledby") || ""
                )
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
              type:
                element.getAttribute("type") || element.tagName.toLowerCase(),
            })),
        );
        const safeUrl = new URL(page.url());
        if (action.action !== "snapshot") await this.captureNativePopup();
        safeUrl.search = "";
        safeUrl.hash = "";
        result = {
          revision: this.frame,
          status: "ready",
          viewport: this.width < 600 ? "mobile" : "desktop",
          url: safeUrl.href,
          title: redactSecrets(title).slice(0, 200),
          text: redactSecrets(redactBrowserSnapshot(text)).slice(0, 16000),
          errors: [...this.errors],
          message: "",
          horizontalOverflow,
          controls: controls.map((control) => ({
            ...control,
            label: redactSecrets(control.label),
          })),
        };
      },
      signal,
      false,
      () => changingPage,
    );
    return result!;
  }

  private async captureAccessibleControls(
    pageId: string,
  ): Promise<BrowserPageControl[]> {
    const controls: BrowserPageControl[] = [];
    try {
      await this.run(
        async () => {
          if (pageId !== this.viewId || !this.active)
            throw new Error("The page changed. Refresh the page outline.");
          this.clearAccessibleControls();
          const locator = this.active.page.locator(
            'a[href]:visible, button:visible, input:visible:not([type="hidden"]):not([type="file"]), textarea:visible, select:visible, [role="button"]:visible, [contenteditable="true"]:visible',
          );
          const count = Math.min(await locator.count(), 60);
          for (let index = 0; index < count; index++) {
            if (pageId !== this.viewId)
              throw new Error("The page changed. Refresh the page outline.");
            const handle = await locator
              .nth(index)
              .elementHandle({ timeout: 1000 })
              .catch(() => null);
            if (!handle) continue;
            const detail = await handle
              .evaluate(readAccessibleControl)
              .catch(() => null);
            if (!detail) {
              await handle.dispose().catch(() => undefined);
              continue;
            }
            const id = randomUUID();
            this.accessibleControls.set(id, {
              handle,
              kind: detail.kind,
              label: detail.label,
            });
            controls.push({
              id,
              label: redactSecrets(detail.label).slice(0, 120),
              kind: detail.kind,
              disabled: detail.disabled,
            });
          }
          if (pageId !== this.viewId)
            throw new Error("The page changed. Refresh the page outline.");
          this.controlsPageId = pageId;
        },
        undefined,
        true,
      );
      return controls;
    } catch (error: unknown) {
      this.clearAccessibleControls();
      throw error;
    }
  }

  private clearAccessibleControls(): void {
    for (const { handle } of this.accessibleControls.values())
      void handle.dispose().catch(() => undefined);
    this.accessibleControls.clear();
    this.controlsPageId = "";
  }

  async reset(reason?: "idle"): Promise<void> {
    this.epoch++;
    this.nativeSelect.invalidate();
    this.nativePicker.invalidate();
    this.nativeFileChooser.invalidate();
    this.nativeDownload.invalidate();
    this.clearAccessibleControls();
    clearTimeout(this.idle);
    this.idleExpiresAt = undefined;
    this.closedReason = reason;
    const browser = this.browser;
    const proxy = this.proxy;
    this.browser = undefined;
    this.context = undefined;
    this.proxy = undefined;
    this.cdp = undefined;
    this.tabs = [];
    this.pageRegistrations.clear();
    this.active = undefined;
    this.image = undefined;
    this.viewId = "";
    this.frame++;
    this.busy = false;
    this.loading = false;
    this.message = "";
    this.errors = [];
    this.canGoBack = false;
    this.canGoForward = false;
    this.mouseButtons = 0;
    this.width = 1280;
    this.height = 800;
    if (reason === "idle")
      this.options.onStatus?.("browser_preview_idle_closed");
    // Revoke network access before waiting for the Chromium process to exit.
    await proxy?.stop();
    await browser?.close().catch(() => undefined);
  }
  private async start(): Promise<void> {
    this.closedReason = undefined;
    const epoch = this.epoch;
    const proxy = new BrowserNetworkProxy({
      blockedPort: this.options.blockedPort,
    });
    this.proxy = proxy;
    const transport = await proxy.start();
    this.assertCurrent(epoch);
    const browser = await launchPreviewBrowser({
      ...transport,
      bypass: "<-loopback>",
    });
    if (epoch !== this.epoch) {
      await browser.close();
      await proxy.stop();
      throw new Error("Browser stopped.");
    }
    this.browser = browser;
    const context = await browser.newContext({
      viewport: { width: this.width, height: this.height },
      serviceWorkers: "block",
      acceptDownloads: true,
      permissions: [],
    });
    this.assertCurrent(epoch);
    this.context = context;
    await context.route("**/*", async (route) => {
      try {
        const url = new URL(route.request().url());
        if (
          epoch !== this.epoch ||
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password
        ) {
          await route.abort();
          return;
        }
        // Public tabs cannot reuse another tab's explicitly opened local service.
        const headers = { ...route.request().headers() };
        delete headers["x-orbit-local-access"];
        if (url.hostname === "127.0.0.1") {
          const frame = route.request().frame();
          const page = frame.page();
          const tab = this.tabs.find((item) => item.page === page);
          const opener = tab ? undefined : await page.opener();
          const grant =
            tab?.localOrigin ||
            (opener && new URL(opener.url()).origin === url.origin
              ? this.tabs.find((item) => item.page === opener)?.localOrigin
              : undefined);
          if (grant !== url.origin) {
            await route.abort();
            return;
          }
          const parent = frame.parentFrame();
          const navigatingFromGrantedPage =
            route.request().isNavigationRequest() &&
            (frame === page.mainFrame() ||
              (parent && new URL(parent.url()).origin === grant));
          if (
            !navigatingFromGrantedPage &&
            new URL(frame.url()).origin !== grant
          ) {
            await route.abort();
            return;
          }
          headers["x-orbit-local-access"] = proxy.localTicket(
            url.href,
            route.request().method(),
          );
        }
        await route.continue({ headers });
      } catch {
        await route.abort().catch(() => undefined);
      }
    });
    this.assertCurrent(epoch);
    // Popup requests can arrive before page-specific routes exist. No local socket
    // is allowed by the fallback; public destinations still use the pinned proxy.
    await context.routeWebSocket("**/*", (socket) => {
      const url = new URL(socket.url());
      if (epoch !== this.epoch || url.hostname === "127.0.0.1") socket.close();
      else socket.connectToServer();
    });
    this.assertCurrent(epoch);
    const page = await context.newPage();
    this.assertCurrent(epoch);
    await this.addPage(page);
    context.on("page", (popup) => {
      if (epoch !== this.epoch) {
        void popup.close().catch(() => undefined);
        return;
      }
      // Include noreferrer/noopener public tabs. Registration is shared with
      // explicit newPage() calls so one Chromium page never appears twice.
      void (async () => {
        // Chromium may surface a blank, opener-less target alongside a download.
        // It is not a website tab and must not replace the page that requested it.
        if (
          this.nativeDownload.popup &&
          !popup.url() &&
          !(await popup.opener())
        ) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          if (this.nativeDownload.popup && !popup.url()) {
            await popup.close();
            return;
          }
        }
        await this.addPage(popup);
      })().catch(() => undefined);
    });
    browser.on("disconnected", () => {
      if (epoch === this.epoch && this.browser === browser) void this.reset();
    });
  }
  private addPage(page: Page): Promise<void> {
    const existing = this.pageRegistrations.get(page);
    if (existing) return existing;
    const registering = this.attachPage(page);
    this.pageRegistrations.set(page, registering);
    return registering;
  }
  private async attachPage(page: Page): Promise<void> {
    const epoch = this.epoch;
    const opener = await page.opener();
    this.assertCurrent(epoch);
    const pageUrl = page.url();
    if (
      pageUrl &&
      pageUrl !== "about:blank" &&
      !/^https?:\/\//i.test(pageUrl)
    ) {
      await page.close().catch(() => undefined);
      return;
    }
    if (this.tabs.length >= 8) {
      await page.close();
      return;
    }
    const localOrigin = this.tabs.find(
      (item) => item.page === opener,
    )?.localOrigin;
    const tab: Tab = {
      id: randomUUID(),
      page,
      title: "",
      resourceErrors: new Set(),
      address: /^https?:/.test(page.url()) ? page.url() : "",
      localOrigin:
        opener &&
        localOrigin &&
        new URL(opener.url()).origin === localOrigin &&
        (page.url() === "about:blank" ||
          new URL(page.url()).origin === localOrigin)
          ? localOrigin
          : undefined,
    };
    this.tabs.push(tab);
    page.setDefaultTimeout(5000);
    page.setDefaultNavigationTimeout(20_000);
    page.on("dialog", (dialog) => {
      tab.dialog = dialog;
      if (tab === this.active) {
        this.nativeSelect.invalidate();
        this.nativePicker.invalidate();
        this.nativeFileChooser.invalidate();
        this.nativeDownload.invalidate();
      }
    });
    page.on("download", (download) => {
      if (epoch === this.epoch && tab === this.active && !tab.dialog)
        this.nativeDownload.capture(download, this.viewId);
      else {
        void download.cancel().catch(() => undefined);
        void download.delete().catch(() => undefined);
      }
    });
    page.on("filechooser", (chooser) => {
      if (epoch === this.epoch && tab === this.active && !tab.dialog)
        this.nativeFileChooser.capture(chooser, this.viewId);
    });
    page.on("console", (item) => {
      if (epoch !== this.epoch) return;
      if (["error", "warning"].includes(item.type())) {
        this.errors.push(redactSecrets(item.text()).slice(0, 350));
        this.errors = this.errors.slice(-20);
      }
    });
    page.on("pageerror", (error) => {
      if (epoch !== this.epoch) return;
      this.errors.push(redactSecrets(error.message).slice(0, 350));
      this.errors = this.errors.slice(-20);
    });
    const recordResourceFailure = (request: Request) => {
      if (
        epoch === this.epoch &&
        ["stylesheet", "script"].includes(request.resourceType()) &&
        tab.resourceErrors.size < 32
      )
        tab.resourceErrors.add(request.url());
    };
    page.on("requestfailed", (request) => {
      // Navigating away deliberately aborts in-flight resources; that is not an outage.
      if (!request.failure()?.errorText.includes("ERR_ABORTED"))
        recordResourceFailure(request);
    });
    page.on("response", (response) => {
      if (response.status() >= 400) recordResourceFailure(response.request());
    });
    page.on("framenavigated", (frame) => {
      if (epoch !== this.epoch || frame !== page.mainFrame()) return;
      const frameUrl = frame.url();
      if (!URL.canParse(frameUrl)) return;
      const destination = new URL(frameUrl);
      tab.resourceErrors.clear();
      if (["http:", "https:"].includes(destination.protocol))
        tab.address = frameUrl;
      else if (frameUrl === "about:blank") {
        tab.address = "";
        tab.title = "";
      }
      if (tab.localOrigin && destination.origin !== tab.localOrigin)
        tab.localOrigin = undefined;
      if (tab === this.active) {
        this.clearAccessibleControls();
        this.nativeSelect.invalidate();
        this.nativePicker.invalidate();
        this.nativeFileChooser.invalidate();
        this.nativeDownload.invalidate();
        this.viewId = randomUUID();
        this.image = undefined;
        this.frame++;
        this.metaAt = 0;
        this.mouseButtons = 0;
      }
    });
    page.on("domcontentloaded", () => {
      if (tab === this.active) {
        this.loading = false;
        this.metaAt = 0;
      }
    });
    page.on("close", () => {
      if (epoch !== this.epoch) return;
      this.pageRegistrations.delete(page);
      this.tabs = this.tabs.filter((item) => item !== tab);
      if (this.active === tab) {
        if (this.tabs[0]) void this.select(this.tabs[0]).catch(() => undefined);
        else void this.reset();
      }
    });
    await page.routeWebSocket("**/*", (socket) => {
      const url = new URL(socket.url());
      const target = url.origin.replace(/^ws/, "http");
      if (
        epoch !== this.epoch ||
        (url.hostname === "127.0.0.1" &&
          (target !== tab.localOrigin ||
            new URL(page.url()).origin !== tab.localOrigin))
      )
        socket.close();
      else socket.connectToServer();
    });
    this.assertCurrent(epoch);
    await this.select(tab);
  }
  private async select(tab: Tab): Promise<void> {
    const epoch = this.epoch;
    const old = this.cdp;
    this.cdp = undefined;
    this.active = tab;
    this.nativeSelect.invalidate();
    this.nativePicker.invalidate();
    this.nativeFileChooser.invalidate();
    this.nativeDownload.invalidate();
    this.clearAccessibleControls();
    this.viewId = randomUUID();
    this.image = undefined;
    this.frame++;
    this.metaAt = 0;
    this.mouseButtons = 0;
    this.canGoBack = false;
    this.canGoForward = false;
    await old?.detach().catch(() => undefined);
    await tab.page.setViewportSize({ width: this.width, height: this.height });
    const cdp = await tab.page.context().newCDPSession(tab.page);
    if (epoch !== this.epoch || tab !== this.active) {
      await cdp.detach();
      return;
    }
    this.cdp = cdp;
    cdp.on("Page.screencastFrame", (raw: unknown) => {
      const parsed = FrameSchema.safeParse(raw);
      if (!parsed.success) return;
      void cdp
        .send("Page.screencastFrameAck", { sessionId: parsed.data.sessionId })
        .catch(() => undefined);
      if (
        epoch !== this.epoch ||
        tab !== this.active ||
        cdp !== this.cdp ||
        parsed.data.metadata.deviceWidth !== this.width ||
        parsed.data.metadata.deviceHeight !== this.height
      )
        return;
      this.image = parsed.data.data;
      this.frame++;
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 85,
      maxWidth: 2560,
      maxHeight: 1600,
      everyNthFrame: 1,
    });
  }
  private async navigate(url: URL): Promise<void> {
    this.active!.address = url.href;
    await this.awaitNavigation((page) =>
      page.goto(url.href, { waitUntil: "domcontentloaded" }),
    );
  }
  private async awaitNavigation(
    operation: (page: Page) => Promise<unknown>,
  ): Promise<void> {
    const epoch = this.epoch;
    const tab = this.active!;
    const page = tab.page;
    const previousPageId = this.viewId;
    this.loading = true;
    try {
      await operation(page);
    } catch (error: unknown) {
      const committedUrl = page.url();
      const committed =
        epoch === this.epoch &&
        this.active === tab &&
        this.viewId !== previousPageId &&
        URL.canParse(committedUrl) &&
        ["http:", "https:"].includes(new URL(committedUrl).protocol);
      if (
        !(error instanceof Error && error.name === "TimeoutError") ||
        !committed
      )
        throw error;
      // A document that committed before DOM-ready timed out is usable as a
      // partial page. Keep the address and show the existing incomplete-page
      // notice instead of reporting a failed navigation over visible content.
      if (tab.resourceErrors.size < 32) tab.resourceErrors.add(committedUrl);
    } finally {
      if (epoch === this.epoch) {
        this.loading = false;
        this.metaAt = 0;
      }
    }
  }
  private async readSelection(): Promise<string> {
    for (const frame of this.active!.page.frames().slice(0, 12)) {
      try {
        const text = await frame.evaluate(() => {
          const field = document.activeElement;
          if (field instanceof HTMLInputElement) {
            if (field.type === "password") return null;
            return field.value.slice(
              field.selectionStart ?? 0,
              field.selectionEnd ?? 0,
            );
          }
          if (field instanceof HTMLTextAreaElement)
            return field.value.slice(
              field.selectionStart ?? 0,
              field.selectionEnd ?? 0,
            );
          return window.getSelection()?.toString() || "";
        });
        if (text === null) return "";
        if (text) return text.slice(0, 16_000);
      } catch {
        // A frame may navigate or disappear while its selection is read.
      }
    }
    return "";
  }
  private async input(event: BrowserInput): Promise<void> {
    if (!this.active || !this.cdp) throw new Error("Browser stopped.");
    if (this.active.dialog)
      throw new Error("Respond to the page dialog first.");
    if (event.type === "text")
      await this.cdp.send("Input.insertText", { text: event.text });
    else if (event.type === "key")
      await this.active.page.keyboard.press(event.key);
    else {
      if (event.x > this.width || event.y > this.height)
        throw new Error("Pointer is outside the current page.");
      if (event.type === "wheel")
        await this.cdp.send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: event.x,
          y: event.y,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
        });
      else {
        const button =
          event.button === "left" ? 1 : event.button === "right" ? 2 : 4;
        if (event.phase === "down") this.mouseButtons |= button;
        else if (event.phase === "up") this.mouseButtons &= ~button;
        await this.cdp.send("Input.dispatchMouseEvent", {
          type:
            event.phase === "move"
              ? "mouseMoved"
              : event.phase === "down"
                ? "mousePressed"
                : "mouseReleased",
          x: event.x,
          y: event.y,
          button:
            event.phase === "move" && !this.mouseButtons
              ? "none"
              : event.button,
          buttons: this.mouseButtons,
          clickCount: event.phase === "move" ? 0 : event.clicks,
          modifiers: event.modifiers ?? 0,
        });
      }
    }
  }
  private async captureNativePopup(): Promise<void> {
    const tab = this.active,
      pageId = this.viewId;
    if (!tab || tab.dialog) return;
    await this.nativeSelect.capture(tab.page, pageId);
    if (
      !this.nativeSelect.popup &&
      tab === this.active &&
      pageId === this.viewId
    )
      await this.nativePicker.capture(tab.page, pageId);
    if (tab !== this.active || pageId !== this.viewId) return;
    if (this.nativeSelect.popup || this.nativePicker.popup)
      this.mouseButtons = 0;
  }
  private assertCurrent(epoch: number): void {
    if (epoch !== this.epoch) throw new Error("Browser stopped.");
  }
  private async run(
    operation: () => Promise<void>,
    signal?: AbortSignal,
    quiet = false,
    pageToCancel?: () => Page | undefined,
    reportFailure = true,
  ): Promise<void> {
    if (signal?.aborted) throw new Error("Browser action cancelled.");
    if (this.busy)
      throw new Error("Browser is busy. Wait for the current action.");
    const epoch = this.epoch;
    this.busy = true;
    if (!quiet) this.message = "";
    clearTimeout(this.idle);
    this.idleExpiresAt = undefined;
    let rejectCancellation: ((error: Error) => void) | undefined;
    let cancellation: Promise<boolean> | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      rejectCancellation = reject;
    });
    const abort = () => {
      const page = pageToCancel?.();
      if (page) cancellation = this.closeCancelledPage(page);
      rejectCancellation?.(new Error("Browser action cancelled."));
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (!quiet) this.options.onStatus?.("browser_preview_running");
    try {
      await Promise.race([operation(), cancelled]);
      if (signal?.aborted) throw new Error("Browser action cancelled.");
      this.assertCurrent(epoch);
      if (!quiet) this.options.onStatus?.("browser_preview_ready");
    } catch (error: unknown) {
      signal?.removeEventListener("abort", abort);
      const closedCancelledTab = (await cancellation) ?? false;
      const message = signal?.aborted
        ? closedCancelledTab
          ? "Agent browser action cancelled. The affected tab was closed; other tabs and the browser session remain open."
          : "Agent browser action cancelled. Browser tabs remain open."
        : redactSecrets(
            error instanceof Error ? error.message : "Browser action failed.",
          )
            .split("\n")[0]!
            .slice(0, 350);
      if (epoch === this.epoch && reportFailure) {
        this.message = message;
        this.options.onStatus?.("browser_preview_error");
      }
      throw new Error(epoch === this.epoch ? message : "Browser stopped.");
    } finally {
      signal?.removeEventListener("abort", abort);
      if (epoch === this.epoch) {
        this.busy = false;
        if (this.browser) {
          if (!this.active) {
            const browser = this.browser;
            this.browser = undefined;
            this.context = undefined;
            await this.proxy?.stop();
            await browser.close().catch(() => undefined);
          } else {
            this.idleExpiresAt = Date.now() + 30 * 60_000;
            this.idle = setTimeout(() => {
              void this.reset("idle");
            }, 30 * 60_000);
            this.idle.unref();
          }
        } else await this.proxy?.stop();
      }
    }
  }

  private async closeCancelledPage(page: Page): Promise<boolean> {
    try {
      if (!this.browser || !this.context) return false;
      const tab = this.tabs.find((item) => item.page === page);
      if (!tab) return false;
      const wasActive = tab === this.active;
      // Close the mutating page first. Merely switching tabs leaves the pending
      // Playwright action free to modify it after cancellation.
      if (wasActive) this.active = undefined;
      await page.close({ runBeforeUnload: false });
      if (wasActive) {
        const fallback = this.tabs[0];
        if (fallback) await this.select(fallback);
        else await this.addPage(await this.context.newPage());
      }
      return true;
    } catch {
      // If tab isolation fails, revoke the whole browser to prevent late writes.
      await this.reset();
      return false;
    }
  }
}
