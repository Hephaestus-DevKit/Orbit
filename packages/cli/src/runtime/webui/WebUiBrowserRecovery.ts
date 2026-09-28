import type { BrowserLiveAction } from "../browser/BrowserLiveContracts.js";

interface FailedBrowserAction {
  action: string;
  pageId?: string;
  address?: string;
  searchEngine?: "bing" | "google" | "baidu" | "duckduckgo";
}

/** A replayed navigation must not replace an independently edited address draft. */
export function browserPreservesAddressDraft(
  request: FailedBrowserAction,
  draft: string,
  dirty: boolean,
): boolean {
  return request.action === "open" && dirty && draft.trim() !== request.address;
}

/** Only offer a repeatable operation, never an unsent omnibox draft or page mutation. */
export function browserRetryRequest(
  failure: FailedBrowserAction | null | undefined,
  page: { active: boolean; pageId: string } | null | undefined,
):
  | Extract<
      BrowserLiveAction,
      { action: "open" | "read-page" | "copy-selection" }
    >
  | { action: "reload" }
  | undefined {
  if (!failure) return;
  if (failure.action === "open" && failure.address)
    return {
      action: "open",
      address: failure.address,
      ...(failure.searchEngine ? { searchEngine: failure.searchEngine } : {}),
    };
  if (!page?.active || !failure.pageId || failure.pageId !== page.pageId)
    return;
  if (failure.action === "read-page")
    return { action: "read-page", pageId: failure.pageId };
  if (failure.action === "copy-selection") return { action: "copy-selection" };
  if (failure.action === "reload") return { action: "reload" };
}

/** An idle reminder is an overlay: showing it must not resize or renew the page. */
export function browserIdleNotice(
  page:
    | {
        active: boolean;
        idleExpiresAt?: number;
        closedReason?: "idle";
      }
    | null
    | undefined,
  now: number,
): "expiring" | "closed" | undefined {
  if (!page) return;
  if (!page.active) return page.closedReason === "idle" ? "closed" : undefined;
  if (
    page.idleExpiresAt !== undefined &&
    Number.isFinite(page.idleExpiresAt) &&
    page.idleExpiresAt - now <= 120_000
  )
    return "expiring";
}
