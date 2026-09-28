import { randomUUID } from "node:crypto";
import type { Download } from "playwright-core";
import { redactSecrets } from "@orbit-build/shared";
import {
  BrowserDownloadPopupSchema,
  type BrowserDownloadPopup,
} from "./BrowserLiveContracts.js";

const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const DOWNLOAD_LIFETIME_MS = 2 * 60_000;

function safeFilename(value: string): string {
  const name = redactSecrets(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 180);
  if (!name) return "download";
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
    ? `_${name}`
    : name;
}

/** Owns one bounded, short-lived website download without a workspace path. */
export class BrowserNativeDownload {
  private current?: {
    popup: BrowserDownloadPopup;
    pageId: string;
    download: Download;
    buffer?: Buffer;
    expiresAt: number;
    timer: ReturnType<typeof setTimeout>;
  };

  get popup(): BrowserDownloadPopup | undefined {
    if (this.current && Date.now() >= this.current.expiresAt) this.invalidate();
    return this.current?.popup;
  }

  capture(download: Download, pageId: string): void {
    this.invalidate();
    const popup = BrowserDownloadPopupSchema.parse({
      id: randomUUID(),
      filename: safeFilename(download.suggestedFilename()),
      status: "preparing",
    });
    const pending = {
      popup,
      pageId,
      download,
      expiresAt: Date.now() + DOWNLOAD_LIFETIME_MS,
      timer: setTimeout(
        () => this.invalidateIfCurrent(popup.id),
        DOWNLOAD_LIFETIME_MS,
      ),
      buffer: undefined as Buffer | undefined,
    };
    pending.timer.unref();
    this.current = pending;
    void this.prepare(pending);
  }

  invalidate(): void {
    const current = this.current;
    if (!current) return;
    this.current = undefined;
    clearTimeout(current.timer);
    current.buffer = undefined;
    void current.download.cancel().catch(() => undefined);
    void current.download.delete().catch(() => undefined);
  }

  dismiss(pageId: string, downloadId: string): void {
    this.assertCurrent(pageId, downloadId);
    this.invalidate();
  }

  take(
    pageId: string,
    downloadId: string,
  ): {
    filename: string;
    buffer: Buffer;
  } {
    const current = this.assertCurrent(pageId, downloadId);
    if (current.popup.status !== "ready" || !current.buffer)
      throw new Error("The website download is not ready yet.");
    const result = { filename: current.popup.filename, buffer: current.buffer };
    this.invalidate();
    return result;
  }

  private assertCurrent(pageId: string, downloadId: string) {
    const current = this.current;
    if (
      !current ||
      Date.now() >= current.expiresAt ||
      current.pageId !== pageId ||
      current.popup.id !== downloadId
    )
      throw new Error(
        "The download expired. Request it on the current page again.",
      );
    return current;
  }

  private invalidateIfCurrent(downloadId: string): void {
    if (this.current?.popup.id === downloadId) this.invalidate();
  }

  private async prepare(
    pending: NonNullable<BrowserNativeDownload["current"]>,
  ) {
    try {
      const stream = await pending.download.createReadStream();
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of stream) {
        if (this.current !== pending) {
          stream.destroy();
          return;
        }
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > MAX_DOWNLOAD_BYTES) {
          stream.destroy();
          await pending.download.cancel().catch(() => undefined);
          throw new Error("This download exceeds the 64 MB limit.");
        }
        chunks.push(bytes);
      }
      if (this.current !== pending) return;
      pending.buffer = Buffer.concat(chunks, size);
      pending.popup = BrowserDownloadPopupSchema.parse({
        ...pending.popup,
        status: "ready",
        size,
      });
    } catch (error: unknown) {
      if (this.current !== pending) return;
      pending.popup = BrowserDownloadPopupSchema.parse({
        ...pending.popup,
        status: "error",
        message:
          error instanceof Error && error.message.includes("64 MB")
            ? "This download exceeds the 64 MB limit."
            : "The website download failed. Try again on the page.",
      });
    } finally {
      await pending.download.delete().catch(() => undefined);
    }
  }
}
