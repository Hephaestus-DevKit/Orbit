import type { Page } from "@playwright/test";

/** macOS Safari uses Option-Tab to include all controls in keyboard navigation. */
export function navigateTab(page: Page, reverse = false) {
  const webkit = page.context().browser()?.browserType().name() === "webkit";
  const modifier = webkit && process.platform === "darwin" ? "Alt+" : "";
  return page.keyboard.press(modifier + (reverse ? "Shift+Tab" : "Tab"));
}
