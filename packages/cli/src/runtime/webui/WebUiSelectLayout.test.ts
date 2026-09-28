import { describe, expect, it } from "vitest";
import { selectMenuLayout } from "./WebUiSelectLayout.js";

describe("select menu placement", () => {
  const input = {
    trigger: { top: 300, bottom: 328, left: 820, width: 230 },
    viewportWidth: 1100,
    viewportHeight: 760,
    contentHeight: 700,
    minimumWidth: 250,
    preferTop: true,
  };
  it("uses the free space below a landing composer even when top is preferred", () => {
    const menu = selectMenuLayout(input);
    expect(menu.placement).toBe("bottom");
    expect(menu.top).toBe(335);
    expect(menu.left + menu.width).toBeLessThanOrEqual(1090);
  });
  it("opens above a composer near the bottom", () => {
    const menu = selectMenuLayout({
      ...input,
      trigger: { ...input.trigger, top: 670, bottom: 698 },
    });
    expect(menu.placement).toBe("top");
    expect(menu.top + 320).toBe(663);
    expect(menu.maxHeight).toBe(320);
  });
  it("caps height on the roomier side in a short viewport", () => {
    const menu = selectMenuLayout({ ...input, viewportHeight: 460 });
    expect(menu.placement).toBe("top");
    expect(menu.maxHeight).toBe(283);
    expect(menu.top).toBe(10);
  });
  it("keeps small menus on their preferred side and inside narrow viewports", () => {
    const menu = selectMenuLayout({
      ...input,
      viewportWidth: 320,
      contentHeight: 90,
    });
    expect(menu.placement).toBe("top");
    expect(menu.width).toBe(250);
    expect(menu.left).toBe(60);
  });
  it("does not flip sides while filtering an open menu", () => {
    const menu = selectMenuLayout({
      ...input,
      contentHeight: 90,
      placement: "bottom",
    });
    expect(menu.placement).toBe("bottom");
    expect(menu.top).toBe(335);
  });
});
