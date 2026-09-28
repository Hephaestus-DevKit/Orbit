import { randomUUID } from "node:crypto";
import type { FileChooser } from "playwright-core";
import {
  BrowserFileChooserSchema,
  type BrowserFileChooser,
} from "./BrowserLiveContracts.js";

type FilePayload = { name: string; mimeType: string; buffer: Buffer };

/** A website file request is usable only on the page that opened it. */
export class BrowserNativeFileChooser {
  private current?: {
    popup: BrowserFileChooser;
    pageId: string;
    chooser: FileChooser;
    expiresAt: number;
  };

  get popup(): BrowserFileChooser | undefined {
    if (this.current && Date.now() >= this.current.expiresAt) this.invalidate();
    return this.current?.popup;
  }

  capture(chooser: FileChooser, pageId: string): void {
    this.current = {
      popup: BrowserFileChooserSchema.parse({
        id: randomUUID(),
        multiple: chooser.isMultiple(),
      }),
      pageId,
      chooser,
      expiresAt: Date.now() + 2 * 60_000,
    };
  }

  invalidate(): void {
    this.current = undefined;
  }

  dismiss(pageId: string, chooserId: string): void {
    this.assertCurrent(pageId, chooserId);
    this.invalidate();
  }

  async apply(
    pageId: string,
    chooserId: string,
    files: FilePayload[],
  ): Promise<void> {
    const current = this.assertCurrent(pageId, chooserId);
    if (!current.popup.multiple && files.length !== 1)
      throw new Error("This website accepts one file at a time.");
    this.invalidate();
    await current.chooser.setFiles(files);
  }

  private assertCurrent(pageId: string, chooserId: string) {
    const current = this.current;
    if (
      !current ||
      Date.now() >= current.expiresAt ||
      current.pageId !== pageId ||
      current.popup.id !== chooserId
    )
      throw new Error(
        "The file request expired. Open it on the current page again.",
      );
    return current;
  }
}
