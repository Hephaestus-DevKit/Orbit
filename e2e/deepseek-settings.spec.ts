import { expect, test } from "@playwright/test";
import { DEFAULT_CONFIG } from "../packages/config/src/defaults.js";
import {
  startOrbitWebUi,
  stopOrbitWebUi,
} from "../packages/cli/src/runtime/webui/WebUiServer.js";

test("selects and restores the paid DeepSeek search backend across viewport sizes", async ({
  page,
}, testInfo) => {
  const config = structuredClone(DEFAULT_CONFIG);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const handle = await startOrbitWebUi({
    cwd: process.cwd(),
    config,
    port: 0,
    open: false,
    updateSettings: async (patch) => {
      if (patch.webSearchProvider)
        config.tools.webSearch.provider = patch.webSearchProvider;
      return { ok: true };
    },
  });
  try {
    await page.goto(handle.url);
    await expect(page.locator("#connectionState")).toHaveClass(/is-connected/);
    await page.keyboard.press("Control+,");
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.locator("#searchProviderTrigger").focus();
      await page.keyboard.press("ArrowDown");
      await page
        .locator("#searchProviderMenu")
        .getByRole("option", {
          name: "DeepSeek ($0.00075/search)",
          exact: true,
        })
        .click();
      await expect.poll(() => config.tools.webSearch.provider).toBe("deepseek");
      await expect(page.locator("#searchProviderTrigger")).toContainText(
        "DeepSeek",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`deepseek-settings-${width}.png`),
        animations: "disabled",
      });
      await page.locator("#searchProviderTrigger").click();
      await page
        .locator("#searchProviderMenu")
        .getByRole("option", { name: "Auto", exact: true })
        .click();
      await expect.poll(() => config.tools.webSearch.provider).toBe("auto");
    }
    expect(errors).toEqual([]);
  } finally {
    await stopOrbitWebUi();
  }
});
