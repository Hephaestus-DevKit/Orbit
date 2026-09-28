import { describe, expect, it, vi } from "vitest";
import {
  BrowserPreviewTool,
  type BrowserPreviewSnapshot,
} from "./BrowserPreview.js";

describe("browser_preview tool", () => {
  const tool = new BrowserPreviewTool();
  const context = { cwd: "/project", sessionId: "session" };
  it("requires a host-connected browser instead of creating implicit access", async () => {
    expect(await tool.execute({ action: "snapshot" }, context)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Connect"),
    });
    expect(
      tool.inputSchema.safeParse({
        action: "connect",
        url: "http://127.0.0.1:6047",
      }).success,
    ).toBe(false);
  });
  it("uses exclusive execution permissions and passes cancellation to the shared session", async () => {
    const snapshot: BrowserPreviewSnapshot = {
      revision: 1,
      status: "ready",
      viewport: "desktop",
      url: "http://127.0.0.1:5173/",
      title: "Project",
      text: "- button Save",
      image: "private-image",
      errors: [],
      message: "",
    };
    const execute = vi.fn().mockResolvedValue(snapshot);
    const controller = new AbortController();
    const result = await tool.execute(
      { action: "click", selector: "#save" },
      {
        ...context,
        abortSignal: controller.signal,
        services: { browserPreview: { execute, reset: vi.fn() } },
      },
    );
    expect(execute).toHaveBeenCalledWith(
      { action: "click", selector: "#save" },
      controller.signal,
    );
    expect(result).toMatchObject({ ok: true, data: { text: "- button Save" } });
    expect(result.data).not.toHaveProperty("image");
    expect(tool.risk).toBe("execute");
    expect(tool.execution.concurrency).toBe("exclusive");
  });
  it("returns bounded runtime failures as tool errors", async () => {
    const result = await tool.execute(
      { action: "snapshot" },
      {
        ...context,
        services: {
          browserPreview: {
            execute: vi.fn().mockRejectedValue(new Error("Preview stopped")),
            reset: vi.fn(),
          },
        },
      },
    );
    expect(result).toEqual({ ok: false, error: "Preview stopped" });
  });
});
