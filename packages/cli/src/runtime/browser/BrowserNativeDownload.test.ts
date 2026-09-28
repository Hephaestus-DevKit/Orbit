import { Readable } from "node:stream";
import type { Download } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import { BrowserNativeDownload } from "./BrowserNativeDownload.js";

const PAGE_ID = "126c6fdc-07d1-4b75-991f-77b69c2c7de1";

function fixture(filename: string, chunks: Buffer[] = [Buffer.from("hello")]) {
  const download = {
    suggestedFilename: () => filename,
    createReadStream: vi.fn(async () => Readable.from(chunks)),
    cancel: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  } as unknown as Download;
  return download;
}

describe("BrowserNativeDownload", () => {
  it("sanitizes website filenames and transfers the bytes only once", async () => {
    const owner = new BrowserNativeDownload();
    const download = fixture("../CON:<secret>\\report.txt");
    owner.capture(download, PAGE_ID);
    await vi.waitFor(() => expect(owner.popup?.status).toBe("ready"));
    expect(owner.popup?.filename).not.toMatch(/[\\/:<>]/);
    const id = owner.popup!.id;
    const filename = owner.popup!.filename;
    expect(owner.take(PAGE_ID, id)).toEqual({
      filename,
      buffer: Buffer.from("hello"),
    });
    expect(owner.popup).toBeUndefined();
    expect(() => owner.take(PAGE_ID, id)).toThrow("expired");
  });

  it("rejects an oversized website response without exposing bytes", async () => {
    const owner = new BrowserNativeDownload();
    owner.capture(
      fixture("large.bin", [
        Buffer.alloc(33 * 1024 * 1024),
        Buffer.alloc(32 * 1024 * 1024),
      ]),
      PAGE_ID,
    );
    await vi.waitFor(() => expect(owner.popup?.status).toBe("error"));
    expect(owner.popup?.message).toContain("64 MB");
    expect(() => owner.take(PAGE_ID, owner.popup!.id)).toThrow("not ready");
    owner.invalidate();
  });

  it("expires on dismissal or a different page, and never exposes stale bytes", async () => {
    const owner = new BrowserNativeDownload();
    const download = fixture("report.txt");
    owner.capture(download, PAGE_ID);
    await vi.waitFor(() => expect(owner.popup?.status).toBe("ready"));
    const id = owner.popup!.id;
    expect(() =>
      owner.take("e80ca7c4-37a3-4c5f-80d1-527610e1a257", id),
    ).toThrow("expired");
    owner.dismiss(PAGE_ID, id);
    expect(owner.popup).toBeUndefined();
    expect(download.cancel).toHaveBeenCalled();
  });

  it("expires the pending capability after two minutes", async () => {
    vi.useFakeTimers();
    try {
      const owner = new BrowserNativeDownload();
      const download = fixture("report.txt");
      owner.capture(download, PAGE_ID);
      const id = owner.popup!.id;
      await vi.advanceTimersByTimeAsync(2 * 60_000);
      expect(owner.popup).toBeUndefined();
      expect(() => owner.take(PAGE_ID, id)).toThrow("expired");
      expect(download.cancel).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
