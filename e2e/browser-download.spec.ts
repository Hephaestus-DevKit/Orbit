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

const content = Buffer.from("Orbit website file\n");
const fixture = `<!doctype html><title>Download fixture</title><style>body{font:16px system-ui;padding:24px;background:#f4f6f2;color:#20342e}a{display:inline-block;padding:12px;background:#246b55;color:white}</style><h1>Download fixture</h1><a id="download" href="/download">Download report</a>`;

for (const language of ["en", "zh", "zh-TW"] as const) {
  test(`website download requires confirmation in ${language}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const cwd = mkdtempSync(join(tmpdir(), "orbit-browser-download-"));
    const site = createServer((req, res) => {
      if (req.url === "/download") {
        res.writeHead(200, {
          "Content-Type": "text/plain",
          "Content-Disposition": 'attachment; filename="report.txt"',
        });
        res.end(content);
      } else {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(fixture);
      }
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
          getSessionId: () => "browser-download-test",
          setBrowserPreviewService: (service) => {
            if (service) runtime = service as BrowserPreviewRuntime;
          },
        },
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(handle.url);
      await page.locator("#browserPreviewButton").click();
      await page.locator("#prompt").fill("Keep this draft during download.");
      await page
        .locator("#browserPreviewUrl")
        .fill(`http://127.0.0.1:${address.port}`);
      await page.locator("#browserPreviewStart").click();
      await expect(page.locator("#browserPreviewImage")).toBeVisible();
      expect((await runtime.live.read()).tabs).toHaveLength(1);
      const website = (runtime.live as unknown as { active: { page: Page } })
        .active.page;
      const clickDownload = async () => {
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
        const control = await website.locator("#download").boundingBox();
        const image = await page.locator("#browserPreviewImage").boundingBox();
        const live = await runtime.live.read();
        if (!control || !image)
          throw new Error("Missing download link geometry");
        await page.mouse.click(
          image.x +
            ((control.x + control.width / 2) * image.width) / live.width,
          image.y +
            ((control.y + control.height / 2) * image.height) / live.height,
        );
        await expect
          .poll(async () => await runtime.live.read())
          .toMatchObject({
            download: { status: "ready" },
          });
        await expect(page.locator("#browserDownloadPopup")).toBeVisible();
        await expect(page.locator("#browserDownloadSave")).toBeEnabled();
      };
      await clickDownload();
      const first = await runtime.live.read();
      expect(first.download?.filename).toBe("report.txt");
      await page.screenshot({
        path: testInfo.outputPath(`download-${language}-desktop.png`),
      });
      const awaitedDownload = page.waitForEvent("download");
      await page.locator("#browserDownloadSave").click();
      const saved = await awaitedDownload;
      expect(saved.suggestedFilename()).toBe("report.txt");
      const chunks: Buffer[] = [];
      for await (const chunk of await saved.createReadStream())
        chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks)).toEqual(content);
      await expect(page.locator("#browserDownloadPopup")).toBeHidden();
      await expect(page.locator("#prompt")).toHaveValue(
        "Keep this draft during download.",
      );
      expect((await runtime.live.read()).download).toBeUndefined();
      const replay = await page.evaluate(
        async (request) =>
          (
            await fetch("/api/browser-download", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(request),
            })
          ).status,
        { pageId: first.pageId, downloadId: first.download!.id },
      );
      expect(replay).toBe(400);

      await clickDownload();
      await page.locator("#browserDownloadDiscard").click();
      await expect(page.locator("#browserDownloadPopup")).toBeHidden();
      expect((await runtime.live.read()).download).toBeUndefined();

      await page.setViewportSize({ width: 1100, height: 760 });
      await page.emulateMedia({ colorScheme: "dark" });
      await clickDownload();
      await page.screenshot({
        path: testInfo.outputPath(`download-${language}-narrow.png`),
      });
      await runtime.live.handle({ action: "tab", operation: "new" });
      await expect(page.locator("#browserDownloadPopup")).toBeHidden();
      expect(errors).toEqual([]);
    } finally {
      if (handle) await stopOrbitWebUi();
      await new Promise<void>((resolve) => site.close(() => resolve()));
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}
