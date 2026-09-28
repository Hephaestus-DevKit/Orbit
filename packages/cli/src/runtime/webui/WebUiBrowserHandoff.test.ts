import { describe, expect, it, vi } from "vitest";
import { bindBrowserPrompt } from "./WebUiBrowserHandoff.js";

describe("browser-bound WebUI prompts", () => {
  it("passes model-only browser context without changing the user's prompt", async () => {
    const release = vi.fn();
    const preview = { pinTabForTurn: vi.fn(() => release) };
    const submitPrompt = vi.fn(async () => ({ ok: true }));
    const execute = bindBrowserPrompt(
      {
        prompt: "What does this page say?",
        browserTabId: "attached-tab",
        browserTabUrl: "https://example.com/page",
      },
      [],
      submitPrompt,
      preview,
    );
    expect(preview.pinTabForTurn).toHaveBeenCalledWith(
      "attached-tab",
      "https://example.com/page",
    );
    expect(await execute()).toEqual({ ok: true });
    expect(submitPrompt).toHaveBeenCalledWith(
      "What does this page say?",
      [],
      expect.objectContaining({ browserAttached: true }),
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it("preserves plain prompts and releases a page when submission fails", async () => {
    const release = vi.fn();
    const preview = { pinTabForTurn: vi.fn(() => release) };
    const submitPrompt = vi.fn(async () => {
      throw new Error("Provider failed");
    });
    const plain = bindBrowserPrompt(
      { prompt: "Plain question" },
      [],
      async (prompt) => ({ ok: prompt === "Plain question" }),
      preview,
    );
    expect(await plain()).toEqual({ ok: true });
    expect(preview.pinTabForTurn).not.toHaveBeenCalled();
    const attached = bindBrowserPrompt(
      { prompt: "Inspect", browserTabId: "tab" },
      [],
      submitPrompt,
      preview,
    );
    await expect(attached()).rejects.toThrow("Provider failed");
    expect(release).toHaveBeenCalledOnce();
  });

  it("lets the initial run release its pin before queued work continues", async () => {
    const release = vi.fn();
    const preview = { pinTabForTurn: vi.fn(() => release) };
    const execute = bindBrowserPrompt(
      { prompt: "Inspect", browserTabId: "tab" },
      [],
      async (_prompt, _attachments, context) => {
        expect(release).not.toHaveBeenCalled();
        context?.onInitialRunComplete();
        expect(release).toHaveBeenCalledOnce();
        return { ok: true };
      },
      preview,
    );
    expect(await execute()).toEqual({ ok: true });
    expect(release).toHaveBeenCalledTimes(2);
  });
});
