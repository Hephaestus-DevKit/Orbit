import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../packages/config/src/defaults.js";
import type { BrowserPreviewRuntime } from "../packages/cli/src/runtime/browser/BrowserPreviewRuntime.js";
import {
  startOrbitWebUi,
  stopOrbitWebUi,
} from "../packages/cli/src/runtime/webui/WebUiServer.js";

for (const language of ["en", "zh", "zh-TW"] as const) {
  test(`browser canvas explains the first-frame transition in ${language}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const cwd = mkdtempSync(join(tmpdir(), "orbit-browser-stage-"));
    let requested!: () => void;
    let release!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      requested = resolve;
    });
    const responseGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const site = createServer(async (req, res) => {
      if (req.url === "/slow") {
        requested();
        await responseGate;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(
          "<!doctype html><title>Ready website</title><h1>Page ready</h1>",
        );
      } else {
        res.writeHead(204);
        res.end();
      }
    });
    await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
    const address = site.address();
    if (!address || typeof address === "string")
      throw new Error("No fixture port");
    const config = structuredClone(DEFAULT_CONFIG);
    config.language = language;
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    let handle: Awaited<ReturnType<typeof startOrbitWebUi>> | undefined;
    let runtime!: BrowserPreviewRuntime;
    let releaseClose: (() => void) | undefined;
    try {
      handle = await startOrbitWebUi({
        cwd,
        config,
        port: 0,
        open: false,
        loop: {
          getSessionId: () => "browser-stage-test",
          setBrowserPreviewService: (service) => {
            if (service) runtime = service as BrowserPreviewRuntime;
          },
        },
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(handle.url);
      await page.locator("#browserPreviewButton").click();
      const placeholder = page.locator("#browserPreviewEmpty");
      await expect(placeholder).toHaveAttribute("data-state", "idle");
      await expect(placeholder).toBeVisible();
      await page
        .locator("#prompt")
        .fill("Keep this draft while the site opens.");
      await page
        .locator("#browserPreviewUrl")
        .fill(`http://127.0.0.1:${address.port}/slow`);
      await page.locator("#browserPreviewStart").click();
      await requestStarted;
      await expect(placeholder).toHaveAttribute("data-state", "opening");
      await expect(placeholder).toBeVisible();
      await expect(page.locator(".browser-preview-empty-note")).toBeHidden();
      await expect(page.locator("#browserPreviewWorking")).toBeHidden();
      await page.screenshot({
        path: testInfo.outputPath(`opening-${language}.png`),
      });

      release();
      await expect(page.locator("#browserPreviewImage")).toBeVisible();
      await expect(placeholder).toBeHidden();
      await expect(page.locator("#prompt")).toHaveValue(
        "Keep this draft while the site opens.",
      );
      await page.setViewportSize({ width: 1100, height: 760 });
      await page.emulateMedia({ colorScheme: "dark" });
      await expect
        .poll(async () => {
          const live = await runtime.live.read();
          const size = await page.locator("#browserPreviewStage").boundingBox();
          return Boolean(
            size &&
            Math.abs(size.width - live.width) < 2 &&
            Math.abs(size.height - live.height) < 2 &&
            !live.busy,
          );
        })
        .toBe(true);
      const closeGate = new Promise<void>((resolve) => {
        releaseClose = resolve;
      });
      const delayClose = async (route: import("@playwright/test").Route) => {
        if (route.request().method() !== "POST") return route.continue();
        const body = route.request().postDataJSON() as { action?: string };
        if (body.action !== "disconnect") return route.continue();
        await closeGate;
        await route.continue();
      };
      await page.route("**/api/browser-preview", delayClose);
      await page.locator("#browserPreviewStop").click();
      await expect(placeholder).toHaveAttribute("data-state", "closing");
      await expect(page.locator("#browserPreviewStop")).toBeDisabled();
      await expect(page.locator("#browserPreviewStatus")).toHaveText(
        language === "en" ? "Closing" : language === "zh" ? "关闭中" : "關閉中",
      );
      await page.screenshot({
        path: testInfo.outputPath(`closing-${language}-dark.png`),
      });
      releaseClose();
      await expect(placeholder).toHaveAttribute("data-state", "idle", {
        timeout: 15_000,
      });
      await page.unroute("**/api/browser-preview", delayClose);
      await expect(placeholder).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`idle-${language}-dark.png`),
      });
      const pollRoute = async (route: import("@playwright/test").Route) => {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "Fixture connection unavailable" }),
        });
      };
      await page.route("**/api/browser-preview?mode=live*", pollRoute);
      await expect(placeholder).toHaveAttribute("data-state", "disconnected");
      await expect(page.locator("#browserPreviewNotice")).toBeVisible();
      await expect(page.locator(".browser-preview-empty-note")).toBeHidden();
      await page.screenshot({
        path: testInfo.outputPath(`disconnected-${language}-dark.png`),
      });
      await page.unroute("**/api/browser-preview?mode=live*", pollRoute);
      await page.locator("#browserPreviewRetry").click();
      await expect(placeholder).toHaveAttribute("data-state", "idle");
      const failedOpen = async (route: import("@playwright/test").Route) => {
        if (route.request().method() !== "POST") return route.continue();
        const body = route.request().postDataJSON() as { action?: string };
        if (body.action !== "open") return route.continue();
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, message: "Fixture open failed" }),
        });
      };
      await page.route("**/api/browser-preview", failedOpen);
      await page
        .locator("#browserPreviewUrl")
        .fill(`http://127.0.0.1:${address.port}/slow`);
      await page.locator("#browserPreviewStart").click();
      await expect(placeholder).toHaveAttribute("data-state", "error");
      await expect(page.locator("#browserPreviewNotice")).toBeVisible();
      await expect(page.locator(".browser-preview-empty-note")).toBeHidden();
      await page.screenshot({
        path: testInfo.outputPath(`error-${language}-dark.png`),
      });
      await page.unroute("**/api/browser-preview", failedOpen);
      await page.locator("#browserPreviewRetry").click();
      await expect(page.locator("#browserPreviewImage")).toBeVisible();
      await expect(page.locator("#prompt")).toHaveValue(
        "Keep this draft while the site opens.",
      );
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      expect(errors).toHaveLength(2);
      expect(errors.some((message) => message.includes("503"))).toBe(true);
      expect(errors.some((message) => message.includes("400"))).toBe(true);
    } finally {
      release();
      releaseClose?.();
      if (handle) await stopOrbitWebUi();
      await new Promise<void>((resolve) => site.close(() => resolve()));
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}
