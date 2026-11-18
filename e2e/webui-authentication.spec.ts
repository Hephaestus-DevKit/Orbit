import { expect, test } from "@playwright/test";
import { DEFAULT_CONFIG } from "../packages/config/src/defaults.js";
import { openAuthenticatedWebUi } from "../packages/cli/src/runtime/webui/WebUiBrowserLauncher.js";
import { startOrbitWebUi, stopOrbitWebUi } from "../packages/cli/src/runtime/webui/WebUiServer.js";

test("recovers an unauthenticated page through the complete browser launch URL", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const handle = await startOrbitWebUi({
    cwd: process.cwd(),
    config: DEFAULT_CONFIG,
    port: 0,
    loop: { getHistory: () => [], getSessionId: () => "browser-launch-test" },
  });
  const root = new URL("/", handle.url).href;
  try {
    await page.goto(root);
    await expect(page.locator("#connectionState")).toHaveClass(
      /is-disconnected/,
    );
    await expect(page.locator('.toast[role="alert"]')).toContainText(
      "/webui --open",
    );

    const launch = () =>
      openAuthenticatedWebUi(handle.url, {
        platform: "darwin",
        execute: async (_executable, args) => {
          await page.goto(args[0]);
        },
      });
    expect(await launch()).toBe(true);
    await expect(page.locator("#connectionState")).toHaveClass(/is-connected/);
    expect(page.url()).toBe(root);
    await expect(page.locator('.toast[role="alert"]')).toHaveCount(0);
    await page.getByTestId("composer-input").fill("Browser launch recovered");

    // Stale cookies and a stale cached token must not override the fresh
    // authenticated URL delivered by /webui --open.
    await page.context().clearCookies();
    await page.evaluate(() => {
      sessionStorage.setItem("orbit.webui.bootstrap-token", "x".repeat(43));
    });
    await page.goto(root);
    await expect(page.locator("#connectionState")).toHaveClass(
      /is-disconnected/,
    );
    expect(await launch()).toBe(true);
    await expect(page.locator("#connectionState")).toHaveClass(/is-connected/);
    await expect(page.getByTestId("composer-input")).toHaveValue(
      "Browser launch recovered",
    );
    await expect(page.getByTestId("composer-send")).toBeEnabled();
    await page.screenshot({
      path: testInfo.outputPath("authenticated-desktop.png"),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("composer-input")).toBeVisible();
    await expect(page.getByTestId("composer-send")).toBeEnabled();
    await expect
      .poll(async () => {
        const box = await page.getByTestId("composer-input").boundingBox();
        return Boolean(box && box.x >= 0 && box.x + box.width <= 391);
      })
      .toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("authenticated-narrow.png"),
      animations: "disabled",
    });
    expect(errors).toEqual([]);
  } finally {
    await stopOrbitWebUi();
  }
});
