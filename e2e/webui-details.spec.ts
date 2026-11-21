import { navigateTab } from "./safari-keyboard.js";
import { expect, test } from "@playwright/test";
import { DEFAULT_CONFIG } from "../packages/config/src/defaults.js";
import { startOrbitWebUi, stopOrbitWebUi } from "../packages/cli/src/runtime/webui/WebUiServer.js";

for (const language of ["en", "zh", "zh-TW"] as const) {
  test(`keeps navigation titles and composer controls readable in ${language}`, async ({
    page,
    browser,
  }, testInfo) => {
    const errors: string[] = [];
    const actions: string[] = [];
    const title = "Review the authentication flow";
    const config = { ...structuredClone(DEFAULT_CONFIG), language };
    const handle = await startOrbitWebUi({
      cwd: process.cwd(),
      config,
      port: 0,
      open: false,
      loop: {
        getSessionId: () => "active",
        getHistory: () => [
          {
            id: "ready",
            role: "assistant",
            content: [{ type: "text", text: "Ready for a new task." }],
          },
        ],
        getSessions: () =>
          ["active", "previous"].map((id) => ({
            id,
            title,
            model: "deepseek-flash",
            updatedAt: new Date().toISOString(),
          })),
      },
      updateSession: async (action) => {
        actions.push(action.action);
        return { ok: true };
      },
    });
    const touchContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    try {
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(handle.url);
      await expect(page.locator("#connectionState")).toHaveClass(
        /is-connected/,
      );
      const previous = page.locator(
        '.recent-session[data-session-id="previous"]',
      );
      await expect(previous).toHaveAttribute("title", title);
      const activeTitle = await page
        .locator(".session-row.is-active .recent-session-title")
        .boundingBox();
      const previousTitle = await previous
        .locator(".recent-session-title")
        .boundingBox();
      expect(activeTitle).not.toBeNull();
      expect(previousTitle).not.toBeNull();
      expect(Math.abs(activeTitle!.width - previousTitle!.width)).toBeLessThan(
        1,
      );
      const archive = page.locator(
        '[data-session-action="archive"][data-session-id="previous"]',
      );
      await previous.focus();
      await navigateTab(page);
      await expect(archive).toBeFocused();
      await expect(archive.locator("..")).toHaveCSS("opacity", "1");
      const actionBox = await archive.boundingBox();
      expect(actionBox!.y).toBeGreaterThanOrEqual(
        previousTitle!.y + previousTitle!.height,
      );
      await page.keyboard.press("Enter");
      await expect.poll(() => actions).toEqual(["archive"]);

      const touchPage = await touchContext.newPage();
      touchPage.on("pageerror", (error) => errors.push(error.message));
      await touchPage.goto(handle.url);
      await expect(touchPage.locator("#connectionState")).toHaveClass(
        /is-connected/,
      );
      const automatic = language === "en"
        ? "Automatic"
        : language === "zh"
        ? "自动选择"
        : "自動選擇";
      for (const width of [390, 320, 600]) {
        await touchPage.setViewportSize({ width, height: 844 });
        await touchPage.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            ),
        );
        await expect(
          touchPage.locator("#modelSelectTrigger .select-value"),
        ).toHaveText(automatic);
        await expect(
          touchPage.locator("#providerSelectTrigger .select-value"),
        ).not.toContainText(" · ");
        for (const id of [
          "contextPickerButton",
          "attachmentButton",
          "searchToggle",
          "permissionSelectTrigger",
        ]) {
          const control = touchPage.locator(`#${id}`);
          await expect(control).toBeVisible();
          const label = control
            .locator("span")
            .filter({ hasText: /\S/ })
            .first();
          await expect(label).toBeVisible();
          const box = await control.boundingBox();
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width);
          expect(box!.height).toBeGreaterThanOrEqual(width <= 560 ? 40 : 29);
          expect(
            await label.evaluate(
              (node) => node.scrollWidth <= node.clientWidth,
            ),
          ).toBe(true);
        }
        for (const id of [
          "menuButton",
          "connectionState",
          "tasksButton",
        ]) {
          const control = touchPage.locator(`#${id}`);
          const box = await control.boundingBox();
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width);
          expect(
            await control.evaluate((node) => {
              const rect = node.getBoundingClientRect();
              return node.contains(
                document.elementFromPoint(
                  rect.x + rect.width / 2,
                  rect.y + rect.height / 2,
                ),
              );
            }),
          ).toBe(true);
        }
        expect(
          await touchPage
            .locator(".composer")
            .evaluate((node) => node.scrollWidth <= node.clientWidth),
        ).toBe(true);
        await touchPage.locator("#modelSelectTrigger").focus();
        await touchPage.keyboard.press("ArrowDown");
        const autoOption = touchPage.locator(
          '#modelSelectMenu [data-value="__auto__"]',
        );
        await expect(autoOption).toBeFocused();
        await expect(autoOption).toContainText("deepseek-flash");
        await touchPage.keyboard.press("Escape");
        await expect(touchPage.locator("#modelSelectTrigger")).toBeFocused();
        await touchPage.screenshot({
          path: testInfo.outputPath(`${language}-${width}.png`),
        });
      }
      await touchPage.locator("#menuButton").click();
      const touchArchive = touchPage.locator(
        '[data-session-action="archive"][data-session-id="previous"]',
      );
      await expect(touchArchive.locator("..")).toHaveCSS("opacity", "1");
      const touchBox = await touchArchive.boundingBox();
      expect(Math.round(touchBox!.width * 100) / 100).toBeGreaterThanOrEqual(32);
      expect(Math.round(touchBox!.height * 100) / 100).toBeGreaterThanOrEqual(32);
      await touchArchive.tap();
      await expect.poll(() => actions).toEqual(["archive", "archive"]);
      expect(errors).toEqual([]);
    } finally {
      await touchContext.close();
      await page.close();
      await stopOrbitWebUi(handle.id);
    }
  });
}

test("switches drafts and in-flight images with the active chat", async ({ page }) => {
  let active = "first";
  let finishSwitch = () => {};
  const switching = new Promise<void>(resolve => {
    finishSwitch = resolve;
  });
  const handle = await startOrbitWebUi({
    cwd: process.cwd(),
    config: structuredClone(DEFAULT_CONFIG),
    port: 0,
    open: false,
    loop: {
      getSessionId: () => active,
      getHistory: () => [],
      getSessions: () => ["first", "second"].map(id => ({
        id,
        title: id,
        model: "deepseek-flash",
        updatedAt: new Date().toISOString(),
      })),
    },
    updateSession: async action => {
      await switching;
      if (action.action === "resume") active = action.sessionId;
      return { ok: true };
    },
  });
  let releaseUpload = () => {};
  const waitForRelease = new Promise<void>(resolve => {
    releaseUpload = resolve;
  });
  try {
    await page.exposeFunction("holdUploadAck", () => waitForRelease);
    await page.addInitScript(() => {
      const fetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const response = await fetch(...args);
        if (response.url.includes("/api/attachment?name=first.png")) {
          await (window as Window & { holdUploadAck?: () => Promise<void> }).holdUploadAck?.();
        }
        return response;
      };
    });
    await page.goto(handle.url);
    await expect(page.locator("#connectionState")).toHaveClass(/is-connected/);
    const prompt = page.locator("#prompt");
    await prompt.fill("First chat notes");
    const upload = page.waitForResponse("**/api/attachment?name=first.png");
    await page.getByTestId("attachment-input").setInputFiles({
      name: "first.png",
      mimeType: "image/png",
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    expect((await upload).ok()).toBe(true);
    await page.locator('.recent-session[data-session-id="second"]').click();
    await expect(page.locator("#sendButton")).toBeDisabled();
    await prompt.press("Enter");
    finishSwitch();
    await expect(prompt).toHaveValue("");
    await prompt.fill("Second chat notes");
    releaseUpload();
    await expect(page.locator("#attachmentShelf")).toBeHidden();
    await page.locator('.recent-session[data-session-id="first"]').click();
    await expect(prompt).toHaveValue("First chat notes");
    await expect(page.locator(".attachment-card")).toContainText("first.png");
    await page.reload();
    await expect(prompt).toHaveValue("First chat notes");
    await page.locator('.recent-session[data-session-id="second"]').click();
    await expect(prompt).toHaveValue("Second chat notes");
  } finally {
    finishSwitch();
    releaseUpload();
    await stopOrbitWebUi();
  }
});
