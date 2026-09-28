import { randomUUID } from "node:crypto";
import type { ElementHandle, Page } from "playwright-core";
import { z } from "zod";
import { redactSecrets } from "@orbit-build/shared";
import {
  BrowserSelectPopupSchema,
  type BrowserSelectPopup,
} from "./BrowserLiveContracts.js";

const NativeSelectSnapshotSchema = z
  .object({
    label: z.string().max(120),
    selectedIndex: z.number().int().min(-1).max(9999),
    options: z
      .array(
        z
          .object({
            value: z.string().max(4096),
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
type NativeSelectSnapshot = z.infer<typeof NativeSelectSnapshotSchema>;

/** Runs in the website and is never exposed through an arbitrary-evaluation API. */
export function readNativeSelect(
  element: Node,
): NativeSelectSnapshot | "unsupported" | null {
  if (
    !(element instanceof HTMLSelectElement) ||
    !element.isConnected ||
    element.disabled ||
    element.multiple ||
    element.size > 1 ||
    !element.getClientRects().length
  )
    return null;
  // Keep the private snapshot bounded before serializing website-controlled data.
  if (element.options.length > 10_000) return "unsupported";
  const options = Array.from(element.options);
  if (options.some((option) => option.value.length > 4096))
    return "unsupported";
  const label =
    element.getAttribute("aria-label") ||
    (element.getAttribute("aria-labelledby") || "")
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || "")
      .join(" ")
      .trim() ||
    Array.from(element.labels || [])
      .map((label) => label.textContent || "")
      .join(" ") ||
    element.title;
  return {
    label: label.trim().slice(0, 120),
    selectedIndex: element.selectedIndex,
    options: options.map((option) => ({
      value: option.value,
      label: option.label.slice(0, 200),
      group:
        option.parentElement instanceof HTMLOptGroupElement
          ? option.parentElement.label.slice(0, 120)
          : "",
      disabled:
        option.disabled ||
        (option.parentElement instanceof HTMLOptGroupElement &&
          option.parentElement.disabled),
      selected: option.selected,
    })),
  };
}

/** Short-lived native-select capability: only labels/opaque option IDs leave the host. */
export class BrowserNativeSelect {
  private revision = 0;
  private capturingRevision?: number;
  private handle?: ElementHandle;
  private snapshot?: NativeSelectSnapshot;
  private popupValue?: BrowserSelectPopup;
  private pageId = "";

  /** The display snapshot never includes HTML, option values or client-supplied selectors. */
  get popup(): BrowserSelectPopup | undefined {
    return this.popupValue;
  }

  /** Revoke the capability on navigation, resize, tab replacement or dismissal. */
  invalidate(): void {
    this.revision++;
    const handle = this.handle;
    this.handle = undefined;
    this.snapshot = undefined;
    this.popupValue = undefined;
    this.pageId = "";
    void handle?.dispose().catch(() => undefined);
  }

  /** Convert an actually opened folded select; inline/multiple listboxes stay native. */
  async capture(page: Page, pageId: string): Promise<void> {
    if (this.popupValue || this.capturingRevision === this.revision) return;
    const revision = this.revision;
    this.capturingRevision = revision;
    try {
      for (const frame of page.frames().slice(0, 12)) {
        const candidate = await frame
          .evaluateHandle(() => document.querySelector("select:open"))
          .catch(() => undefined);
        const handle = candidate?.asElement();
        if (!handle) {
          await candidate?.dispose().catch(() => undefined);
          continue;
        }
        try {
          const raw = await handle.evaluate(readNativeSelect);
          if (raw === "unsupported") {
            await page.keyboard.press("Escape");
            throw new Error(
              "This website selector is too large for the options panel. Use the arrow keys on the focused page control.",
            );
          }
          const parsed = NativeSelectSnapshotSchema.safeParse(raw);
          const bounds = await handle.boundingBox();
          if (!parsed.success || !bounds || revision !== this.revision) return;
          const popup = BrowserSelectPopupSchema.parse({
            id: randomUUID(),
            label: redactSecrets(parsed.data.label).slice(0, 120),
            bounds,
            options: parsed.data.options.map((option) => ({
              id: randomUUID(),
              label: redactSecrets(option.label).slice(0, 200),
              group: redactSecrets(option.group).slice(0, 120),
              disabled: option.disabled,
              selected: option.selected,
            })),
          });
          await page.keyboard.press("Escape");
          if (revision !== this.revision) return;
          this.handle = handle;
          this.snapshot = parsed.data;
          this.pageId = pageId;
          this.popupValue = popup;
          return;
        } finally {
          if (handle !== this.handle)
            await handle.dispose().catch(() => undefined);
        }
      }
    } finally {
      if (this.capturingRevision === revision)
        this.capturingRevision = undefined;
    }
  }

  /** Dismissal is local cleanup and must not modify the page or renew its idle timer. */
  dismiss(pageId: string, popupId: string): void {
    this.assertCurrent(pageId, popupId);
    this.invalidate();
  }

  /** Atomically validate and apply one visible option with the site's input/change events. */
  async choose(
    pageId: string,
    popupId: string,
    optionId: string,
  ): Promise<void> {
    this.assertCurrent(pageId, popupId);
    const index = this.popupValue!.options.findIndex(
      (option) => option.id === optionId,
    );
    const option = this.snapshot!.options[index];
    if (!option || option.disabled)
      throw new Error("This option is not available.");
    const handle = this.handle!,
      revision = this.revision;
    try {
      const applied = await handle.evaluate(
        (element, expected) => {
          if (
            !(element instanceof HTMLSelectElement) ||
            !element.isConnected ||
            element.disabled ||
            element.multiple ||
            element.size > 1 ||
            !element.getClientRects().length ||
            element.selectedIndex !== expected.selectedIndex
          )
            return false;
          const option = element.options[expected.index];
          const group = option?.parentElement;
          if (
            !option ||
            option.disabled ||
            (group instanceof HTMLOptGroupElement && group.disabled) ||
            option.value !== expected.value ||
            option.label.slice(0, 200) !== expected.label ||
            (group instanceof HTMLOptGroupElement
              ? group.label.slice(0, 120)
              : "") !== expected.group
          )
            return false;
          const changed = element.selectedIndex !== expected.index;
          element.selectedIndex = expected.index;
          element.focus();
          if (changed) {
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
          }
          return true;
        },
        {
          index,
          value: option.value,
          label: option.label,
          group: option.group,
          selectedIndex: this.snapshot!.selectedIndex,
        },
      );
      // A website may navigate synchronously from its change handler. The
      // atomic page evaluation already committed the choice in that case.
      if (!applied)
        throw new Error("The options changed. Open the selector again.");
    } finally {
      if (revision === this.revision) this.invalidate();
    }
  }

  /** Reject invalid or stale choices before a session operation renews idle time. */
  canChoose(pageId: string, popupId: string, optionId: string): void {
    this.assertCurrent(pageId, popupId);
    const index = this.popupValue!.options.findIndex(
      (item) => item.id === optionId,
    );
    if (index < 0 || this.snapshot!.options[index]?.disabled)
      throw new Error("This option is not available.");
  }

  private assertCurrent(pageId: string, popupId: string): void {
    if (
      !this.handle ||
      !this.snapshot ||
      this.pageId !== pageId ||
      this.popupValue?.id !== popupId
    )
      throw new Error(
        "The selector changed. Open it again on the current page.",
      );
  }
}
