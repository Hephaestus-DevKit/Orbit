import { z } from "zod";

const BrowserSearchEngineSchema = z.enum([
  "bing",
  "google",
  "baidu",
  "duckduckgo",
]);
type BrowserSearchEngine = z.infer<typeof BrowserSearchEngineSchema>;
const searchEndpoints: Record<BrowserSearchEngine, string> = {
  bing: "https://www.bing.com/search?q=",
  google: "https://www.google.com/search?q=",
  baidu: "https://www.baidu.com/s?wd=",
  duckduckgo: "https://duckduckgo.com/?q=",
};

const point = {
  x: z.number().finite().min(0).max(4096),
  y: z.number().finite().min(0).max(4096),
};
export const BrowserInputSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("pointer"),
      ...point,
      phase: z.enum(["move", "down", "up"]),
      button: z.enum(["left", "right", "middle"]).default("left"),
      clicks: z.number().int().min(1).max(2).default(1),
      modifiers: z.number().int().min(0).max(15).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("wheel"),
      ...point,
      deltaX: z.number().finite().min(-3000).max(3000),
      deltaY: z.number().finite().min(-3000).max(3000),
    })
    .strict(),
  z.object({ type: z.literal("text"), text: z.string().max(8000) }).strict(),
  z
    .object({
      type: z.literal("key"),
      key: z.enum([
        "Enter",
        "Tab",
        "Escape",
        "Backspace",
        "Delete",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Home",
        "End",
        "PageUp",
        "PageDown",
        "ControlOrMeta+A",
        "ControlOrMeta+Z",
        "ControlOrMeta+Y",
        "Shift+Tab",
        "Shift+ArrowLeft",
        "Shift+ArrowRight",
        "Shift+ArrowUp",
        "Shift+ArrowDown",
      ]),
    })
    .strict(),
]);
export const BrowserLiveActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("dismiss-download"),
      pageId: z.string().uuid(),
      downloadId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("dismiss-upload"),
      pageId: z.string().uuid(),
      chooserId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("apply-picker"),
      pageId: z.string().uuid(),
      popupId: z.string().uuid(),
      value: z.string().max(64),
    })
    .strict(),
  z
    .object({
      action: z.literal("dismiss-picker"),
      pageId: z.string().uuid(),
      popupId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("choose-option"),
      pageId: z.string().uuid(),
      popupId: z.string().uuid(),
      optionId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("dismiss-options"),
      pageId: z.string().uuid(),
      popupId: z.string().uuid(),
    })
    .strict(),
  z
    .object({ action: z.literal("keep-alive"), pageId: z.string().uuid() })
    .strict(),
  z.object({ action: z.literal("copy-selection") }).strict(),
  z
    .object({
      action: z.literal("find"),
      pageId: z.string().uuid(),
      query: z.string().trim().min(1).max(200),
      direction: z.enum(["next", "previous"]),
    })
    .strict(),
  z
    .object({ action: z.literal("read-page"), pageId: z.string().uuid() })
    .strict(),
  z
    .object({
      action: z.literal("control"),
      pageId: z.string().uuid(),
      controlId: z.string().uuid(),
      operation: z.enum(["activate", "focus"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("open"),
      address: z.string().trim().min(1).max(4096),
      searchEngine: BrowserSearchEngineSchema.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("input"),
      pageId: z.string().uuid(),
      events: z.array(BrowserInputSchema).min(1).max(32),
    })
    .strict(),
  z
    .object({
      action: z.literal("resize"),
      pageId: z.string().uuid(),
      width: z.number().int().min(320).max(2560),
      height: z.number().int().min(200).max(1600),
    })
    .strict(),
  z
    .object({
      action: z.literal("history"),
      direction: z.enum(["back", "forward"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("dialog"),
      accept: z.boolean(),
      text: z.string().max(4000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("tab"),
      id: z.string().uuid().optional(),
      operation: z.enum(["new", "select", "close"]),
    })
    .strict(),
]);
export type BrowserLiveAction = z.infer<typeof BrowserLiveActionSchema>;

export const BrowserPageControlSchema = z
  .object({
    id: z.string().uuid(),
    label: z.string().max(120),
    kind: z.enum(["button", "link", "field", "select", "toggle"]),
    disabled: z.boolean(),
  })
  .strict();
export type BrowserPageControl = z.infer<typeof BrowserPageControlSchema>;

export const BrowserPageOutlineSchema = z
  .object({
    text: z.string().max(16_000),
    controls: z.array(BrowserPageControlSchema).max(60),
  })
  .strict();
export type BrowserInput = z.infer<typeof BrowserInputSchema>;
export const BrowserSelectPopupSchema = z
  .object({
    id: z.string().uuid(),
    label: z.string().max(120),
    bounds: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().positive(),
        height: z.number().positive(),
      })
      .strict(),
    options: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            label: z.string().max(200),
            group: z.string().max(120),
            disabled: z.boolean(),
            selected: z.boolean(),
          })
          .strict(),
      )
      .max(10000),
  })
  .strict();
export type BrowserSelectPopup = z.infer<typeof BrowserSelectPopupSchema>;
export const BrowserInputPickerSchema = z
  .object({
    id: z.string().uuid(),
    label: z.string().max(120),
    type: z.enum(["date", "time", "datetime-local", "month", "week", "color"]),
    required: z.boolean(),
    min: z.string().max(64),
    max: z.string().max(64),
    step: z.string().max(64),
    bounds: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().positive(),
        height: z.number().positive(),
      })
      .strict(),
  })
  .strict();
export type BrowserInputPicker = z.infer<typeof BrowserInputPickerSchema>;
export const BrowserFileChooserSchema = z
  .object({ id: z.string().uuid(), multiple: z.boolean() })
  .strict();
export type BrowserFileChooser = z.infer<typeof BrowserFileChooserSchema>;
export const BrowserDownloadPopupSchema = z
  .object({
    id: z.string().uuid(),
    filename: z.string().min(1).max(180),
    status: z.enum(["preparing", "ready", "error"]),
    size: z
      .number()
      .int()
      .nonnegative()
      .max(64 * 1024 * 1024)
      .optional(),
    message: z.string().max(160).optional(),
  })
  .strict();
export type BrowserDownloadPopup = z.infer<typeof BrowserDownloadPopupSchema>;
export const BrowserDownloadRequestSchema = z
  .object({ pageId: z.string().uuid(), downloadId: z.string().uuid() })
  .strict();
export type BrowserDownloadRequest = z.infer<
  typeof BrowserDownloadRequestSchema
>;
export const BrowserFileUploadMetadataSchema = z
  .object({
    pageId: z.string().uuid(),
    chooserId: z.string().uuid(),
    files: z
      .array(
        z
          .object({
            name: z
              .string()
              .min(1)
              .max(255)
              .regex(/^[^\\/\u0000-\u001f\u007f]+$/),
            mimeType: z
              .string()
              .min(3)
              .max(128)
              .regex(/^[a-z\d!#$&^_.+-]+\/[a-z\d!#$&^_.+-]+$/i),
            size: z
              .number()
              .int()
              .nonnegative()
              .max(32 * 1024 * 1024),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict()
  .refine(
    (value) =>
      value.files.reduce((total, file) => total + file.size, 0) <=
      32 * 1024 * 1024,
    "Files exceed the 32 MB upload limit.",
  );
export type BrowserFileUploadMetadata = z.infer<
  typeof BrowserFileUploadMetadataSchema
>;
/** Decode only bounded, structured metadata; file bytes travel in the body. */
export function parseBrowserFileUploadMetadata(
  encoded: unknown,
): BrowserFileUploadMetadata {
  if (typeof encoded !== "string" || encoded.length > 8_000)
    throw new Error("Invalid browser upload metadata.");
  try {
    return BrowserFileUploadMetadataSchema.parse(
      JSON.parse(decodeURIComponent(encoded)),
    );
  } catch {
    throw new Error("Invalid browser upload metadata.");
  }
}
export interface BrowserLiveState {
  active: boolean;
  pageId: string;
  frame: number;
  image?: string;
  width: number;
  height: number;
  url: string;
  title: string;
  loading: boolean;
  busy: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  message: string;
  resourceErrors?: number;
  idleExpiresAt?: number;
  closedReason?: "idle";
  selectPopup?: BrowserSelectPopup;
  inputPicker?: BrowserInputPicker;
  fileChooser?: BrowserFileChooser;
  download?: BrowserDownloadPopup;
  tabs: Array<{ id: string; title: string; active: boolean }>;
  dialog?: { type: string; message: string; defaultValue: string };
}

/** An omnibox accepts HTTP(S), localhost development addresses, or search terms. */
export function browserAddress(
  input: string,
  searchEngine: BrowserSearchEngine = "bing",
): URL {
  const value = input.trim();
  if (!value || value.length > 4096)
    throw new Error("Enter a website or search query.");
  let address = value;
  const search = () =>
    new URL(
      searchEndpoints[BrowserSearchEngineSchema.parse(searchEngine)] +
        encodeURIComponent(value),
    );
  if (/^(site|filetype|intitle|inurl|intext):/i.test(value)) return search();
  if (
    !/^[a-z][a-z\d+.-]*:/i.test(value) ||
    /^(localhost|[a-z\d.-]+\.[a-z\d-]+):\d+(?:[/?#]|$)/i.test(value)
  ) {
    if (/^(localhost|127\.0\.0\.1)(:\d+)?([/?#]|$)/i.test(value))
      address = "http://" + value;
    else if (/^[^\s/]+\.[^\s/]+(?:[/?#].*)?$/.test(value))
      address = "https://" + value;
    else return search();
  }
  const url = new URL(address);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      "Use an HTTP or HTTPS website without credentials in its URL.",
    );
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url;
}
