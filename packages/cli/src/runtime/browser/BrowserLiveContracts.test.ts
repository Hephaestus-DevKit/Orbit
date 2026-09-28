import { describe, expect, it } from "vitest";
import {
  browserAddress,
  BrowserInputPickerSchema,
  BrowserLiveActionSchema,
  BrowserPageOutlineSchema,
  BrowserSelectPopupSchema,
} from "./BrowserLiveContracts.js";

describe("browser omnibox and direct input boundary", () => {
  it("accepts only a scoped picker action and a value-free display contract", () => {
    const pageId = "c22ffce6-950e-4c65-a5fc-f710a57fa7a7";
    const popupId = "e80ca7c4-37a3-4c5f-80d1-527610e1a257";
    const apply = {
      action: "apply-picker",
      pageId,
      popupId,
      value: "2026-10-04",
    };
    expect(BrowserLiveActionSchema.safeParse(apply).success).toBe(true);
    expect(
      BrowserLiveActionSchema.safeParse({ ...apply, selector: "#birthdate" })
        .success,
    ).toBe(false);
    expect(
      BrowserLiveActionSchema.safeParse({ ...apply, value: "x".repeat(65) })
        .success,
    ).toBe(false);
    expect(
      BrowserLiveActionSchema.safeParse({
        action: "dismiss-picker",
        pageId,
        popupId,
      }).success,
    ).toBe(true);
    const display = {
      id: popupId,
      label: "Appointment date",
      type: "date",
      required: true,
      min: "2026-01-01",
      max: "2026-12-31",
      step: "1",
      bounds: { x: 20, y: 30, width: 180, height: 30 },
    };
    expect(BrowserInputPickerSchema.safeParse(display).success).toBe(true);
    expect(
      BrowserInputPickerSchema.safeParse({ ...display, value: "2026-09-27" })
        .success,
    ).toBe(false);
  });
  it("accepts only scoped opaque website-option actions and text-only responses", () => {
    const pageId = "c22ffce6-950e-4c65-a5fc-f710a57fa7a7";
    const popupId = "e80ca7c4-37a3-4c5f-80d1-527610e1a257";
    const optionId = "c1f29366-83bb-42ae-ace4-384b6b66aad1";
    const choose = { action: "choose-option", pageId, popupId, optionId };
    expect(BrowserLiveActionSchema.safeParse(choose).success).toBe(true);
    expect(
      BrowserLiveActionSchema.safeParse({ ...choose, selector: "#private" })
        .success,
    ).toBe(false);
    expect(
      BrowserLiveActionSchema.safeParse({ ...choose, optionId: "Dark" })
        .success,
    ).toBe(false);
    expect(
      BrowserLiveActionSchema.safeParse({
        action: "dismiss-options",
        pageId,
        popupId,
      }).success,
    ).toBe(true);
    const popup = {
      id: popupId,
      label: "Appearance",
      bounds: { x: 20, y: 30, width: 180, height: 30 },
      options: [
        {
          id: optionId,
          label: "Dark",
          group: "Theme",
          disabled: false,
          selected: false,
        },
      ],
    };
    expect(BrowserSelectPopupSchema.safeParse(popup).success).toBe(true);
    expect(
      BrowserSelectPopupSchema.safeParse({
        ...popup,
        options: [{ ...popup.options[0], value: "secret" }],
      }).success,
    ).toBe(false);
  });
  it("accepts only an explicit page-scoped keep-alive request", () => {
    const action = {
      action: "keep-alive",
      pageId: "c22ffce6-950e-4c65-a5fc-f710a57fa7a7",
    };
    expect(BrowserLiveActionSchema.safeParse(action).success).toBe(true);
    expect(
      BrowserLiveActionSchema.safeParse({ action: "keep-alive" }).success,
    ).toBe(false);
    expect(
      BrowserLiveActionSchema.safeParse({ ...action, pageId: "stale" }).success,
    ).toBe(false);
    expect(
      BrowserLiveActionSchema.safeParse({ ...action, address: "example.com" })
        .success,
    ).toBe(false);
  });
  it("bounds page outlines and excludes executable selectors from control responses", () => {
    const control = {
      id: "c22ffce6-950e-4c65-a5fc-f710a57fa7a7",
      label: "Search",
      kind: "field",
      disabled: false,
    };
    expect(
      BrowserPageOutlineSchema.safeParse({
        text: "- textbox [form value hidden]",
        controls: [control],
      }).success,
    ).toBe(true);
    expect(
      BrowserPageOutlineSchema.safeParse({
        text: "page",
        controls: [{ ...control, selector: "#private" }],
      }).success,
    ).toBe(false);
    expect(
      BrowserPageOutlineSchema.safeParse({
        text: "x".repeat(16_001),
        controls: [],
      }).success,
    ).toBe(false);
  });
  it.each([
    ["example.com", "https://example.com/"],
    [
      "example.com:8080/path?q=x#part",
      "https://example.com:8080/path?q=x#part",
    ],
    ["localhost:5173", "http://127.0.0.1:5173/"],
    ["127.0.0.1:5173/demo", "http://127.0.0.1:5173/demo"],
    [
      "https://example.com/search?q=你好",
      "https://example.com/search?q=%E4%BD%A0%E5%A5%BD",
    ],
  ])("normalizes %s", (input, expected) =>
    expect(browserAddress(input).href).toBe(expected),
  );
  it("searches whole phrases without dropping Chinese text", () => {
    const url = browserAddress("浏览器设计 Orbit");
    expect(url.origin).toBe("https://www.bing.com");
    expect(url.searchParams.get("q")).toBe("浏览器设计 Orbit");
  });
  it("accepts search operators without treating them as browser protocols", () => {
    expect(
      browserAddress("site:typescriptlang.org 你好").searchParams.get("q"),
    ).toBe("site:typescriptlang.org 你好");
  });
  it.each([
    ["bing", "www.bing.com", "q"],
    ["google", "www.google.com", "q"],
    ["baidu", "www.baidu.com", "wd"],
    ["duckduckgo", "duckduckgo.com", "q"],
  ] as const)(
    "uses only the explicitly selected %s search engine",
    (engine, host, key) => {
      const action = BrowserLiveActionSchema.parse({
        action: "open",
        address: "site:typescriptlang.org 中文",
        searchEngine: engine,
      });
      expect(action.action).toBe("open");
      const url = browserAddress("site:typescriptlang.org 中文", engine);
      expect(url.hostname).toBe(host);
      expect(url.searchParams.get(key)).toBe("site:typescriptlang.org 中文");
      expect(browserAddress("example.com", engine).href).toBe(
        "https://example.com/",
      );
    },
  );
  it("rejects unrecognized search engines at the API boundary", () => {
    expect(
      BrowserLiveActionSchema.safeParse({
        action: "open",
        address: "hello",
        searchEngine: "https://private.example",
      }).success,
    ).toBe(false);
  });
  it.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,hello",
    "https://user:password@example.com",
    " ",
  ])("rejects unsafe address %s", (address) =>
    expect(() => browserAddress(address)).toThrow(),
  );
  it("bounds input and excludes arbitrary code or file access", () => {
    expect(
      BrowserLiveActionSchema.safeParse({ action: "copy-selection" }).success,
    ).toBe(true);
    expect(
      BrowserLiveActionSchema.safeParse({
        action: "copy-selection",
        selector: "*",
      }).success,
    ).toBe(false);
    const pageId = "c3a41bf3-5a73-4cef-bfb3-7c17e4f48532";
    const controlId = "c22ffce6-950e-4c65-a5fc-f710a57fa7a7";
    expect(
      BrowserLiveActionSchema.safeParse({
        action: "find",
        pageId,
        query: "Orbit",
        direction: "next",
      }).success,
    ).toBe(true);
    for (const query of [" ", "x".repeat(201)])
      expect(
        BrowserLiveActionSchema.safeParse({
          action: "find",
          pageId,
          query,
          direction: "next",
        }).success,
      ).toBe(false);
    expect(
      BrowserLiveActionSchema.safeParse({
        action: "control",
        pageId,
        controlId,
        operation: "focus",
      }).success,
    ).toBe(true);
    expect(
      BrowserLiveActionSchema.safeParse({
        action: "control",
        pageId,
        controlId,
        operation: "evaluate",
      }).success,
    ).toBe(false);
    expect(
      BrowserLiveActionSchema.safeParse({
        action: "input",
        pageId,
        events: [{ type: "text", text: "你好" }],
      }).success,
    ).toBe(true);
    expect(
      BrowserLiveActionSchema.safeParse({
        action: "input",
        pageId,
        events: [
          { type: "pointer", phase: "down", x: 12, y: 20, modifiers: 10 },
        ],
      }).success,
    ).toBe(true);
    expect(
      BrowserLiveActionSchema.safeParse({
        action: "input",
        pageId,
        events: [{ type: "key", key: ["Shift", "ArrowDown"].join("+") }],
      }).success,
    ).toBe(true);
    for (const event of [
      { type: "evaluate", code: "x" },
      { type: "text", text: "x".repeat(8001) },
      { type: "pointer", x: -1, y: 0, phase: "down" },
      { type: "pointer", x: 1, y: 1, phase: "down", modifiers: 16 },
      { type: "pointer", x: 1, y: 1, phase: "down", modifiers: -1 },
      { type: "key", key: "ControlOrMeta+O" },
    ])
      expect(
        BrowserLiveActionSchema.safeParse({
          action: "input",
          pageId,
          events: [event],
        }).success,
      ).toBe(false);
    expect(
      BrowserLiveActionSchema.safeParse({
        action: "resize",
        pageId,
        width: 10000,
        height: 800,
      }).success,
    ).toBe(false);
    expect(
      BrowserLiveActionSchema.safeParse({
        action: "open",
        address: "example.com",
        evaluate: "alert(1)",
      }).success,
    ).toBe(false);
  });
});
