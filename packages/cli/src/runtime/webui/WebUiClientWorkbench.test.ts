import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { createWorkbenchController } from "./WebUiClientWorkbench.js";
import { createPreviewGeometry } from "./WebUiBrowserPreviewLayout.js";

function harness(width = 1440) {
  const nodes = new Map<string, ElementStub>();
  let activeElement: ElementStub | null = null;
  const focusElement = (element: ElementStub) => {
    activeElement = element;
  };
  class ElementStub {
    hidden = false;
    inert = false;
    isConnected = true;
    clientWidth = width - 260;
    tabIndex = 0;
    textContent = "";
    dataset: Record<string, string> = {};
    parentElement?: ElementStub;
    classes = new Set<string>();
    attributes = new Map<string, string>();
    events = new Map<string, (event: object) => void>();
    style = { setProperty: vi.fn() };
    classList = {
      toggle: (key: string, enabled: boolean) =>
        enabled ? this.classes.add(key) : this.classes.delete(key),
      add: (key: string) => this.classes.add(key),
      remove: (key: string) => this.classes.delete(key),
    };
    setAttribute(key: string, value: string) {
      this.attributes.set(key, value);
    }
    contains(element: unknown) {
      return element === this;
    }
    focus() {
      focusElement(this);
    }
    closest() {
      return this.inert || this.hidden ? this : null;
    }
    addEventListener(type: string, listener: (event: object) => void) {
      this.events.set(type, listener);
    }
    dispatchEvent = vi.fn();
  }
  const get = (id: string): ElementStub => {
    if (!nodes.has(id)) nodes.set(id, new ElementStub());
    return nodes.get(id)!;
  };
  get("workbench").parentElement = get("workspace");
  get("workbench").hidden = true;
  get("browserPreviewFocus").dataset = {
    focusLabel: "Expand",
    splitLabel: "Split view",
  };
  get("browserPreviewButton").focus();
  const runtime = {
    geometry: createPreviewGeometry(),
    readWidth: () => 54,
    saveWidth: vi.fn(),
    syncSidebarInteractivity: vi.fn(),
    closeSidebar: vi.fn(),
  };
  const controller = runInNewContext(
    `(${createWorkbenchController.toString()})(runtime)`,
    {
      runtime,
      HTMLElement: ElementStub,
      document: {
        getElementById: get,
        dispatchEvent: vi.fn(),
        get activeElement() {
          return activeElement;
        },
      },
      window: { innerWidth: width, addEventListener: vi.fn() },
      Event: class {
        constructor(public type: string) {}
      },
      ResizeObserver: class {
        observe() {}
        disconnect() {}
      },
      CustomEvent: class {
        constructor(
          public type: string,
          public options: unknown,
        ) {}
      },
    },
  ) as ReturnType<typeof createWorkbenchController>;
  return { get, controller, runtime, active: () => activeElement };
}

describe("nonmodal workbench", () => {
  it("keeps stable panels while switching without making the conversation inert", () => {
    const ui = harness();
    const browser = ui.get("browserPreviewPanel");
    ui.controller.setWorkbench("browser");
    expect(browser.hidden).toBe(false);
    expect(ui.get("conversation").inert).toBe(false);
    expect(ui.get("browserPreviewFocusLabel").textContent).toBe("Expand");
    ui.controller.setWorkbench("changes");
    expect(browser.hidden).toBe(true);
    expect(ui.get("changesPanel").hidden).toBe(false);
    ui.controller.setWorkbench("browser", false);
    expect(ui.get("browserPreviewPanel")).toBe(browser);
    expect(ui.get("browserTab").attributes.get("aria-selected")).toBe("true");
    expect(ui.get("changesTab").tabIndex).toBe(-1);
  });

  it("uses roving keyboard tabs and restores the original launcher on hide", () => {
    const ui = harness();
    ui.controller.setWorkbench("browser");
    const preventDefault = vi.fn();
    ui.get("browserTab").events.get("keydown")!({ key: "End", preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(ui.active()).toBe(ui.get("runTab"));
    expect(ui.get("runPanel").hidden).toBe(false);
    ui.controller.setWorkbench(null);
    expect(ui.get("workbench").hidden).toBe(true);
    expect(ui.get("conversation").inert).toBe(false);
    expect(ui.active()).toBe(ui.get("browserPreviewButton"));
  });

  it("can return to the draft from a focused browser without discarding panels", () => {
    const ui = harness(1000);
    ui.controller.setWorkbench("browser");
    expect(ui.get("conversation").inert).toBe(true);
    expect(ui.get("browserPreviewFocus").hidden).toBe(true);
    expect(ui.get("appShell").classes.has("sidebar-workbench-collapsed")).toBe(
      true,
    );
    ui.controller.showConversation();
    expect(ui.get("conversation").inert).toBe(false);
    expect(ui.get("appShell").classes.has("sidebar-workbench-collapsed")).toBe(
      false,
    );
    expect(ui.runtime.saveWidth).not.toHaveBeenCalled();
  });

  it("labels the narrow return action and focuses the draft without discarding panels", () => {
    const ui = harness(1000);
    ui.get("browserPreviewHide").dataset.returnLabel = "返回对话";
    const browser = ui.get("browserPreviewPanel");
    ui.controller.setWorkbench("browser");
    expect(ui.get("browserPreviewHide").attributes.get("aria-label")).toBe(
      "返回对话",
    );
    ui.get("browserPreviewHide").events.get("click")!({});
    expect(ui.get("workbench").hidden).toBe(true);
    expect(ui.active()).toBe(ui.get("prompt"));
    expect(ui.get("conversation").inert).toBe(false);
    ui.controller.setWorkbench("browser", false);
    expect(ui.get("browserPreviewPanel")).toBe(browser);
    expect(ui.runtime.saveWidth).not.toHaveBeenCalled();
  });

  it("uses the same explicit return in expanded mode but preserves split-mode focus restoration", () => {
    const ui = harness();
    ui.controller.setWorkbench("browser");
    expect(ui.get("browserPreviewHide").attributes.get("aria-label")).toBe(
      "Hide workspace",
    );
    ui.get("browserPreviewFocus").events.get("click")!({});
    expect(ui.get("browserPreviewHide").attributes.get("aria-label")).toBe(
      "Back to chat",
    );
    ui.get("browserPreviewHide").events.get("click")!({});
    expect(ui.active()).toBe(ui.get("prompt"));
    ui.controller.setWorkbench("browser");
    ui.get("browserPreviewFocus").events.get("click")!({});
    ui.get("browserPreviewHide").events.get("click")!({});
    expect(ui.active()).toBe(ui.get("prompt"));
    expect(ui.get("browserPreviewHide").attributes.get("aria-label")).toBe(
      "Hide workspace",
    );
  });

  it("clamps a resized workspace to desktop pane minima and saves only explicit resizing", () => {
    const ui = harness();
    ui.controller.setWorkbench("browser");
    ui.get("browserPreviewDivider").events.get("keydown")!({
      key: "End",
      preventDefault: vi.fn(),
    });
    const percent = Number(
      ui.get("browserPreviewDivider").attributes.get("aria-valuenow"),
    );
    expect(1180 * (1 - percent / 100)).toBeGreaterThanOrEqual(420);
    expect(ui.runtime.saveWidth).toHaveBeenCalledWith(percent);
    ui.controller.setWorkbench("run");
    expect(ui.runtime.saveWidth).toHaveBeenCalledOnce();
  });
});
