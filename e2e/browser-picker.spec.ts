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

const fixture = `<!doctype html><title>Picker fixture</title>
<style>body{font:16px system-ui;padding:24px;background:#f2f5f1;color:#1f302a}main{max-width:520px}label{display:grid;gap:5px;margin:14px 0}input{width:260px;height:40px;padding:4px 8px;font:16px system-ui}#color{padding:2px}</style>
<main><h1>Native picker fixture</h1>
<label>Appointment date<input id="date" type="date" value="2026-09-27" min="2026-01-01" max="2026-12-31" required></label>
<label>Meeting time<input id="time" type="time" value="10:30"></label>
<label>Theme color<input id="color" type="color" value="#447766"></label>
<label>Local date and time<input id="datetime" type="datetime-local"></label>
<label>Release month<input id="month" type="month"></label>
<label>Release week<input id="week" type="week"></label>
<p id="result">Unchanged</p><p id="events">0</p></main>
<script>
document.querySelectorAll('input').forEach(input=>input.addEventListener('change',()=>{document.querySelector('#result').textContent=input.id+': '+input.value;document.querySelector('#events').textContent=String(Number(document.querySelector('#events').textContent)+1)}));
const controlled=document.querySelector('#date'), nativeValue=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
let tracked=controlled.value;
Object.defineProperty(controlled,'value',{configurable:true,get(){return nativeValue.get.call(this)},set(next){tracked=String(next);nativeValue.set.call(this,next)}});
controlled.addEventListener('input',()=>{if(tracked!==controlled.value){tracked=controlled.value;document.querySelector('#controlled-result').textContent=controlled.value}});
</script><p id="controlled-result">Unchanged</p>`;

for (const language of ["en", "zh", "zh-TW"] as const) {
  test(`native website date, time, color and period pickers remain operable in ${language}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const cwd = mkdtempSync(join(tmpdir(), "orbit-native-picker-"));
    const site = createServer((_req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(fixture);
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
          getSessionId: () => "native-picker-audit",
          setBrowserPreviewService: (service) => {
            if (service) runtime = service as BrowserPreviewRuntime;
          },
        },
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(handle.url);
      await page.locator("#browserPreviewButton").click();
      await page
        .locator("#prompt")
        .fill("Keep this draft while editing a date.");
      await page
        .locator("#browserPreviewUrl")
        .fill(`http://127.0.0.1:${address.port}`);
      await page.locator("#browserPreviewStart").click();
      await expect(page.locator("#browserPreviewImage")).toBeVisible();
      const website = (runtime.live as unknown as { active: { page: Page } })
        .active.page;
      const clickPicker = async (id: string) => {
        await expect
          .poll(async () => {
            const live = await runtime.live.read();
            const box = await page
              .locator("#browserPreviewStage")
              .boundingBox();
            return Boolean(
              box &&
              !live.busy &&
              Math.abs(box.width - live.width) < 2 &&
              Math.abs(box.height - live.height) < 2,
            );
          })
          .toBe(true);
        const control = await website.locator(`#${id}`).boundingBox();
        const image = await page.locator("#browserPreviewImage").boundingBox();
        const live = await runtime.live.read();
        if (!control || !image) throw new Error("Missing picker geometry");
        await page.mouse.click(
          image.x +
            ((control.x + control.width - 12) * image.width) / live.width,
          image.y +
            ((control.y + control.height / 2) * image.height) / live.height,
        );
        await expect(page.locator("#browserPickerPopup")).toBeVisible();
        await expect(page.locator("#browserPickerValue")).toBeFocused();
      };
      await clickPicker("date");
      const originalPopup = (await runtime.live.read()).inputPicker!;
      expect(originalPopup).toMatchObject({
        type: "date",
        required: true,
        min: "2026-01-01",
      });
      expect(JSON.stringify(originalPopup)).not.toContain("2026-09-27");
      await expect(page.locator("#browserPickerValue")).toHaveValue("");
      await page.screenshot({
        path: testInfo.outputPath("picker-date-desktop.png"),
        animations: "disabled",
      });
      await page.locator("#browserPickerValue").fill("2027-01-01");
      await expect(page.locator("#browserPickerApply")).toBeDisabled();
      await expect(website.locator("#date")).toHaveValue("2026-09-27");
      await page.locator("#browserPickerValue").fill("2026-10-04");
      await expect(website.locator("#date")).toHaveValue("2026-09-27");
      await expect(website.locator("#events")).toHaveText("0");
      await page.locator("#browserPickerApply").click();
      await expect(website.locator("#date")).toHaveValue("2026-10-04");
      await expect(website.locator("#controlled-result")).toHaveText(
        "2026-10-04",
      );
      await expect(website.locator("#events")).toHaveText("1");
      await expect(page.locator("#browserPickerPopup")).toBeHidden();
      await expect(page.locator("#prompt")).toHaveValue(
        "Keep this draft while editing a date.",
      );

      await clickPicker("date");
      await page.keyboard.press("Escape");
      await expect(page.locator("#browserPickerPopup")).toBeHidden();
      await expect(website.locator("#date")).toHaveValue("2026-10-04");
      await expect(website.locator("#events")).toHaveText("1");

      for (const [id, value, expected] of [
        ["time", "13:45", "13:45"],
        ["color", "#aabbcc", "#aabbcc"],
        ["datetime", "2026-10-04T13:45", "2026-10-04T13:45"],
        ["month", "2026-10", "2026-10"],
        ["week", "2026-W42", "2026-W42"],
      ] as const) {
        await clickPicker(id);
        await page.locator("#browserPickerValue").fill(value);
        await page.locator("#browserPickerApply").click();
        await expect(website.locator(`#${id}`)).toHaveValue(expected);
        await expect(page.locator("#browserPickerPopup")).toBeHidden();
      }
      await expect(website.locator("#events")).toHaveText("6");
      await clickPicker("color");
      await expect(page.locator("#browserPickerValue")).toHaveValue("#000000");
      await expect(page.locator("#browserPickerApply")).toBeEnabled();
      await expect(page.locator("#browserPickerHelp")).toContainText(
        language === "en" ? "starts at black" : "黑色",
      );
      await page.screenshot({
        path: testInfo.outputPath("picker-color-default-desktop.png"),
        animations: "disabled",
      });
      await page.locator("#browserPickerApply").click();
      await expect(website.locator("#color")).toHaveValue("#000000");
      await expect(website.locator("#events")).toHaveText("7");
      await clickPicker("color");
      await page.locator("#browserPickerValue").fill("#000000");
      await page.locator("#browserPickerApply").click();
      await expect(website.locator("#events")).toHaveText("7");
      await clickPicker("time");
      await expect(page.locator("#browserPickerClear")).toBeVisible();
      await page.locator("#browserPickerClear").click();
      await expect(website.locator("#time")).toHaveValue("");
      await expect(website.locator("#events")).toHaveText("8");
      await page.setViewportSize({ width: 1100, height: 760 });
      await page.emulateMedia({ colorScheme: "dark" });
      await clickPicker("date");
      await page.screenshot({
        path: testInfo.outputPath("picker-date-narrow-dark.png"),
        animations: "disabled",
      });
      await runtime.live.handle({ action: "tab", operation: "new" });
      await expect(page.locator("#browserPickerPopup")).toBeHidden();
      await expect(
        runtime.live.handle({
          action: "apply-picker",
          pageId: (await runtime.live.read()).pageId,
          popupId: originalPopup.id,
          value: "2026-11-01",
        }),
      ).rejects.toThrow("picker changed");
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
