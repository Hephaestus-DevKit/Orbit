import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { createContextPickerLayout } from "./WebUiClientContextLayout.js";
import { contextFileParts } from "./WebUiClientContext.js";

function layoutHarness() {
  const events = new Map<string, (event: { target: unknown }) => void>();
  const panel = {
    hidden: false,
    style: {} as Record<string, string>,
    offsetWidth: 296,
    offsetHeight: 260,
    contains: (target: unknown) => target === panel,
  };
  const trigger = { top: 270, bottom: 306, left: 280 };
  const viewport = {
    width: 320,
    height: 360,
    offsetTop: 0,
    offsetLeft: 0,
    addEventListener: (name: string, callback: () => void) =>
      events.set("viewport-" + name, callback),
  };
  const append = vi.fn();
  let resized = () => {};
  const position = runInNewContext(
    `(${createContextPickerLayout.toString()})(elements)`,
    {
      elements: {
        contextPicker: panel,
        contextPickerButton: { getBoundingClientRect: () => trigger },
      },
      window: {
        visualViewport: viewport,
        addEventListener: (name: string, callback: () => void) =>
          events.set(name, callback),
      },
      document: {
        body: { append },
        addEventListener: (
          name: string,
          callback: (event: { target: unknown }) => void,
        ) => events.set("document-" + name, callback),
      },
      ResizeObserver: class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {}
      },
      Node: Object,
    },
  ) as () => void;
  return {
    panel,
    trigger,
    viewport,
    events,
    append,
    position,
    resize: () => resized(),
  };
}

describe("context picker layout", () => {
  it("labels root files and normalizes Windows paths without losing their directories", () => {
    expect(contextFileParts("README.md", "Workspace")).toEqual({
      name: "README.md",
      directory: "Workspace",
    });
    expect(contextFileParts("src\\runtime\\index.ts", "Workspace")).toEqual({
      name: "index.ts",
      directory: "src/runtime",
    });
  });
  it("escapes the clipped composer and fits a short viewport", () => {
    const ui = layoutHarness();
    expect(ui.append).toHaveBeenCalledWith(ui.panel);
    ui.position();
    expect(ui.panel.style).toEqual({
      width: "296px",
      maxHeight: "336px",
      left: "12px",
      top: "88px",
    });
  });

  it("repositions after content changes and a keyboard shrinks the visual viewport", () => {
    const ui = layoutHarness();
    ui.panel.offsetHeight = 180;
    ui.resize();
    expect(ui.panel.style.top).toBe("81px");
    Object.assign(ui.viewport, { height: 220, offsetTop: 80 });
    ui.events.get("viewport-resize")?.({ target: ui.viewport });
    expect(ui.panel.style.maxHeight).toBe("196px");
    expect(ui.panel.style.top).toBe("108px");
  });

  it("does not reposition a closed picker or react to its own result scrolling", () => {
    const ui = layoutHarness();
    ui.panel.hidden = true;
    ui.position();
    expect(ui.panel.style).toEqual({});
    ui.panel.hidden = false;
    ui.events.get("document-scroll")?.({ target: ui.panel });
    expect(ui.panel.style).toEqual({});
    ui.events.get("document-scroll")?.({ target: {} });
    expect(ui.panel.style.left).toBe("12px");
  });
});
