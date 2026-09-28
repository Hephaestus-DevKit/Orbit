import { test, expect, type Locator, type Page } from "@playwright/test";
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

const fixture = `<!doctype html><title>Select fixture</title>
<style>body{font:16px system-ui;padding:24px}select{display:block;margin:12px 0;width:260px;height:44px}select[multiple]{height:112px}</style>
<h1>Native select fixture</h1><label for="choice">Appearance</label>
<select id="choice" aria-label="Appearance"><optgroup label="Theme"><option value="private-light-value">Light option</option><option value="private-dark-value">Dark option</option><option disabled value="private-disabled-value">Disabled option</option></optgroup></select>
<p id="result">Unchanged</p><p id="events">0</p><iframe src="/embedded" title="Embedded selector" style="display:block;width:350px;height:130px;border:0"></iframe>
<label for="multi">Select several</label><select id="multi" multiple size="4"><option value="alpha">Alpha</option><option value="beta">Beta</option><option value="gamma">Gamma</option><option value="delta">Delta</option></select><p id="multi-result">None</p>
<script>
  const select = document.querySelector('#choice');
  const group = document.createElement('optgroup'); group.label = 'Many choices';
  for(let i=0;i<210;i++){const option=document.createElement('option');option.value='private-choice-'+i;option.textContent='Choice '+i;group.append(option)}
  select.append(group);
  select.addEventListener('change',()=>{document.querySelector('#result').textContent=select.selectedOptions[0].textContent;document.querySelector('#events').textContent=String(Number(document.querySelector('#events').textContent)+1)});
  document.querySelector('#multi').addEventListener('change',event=>{document.querySelector('#multi-result').textContent=Array.from(event.target.selectedOptions,option=>option.value).join(',')||'None'});
</script>`;

for (const language of ["en", "zh", "zh-TW"] as const) {
  test(`folded website select stays clickable, searchable and keyboard reachable in ${language}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const cwd = mkdtempSync(join(tmpdir(), "orbit-native-select-"));
    const site = createServer((_req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        _req.url === "/embedded"
          ? '<style>body{font:14px system-ui}select{width:220px;height:36px}</style><label for="embedded">Embedded mode</label><select id="embedded"><option>First</option><option>Second</option></select><p id="embedded-result">Unchanged</p><script>document.querySelector("#embedded").addEventListener("change",event=>document.querySelector("#embedded-result").textContent=event.target.value)</script>'
          : fixture,
      );
    });
    await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
    const address = site.address();
    if (!address || typeof address === "string")
      throw new Error("No fixture port");
    let runtime!: BrowserPreviewRuntime;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      const config = structuredClone(DEFAULT_CONFIG);
      config.language = language;
      const handle = await startOrbitWebUi({
        cwd,
        config,
        port: 0,
        open: false,
        loop: {
          getSessionId: () => "native-select-audit",
          setBrowserPreviewService: (service) => {
            if (service) runtime = service as BrowserPreviewRuntime;
          },
        },
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(handle.url);
      await page.locator("#browserPreviewButton").click();
      await page.locator("#prompt").fill("Keep my draft while choosing.");
      await page
        .locator("#browserPreviewUrl")
        .fill(`http://127.0.0.1:${address.port}`);
      await page.locator("#browserPreviewStart").click();
      await expect(page.locator("#browserPreviewImage")).toBeVisible();
      await expect
        .poll(async () => {
          const live = await runtime.live.read();
          const box = await page.locator("#browserPreviewStage").boundingBox();
          return Boolean(
            box &&
            !live.busy &&
            Math.abs(box.width - live.width) < 2 &&
            Math.abs(box.height - live.height) < 2,
          );
        })
        .toBe(true);
      // Test-only access observes the real website; the WebUI receives no DOM or values.
      const innerPage = (runtime.live as unknown as { active: { page: Page } })
        .active.page;
      const clickSelect = async (
        locator: Locator = innerPage.locator("#choice"),
      ) => {
        await expect
          .poll(async () => {
            const state = await runtime.live.read();
            const stage = await page
              .locator("#browserPreviewStage")
              .boundingBox();
            return Boolean(
              stage &&
              !state.busy &&
              Math.abs(stage.width - state.width) < 2 &&
              Math.abs(stage.height - state.height) < 2,
            );
          })
          .toBe(true);
        const select = await locator.boundingBox();
        const image = await page.locator("#browserPreviewImage").boundingBox();
        const live = await runtime.live.read();
        if (!select || !image) throw new Error("Missing fixture geometry");
        await page.mouse.click(
          image.x + ((select.x + select.width / 2) * image.width) / live.width,
          image.y +
            ((select.y + select.height / 2) * image.height) / live.height,
        );
        await expect(locator).toBeFocused();
        await expect(page.locator("#browserSelectPopup")).toBeVisible();
      };
      await clickSelect();
      const popup = (await runtime.live.read()).selectPopup;
      expect(popup?.label).toBe("Appearance");
      expect(popup?.options).toHaveLength(213);
      expect(JSON.stringify(popup)).not.toContain("private-dark-value");
      expect(popup?.options[2]).toMatchObject({
        disabled: true,
        group: "Theme",
      });
      await page.screenshot({
        path: testInfo.outputPath(`select-${language}-desktop.png`),
      });
      await expect(
        page.locator('.browser-select-option[tabindex="0"]'),
      ).toHaveCount(1);
      await page.keyboard.press("Tab");
      await expect(page.locator("#browserSelectNext")).toBeFocused();
      await page.locator("#browserSelectSearch").fill("Dark");
      await expect(page.locator(".browser-select-option")).toHaveCount(1);
      await page.locator(".browser-select-option").click();
      await expect(innerPage.locator("#result")).toHaveText("Dark option");
      await expect(innerPage.locator("#events")).toHaveText("1");
      await expect(page.locator("#browserSelectPopup")).toBeHidden();
      await expect(page.locator("#prompt")).toHaveValue(
        "Keep my draft while choosing.",
      );

      await clickSelect();
      await page.locator("#browserSelectSearch").fill("Light");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect(innerPage.locator("#result")).toHaveText("Light option");
      await expect(innerPage.locator("#events")).toHaveText("2");
      await clickSelect();
      await page.keyboard.press("Escape");
      await expect(page.locator("#browserSelectPopup")).toBeHidden();
      await expect(innerPage.locator("#events")).toHaveText("2");

      await page.setViewportSize({ width: 1100, height: 760 });
      await clickSelect();
      await page.locator("#browserSelectSearch").fill("Choice 209");
      await expect(page.locator(".browser-select-option")).toHaveCount(1);
      await page.screenshot({
        path: testInfo.outputPath(`select-${language}-narrow.png`),
      });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.screenshot({
        path: testInfo.outputPath(`select-${language}-dark.png`),
      });
      await page.locator(".browser-select-option").click();
      await expect(innerPage.locator("#result")).toHaveText("Choice 209");
      await expect(innerPage.locator("#events")).toHaveText("3");
      await clickSelect();
      await page.keyboard.press("End");
      await expect(
        page.locator(".browser-select-option[aria-selected='true']"),
      ).toHaveText(/Choice 209/);
      await page
        .locator(".browser-select-option[aria-selected='true']")
        .click();
      await expect(innerPage.locator("#events")).toHaveText("3");
      await expect(
        runtime.live.handle({
          action: "choose-option",
          pageId: (await runtime.live.read()).pageId,
          popupId: popup!.id,
          optionId: popup!.options[1]!.id,
        }),
      ).rejects.toThrow("selector changed");
      const embedded = innerPage.frameLocator(
        'iframe[title="Embedded selector"]',
      );
      await clickSelect(embedded.locator("#embedded"));
      await expect(page.locator("#browserSelectTitle")).toHaveText(
        "Embedded mode",
      );
      await page
        .locator(".browser-select-option")
        .filter({ hasText: "Second" })
        .click();
      await expect(embedded.locator("#embedded-result")).toHaveText("Second");
      const clickMultipleOption = async (index: number, modifier = "") => {
        await expect
          .poll(async () => {
            const state = await runtime.live.read();
            const stage = await page
              .locator("#browserPreviewStage")
              .boundingBox();
            return Boolean(
              stage &&
              !state.busy &&
              Math.abs(stage.width - state.width) < 2 &&
              Math.abs(stage.height - state.height) < 2,
            );
          })
          .toBe(true);
        const option = await innerPage
          .locator(`#multi option:nth-child(${index + 1})`)
          .boundingBox();
        const image = await page.locator("#browserPreviewImage").boundingBox();
        const live = await runtime.live.read();
        if (!option || !image) throw new Error("Missing multi-select geometry");
        if (modifier) await page.keyboard.down(modifier);
        try {
          await page.mouse.click(
            image.x +
              ((option.x + option.width / 2) * image.width) / live.width,
            image.y +
              ((option.y + option.height / 2) * image.height) / live.height,
          );
        } finally {
          if (modifier) await page.keyboard.up(modifier);
        }
      };
      await clickMultipleOption(0);
      await expect(innerPage.locator("#multi-result")).toHaveText("alpha");
      await clickMultipleOption(2, "Control");
      await expect(innerPage.locator("#multi-result")).toHaveText(
        "alpha,gamma",
      );
      await page.screenshot({
        path: testInfo.outputPath(`multi-${language}-narrow-dark.png`),
        animations: "disabled",
      });
      await page.keyboard.press("Shift+ArrowDown");
      await expect(innerPage.locator("#multi-result")).toContainText("delta");
      await expect
        .poll(async () => (await runtime.live.read()).busy)
        .toBe(false);
      await expect(page.locator("#browserSelectPopup")).toBeHidden();
      expect(errors).toEqual([]);
    } finally {
      await page.unrouteAll({ behavior: "wait" });
      await stopOrbitWebUi();
      await new Promise<void>((resolve, reject) =>
        site.close((error) => (error ? reject(error) : resolve())),
      );
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}
