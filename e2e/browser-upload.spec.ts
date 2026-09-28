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

const fixture = `<!doctype html><title>Upload fixture</title>
<style>body{font:16px system-ui;padding:24px;background:#f4f6f2;color:#20342e}main{max-width:580px}label{display:grid;gap:8px;margin:24px 0}input{font:16px system-ui}#result{padding:12px;background:white}</style>
<main><h1>Website file request</h1><label>Single file<input id="single" type="file"></label><label>Multiple files<input id="multiple" type="file" multiple></label><p id="result">No file sent</p></main>
<script>for(const input of document.querySelectorAll('input'))input.addEventListener('change',async()=>{const files=[...input.files];document.querySelector('#result').textContent=input.id+': '+(await Promise.all(files.map(async file=>file.name+'='+await file.text()))).join(' | ')})</script>`;

for (const language of ["en", "zh", "zh-TW"] as const) {
  test(`website file chooser uses explicit, session-bound uploads in ${language}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const cwd = mkdtempSync(join(tmpdir(), "orbit-browser-upload-"));
    const site = createServer((_req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(fixture);
    });
    await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
    const address = site.address();
    if (!address || typeof address === "string")
      throw new Error("No fixture port");
    const config = structuredClone(DEFAULT_CONFIG);
    config.language = language;
    let runtime!: BrowserPreviewRuntime;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let handle: Awaited<ReturnType<typeof startOrbitWebUi>> | undefined;
    try {
      handle = await startOrbitWebUi({
        cwd,
        config,
        port: 0,
        open: false,
        loop: {
          getSessionId: () => "browser-upload-test",
          setBrowserPreviewService: (service) => {
            if (service) runtime = service as BrowserPreviewRuntime;
          },
        },
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(handle.url);
      await page.locator("#browserPreviewButton").click();
      await page.locator("#prompt").fill("Keep my draft while choosing files.");
      await page
        .locator("#browserPreviewUrl")
        .fill(`http://127.0.0.1:${address.port}`);
      await page.locator("#browserPreviewStart").click();
      await expect(page.locator("#browserPreviewImage")).toBeVisible();
      const website = (runtime.live as unknown as { active: { page: Page } })
        .active.page;
      const clickWebsiteInput = async (id: string) => {
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
        if (!control || !image) throw new Error("Missing file input geometry");
        await page.mouse.click(
          image.x +
            ((control.x + control.width / 2) * image.width) / live.width,
          image.y +
            ((control.y + control.height / 2) * image.height) / live.height,
        );
        await expect(page.locator("#browserUploadPopup")).toBeVisible();
      };
      await clickWebsiteInput("single");
      const first = await runtime.live.read();
      expect(first.fileChooser?.multiple).toBe(false);
      await expect(page.locator("#browserUploadApply")).toBeDisabled();
      await page.locator("#browserUploadFiles").setInputFiles({
        name: "notes.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("hello"),
      });
      await expect(website.locator("#result")).toHaveText("No file sent");
      await page.screenshot({
        path: testInfo.outputPath(`upload-${language}-desktop.png`),
      });
      await page.locator("#browserUploadApply").click();
      await expect(website.locator("#result")).toHaveText(
        "single: notes.txt=hello",
      );
      await expect(page.locator("#browserUploadPopup")).toBeHidden();
      await expect(page.locator("#prompt")).toHaveValue(
        "Keep my draft while choosing files.",
      );
      expect((await runtime.live.read()).fileChooser).toBeUndefined();
      const replayStatus = await page.evaluate(
        async (metadata) => {
          const response = await fetch("/api/browser-upload", {
            method: "POST",
            headers: {
              "Content-Type": "application/octet-stream",
              "X-Orbit-Upload": encodeURIComponent(JSON.stringify(metadata)),
            },
            body: new Blob(["hello"]),
          });
          return response.status;
        },
        {
          pageId: first.pageId,
          chooserId: first.fileChooser!.id,
          files: [{ name: "notes.txt", mimeType: "text/plain", size: 5 }],
        },
      );
      expect(replayStatus).toBe(400);

      await clickWebsiteInput("single");
      await page.locator("#browserUploadCancel").click();
      await expect(page.locator("#browserUploadPopup")).toBeHidden();
      await expect(website.locator("#result")).toHaveText(
        "single: notes.txt=hello",
      );

      await clickWebsiteInput("multiple");
      expect((await runtime.live.read()).fileChooser?.multiple).toBe(true);
      await page.locator("#browserUploadFiles").setInputFiles([
        { name: "empty.txt", mimeType: "text/plain", buffer: Buffer.alloc(0) },
        {
          name: "数据.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("world"),
        },
      ]);
      await page.locator("#browserUploadApply").click();
      await expect(website.locator("#result")).toHaveText(
        "multiple: empty.txt= | 数据.txt=world",
      );
      await page.setViewportSize({ width: 1100, height: 760 });
      await page.emulateMedia({ colorScheme: "dark" });
      await clickWebsiteInput("single");
      await page.screenshot({
        path: testInfo.outputPath(`upload-${language}-narrow.png`),
      });
      await runtime.live.handle({ action: "tab", operation: "new" });
      await expect(page.locator("#browserUploadPopup")).toBeHidden();
      expect(errors).toEqual([]);
    } finally {
      if (handle) await stopOrbitWebUi();
      await new Promise<void>((resolve) => site.close(() => resolve()));
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}
