import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { WEB_UI_CLIENT_INSPECTOR_SCRIPT } from "./WebUiClientInspector.js";

function inspectorHarness() {
  const ids = ["general", "capabilities", "appearance"];
  const buttons = ids.map((id) => {
    const attributes = new Map<string, string>();
    return {
      dataset: { settingsTarget: id },
      attributes,
      setAttribute: (key: string, value: string) => attributes.set(key, value),
      removeAttribute: (key: string) => attributes.delete(key),
    };
  });
  const sections = ids.map((id, index) => ({
    id,
    top: 160 + index * 700,
    tabIndex: 0,
    getBoundingClientRect() {
      return { top: this.top };
    },
    focus: vi.fn(),
    scrollIntoView: vi.fn(),
  }));
  let scroll = () => {};
  let resize = () => {};
  const content = {
    scrollTop: 0,
    scrollHeight: 2200,
    clientHeight: 600,
    getBoundingClientRect: () => ({ top: 100 }),
    addEventListener: (_type: string, callback: () => void) => {
      scroll = callback;
    },
  };
  const panel = {
    hidden: false,
    querySelectorAll: () => buttons,
    querySelector: () => ({ offsetHeight: 53 }),
    contains: (element: unknown) =>
      sections.includes(element as (typeof sections)[number]),
  };
  const external = { focus: vi.fn() };
  const controller = runInNewContext(
    WEB_UI_CLIENT_INSPECTOR_SCRIPT + "\n({ navigateSettingsSection });",
    {
      elements: { settingsPanel: panel, inspectorContent: content },
      state: {},
      syncSidebarInteractivity: vi.fn(),
      syncScrollAffordance: vi.fn(),
      setWorkbench: vi.fn(),
      document: {
        getElementById: (id: string) =>
          id === "outside"
            ? external
            : sections.find((section) => section.id === id),
      },
      window: {
        addEventListener: (_type: string, callback: () => void) => {
          resize = callback;
        },
      },
    },
  ) as { navigateSettingsSection: (id: string) => void };
  return {
    controller,
    buttons,
    sections,
    content,
    panel,
    external,
    scroll: () => scroll(),
    resize: () => resize(),
  };
}

describe("inspector section navigation", () => {
  it("tracks the section below the sticky index without multiple current markers", () => {
    const ui = inspectorHarness();
    ui.scroll();
    expect(ui.buttons[0].attributes.get("aria-current")).toBe("location");
    ui.sections[1].top = 165;
    ui.scroll();
    expect(ui.buttons[1].attributes.get("aria-current")).toBe("location");
    expect(ui.buttons[0].attributes.has("aria-current")).toBe(false);
  });

  it("marks a short final section at the bottom and updates on resize", () => {
    const ui = inspectorHarness();
    ui.content.scrollTop = 1600;
    ui.resize();
    expect(ui.buttons[2].attributes.get("aria-current")).toBe("location");
  });

  it("does not recalculate hidden panel geometry", () => {
    const ui = inspectorHarness();
    ui.scroll();
    ui.panel.hidden = true;
    ui.sections[2].top = 0;
    ui.scroll();
    expect(ui.buttons[0].attributes.get("aria-current")).toBe("location");
  });

  it("moves focus before scrolling without adding section stops to the tab order", () => {
    const ui = inspectorHarness();
    ui.controller.navigateSettingsSection("capabilities");
    expect(ui.sections[1].tabIndex).toBe(-1);
    expect(ui.sections[1].focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(ui.sections[1].scrollIntoView).toHaveBeenCalledWith({
      block: "start",
    });
    expect(ui.sections[1].focus.mock.invocationCallOrder[0]).toBeLessThan(
      ui.sections[1].scrollIntoView.mock.invocationCallOrder[0],
    );
  });

  it("ignores absent and out-of-panel destinations", () => {
    const ui = inspectorHarness();
    ui.controller.navigateSettingsSection("missing");
    ui.controller.navigateSettingsSection("outside");
    expect(ui.external.focus).not.toHaveBeenCalled();
    for (const section of ui.sections)
      expect(section.focus).not.toHaveBeenCalled();
  });
});
