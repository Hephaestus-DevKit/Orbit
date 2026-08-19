/**
 * Headless screenshot set for WebUI design review: light/dark, desktop and
 * mobile, inspector and palette states. Usage:
 *   pnpm webui:shots "<preview url with #token>" [outDir]
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const url = process.argv[2];
if (!url) {
  console.error("Usage: node screenshots.mjs <preview-url> [outDir]");
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[3] ?? resolve(join(here, ".shots"));
mkdirSync(outDir, { recursive: true });

const browserChannel =
  process.env.ORBIT_E2E_BROWSER_CHANNEL ??
  (process.platform === "win32" ? "msedge" : "chrome");
let browser;
try {
  browser = await chromium.launch({ channel: browserChannel });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(
    `Unable to launch the ${browserChannel} channel for WebUI screenshots. ` +
      `Set ORBIT_E2E_BROWSER_CHANNEL to an installed Chrome-compatible browser.\n${message}`,
  );
}

async function shoot(
  name,
  { width = 1440, height = 900, dark = false, setup } = {},
) {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: dark ? "dark" : "light",
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  if (setup) await setup(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  await context.close();
  console.log(`SHOT ${name}`);
}

await shoot("desktop-light");
await shoot("desktop-dark", { dark: true });
await shoot("mobile-light", { width: 390, height: 844 });
await shoot("mobile-dark", { width: 390, height: 844, dark: true });
await shoot("inspector-changes", {
  setup: async (page) => {
    await page.click("#changesButton").catch(() => {});
    await page.waitForTimeout(400);
    const card = page.locator(".change-card summary").first();
    if (await card.count()) await card.click().catch(() => {});
  },
});
await shoot("inspector-changes-dark", {
  dark: true,
  setup: async (page) => {
    await page.click("#changesButton").catch(() => {});
    await page.waitForTimeout(400);
    const card = page.locator(".change-card summary").first();
    if (await card.count()) await card.click().catch(() => {});
  },
});
await shoot("palette", {
  setup: async (page) => {
    await page.keyboard.press("Control+k").catch(() => {});
    await page.waitForTimeout(300);
    if (!(await page.locator("#commandPalette:not([hidden])").count())) {
      await page.click("#commandTrigger").catch(() => {});
    }
  },
});

await browser.close();
console.log("DONE");
