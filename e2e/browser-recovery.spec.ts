import { test, expect, type Page } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../packages/config/src/defaults.js";
import {
  startOrbitWebUi,
  stopOrbitWebUi,
} from "../packages/cli/src/runtime/webui/WebUiServer.js";
import { BrowserPreviewRuntime } from "../packages/cli/src/runtime/browser/BrowserPreviewRuntime.js";

async function expectIdleActionExposed(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.locator("#browserIdleAction").evaluate((button) => {
        const box = button.getBoundingClientRect();
        return button.contains(
          document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          ),
        );
      }),
    )
    .toBe(true);
}

async function settleViewport(
  page: Page,
  runtime: BrowserPreviewRuntime,
): Promise<void> {
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
}

for (const language of ["en", "zh", "zh-TW"] as const) {
  test(`explicit recovery and idle lifecycle in ${language}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const cwd = mkdtempSync(join(tmpdir(), "orbit-browser-recovery-"));
    let visits = 0;
    const site = createServer((_req, res) => {
      visits++;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        '<title>Recovery fixture</title><h1>Keep this page</h1><input aria-label="Page draft" value="unsent page value">' +
          Array.from(
            { length: 70 },
            (_, index) =>
              `<p>Reading section ${index + 1}: Preserve this page and its reading position.</p>`,
          ).join(""),
      );
    });
    await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
    const address = site.address();
    if (!address || typeof address === "string")
      throw new Error("No fixture address");
    const url = `http://127.0.0.1:${address.port}`;
    let runtime!: BrowserPreviewRuntime;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const actions: Array<{ action: string; address?: string }> = [];
    let failRead = true,
      failReload = false,
      failOpen = false,
      expiring = false,
      forceBusy = false;
    let releaseResize: (() => void) | undefined;
    try {
      const handle = await startOrbitWebUi({
        cwd,
        config: { ...structuredClone(DEFAULT_CONFIG), language },
        port: 0,
        open: false,
        loop: {
          getSessionId: () => "browser-recovery",
          setBrowserPreviewService: (service) => {
            if (service) runtime = service as BrowserPreviewRuntime;
          },
        },
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(handle.url);
      await page.locator("#prompt").fill("Keep this chat draft");
      await page.locator("#browserPreviewButton").click();
      await page.locator("#browserPreviewUrl").fill(url);
      await page.locator("#browserPreviewStart").click();
      await expect(page.locator("#browserPreviewImage")).toBeVisible();
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
      await page.route("**/api/browser-preview", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        const body = route.request().postDataJSON() as {
          action: string;
          address?: string;
        };
        actions.push({
          action: body.action,
          ...(body.address ? { address: body.address } : {}),
        });
        if (
          (body.action === "read-page" && failRead) ||
          (body.action === "reload" && failReload) ||
          (body.action === "open" && failOpen)
        ) {
          failRead = false;
          failReload = false;
          failOpen = false;
          return route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
              ok: false,
              message: "Fixture action failed",
            }),
          });
        }
        if (body.action === "keep-alive") expiring = false;
        return route.continue();
      });
      await page
        .locator("#browserPreviewUrl")
        .fill("Unsubmitted private search draft");
      await page.locator("#browserPageActions").click();
      await page.locator("#browserReadPage").click();
      await expect(page.locator("#browserPreviewNotice")).toBeVisible();
      await page.locator("#browserPreviewRetry").click();
      await expect(page.locator("#browserPageReaderText")).toContainText(
        "Keep this page",
      );
      expect(
        actions.filter((action) => action.action === "read-page"),
      ).toHaveLength(2);
      expect(actions.some((action) => action.action === "open")).toBe(false);
      await expect(page.locator("#browserPreviewUrl")).toHaveValue(
        "Unsubmitted private search draft",
      );
      await page.locator("#browserPageReaderClose").click();
      await page.locator("#browserPageActions").click();
      await page.keyboard.press("Tab");
      await expect(page.locator("#browserPageContextMenu")).toBeHidden();
      await expect(page.locator("#browserPreviewStage")).toBeFocused();
      await expect(page.locator("#workbench")).toBeVisible();
      await page.locator("#browserPageActions").click();
      await page.keyboard.press("Shift+Tab");
      await expect(page.locator("#browserPageActions")).toBeFocused();
      await expect(page.locator("#browserPageContextMenu")).toBeHidden();
      await page.locator("#browserPageActions").click();
      await page.keyboard.press("Escape");
      await expect(page.locator("#browserPageActions")).toBeFocused();
      await expect(page.locator("#workbench")).toBeVisible();
      await page.locator("#browserPageActions").click();
      await page.locator("#browserPreviewStop").focus();
      await expect(page.locator("#browserPageContextMenu")).toBeHidden();

      failReload = true;
      await page.locator("#browserPreviewReload").click();
      await expect(page.locator("#browserPreviewNotice")).toBeVisible();
      await page.locator("#browserPreviewRetry").click();
      await expect(page.locator("#browserPreviewNotice")).toBeHidden();
      expect(
        actions.filter((action) => action.action === "reload"),
      ).toHaveLength(2);
      expect(actions.some((action) => action.action === "open")).toBe(false);
      await expect(page.locator("#browserPreviewUrl")).toHaveValue(
        "Unsubmitted private search draft",
      );

      failOpen = true;
      await page.locator("#browserPreviewUrl").fill(url + "/submitted");
      await page.locator("#browserPreviewStart").click();
      await expect(page.locator("#browserPreviewNotice")).toBeVisible();
      await page.locator("#browserPreviewUrl").fill("Another unsent draft");
      const recoveredOpen = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/api/browser-preview") &&
          response.request().postDataJSON()?.action === "open" &&
          response.ok(),
      );
      await page.locator("#browserPreviewRetry").click();
      await recoveredOpen;
      await expect(page.locator("#browserPreviewUrl")).toBeEnabled();
      await expect(page.locator("#browserPreviewNotice")).toBeHidden();
      expect(actions.filter((action) => action.action === "open")).toEqual([
        { action: "open", address: url + "/submitted" },
        { action: "open", address: url + "/submitted" },
      ]);
      await expect(page.locator("#browserPreviewUrl")).toHaveValue(
        "Another unsent draft",
      );
      await page.locator("#browserPreviewUrl").fill("Keep this address draft");
      await settleViewport(page, runtime);
      const stageBefore = await page
        .locator("#browserPreviewStage")
        .boundingBox();
      const stateBefore = await runtime.live.read();
      const visitsBefore = visits;
      const resizeCount = actions.filter(
        (action) => action.action === "resize",
      ).length;
      await page.route(
        "**/api/browser-preview?mode=live&after=*",
        async (route) => {
          const response = await route.fetch();
          const body = await response.json();
          if (!body.browser) return route.fulfill({ response });
          if (expiring && body.browser.active)
            body.browser.idleExpiresAt = Date.now() + 60_000;
          if (forceBusy) body.browser.busy = true;
          await route.fulfill({ response, json: body });
        },
      );
      expiring = true;
      await expect(page.locator("#browserIdleNotice")).toBeVisible();
      await expect(page.locator("#browserIdleAction")).toHaveText(
        language === "en"
          ? "Keep open"
          : language === "zh"
            ? "继续保留"
            : "繼續保留",
      );
      await page.screenshot({
        path: testInfo.outputPath(`idle-${language}-desktop.png`),
        animations: "disabled",
      });
      expect(await page.locator("#browserPreviewStage").boundingBox()).toEqual(
        stageBefore,
      );
      expect(
        actions.filter((action) => action.action === "resize"),
      ).toHaveLength(resizeCount);
      expect(actions.some((action) => action.action === "keep-alive")).toBe(
        false,
      );
      forceBusy = true;
      await expect(page.locator("#browserIdleNotice")).toBeHidden();
      forceBusy = false;
      await expect(page.locator("#browserIdleNotice")).toBeVisible();
      await page.locator("#browserIdleAction").focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#browserIdleNotice")).toBeHidden();
      await expect(page.locator("#browserPreviewStage")).toBeFocused();
      await expect
        .poll(async () => (await runtime.live.read()).idleExpiresAt ?? 0)
        .toBeGreaterThan(stateBefore.idleExpiresAt!);
      expect(visits).toBe(visitsBefore);
      expect((await runtime.live.read()).tabs).toEqual(stateBefore.tabs);
      await expect(page.locator("#browserPreviewUrl")).toHaveValue(
        "Keep this address draft",
      );
      expect(
        actions.filter((action) => action.action === "keep-alive"),
      ).toHaveLength(1);

      await page.locator("#browserPageActions").click();
      await page.locator("#browserReadPage").click();
      await expect(page.locator("#browserPageReaderText")).toContainText(
        "Keep this page",
      );
      await page.locator("#browserPageReaderText").focus();
      await page.keyboard.press("PageDown");
      await expect
        .poll(() =>
          page
            .locator("#browserPageReaderText")
            .evaluate((node) => node.scrollTop),
        )
        .toBeGreaterThan(0);
      let readingPosition = -1,
        stableScrollSamples = 0;
      await expect
        .poll(
          async () => {
            const position = await page
              .locator("#browserPageReaderText")
              .evaluate((node) => node.scrollTop);
            stableScrollSamples =
              position === readingPosition ? stableScrollSamples + 1 : 0;
            readingPosition = position;
            return stableScrollSamples;
          },
          { intervals: [100] },
        )
        .toBeGreaterThanOrEqual(3);
      expiring = true;
      await expect(page.locator("#browserIdleNotice")).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`idle-${language}-reader.png`),
        animations: "disabled",
      });
      await expectIdleActionExposed(page);
      const readerStage = await page
        .locator("#browserPreviewStage")
        .boundingBox();
      const readerPage = await runtime.live.read();
      const readerResizes = actions.filter(
        (action) => action.action === "resize",
      ).length;
      await page.locator("#browserIdleAction").focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#browserIdleNotice")).toBeHidden();
      await expect(page.locator("#browserPageReaderText")).toBeFocused();
      await expect(page.locator("#browserPageReaderText")).toContainText(
        "Keep this page",
      );
      expect(
        await page
          .locator("#browserPageReaderText")
          .evaluate((node) => node.scrollTop),
      ).toBe(readingPosition);
      expect(await page.locator("#browserPreviewStage").boundingBox()).toEqual(
        readerStage,
      );
      expect((await runtime.live.read()).pageId).toBe(readerPage.pageId);
      expect(
        actions.filter((action) => action.action === "resize"),
      ).toHaveLength(readerResizes);
      expect(
        actions.filter((action) => action.action === "keep-alive"),
      ).toHaveLength(2);
      await page.locator("#browserPageReaderClose").click();

      await page.locator("#browserPreviewFocus").click();
      await settleViewport(page, runtime);
      await page.locator("#browserPageActions").click();
      await page.locator("#browserReadPage").click();
      await expect(page.locator("#browserPageReaderText")).toContainText(
        "Reading section 70",
      );
      expiring = true;
      await expect(page.locator("#browserIdleNotice")).toBeVisible();
      await expectIdleActionExposed(page);
      const dockedBounds = await page.evaluate(() => ({
        stageRight: document
          .getElementById("browserPreviewStage")!
          .getBoundingClientRect().right,
        readerLeft: document
          .getElementById("browserPageReader")!
          .getBoundingClientRect().left,
      }));
      expect(dockedBounds.stageRight).toBeLessThan(dockedBounds.readerLeft);
      await page.screenshot({
        path: testInfo.outputPath(`idle-${language}-reader-docked.png`),
        animations: "disabled",
      });
      await page.locator("#browserIdleAction").click();
      await expect(page.locator("#browserIdleNotice")).toBeHidden();
      await expect(page.locator("#browserPageReaderText")).toBeFocused();
      await page.locator("#browserPageReaderClose").click();
      await page.locator("#browserPreviewFocus").click();

      await page.setViewportSize({ width: 1100, height: 760 });
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
      expiring = true;
      await expect(page.locator("#browserIdleNotice")).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`idle-${language}-narrow.png`),
        animations: "disabled",
      });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.screenshot({
        path: testInfo.outputPath(`idle-${language}-dark.png`),
        animations: "disabled",
      });
      await page.locator("#browserPageActions").click();
      await page.locator("#browserReadPage").click();
      await expect(page.locator("#browserPageReaderText")).toContainText(
        "Reading section 70",
      );
      await expect(page.locator("#browserIdleNotice")).toBeVisible();
      await expectIdleActionExposed(page);
      await page.screenshot({
        path: testInfo.outputPath(`idle-${language}-reader-dark.png`),
        animations: "disabled",
      });
      await page.locator("#browserIdleAction").focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#browserIdleNotice")).toBeHidden();
      await expect(page.locator("#browserPageReaderText")).toBeFocused();
      await page.locator("#browserPageReaderClose").click();
      await settleViewport(page, runtime);
      let resizeRequested = false,
        holdResize = true;
      const resizeGate = new Promise<void>((resolve) => {
        releaseResize = resolve;
      });
      await page.route("**/api/browser-preview", async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        const action = route.request().postDataJSON() as { action: string };
        if (action.action !== "resize" || !holdResize) return route.fallback();
        holdResize = false;
        resizeRequested = true;
        await resizeGate;
        return route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, message: "Open a website first." }),
        });
      });
      await page.setViewportSize({ width: 1120, height: 780 });
      await expect.poll(() => resizeRequested).toBe(true);
      expiring = false;
      await runtime.live.reset("idle");
      await expect(page.locator("#browserIdleTitle")).toHaveText(
        language === "en"
          ? "Idle session closed"
          : language === "zh"
            ? "已因闲置关闭"
            : "已因閒置關閉",
      );
      await expect(page.locator("#browserIdleText")).toContainText(
        /cookies|Cookie/,
      );
      const lateResize = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/api/browser-preview") &&
          response.request().postDataJSON()?.action === "resize" &&
          response.status() === 400,
      );
      releaseResize?.();
      await lateResize;
      await expect(page.locator("#browserPreviewImage")).toBeHidden();
      await expect(page.locator("#browserPreviewNotice")).toBeHidden();
      await page.locator("#browserIdleAction").focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#browserPreviewUrl")).toBeFocused();
      await expect(page.locator("#browserPreviewUrl")).toHaveValue(
        "Keep this address draft",
      );
      await page.locator("#browserPreviewHide").click();
      await expect(page.locator("#prompt")).toHaveValue("Keep this chat draft");
      await page.locator("#browserPreviewButton").click();
      await expect(page.locator("#browserIdleNotice")).toBeVisible();
      await page.locator("#browserPreviewUrl").fill(url);
      await page.locator("#browserPreviewStart").click();
      await expect(page.locator("#browserPreviewImage")).toBeVisible();
      await expect(page.locator("#browserIdleNotice")).toBeHidden();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      ).toBe(false);
      expect(errors).toEqual([]);
    } finally {
      releaseResize?.();
      await page.unrouteAll({ behavior: "wait" });
      await stopOrbitWebUi();
      await new Promise<void>((resolve, reject) =>
        site.close((error) => (error ? reject(error) : resolve())),
      );
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}
