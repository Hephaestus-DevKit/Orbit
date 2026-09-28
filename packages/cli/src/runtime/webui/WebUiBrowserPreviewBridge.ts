import type { IncomingMessage, ServerResponse } from "http";
import { eventBus } from "@orbit-build/core";
import { BrowserPreviewRuntime } from "../browser/BrowserPreviewRuntime.js";
import { BrowserPreviewRequestSchema } from "../browser/BrowserPreviewPolicy.js";
import {
  readBinaryBody,
  readJsonBody,
  sendDownload,
  sendJson,
} from "./WebUiHttp.js";
import { safeWebMessage, webRequestErrorStatus } from "./WebUiSecurity.js";
import type { WebUiLoopSnapshot } from "./WebUiContracts.js";
import {
  BrowserLiveActionSchema,
  BrowserPageOutlineSchema,
  BrowserDownloadRequestSchema,
  parseBrowserFileUploadMetadata,
} from "../browser/BrowserLiveContracts.js";
import { z } from "zod";

/** Own browser lifecycle and authenticated route handling outside the HTTP shell. */
export class WebUiBrowserPreviewBridge {
  handlesRoute(pathname: string): boolean {
    return [
      "/api/browser-preview",
      "/api/browser-upload",
      "/api/browser-download",
    ].includes(pathname);
  }
  private readonly runtime: BrowserPreviewRuntime;
  private loop?: WebUiLoopSnapshot;
  private generation = 0;
  private stopped = false;
  private uploadPending = false;
  constructor(blockedPort: () => number | undefined) {
    this.runtime = new BrowserPreviewRuntime({
      blockedPort,
      onStatus: (status) => {
        const sessionId = this.loop?.getSessionId?.();
        if (!sessionId || this.stopped) return;
        eventBus.runWithContext(
          { sessionId, runId: `browser-preview-${this.generation}` },
          () =>
            eventBus.emitEvent("agent_status", {
              taskId: "browser-preview",
              status,
              detail: "Built-in browser",
            }),
        );
      },
    });
  }
  bind(loop?: WebUiLoopSnapshot): void {
    if (this.stopped) return;
    this.generation++;
    this.loop?.setBrowserPreviewService?.(undefined, this.runtime);
    void this.runtime.reset();
    this.loop = loop;
    loop?.setBrowserPreviewService?.(this.runtime);
  }
  pinTabForTurn(tabId: string, expectedUrl?: string): () => void {
    if (this.stopped) throw new Error("Browser preview was stopped.");
    return this.runtime.pinTabForTurn(tabId, expectedUrl);
  }
  async stop(): Promise<void> {
    this.stopped = true;
    this.generation++;
    this.loop?.setBrowserPreviewService?.(undefined, this.runtime);
    this.loop = undefined;
    await this.runtime.reset();
  }
  async handleRoute(
    pathname: string,
    req: IncomingMessage,
    res: ServerResponse,
    busy: () => boolean,
  ): Promise<void> {
    if (pathname === "/api/browser-download")
      await this.handleDownload(req, res, busy);
    else if (pathname === "/api/browser-upload")
      await this.handleUpload(req, res, busy);
    else await this.handle(req, res, busy);
  }
  /** Relay one confirmed website download to the user's browser save flow. */
  async handleDownload(
    req: IncomingMessage,
    res: ServerResponse,
    busy: () => boolean,
  ): Promise<void> {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, message: "Method not allowed." });
      return;
    }
    const generation = this.generation;
    const sessionId = this.loop?.getSessionId?.();
    try {
      const request = BrowserDownloadRequestSchema.parse(
        await readJsonBody(req),
      );
      if (
        this.stopped ||
        generation !== this.generation ||
        sessionId !== this.loop?.getSessionId?.() ||
        busy()
      )
        throw new Error(
          "Browser session changed or is busy. Request the download again.",
        );
      const file = this.runtime.live.takeDownload(request);
      sendDownload(res, file.filename, file.buffer);
    } catch (error: unknown) {
      const status = webRequestErrorStatus(error);
      sendJson(res, status === 500 ? 400 : status, {
        ok: false,
        message: safeWebMessage(error),
      });
    }
  }
  /** Receive user-selected file bytes without accepting a host filesystem path. */
  async handleUpload(
    req: IncomingMessage,
    res: ServerResponse,
    busy: () => boolean,
  ): Promise<void> {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, message: "Method not allowed." });
      return;
    }
    if (req.headers["content-type"] !== "application/octet-stream") {
      sendJson(res, 415, { ok: false, message: "Use a binary file upload." });
      return;
    }
    const generation = this.generation;
    const sessionId = this.loop?.getSessionId?.();
    if (this.stopped || busy() || this.uploadPending) {
      sendJson(res, 409, { ok: false, message: "Browser is busy or closed." });
      return;
    }
    this.uploadPending = true;
    try {
      const metadata = parseBrowserFileUploadMetadata(
        req.headers["x-orbit-upload"],
      );
      const body = await readBinaryBody(req, 32 * 1024 * 1024);
      if (
        this.stopped ||
        generation !== this.generation ||
        sessionId !== this.loop?.getSessionId?.() ||
        busy()
      )
        throw new Error(
          "Browser session changed. Open the file request again.",
        );
      await this.runtime.live.applyUpload(metadata, body);
      if (
        this.stopped ||
        generation !== this.generation ||
        sessionId !== this.loop?.getSessionId?.()
      )
        throw new Error(
          "Browser session changed. Open the file request again.",
        );
      sendJson(res, 200, { ok: true, browser: await this.runtime.live.read() });
    } catch (error: unknown) {
      const status =
        error instanceof Error &&
        error.message === "Invalid browser upload metadata."
          ? 400
          : webRequestErrorStatus(error);
      sendJson(res, status === 500 ? 400 : status, {
        ok: false,
        message: safeWebMessage(error),
      });
    } finally {
      this.uploadPending = false;
    }
  }
  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    busy: () => boolean,
  ): Promise<void> {
    const generation = this.generation;
    const sessionId = this.loop?.getSessionId?.();
    if (this.stopped) {
      sendJson(res, 409, {
        ok: false,
        message: "Browser preview was stopped.",
      });
      return;
    }
    if (req.method === "GET") {
      const query = new URL(req.url || "/", "http://localhost").searchParams;
      if (query.get("mode") === "live") {
        const after = z.coerce
          .number()
          .int()
          .min(-1)
          .max(Number.MAX_SAFE_INTEGER)
          .safeParse(query.get("after") ?? -1);
        if (!after.success) {
          sendJson(res, 400, { ok: false, message: "Invalid frame revision." });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          browser: await this.runtime.live.read(after.data),
        });
        return;
      }
      sendJson(res, 200, { ok: true, preview: this.runtime.getSnapshot() });
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, message: "Method not allowed." });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const live = BrowserLiveActionSchema.safeParse(body);
      const request = live.success
        ? live.data
        : BrowserPreviewRequestSchema.parse(body);
      if (
        this.stopped ||
        generation !== this.generation ||
        sessionId !== this.loop?.getSessionId?.()
      )
        throw new Error(
          "Browser preview session changed. Reopen Preview before reconnecting.",
        );
      if (
        busy() &&
        request.action !== "disconnect" &&
        request.action !== "dialog" &&
        request.action !== "dismiss-options" &&
        request.action !== "dismiss-picker" &&
        request.action !== "dismiss-upload" &&
        request.action !== "dismiss-download"
      ) {
        sendJson(res, 409, {
          ok: false,
          message:
            "Wait for the active task before controlling Preview, or stop the preview.",
        });
        return;
      }
      if (live.success) {
        if (
          live.data.action === "open" &&
          this.runtime.getSnapshot().status !== "closed"
        ) {
          await this.runtime.reset();
          if (
            this.stopped ||
            generation !== this.generation ||
            sessionId !== this.loop?.getSessionId?.()
          )
            throw new Error("Browser session changed.");
        }
        const content = await this.runtime.live.handle(live.data);
        if (live.data.action === "find") {
          if (content !== "found" && content !== "no-match")
            throw new Error("Could not search the current page.");
          const browser = await this.runtime.live.read();
          if (
            this.stopped ||
            generation !== this.generation ||
            sessionId !== this.loop?.getSessionId?.()
          )
            throw new Error("Browser session changed.");
          sendJson(res, 200, {
            ok: true,
            found: content === "found",
            browser,
          });
          return;
        }
        if (live.data.action === "read-page") {
          if (!content || typeof content === "string")
            throw new Error("Could not read the current page.");
          const outline = BrowserPageOutlineSchema.parse(content);
          const browser = await this.runtime.live.read();
          if (
            this.stopped ||
            generation !== this.generation ||
            sessionId !== this.loop?.getSessionId?.()
          )
            throw new Error("Browser session changed.");
          sendJson(res, 200, {
            ok: true,
            pageText: outline.text,
            controls: outline.controls,
            browser: { ...browser, image: undefined },
          });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          browser: await this.runtime.live.read(),
          ...(live.data.action === "copy-selection"
            ? { selection: typeof content === "string" ? content : "" }
            : {}),
        });
        return;
      }
      const legacy = BrowserPreviewRequestSchema.parse(body);
      if (legacy.action === "disconnect") await this.runtime.reset();
      else if (legacy.action === "connect")
        await this.runtime.connect(legacy.url);
      else await this.runtime.execute(legacy);
      sendJson(res, 200, {
        ok: true,
        preview: this.runtime.getSnapshot(),
        browser: await this.runtime.live.read(),
      });
    } catch (error: unknown) {
      sendJson(res, 400, {
        ok: false,
        message: safeWebMessage(error),
        preview: this.runtime.getSnapshot(),
      });
    }
  }
}
