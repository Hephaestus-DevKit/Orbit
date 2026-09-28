import type { ElementHandle, Page } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import { BrowserNativeSelect } from "./BrowserNativeSelect.js";

const pageId = "c22ffce6-950e-4c65-a5fc-f710a57fa7a7";
const snapshot = {
  label: "Appearance",
  selectedIndex: 0,
  options: [
    {
      value: "private-light-value",
      label: "Light option",
      group: "Theme",
      disabled: false,
      selected: true,
    },
    {
      value: "private-dark-value",
      label: "Dark option",
      group: "Theme",
      disabled: false,
      selected: false,
    },
    {
      value: "private-disabled-value",
      label: "Unavailable",
      group: "Theme",
      disabled: true,
      selected: false,
    },
  ],
};

function fixture() {
  const handle = {
    asElement: vi.fn(),
    evaluate: vi
      .fn()
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(true),
    boundingBox: vi.fn(async () => ({ x: 25, y: 40, width: 210, height: 34 })),
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

describe("short-lived website select capability", () => {
  it("returns only text and opaque IDs, then applies exactly one current choice", async () => {
    const fake = fixture();
    const select = new BrowserNativeSelect();
    await select.capture(fake.page, pageId);
    const popup = select.popup!;
    expect(popup.label).toBe("Appearance");
    expect(popup.bounds).toMatchObject({ x: 25, y: 40 });
    expect(JSON.stringify(popup)).not.toContain("private-");
    expect(popup.options[2]).toMatchObject({ disabled: true, group: "Theme" });
    expect(fake.page.keyboard.press).toHaveBeenCalledWith("Escape");
    expect(() =>
      select.canChoose(pageId, popup.id, popup.options[2]!.id),
    ).toThrow("not available");
    expect(() =>
      select.canChoose(
        pageId,
        popup.id,
        "c1f29366-83bb-42ae-ace4-384b6b66aad1",
      ),
    ).toThrow("not available");
    await select.choose(pageId, popup.id, popup.options[1]!.id);
    expect(fake.handle.evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ index: 1, value: "private-dark-value" }),
    );
    expect(select.popup).toBeUndefined();
    expect(fake.handle.dispose).toHaveBeenCalledOnce();
    await expect(
      select.choose(pageId, popup.id, popup.options[1]!.id),
    ).rejects.toThrow("selector changed");
  });

  it("rejects a stale page or popup and revokes on dismissal", async () => {
    const fake = fixture();
    const select = new BrowserNativeSelect();
    await select.capture(fake.page, pageId);
    const popup = select.popup!;
    expect(() =>
      select.dismiss("e80ca7c4-37a3-4c5f-80d1-527610e1a257", popup.id),
    ).toThrow("selector changed");
    expect(select.popup?.id).toBe(popup.id);
    select.dismiss(pageId, popup.id);
    expect(select.popup).toBeUndefined();
    expect(fake.handle.dispose).toHaveBeenCalledOnce();
  });

  it("does not publish a handle captured after navigation invalidates it", async () => {
    const fake = fixture();
    const select = new BrowserNativeSelect();
    let release!: (
      handle: Awaited<ReturnType<typeof fake.frame.evaluateHandle>>,
    ) => void;
    fake.frame.evaluateHandle.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const capturing = select.capture(fake.page, pageId);
    select.invalidate();
    release(
      fake.handle as unknown as Awaited<
        ReturnType<typeof fake.frame.evaluateHandle>
      >,
    );
    await capturing;
    expect(select.popup).toBeUndefined();
    expect(fake.handle.dispose).toHaveBeenCalledOnce();
  });

  it("allows a new session to capture while an old page evaluation is still pending", async () => {
    const oldPage = fixture();
    const newPage = fixture();
    const select = new BrowserNativeSelect();
    let release!: (
      handle: Awaited<ReturnType<typeof oldPage.frame.evaluateHandle>>,
    ) => void;
    oldPage.frame.evaluateHandle.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const stale = select.capture(oldPage.page, pageId);
    select.invalidate();
    await select.capture(newPage.page, pageId);
    const currentId = select.popup?.id;
    expect(currentId).toBeTypeOf("string");
    release(
      oldPage.handle as unknown as Awaited<
        ReturnType<typeof oldPage.frame.evaluateHandle>
      >,
    );
    await stale;
    expect(select.popup?.id).toBe(currentId);
    expect(oldPage.handle.dispose).toHaveBeenCalledOnce();
    expect(newPage.handle.dispose).not.toHaveBeenCalled();
  });

  it("closes an unsupported native menu with an actionable fallback", async () => {
    const fake = fixture();
    vi.mocked(fake.handle.evaluate)
      .mockReset()
      .mockResolvedValue("unsupported");
    const select = new BrowserNativeSelect();
    await expect(select.capture(fake.page, pageId)).rejects.toThrow(
      "Use the arrow keys",
    );
    expect(fake.page.keyboard.press).toHaveBeenCalledWith("Escape");
    expect(select.popup).toBeUndefined();
    expect(fake.handle.dispose).toHaveBeenCalledOnce();
  });
});
