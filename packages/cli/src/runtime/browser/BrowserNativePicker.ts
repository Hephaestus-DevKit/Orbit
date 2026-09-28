import { randomUUID } from "node:crypto";
import type { ElementHandle, Page } from "playwright-core";
import { z } from "zod";
import { redactSecrets } from "@orbit-build/shared";
import {
  BrowserInputPickerSchema,
  type BrowserInputPicker,
} from "./BrowserLiveContracts.js";

const NativePickerSnapshotSchema = z
  .object({
    label: z.string().max(120),
    type: BrowserInputPickerSchema.shape.type,
    value: z.string().max(64),
    required: z.boolean(),
    min: z.string().max(64),
    max: z.string().max(64),
    step: z.string().max(64),
  })
  .strict();
type NativePickerSnapshot = z.infer<typeof NativePickerSnapshotSchema>;

/** Runs in the website; the existing input value stays private to the host. */
export function readNativePicker(
  element: Node,
): NativePickerSnapshot | "unsupported" | null {
  if (
    !(element instanceof HTMLInputElement) ||
    !element.isConnected ||
    !["date", "time", "datetime-local", "month", "week", "color"].includes(
      element.type,
    ) ||
    element.disabled ||
    element.readOnly ||
    !element.getClientRects().length ||
    !element.matches(":open")
  )
    return null;
  if (
    [element.value, element.min, element.max, element.step].some(
      (part) => part.length > 64,
    )
  )
    return "unsupported";
  const label =
    element.getAttribute("aria-label") ||
    (element.getAttribute("aria-labelledby") || "")
      .split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent || "")
      .join(" ")
      .trim() ||
    Array.from(element.labels || [])
      .map((item) => item.textContent || "")
      .join(" ") ||
    element.title;
  return {
    label: label.trim().slice(0, 120),
    type: element.type as BrowserInputPicker["type"],
    value: element.value,
    required: element.required,
    min: element.min,
    max: element.max,
    step: element.step,
  };
}

function validPickerValue(
  type: BrowserInputPicker["type"],
  value: string,
  required: boolean,
): boolean {
  if (!value) return !required && type !== "color";
  const patterns: Record<BrowserInputPicker["type"], RegExp> = {
    date: /^\d{4}-\d{2}-\d{2}$/,
    time: /^\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/,
    "datetime-local":
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/,
    month: /^\d{4}-\d{2}$/,
    week: /^\d{4}-W\d{2}$/,
    color: /^#[0-9a-fA-F]{6}$/,
  };
  return patterns[type].test(value);
}

/** A short-lived capability for Chromium pickers absent from the page screencast. */
export class BrowserNativePicker {
  private revision = 0;
  private capturingRevision?: number;
  private handle?: ElementHandle;
  private snapshot?: NativePickerSnapshot;
  private popupValue?: BrowserInputPicker;
  private pageId = "";

  get popup(): BrowserInputPicker | undefined {
    return this.popupValue;
  }

  invalidate(): void {
    this.revision++;
    const handle = this.handle;
    this.handle = undefined;
    this.snapshot = undefined;
    this.popupValue = undefined;
    this.pageId = "";
    void handle?.dispose().catch(() => undefined);
  }

  /** Capture only a picker that the user actually opened in the current page. */
  async capture(page: Page, pageId: string): Promise<void> {
    if (this.popupValue || this.capturingRevision === this.revision) return;
    const revision = this.revision;
    this.capturingRevision = revision;
    try {
      for (const frame of page.frames().slice(0, 12)) {
        const candidate = await frame
          .evaluateHandle(() => document.querySelector("input:open"))
          .catch(() => undefined);
        const handle = candidate?.asElement();
        if (!handle) {
          await candidate?.dispose().catch(() => undefined);
          continue;
        }
        try {
          const raw = await handle.evaluate(readNativePicker);
          if (raw === "unsupported") {
            await page.keyboard.press("Escape");
            throw new Error(
              "This website picker is too complex for the panel. Type using the focused page control.",
            );
          }
          const parsed = NativePickerSnapshotSchema.safeParse(raw);
          const bounds = await handle.boundingBox();
          if (!parsed.success || !bounds || revision !== this.revision)
            continue;
          const snapshot = parsed.data;
          const displayedConstraint = (constraint: string) =>
            snapshot.type !== "color" &&
            validPickerValue(snapshot.type, constraint, false)
              ? constraint
              : "";
          const popup = BrowserInputPickerSchema.parse({
            id: randomUUID(),
            label: redactSecrets(snapshot.label).slice(0, 120),
            type: snapshot.type,
            required: snapshot.required,
            min: displayedConstraint(snapshot.min),
            max: displayedConstraint(snapshot.max),
            step:
              /^(?:any|\d+(?:\.\d+)?)$/.test(snapshot.step) &&
              (snapshot.step === "any" || Number(snapshot.step) > 0)
                ? snapshot.step
                : "",
            bounds,
          });
          await page.keyboard.press("Escape");
          if (revision !== this.revision) return;
          this.handle = handle;
          this.snapshot = snapshot;
          this.popupValue = popup;
          this.pageId = pageId;
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

  /** Dismissal cannot change website data or extend the idle deadline. */
  dismiss(pageId: string, popupId: string): void {
    this.assertCurrent(pageId, popupId);
    this.invalidate();
  }

  /** Reject malformed or stale input before a session operation renews idle time. */
  canApply(pageId: string, popupId: string, value: string): void {
    this.assertCurrent(pageId, popupId);
    if (!validPickerValue(this.snapshot!.type, value, this.snapshot!.required))
      throw new Error("Enter a valid value for this website control.");
  }

  /** Revalidate the live input and commit one change with the site's events. */
  async apply(pageId: string, popupId: string, value: string): Promise<void> {
    this.canApply(pageId, popupId, value);
    const handle = this.handle!,
      revision = this.revision;
    try {
      const applied = await handle.evaluate(
        (element, expected) => {
          if (
            !(element instanceof HTMLInputElement) ||
            !element.isConnected ||
            element.disabled ||
            element.readOnly ||
            !element.getClientRects().length ||
            element.type !== expected.type ||
            element.value !== expected.oldValue ||
            element.required !== expected.required ||
            element.min !== expected.min ||
            element.max !== expected.max ||
            element.step !== expected.step
          )
            return false;
          const probe = element.ownerDocument.createElement("input");
          probe.type = expected.type;
          probe.required = expected.required;
          probe.min = expected.min;
          probe.max = expected.max;
          probe.step = expected.step;
          probe.value = expected.value;
          if (
            (probe.value !== expected.value &&
              !(
                expected.type === "color" &&
                probe.value === expected.value.toLowerCase()
              )) ||
            !probe.checkValidity()
          )
            return false;
          const changed = element.value !== probe.value;
          // Frameworks can track an input's instance setter. Invoke the native
          // setter so the subsequent input event observes the actual change.
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )?.set;
          if (!setter) return false;
          setter.call(element, probe.value);
          element.focus();
          if (changed) {
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
          }
          return true;
        },
        { ...this.snapshot!, oldValue: this.snapshot!.value, value },
      );
      if (!applied)
        throw new Error("The website control changed. Open it again.");
    } finally {
      if (revision === this.revision) this.invalidate();
    }
  }

  private assertCurrent(pageId: string, popupId: string): void {
    if (
      !this.handle ||
      !this.snapshot ||
      this.pageId !== pageId ||
      this.popupValue?.id !== popupId
    )
      throw new Error("The website picker changed. Open it again.");
  }
}
