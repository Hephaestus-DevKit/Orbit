import { afterEach, describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { eventBus } from "@orbit-build/core";
import { BrowserPreviewRuntime } from "../browser/BrowserPreviewRuntime.js";
import { BrowserLiveSession } from "../browser/BrowserLiveSession.js";
import { WebUiBrowserPreviewBridge } from "./WebUiBrowserPreviewBridge.js";

vi.mock("playwright-core", () => ({
  chromium: {
    launch: vi.fn().mockRejectedValue(new Error("Fixture browser unavailable")),
  },
}));

function request() {
  const stream = new PassThrough();
  const req = Object.assign(stream, {
    method: "POST",
  }) as unknown as IncomingMessage;
  const res = { writeHead: vi.fn(), end: vi.fn() };
  return { stream, req, res, response: res as unknown as ServerResponse };
}

describe("WebUiBrowserPreviewBridge", () => {
  it("relays a confirmed download as one authenticated binary response", async () => {
    const take = vi
      .spyOn(BrowserLiveSession.prototype, "takeDownload")
      .mockReturnValue({
        filename: "report.txt",
        buffer: Buffer.from("report"),
      });
    const bridge = new WebUiBrowserPreviewBridge(() => 6047);
    bridge.bind({ getSessionId: () => "current" });
    const body = {
      pageId: "126c6fdc-07d1-4b75-991f-77b69c2c7de1",
      downloadId: "e80ca7c4-37a3-4c5f-80d1-527610e1a257",
    };
    const first = request();
    first.stream.end(JSON.stringify(body));
    await bridge.handleRoute(
      "/api/browser-download",
      first.req,
      first.response,
      () => false,
    );
    expect(take).toHaveBeenCalledWith(body);
    expect(first.res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        "Content-Type": "application/octet-stream",
        "Content-Disposition": expect.stringContaining('filename="report.txt"'),
        "Cache-Control": "no-store",
      }),
    );
    expect(first.res.end).toHaveBeenCalledWith(Buffer.from("report"));
    await bridge.stop();
  });
  it("rejects a delayed download confirmation after the session changes", async () => {
    const take = vi.spyOn(BrowserLiveSession.prototype, "takeDownload");
    let session = "before";
    const bridge = new WebUiBrowserPreviewBridge(() => 6047);
    bridge.bind({ getSessionId: () => session });
    const pending = request();
    const handling = bridge.handleDownload(
      pending.req,
      pending.response,
      () => false,
    );
    session = "after";
    pending.stream.end(
      JSON.stringify({
        pageId: "126c6fdc-07d1-4b75-991f-77b69c2c7de1",
        downloadId: "e80ca7c4-37a3-4c5f-80d1-527610e1a257",
      }),
    );
    await handling;
    expect(pending.res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    expect(take).not.toHaveBeenCalled();
    await bridge.stop();
  });
  it("accepts bounded binary uploads only in the current browser session", async () => {
    const apply = vi
      .spyOn(BrowserLiveSession.prototype, "applyUpload")
      .mockResolvedValue();
    const bridge = new WebUiBrowserPreviewBridge(() => 6047);
    let session = "before";
    bridge.bind({ getSessionId: () => session });
    const metadata = {
      pageId: "126c6fdc-07d1-4b75-991f-77b69c2c7de1",
      chooserId: "e80ca7c4-37a3-4c5f-80d1-527610e1a257",
      files: [{ name: "notes.txt", mimeType: "text/plain", size: 4 }],
    };
    const first = request();
    first.req.headers = {
      "content-type": "application/octet-stream",
      "x-orbit-upload": encodeURIComponent(JSON.stringify(metadata)),
    };
    first.stream.end(Buffer.from("test"));
    await bridge.handleUpload(first.req, first.response, () => false);
    expect(first.res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    expect(apply).toHaveBeenCalledWith(metadata, Buffer.from("test"));
    const stale = request();
    stale.req.headers = {
      "content-type": "application/octet-stream",
      "x-orbit-upload": encodeURIComponent(JSON.stringify(metadata)),
    };
    const pending = bridge.handleUpload(stale.req, stale.response, () => false);
    session = "after";
    stale.stream.end(Buffer.from("test"));
    await pending;
    expect(stale.res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    expect(apply).toHaveBeenCalledTimes(1);
    await bridge.stop();
  });
  it("rejects malformed file metadata and upload during Agent work", async () => {
    const apply = vi
      .spyOn(BrowserLiveSession.prototype, "applyUpload")
      .mockResolvedValue();
    const bridge = new WebUiBrowserPreviewBridge(() => 6047);
    bridge.bind();
    const invalid = request();
    invalid.req.headers = {
      "content-type": "application/octet-stream",
      "x-orbit-upload": "%invalid",
    };
    invalid.stream.end(Buffer.from("test"));
    await bridge.handleUpload(invalid.req, invalid.response, () => false);
    expect(invalid.res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    const busy = request();
    busy.req.headers = { "content-type": "application/octet-stream" };
    await bridge.handleUpload(busy.req, busy.response, () => true);
    expect(busy.res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
    expect(apply).not.toHaveBeenCalled();
    await bridge.stop();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it.each(["stop", "replace", "session"] as const)(
    "rejects delayed request bodies after %s",
    async (change) => {
      const connect = vi.spyOn(BrowserPreviewRuntime.prototype, "connect");
      const attach = vi.fn();
      let session = "old";
      const bridge = new WebUiBrowserPreviewBridge(() => 6047);
      bridge.bind({
        getSessionId: () => session,
        setBrowserPreviewService: attach,
      });
      const { stream, req, res, response } = request();
      const handling = bridge.handle(req, response, () => false);
      if (change === "stop") await bridge.stop();
      else if (change === "replace") bridge.bind({ getSessionId: () => "new" });
      else session = "new";
      stream.end(
        JSON.stringify({ action: "connect", url: "http://127.0.0.1:5173" }),
      );
      await handling;
      expect(connect).not.toHaveBeenCalled();
      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
      expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({
        ok: false,
        preview: { status: "closed" },
      });
      await bridge.stop();
    },
  );
  it("checks task activity after body parsing and lets users revoke access while busy", async () => {
    const execute = vi.spyOn(BrowserPreviewRuntime.prototype, "execute");
    const bridge = new WebUiBrowserPreviewBridge(() => 6047);
    bridge.bind();
    let busy = false;
    const first = request();
    const handling = bridge.handle(first.req, first.response, () => busy);
    busy = true;
    first.stream.end(JSON.stringify({ action: "snapshot" }));
    await handling;
    expect(first.res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
    expect(execute).not.toHaveBeenCalled();
    const second = request();
    second.stream.end(JSON.stringify({ action: "disconnect" }));
    await bridge.handle(second.req, second.response, () => true);
    expect(second.res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    await bridge.stop();
  });
  it("allows picker dismissal while busy but never applies a website value", async () => {
    const handle = vi
      .spyOn(BrowserLiveSession.prototype, "handle")
      .mockResolvedValue(undefined);
    const bridge = new WebUiBrowserPreviewBridge(() => 6047);
    bridge.bind();
    const pageId = "126c6fdc-07d1-4b75-991f-77b69c2c7de1";
    const popupId = "e80ca7c4-37a3-4c5f-80d1-527610e1a257";
    const apply = request();
    apply.stream.end(
      JSON.stringify({
        action: "apply-picker",
        pageId,
        popupId,
        value: "2026-10-04",
      }),
    );
    await bridge.handle(apply.req, apply.response, () => true);
    expect(apply.res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
    expect(handle).not.toHaveBeenCalled();
    const dismiss = request();
    dismiss.stream.end(
      JSON.stringify({ action: "dismiss-picker", pageId, popupId }),
    );
    await bridge.handle(dismiss.req, dismiss.response, () => true);
    expect(dismiss.res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    expect(handle).toHaveBeenCalledWith({
      action: "dismiss-picker",
      pageId,
      popupId,
    });
    await bridge.stop();
  });
  it("returns page text only on request and drops a result after the session changes", async () => {
    let session = "before";
    let finishRead:
      | ((value: {
          text: string;
          controls: Array<{
            id: string;
            label: string;
            kind: "button";
            disabled: boolean;
          }>;
        }) => void)
      | undefined;
    const read = vi
      .spyOn(BrowserLiveSession.prototype, "handle")
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            finishRead = resolve;
          }),
      );
    const bridge = new WebUiBrowserPreviewBridge(() => 6047);
    bridge.bind({ getSessionId: () => session });
    const first = request();
    first.stream.end(
      JSON.stringify({
        action: "read-page",
        pageId: "126c6fdc-07d1-4b75-991f-77b69c2c7de1",
      }),
    );
    const handling = bridge.handle(first.req, first.response, () => false);
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    finishRead?.({ text: "Private page text", controls: [] });
    await handling;
    expect(JSON.parse(first.res.end.mock.calls[0][0])).toMatchObject({
      ok: true,
      pageText: "Private page text",
      controls: [],
    });
    expect(
      JSON.parse(first.res.end.mock.calls[0][0]).browser,
    ).not.toHaveProperty("image");

    const second = request();
    second.stream.end(
      JSON.stringify({
        action: "read-page",
        pageId: "126c6fdc-07d1-4b75-991f-77b69c2c7de1",
      }),
    );
    const stale = bridge.handle(second.req, second.response, () => false);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    session = "after";
    finishRead?.({ text: "Old page text", controls: [] });
    await stale;
    expect(second.res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    expect(
      JSON.stringify(JSON.parse(second.res.end.mock.calls[0][0])),
    ).not.toContain("Old page text");
    await bridge.stop();
  });
  it("returns find results only to the active browser session", async () => {
    let session = "before";
    let finishFind: ((value: string) => void) | undefined;
    const find = vi
      .spyOn(BrowserLiveSession.prototype, "handle")
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            finishFind = resolve;
          }),
      );
    const bridge = new WebUiBrowserPreviewBridge(() => 6047);
    bridge.bind({ getSessionId: () => session });
    const action = {
      action: "find",
      pageId: "126c6fdc-07d1-4b75-991f-77b69c2c7de1",
      query: "Orbit",
      direction: "next",
    };
    const first = request();
    first.stream.end(JSON.stringify(action));
    const firstHandling = bridge.handle(first.req, first.response, () => false);
    await vi.waitFor(() => expect(find).toHaveBeenCalledOnce());
    finishFind?.("found");
    await firstHandling;
    expect(JSON.parse(first.res.end.mock.calls[0][0])).toMatchObject({
      ok: true,
      found: true,
    });

    const second = request();
    second.stream.end(JSON.stringify(action));
    const stale = bridge.handle(second.req, second.response, () => false);
    await vi.waitFor(() => expect(find).toHaveBeenCalledTimes(2));
    session = "after";
    finishFind?.("found");
    await stale;
    expect(second.res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    expect(JSON.parse(second.res.end.mock.calls[0][0])).not.toHaveProperty(
      "found",
    );
    await bridge.stop();
  });
  it("is single-use and detaches only its own browser service", async () => {
    const attach = vi.fn();
    const bridge = new WebUiBrowserPreviewBridge(() => 6047);
    bridge.bind({ setBrowserPreviewService: attach });
    const service = attach.mock.calls[0][0];
    await bridge.stop();
    expect(attach).toHaveBeenLastCalledWith(undefined, service);
    bridge.bind({ setBrowserPreviewService: attach });
    expect(attach).toHaveBeenCalledTimes(2);
    const { req, res, response } = request();
    req.method = "GET";
    await bridge.handle(req, response, () => false);
    expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
  });
  it("scopes browser status to its own session, including launch failure", async () => {
    const own = vi.fn();
    const other = vi.fn();
    const unsubscribeOwn = eventBus.subscribeSession(
      "agent_status",
      () => "preview-owner",
      own,
    );
    const unsubscribeOther = eventBus.subscribeSession(
      "agent_status",
      () => "other-session",
      other,
    );
    const bridge = new WebUiBrowserPreviewBridge(() => 6047);
    bridge.bind({ getSessionId: () => "preview-owner" });
    try {
      const { stream, req, response } = request();
      stream.end(
        JSON.stringify({ action: "connect", url: "http://127.0.0.1:5173" }),
      );
      await bridge.handle(req, response, () => false);
      expect(own.mock.calls.map(([payload]) => payload.status)).toEqual([
        "browser_preview_running",
        "browser_preview_error",
      ]);
      expect(other).not.toHaveBeenCalled();
    } finally {
      unsubscribeOwn();
      unsubscribeOther();
      await bridge.stop();
    }
  });
});
