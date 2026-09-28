import { describe, expect, it } from "vitest";
import {
  browserIdleNotice,
  browserPreservesAddressDraft,
  browserRetryRequest,
} from "./WebUiBrowserRecovery.js";

describe("explicit browser recovery", () => {
  const page = { active: true, pageId: "current" };
  it("preserves a later draft only when opening a different submitted address", () => {
    const request = { action: "open", address: "submitted query" };
    expect(browserPreservesAddressDraft(request, "later query", true)).toBe(
      true,
    );
    expect(browserPreservesAddressDraft(request, "", true)).toBe(true);
    expect(browserPreservesAddressDraft(request, "later query", false)).toBe(
      false,
    );
    expect(
      browserPreservesAddressDraft(request, " submitted query ", true),
    ).toBe(false);
    expect(
      browserPreservesAddressDraft({ action: "tab" }, "later query", true),
    ).toBe(false);
  });
  it("retains the submitted address and provider, not a later draft", () => {
    expect(
      browserRetryRequest(
        { action: "open", address: "original query", searchEngine: "baidu" },
        page,
      ),
    ).toEqual({
      action: "open",
      address: "original query",
      searchEngine: "baidu",
    });
  });
  it("retries an outline only on its original page", () => {
    expect(
      browserRetryRequest({ action: "read-page", pageId: "current" }, page),
    ).toEqual({ action: "read-page", pageId: "current" });
    expect(
      browserRetryRequest({ action: "read-page", pageId: "old" }, page),
    ).toBeUndefined();
    expect(
      browserRetryRequest(
        { action: "read-page", pageId: "current" },
        { ...page, active: false },
      ),
    ).toBeUndefined();
  });
  it("bounds copy and reload recovery to the original page", () => {
    expect(
      browserRetryRequest(
        { action: "copy-selection", pageId: "current" },
        page,
      ),
    ).toEqual({ action: "copy-selection" });
    expect(
      browserRetryRequest({ action: "reload", pageId: "current" }, page),
    ).toEqual({ action: "reload" });
    expect(
      browserRetryRequest({ action: "reload", pageId: "old" }, page),
    ).toBeUndefined();
  });
  it.each([
    "input",
    "control",
    "dialog",
    "tab",
    "history",
    "resize",
    "keep-alive",
  ])("does not replay %s after an uncertain failure", (action) => {
    expect(
      browserRetryRequest({ action, pageId: "current" }, page),
    ).toBeUndefined();
  });
  it("reminds only in the last two minutes and identifies idle cleanup", () => {
    expect(
      browserIdleNotice({ active: true, idleExpiresAt: 120_001 }, 0),
    ).toBeUndefined();
    expect(browserIdleNotice({ active: true, idleExpiresAt: 120_000 }, 0)).toBe(
      "expiring",
    );
    expect(
      browserIdleNotice({ active: true, idleExpiresAt: Number.NaN }, 0),
    ).toBeUndefined();
    expect(browserIdleNotice({ active: false, closedReason: "idle" }, 0)).toBe(
      "closed",
    );
    expect(browserIdleNotice({ active: false }, 0)).toBeUndefined();
    expect(browserIdleNotice(null, 0)).toBeUndefined();
  });
});
