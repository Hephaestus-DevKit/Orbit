import { describe, expect, it, vi } from "vitest";
import type { FileChooser } from "playwright-core";
import { BrowserNativeFileChooser } from "./BrowserNativeFileChooser.js";
import {
  BrowserFileUploadMetadataSchema,
  parseBrowserFileUploadMetadata,
} from "./BrowserLiveContracts.js";

const pageId = "126c6fdc-07d1-4b75-991f-77b69c2c7de1";
const chooserId = "e80ca7c4-37a3-4c5f-80d1-527610e1a257";
function chooser(multiple = false) {
  const setFiles = vi.fn(async () => undefined);
  return {
    value: { isMultiple: () => multiple, setFiles } as unknown as FileChooser,
    setFiles,
  };
}

describe("website file chooser capability", () => {
  it("applies only to the current page and consumes the capability", async () => {
    const files = new BrowserNativeFileChooser();
    const target = chooser();
    files.capture(target.value, pageId);
    const id = files.popup!.id;
    const payload = [
      {
        name: "notes.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("hello"),
      },
    ];
    await expect(
      files.apply("deadbeef-dead-4ead-8ead-deadbeefdead", id, payload),
    ).rejects.toThrow("expired");
    await files.apply(pageId, id, payload);
    expect(target.setFiles).toHaveBeenCalledWith(payload);
    expect(files.popup).toBeUndefined();
    await expect(files.apply(pageId, id, payload)).rejects.toThrow("expired");
  });

  it("supports multiple files, but rejects multiple files for a single input", async () => {
    const files = new BrowserNativeFileChooser();
    const target = chooser(false);
    files.capture(target.value, pageId);
    const id = files.popup!.id;
    const payload = [
      { name: "a", mimeType: "text/plain", buffer: Buffer.alloc(0) },
    ];
    await expect(
      files.apply(pageId, id, [...payload, ...payload]),
    ).rejects.toThrow("one file");
    expect(target.setFiles).not.toHaveBeenCalled();
    files.capture(chooser(true).value, pageId);
    expect(files.popup?.multiple).toBe(true);
    files.invalidate();
    expect(files.popup).toBeUndefined();
  });

  it("expires without renewing through reads or dismissal", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const files = new BrowserNativeFileChooser();
      files.capture(chooser().value, pageId);
      const id = files.popup!.id;
      vi.advanceTimersByTime(120_000);
      expect(files.popup).toBeUndefined();
      expect(() => files.dismiss(pageId, id)).toThrow("expired");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("browser upload metadata", () => {
  const valid = {
    pageId,
    chooserId,
    files: [{ name: "数据.txt", mimeType: "text/plain", size: 0 }],
  };
  it("accepts bounded empty files and rejects paths and oversized batches", () => {
    expect(
      parseBrowserFileUploadMetadata(encodeURIComponent(JSON.stringify(valid))),
    ).toEqual(valid);
    expect(
      BrowserFileUploadMetadataSchema.safeParse({
        ...valid,
        files: [{ ...valid.files[0], name: "../secret" }],
      }).success,
    ).toBe(false);
    expect(
      BrowserFileUploadMetadataSchema.safeParse({
        ...valid,
        files: [
          { ...valid.files[0], size: 32 * 1024 * 1024 },
          { ...valid.files[0], size: 1 },
        ],
      }).success,
    ).toBe(false);
    expect(() => parseBrowserFileUploadMetadata("%invalid")).toThrow(
      "Invalid browser upload metadata",
    );
  });
});
