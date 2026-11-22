import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import {
  afterEach,
  describe,
  expect,
  it,
  mockTools as vi,
} from "../../../../../scripts/testing/support.mjs";
import { DEFAULT_CONFIG } from "@orbit-build/config";
import { OrbitBrowserSession } from "./OrbitBrowserSession.js";
import {
  closeOrbitBrowser,
  createBrowserToolRegistry,
  handoffOrbitBrowser,
  launchOrbitBrowser,
  updateBrowserChat,
} from "./OrbitBrowserTools.js";

describe("workspace-owned browser tools", () => {
  const workspace = "http://127.0.0.1:6047/#token=" + "a".repeat(43);
  afterEach(() => {
    closeOrbitBrowser(workspace);
    vi.restoreAllMocks();
  });
  it("never opens a browser on behalf of a model and rejects a stale workspace or chat", async () => {
    const start = vi.spyOn(OrbitBrowserSession.prototype, "start").mockResolvedValue(undefined);
    vi.spyOn(OrbitBrowserSession.prototype, "open", "get").mockReturnValue(true);
    const page = { site: "https://example.org", title: "Example", controls: [] };
    const transport = vi.spyOn(OrbitBrowserSession.prototype, "request").mockResolvedValue(page);
    const registry = createBrowserToolRegistry();
    const observe = registry.get("browser_observe")!;
    const click = registry.get("browser_click")!;
    let sessionId = "a";
    const ctx = { cwd: "/project", sessionId };
    const owner = { cwd: ctx.cwd, config: DEFAULT_CONFIG, loop: { getSessionId: () => sessionId } };
    expect((await observe.execute({}, ctx)).ok).toBe(false);
    expect(start).not.toHaveBeenCalled();
    await launchOrbitBrowser(workspace, owner);
    expect((await observe.execute({}, ctx)).data).toEqual(page);
    expect((await observe.execute({}, { ...ctx, cwd: "/another" })).ok).toBe(false);
    sessionId = "b";
    expect((await observe.execute({}, ctx)).ok).toBe(false);
    expect((await observe.execute({}, { ...ctx, sessionId })).ok).toBe(false);
    await updateBrowserChat(workspace, owner);
    expect(transport).toHaveBeenCalledWith({ action: "revoke" });
    expect((await observe.execute({}, { ...ctx, sessionId })).ok).toBe(true);
    expect((await click.execute({ target: "body" }, { ...ctx, sessionId })).ok).toBe(false);
    const target = "ac5d2696-133d-45aa-bdd9-c7420901b800";
    transport.mockResolvedValueOnce(true);
    expect((await click.execute({ target }, { ...ctx, sessionId })).ok).toBe(true);
    expect(transport).toHaveBeenLastCalledWith({ action: "click", target }, undefined);
  });
  it("hands only the authenticated native chat to its destination project, before retiring the source", async () => {
    vi.spyOn(OrbitBrowserSession.prototype, "start").mockResolvedValue(undefined);
    vi.spyOn(OrbitBrowserSession.prototype, "open", "get").mockReturnValue(true);
    const close = vi.spyOn(OrbitBrowserSession.prototype, "close");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    const owner = {
      cwd: "/project",
      config: DEFAULT_CONFIG,
      loop: { getSessionId: () => "first" },
    };
    await launchOrbitBrowser(workspace, owner);
    const req = new IncomingMessage(new Socket());
    const res = new ServerResponse(req);
    const next = workspace.replace("6047", "6159");
    await handoffOrbitBrowser(req, res, workspace, next);
    expect(fetch).not.toHaveBeenCalled();
    req.headers["user-agent"] = "OrbitBrowserWorkspace/1";
    await expect(handoffOrbitBrowser(req, res, workspace, "https://example.org/")).rejects
      .toThrow();
    await handoffOrbitBrowser(req, res, workspace, next);
    const [url, options] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:6159/api/browser/open");
    expect(options?.redirect).toBe("error");
    expect(close).not.toHaveBeenCalled();
    res.emit("finish");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
