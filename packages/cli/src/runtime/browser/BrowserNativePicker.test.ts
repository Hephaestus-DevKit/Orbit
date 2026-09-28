import type { ElementHandle, Page } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import type { BrowserInputPicker } from "./BrowserLiveContracts.js";
import { BrowserNativePicker } from "./BrowserNativePicker.js";

const pageId = "7e6e655e-2c1f-4a0e-8072-ef2335d468d8";
const snapshot = {
  label: "Appointment date",
  type: "date" as const,
  value: "2026-09-27",
  required: true,
  min: "2026-01-01",
  max: "2026-12-31",
  step: "1",
};

function fixture(
  data:
    | (Omit<typeof snapshot, "type"> & { type: BrowserInputPicker["type"] })
    | "unsupported"
    | null = snapshot,
) {
  const handle = {
    asElement: vi.fn(),
    evaluate: vi.fn().mockResolvedValueOnce(data).mockResolvedValueOnce(true),
    boundingBox: vi.fn(async () => ({ x: 30, y: 50, width: 210, height: 34 })),
    dispose: vi.fn(async () => undefined),
  };
  handle.asElement.mockReturnValue(handle);
  const frame = { evaluateHandle: vi.fn(async () => handle) };
  const page = {
    frames: () => [frame],
    keyboard: { press: vi.fn(async () => undefined) },
  } as unknown as Page;
  return { handle: handle as unknown as ElementHandle, frame, page };
}

describe("short-lived website native picker capability", () => {
  it("keeps the existing value private and commits only a current validated choice", async () => {
    const fake = fixture();
    const picker = new BrowserNativePicker();
    await picker.capture(fake.page, pageId);
    const popup = picker.popup!;
    expect(popup).toMatchObject({
      label: "Appointment date",
      type: "date",
      required: true,
      min: "2026-01-01",
    });
    expect(JSON.stringify(popup)).not.toContain("2026-09-27");
    expect(fake.page.keyboard.press).toHaveBeenCalledWith("Escape");
    expect(() => picker.canApply(pageId, popup.id, "not-a-date")).toThrow(
      "valid value",
    );
    expect(() => picker.canApply(pageId, popup.id, "")).toThrow("valid value");
    await picker.apply(pageId, popup.id, "2026-10-04");
    expect(fake.handle.evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        oldValue: "2026-09-27",
        value: "2026-10-04",
      }),
    );
    expect(picker.popup).toBeUndefined();
    expect(fake.handle.dispose).toHaveBeenCalledOnce();
    await expect(picker.apply(pageId, popup.id, "2026-10-05")).rejects.toThrow(
      "picker changed",
    );
  });

  it("accepts bounded date/time/color formats and explicit optional clearing", async () => {
    for (const [type, accepted, rejected] of [
      ["time", "13:45", "25:99xx"],
      ["datetime-local", "2026-10-04T13:45", "2026-10-04"],
      ["month", "2026-10", "2026/10"],
      ["week", "2026-W42", "2026-42"],
      ["color", "#a1B2c3", "red"],
    ] as const) {
      const fake = fixture({ ...snapshot, type, value: "", required: false });
      const picker = new BrowserNativePicker();
      await picker.capture(fake.page, pageId);
      const popup = picker.popup!;
      expect(() => picker.canApply(pageId, popup.id, accepted)).not.toThrow();
      expect(() => picker.canApply(pageId, popup.id, rejected)).toThrow();
      if (type !== "color")
        expect(() => picker.canApply(pageId, popup.id, "")).not.toThrow();
      picker.dismiss(pageId, popup.id);
      expect(picker.popup).toBeUndefined();
    }
  });

  it("does not publish arbitrary website constraint text as picker metadata", async () => {
    const fake = fixture({
      ...snapshot,
      min: "private-min-token",
      max: "private-max-token",
      step: "private-step-token",
    });
    const picker = new BrowserNativePicker();
    await picker.capture(fake.page, pageId);
    expect(picker.popup).toMatchObject({ min: "", max: "", step: "" });
    expect(JSON.stringify(picker.popup)).not.toContain("private-");
  });

  it("rejects stale page and popup identities without changing the current control", async () => {
    const fake = fixture();
    const picker = new BrowserNativePicker();
    await picker.capture(fake.page, pageId);
    const popup = picker.popup!;
    expect(() =>
      picker.dismiss("f22d9ad1-2c4d-465e-b03c-720fb84b44da", popup.id),
    ).toThrow("picker changed");
    expect(picker.popup?.id).toBe(popup.id);
    picker.dismiss(pageId, popup.id);
    expect(fake.handle.dispose).toHaveBeenCalledOnce();
  });

  it("does not publish a late capture after navigation or block a new session", async () => {
    const oldPage = fixture();
    const newPage = fixture();
    const picker = new BrowserNativePicker();
    let release!: (
      handle: Awaited<ReturnType<typeof oldPage.frame.evaluateHandle>>,
    ) => void;
    oldPage.frame.evaluateHandle.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const stale = picker.capture(oldPage.page, pageId);
    picker.invalidate();
    await picker.capture(newPage.page, pageId);
    const currentId = picker.popup?.id;
    release(
      oldPage.handle as unknown as Awaited<
        ReturnType<typeof oldPage.frame.evaluateHandle>
      >,
    );
    await stale;
    expect(picker.popup?.id).toBe(currentId);
    expect(oldPage.handle.dispose).toHaveBeenCalledOnce();
    expect(newPage.handle.dispose).not.toHaveBeenCalled();
  });

  it("closes an unsupported native picker with a keyboard fallback", async () => {
    const fake = fixture("unsupported");
    const picker = new BrowserNativePicker();
    await expect(picker.capture(fake.page, pageId)).rejects.toThrow(
      "focused page control",
    );
    expect(fake.page.keyboard.press).toHaveBeenCalledWith("Escape");
    expect(picker.popup).toBeUndefined();
    expect(fake.handle.dispose).toHaveBeenCalledOnce();
  });
});
