import { describe, expect, it, vi } from "vitest";
import type { Browser } from "playwright-core";
import { BrowserPreviewRuntime } from "./BrowserPreviewRuntime.js";

function fakeBrowser() {
  const page = {
    on: vi.fn(),
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    goto: vi.fn(),
    url: () => "http://127.0.0.1:5173/",
    title: async () => "Preview",
    locator: vi.fn(() => ({ ariaSnapshot: async () => "Example page" })),
    evaluate: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce([]),
    screenshot: vi.fn().mockResolvedValue(Buffer.from("fixture")),
    setViewportSize: vi.fn(),
  };
  const context = {
    route: vi.fn(),
    routeWebSocket: vi.fn(),
    grantPermissions: vi.fn().mockResolvedValue(undefined),
    newPage: async () => page,
    on: vi.fn(),
  };
  const close = vi.fn().mockResolvedValue(undefined);
  return {
    page,
    close,
    browser: { newContext: async () => context, close } as unknown as Browser,
  };
}

describe("BrowserPreviewRuntime lifecycle", () => {
  it("pins Agent actions to the attached live tab until its turn finishes", async () => {
    const runtime = new BrowserPreviewRuntime({ blockedPort: () => 6047 });
    let activeTabId = "first-tab";
    vi.spyOn(runtime.live, "activeTabId", "get").mockImplementation(
      () => activeTabId,
    );
    vi.spyOn(runtime.live, "activeTabUrl", "get").mockReturnValue(
      "https://example.com/original",
    );
    expect(() => runtime.pinTabForTurn("other-tab")).toThrow("changed");
    expect(() =>
      runtime.pinTabForTurn(activeTabId, "https://example.com/other"),
    ).toThrow("page changed");
    const releaseFirst = runtime.pinTabForTurn(
      activeTabId,
      "https://example.com/original",
    );
    const releaseSecond = runtime.pinTabForTurn(activeTabId);
    releaseFirst();
    activeTabId = "second-tab";
    await expect(runtime.execute({ action: "snapshot" })).rejects.toThrow(
      "no longer active",
    );
    releaseSecond();
    await expect(runtime.execute({ action: "snapshot" })).rejects.toThrow(
      "Connect",
    );
  });
  it("does not launch anything during construction or on invalid targets", async () => {
    const launch = vi.fn();
    const runtime = new BrowserPreviewRuntime({
      blockedPort: () => 6047,
      launch,
    });
    expect(runtime.getSnapshot().status).toBe("closed");
    await expect(runtime.connect("http://127.0.0.1:6047")).rejects.toThrow();
    await expect(runtime.execute({ action: "snapshot" })).rejects.toThrow(
      "Connect",
    );
    expect(launch).not.toHaveBeenCalled();
  });
  it("closes a late browser launch without publishing into a reset session", async () => {
    let release!: (browser: Browser) => void;
    const close = vi.fn().mockResolvedValue(undefined);
    const launch = vi.fn(
      () =>
        new Promise<Browser>((resolve) => {
          release = resolve;
        }),
    );
    const runtime = new BrowserPreviewRuntime({
      blockedPort: () => 6047,
      launch,
    });
    const connecting = runtime.connect("http://127.0.0.1:5173");
    const rejected = expect(connecting).rejects.toThrow("stopped");
    await vi.waitFor(() => expect(launch).toHaveBeenCalledOnce());
    await expect(runtime.connect("http://127.0.0.1:5174")).rejects.toThrow(
      "busy",
    );
    await runtime.reset();
    release({ close } as unknown as Browser);
    await rejected;
    expect(close).toHaveBeenCalledOnce();
    expect(runtime.getSnapshot()).toMatchObject({
      status: "closed",
      url: "",
      text: "",
    });
  });
  it("exposes a recoverable launch failure without a false ready state", async () => {
    const launch = vi
      .fn()
      .mockRejectedValue(new Error("No supported browser could start."));
    const runtime = new BrowserPreviewRuntime({
      blockedPort: () => 6047,
      launch,
    });
    await expect(runtime.connect("http://localhost:5173")).rejects.toThrow(
      "No supported browser",
    );
    expect(runtime.getSnapshot()).toMatchObject({
      status: "error",
    });
    expect(runtime.getSnapshot().image).toBeUndefined();
    await runtime.reset();
    expect(runtime.getSnapshot().status).toBe("closed");
  });
  it("does not reconnect after reset while waiting for an older browser to close", async () => {
    const launch = vi.fn();
    const runtime = new BrowserPreviewRuntime({
      blockedPort: () => 6047,
      launch,
    });
    let release!: () => void;
    const closing = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reset = runtime.reset.bind(runtime);
    vi.spyOn(runtime, "reset").mockImplementationOnce(async () => {
      await reset();
      await closing;
    });
    const connecting = runtime.connect("http://127.0.0.1:5173");
    const rejected = expect(connecting).rejects.toThrow("stopped");
    await runtime.reset();
    release();
    await rejected;
    expect(launch).not.toHaveBeenCalled();
    expect(runtime.getSnapshot().status).toBe("closed");
  });
  it("ignores a late viewport change after the user stops the browser", async () => {
    const fixture = fakeBrowser();
    const runtime = new BrowserPreviewRuntime({
      blockedPort: () => 6047,
      launch: async () => fixture.browser,
    });
    await runtime.connect("http://127.0.0.1:5173");
    let finish!: () => void;
    fixture.page.setViewportSize.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const action = runtime.execute({ action: "viewport", viewport: "mobile" });
    const rejected = expect(action).rejects.toThrow("stopped");
    await runtime.reset();
    finish();
    await rejected;
    expect(runtime.getSnapshot()).toMatchObject({
      status: "closed",
      viewport: "desktop",
    });
    expect(runtime.getSnapshot().image).toBeUndefined();
    expect(fixture.close).toHaveBeenCalledOnce();
  });
  it("closes an idle connection after ten minutes without another browser action", async () => {
    vi.useFakeTimers();
    const fixture = fakeBrowser();
    const runtime = new BrowserPreviewRuntime({
      blockedPort: () => 6047,
      launch: async () => fixture.browser,
    });
    try {
      await runtime.connect("http://127.0.0.1:5173");
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(runtime.getSnapshot().status).toBe("closed");
      expect(fixture.close).toHaveBeenCalledOnce();
    } finally {
      await runtime.reset();
      vi.useRealTimers();
    }
  });
  it("retains a labelled last-good image after capture failure, recovers, then clears on reset", async () => {
    const fixture = fakeBrowser();
    fixture.page.evaluate
      .mockReset()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce([]);
    const runtime = new BrowserPreviewRuntime({
      blockedPort: () => 6047,
      launch: async () => fixture.browser,
    });
    try {
      const first = await runtime.connect("http://127.0.0.1:5173");
      fixture.page.screenshot.mockRejectedValueOnce(
        new Error("Capture timed out."),
      );
      await expect(runtime.execute({ action: "snapshot" })).rejects.toThrow(
        "Capture timed out",
      );
      expect(runtime.getSnapshot()).toMatchObject({
        status: "error",
        image: first.image,
        capturedAt: first.capturedAt,
        text: "",
        controls: undefined,
      });
      expect((await runtime.execute({ action: "snapshot" })).status).toBe(
        "ready",
      );
    } finally {
      await runtime.reset();
    }
    expect(runtime.getSnapshot().image).toBeUndefined();
    expect(runtime.getSnapshot().capturedAt).toBeUndefined();
  });
  it("hides arbitrary form values from the legacy Agent snapshot", async () => {
    const fixture = fakeBrowser();
    fixture.page.locator.mockReturnValue({
      ariaSnapshot: async () =>
        '- textbox "Password": fixture-private-password-9f2b\n- button "Sign in"',
    });
    const runtime = new BrowserPreviewRuntime({
      blockedPort: () => 6047,
      launch: async () => fixture.browser,
    });
    try {
      const snapshot = await runtime.connect("http://127.0.0.1:5173");
      expect(snapshot.text).toContain("textbox [form value hidden]");
      expect(snapshot.text).toContain("Sign in");
      expect(snapshot.text).not.toContain("fixture-private-password-9f2b");
    } finally {
      await runtime.reset();
    }
  });
});
