import {
  test,
  expect,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_CONFIG } from "../packages/config/src/defaults.js";
import {
  startOrbitWebUi,
  stopOrbitWebUi,
} from "../packages/cli/src/runtime/webui/WebUiServer.js";
import { BrowserPreviewRuntime } from "../packages/cli/src/runtime/browser/BrowserPreviewRuntime.js";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture port");
  return `http://127.0.0.1:${address.port}`;
}

async function addSettingsTestToast(page: Page): Promise<Locator> {
  await page.locator("#toasts").evaluate((region) => {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.dataset.settingsTestToast = "true";
    const message = document.createElement("div");
    message.textContent = "Browser notification";
    toast.append(message);
    region.append(toast);
  });
  return page.locator('[data-settings-test-toast="true"]');
}

async function expectToastAboveSettings(page: Page, toast: Locator) {
  await expect
    .poll(async () => {
      const notification = await toast.boundingBox();
      const settings = await page
        .locator(".browser-settings-popover")
        .boundingBox();
      return Boolean(
        notification &&
        settings &&
        notification.y >= 0 &&
        notification.y + notification.height <= settings.y - 8,
      );
    })
    .toBe(true);
}

test("real browser blocks other local services and handles same-origin redirects", async () => {
  test.setTimeout(60_000);
  let leaks = 0,
    sockets = 0;
  const forbidden = createServer((_req, res) => {
    leaks++;
    res.end("private");
  });
  forbidden.on("upgrade", (_req, socket) => {
    leaks++;
    socket.destroy();
  });
  const forbiddenUrl = await listen(forbidden);
  const server = createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/" });
      res.end();
      return;
    }
    if (req.url === "/escape") {
      res.writeHead(302, { Location: forbiddenUrl });
      res.end();
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      fixture +
        `<iframe src="${forbiddenUrl}/private" title="Forbidden local frame"></iframe><script>fetch('${forbiddenUrl}').catch(()=>{});new WebSocket('${forbiddenUrl.replace("http:", "ws:")}/private');new WebSocket('ws://'+location.host+'/hmr');</script>`,
    );
  });
  server.on("upgrade", (_req, socket) => {
    sockets++;
    socket.destroy();
  });
  const url = await listen(server);
  const runtime = new BrowserPreviewRuntime({
    blockedPort: () => Number(new URL(forbiddenUrl).port),
  });
  try {
    await runtime.live.handle({ action: "open", address: url + "/redirect" });
    expect((await runtime.execute({ action: "snapshot" })).text).toContain(
      "Build something useful",
    );
    await expect
      .poll(() => sockets, {
        message: JSON.stringify(
          (await runtime.execute({ action: "snapshot" })).errors,
        ),
      })
      .toBeGreaterThan(0);
    expect(leaks).toBe(0);
    await expect(
      runtime.live.handle({ action: "open", address: forbiddenUrl }),
    ).rejects.toThrow("control port");
    await runtime.live
      .handle({ action: "open", address: url + "/escape" })
      .catch(() => undefined);
    expect(leaks).toBe(0);
  } finally {
    await runtime.reset();
    await close(server);
    await close(forbidden);
  }
});

test("cancelling an Agent action closes only its active tab", async () => {
  test.setTimeout(45_000);
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end("<title>Keep this tab</title><h1>Keep this tab</h1>");
  });
  const url = await listen(server);
  const runtime = new BrowserPreviewRuntime({ blockedPort: () => 6047 });
  try {
    await runtime.live.handle({ action: "open", address: url });
    await runtime.live.handle({ action: "tab", operation: "new" });
    await runtime.live.handle({ action: "open", address: url });
    await expect
      .poll(async () => (await runtime.live.read()).tabs.length)
      .toBe(2);
    const controller = new AbortController();
    const action = runtime.execute(
      { action: "click", selector: "#never-created" },
      controller.signal,
    );
    await expect.poll(async () => (await runtime.live.read()).busy).toBe(true);
    controller.abort();
    await expect(action).rejects.toThrow("cancelled");
    const state = await runtime.live.read();
    expect(state.active).toBe(true);
    expect(state.tabs).toHaveLength(1);
    expect(state.url).toBe(url + "/");
    expect((await runtime.execute({ action: "snapshot" })).text).toContain(
      "Keep this tab",
    );
  } finally {
    await runtime.reset();
    await close(server);
  }
});

test("finds within the live page and keeps browser keyboard shortcuts in the dock", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const cwd = mkdtempSync(join(tmpdir(), "orbit-live-find-"));
  let visits = 0;
  const server = createServer((_req, res) => {
    visits++;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      "<title>Find fixture</title><h1>Find the target</h1><p>Orbit appears here.</p><div style='height:900px'></div><p>Orbit appears again.</p>",
    );
  });
  const url = await listen(server);
  const errors: string[] = [];
  let runtime!: BrowserPreviewRuntime;
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const handle = await startOrbitWebUi({
      cwd,
      config: structuredClone(DEFAULT_CONFIG),
      port: 0,
      open: false,
      loop: {
        getSessionId: () => "live-find-session",
        setBrowserPreviewService: (service) => {
          if (service) runtime = service as BrowserPreviewRuntime;
        },
      },
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(handle.url);
    await page.locator("#browserPreviewButton").click();
    await page.locator("#browserPreviewUrl").fill(url);
    await page.locator("#browserPreviewStart").click();
    await expect(page.locator("#browserPreviewImage")).toBeVisible();
    await settleViewport(page, runtime);
    await expect(page.locator("#browserPreviewStage")).toHaveAttribute(
      "aria-describedby",
      "browserPreviewPageTitle browserInteractionHint",
    );

    await page.locator("#browserPreviewStage").focus();
    await page.keyboard.press("ControlOrMeta+f");
    await expect(page.locator("#browserFindBar")).toBeVisible();
    await expect(page.locator("#browserFindQuery")).toBeFocused();
    await page.locator("#browserFindQuery").fill("Orbit");
    await page.keyboard.press("Enter");
    await expect(page.locator("#browserFindStatus")).toHaveText("Found");
    await page.locator("#browserFindNext").click();
    await expect(page.locator("#browserFindStatus")).toHaveText("Found");
    await page.locator("#browserFindQuery").fill("not-on-this-page");
    await page.keyboard.press("Enter");
    await expect(page.locator("#browserFindStatus")).toHaveText("No match");
    await page.screenshot({
      path: testInfo.outputPath("browser-find-desktop.png"),
      animations: "disabled",
    });

    await page.setViewportSize({ width: 1100, height: 850 });
    await settleViewport(page, runtime);
    await expect(page.locator("#browserFindBar")).toBeVisible();
    await expect(page.locator("#browserFindQuery")).toHaveValue(
      "not-on-this-page",
    );
    await expect(page.locator("#browserFindQuery")).toBeFocused();
    const beforeFindFrame = (await runtime.live.read()).frame;
    const beforeFindImage = await page
      .locator("#browserPreviewImage")
      .getAttribute("src");
    await page.locator("#browserFindQuery").fill("Find the target");
    await page.keyboard.press("Enter");
    await expect(page.locator("#browserFindStatus")).toHaveText("Found");
    await expect
      .poll(async () => (await runtime.live.read()).frame)
      .toBeGreaterThan(beforeFindFrame);
    await expect
      .poll(() => page.locator("#browserPreviewImage").getAttribute("src"))
      .not.toBe(beforeFindImage);
    expect(await runtime.live.handle({ action: "copy-selection" })).toBe(
      "Find the target",
    );
    await page.screenshot({
      path: testInfo.outputPath("browser-find-narrow.png"),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(page.locator("#browserFindBar")).toBeHidden();
    await expect(page.locator("#browserPreviewStage")).toBeFocused();
    await page.keyboard.press("ControlOrMeta+f");
    await expect(page.locator("#browserFindQuery")).toBeFocused();
    await runtime.live.handle({ action: "open", address: url + "/external" });
    await expect(page.locator("#browserFindBar")).toBeHidden();
    await expect(page.locator("#browserPreviewStage")).toBeFocused();
    await page.locator("#browserPageActions").click();
    await expect(page.locator("#browserFindPage")).toBeFocused();
    await runtime.live.handle({
      action: "open",
      address: url + "/external-menu",
    });
    await expect(page.locator("#browserPageContextMenu")).toBeHidden();
    await expect(page.locator("#browserPreviewStage")).toBeFocused();
    await page.locator("#browserPageActions").click();
    await page.locator("#browserFindPage").click();
    await expect(page.locator("#browserFindQuery")).toBeFocused();
    await page.locator("#browserFindQuery").fill("Orbit");
    const beforeReload = visits;
    const beforeReloadPage = (await runtime.live.read()).pageId;
    await page.keyboard.press("ControlOrMeta+r");
    await expect.poll(() => visits).toBeGreaterThan(beforeReload);
    await expect
      .poll(async () => (await runtime.live.read()).pageId)
      .not.toBe(beforeReloadPage);
    await expect(page.locator("#browserFindQuery")).toBeEnabled();
    await expect(page.locator("#browserFindBar")).toBeVisible();
    await expect(page.locator("#browserFindQuery")).toHaveValue("Orbit");
    await page.locator("#browserFindQuery").press("Enter");
    await expect(page.locator("#browserFindStatus")).toHaveText("Found");

    await page.locator("#browserPreviewStage").focus();
    await page.keyboard.press("ControlOrMeta+t");
    await expect(page.locator("#browserTabs [role=tab]")).toHaveCount(2);
    await page.keyboard.press("ControlOrMeta+w");
    await expect(page.locator("#browserTabs [role=tab]")).toHaveCount(1);

    await settleViewport(page, runtime);
    let blockedPosts = 0;
    await page.route("**/api/browser-preview", async (route) => {
      if (route.request().method() === "POST") blockedPosts++;
      await route.continue();
    });
    const focusedClose = page.locator(".browser-live-tab-close").first();
    await focusedClose.focus();
    const busyAction = runtime.execute({
      action: "click",
      selector: "#not-present-during-tab-busy-test",
    });
    const busyActionFailure = expect(busyAction).rejects.toThrow();
    await expect.poll(async () => (await runtime.live.read()).busy).toBe(true);
    await expect(page.locator("#browserPreviewStatus")).toHaveText(
      "Browser busy",
    );
    await expect(page.locator("#browserPreviewStart")).toBeDisabled();
    await expect(page.locator("#browserPreviewReload")).toBeDisabled();
    await expect(page.locator("#browserNewTab")).toBeDisabled();
    await expect(focusedClose).toHaveAttribute("aria-disabled", "true");
    await expect(focusedClose).toBeFocused();
    await page.locator("#browserPreviewImage").click({
      position: { x: 30, y: 30 },
    });
    await page.locator("#browserPageInput").focus();
    await page.keyboard.type("x");
    await focusedClose.focus();
    await page.keyboard.press("ControlOrMeta+t");
    await page.keyboard.press("ControlOrMeta+r");
    const closeBounds = await focusedClose.boundingBox();
    expect(closeBounds).not.toBeNull();
    await page.mouse.click(
      closeBounds!.x + closeBounds!.width / 2,
      closeBounds!.y + closeBounds!.height / 2,
    );
    await expect(page.locator("#browserTabs [role=tab]")).toHaveCount(1);
    expect(blockedPosts).toBe(0);
    await busyActionFailure;
    await expect(focusedClose).toHaveAttribute("aria-disabled", "false");

    await page.setViewportSize({ width: 1440, height: 900 });
    expect(errors).toEqual([]);
  } finally {
    await stopOrbitWebUi();
    await close(server);
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("public browsing and omnibox search smoke", async ({ page }, testInfo) => {
  test.skip(
    !process.env.ORBIT_BROWSER_PUBLIC_SMOKE,
    "Opt-in live internet check; deterministic tests do not depend on external sites.",
  );
  test.setTimeout(120_000);
  const searchEngine =
    process.env.ORBIT_BROWSER_PUBLIC_ENGINE === "duckduckgo"
      ? "duckduckgo"
      : process.env.ORBIT_BROWSER_PUBLIC_ENGINE === "baidu"
        ? "baidu"
        : process.env.ORBIT_BROWSER_PUBLIC_ENGINE === "google"
          ? "google"
          : "bing";
  const searchUrl =
    searchEngine === "bing"
      ? "https://www.bing.com/search?q=typescript%20documentation"
      : searchEngine === "baidu"
        ? "https://www.baidu.com/s?wd=typescript%20documentation"
        : searchEngine === "google"
          ? "https://www.google.com/search?q=typescript%20documentation"
          : "https://duckduckgo.com/?q=typescript%20documentation";
  const cwd = mkdtempSync(join(tmpdir(), "orbit-live-public-"));
  let runtime!: BrowserPreviewRuntime;
  try {
    const handle = await startOrbitWebUi({
      cwd,
      config: structuredClone(DEFAULT_CONFIG),
      port: 0,
      open: false,
      loop: {
        getSessionId: () => "live-public-session",
        setBrowserPreviewService: (service) => {
          if (service) runtime = service as BrowserPreviewRuntime;
        },
      },
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(handle.url);
    await page.locator("#browserPreviewButton").click();
    await page.locator("#browserPreviewUrl").fill("https://example.com");
    await page.locator("#browserPreviewStart").click();
    await expect(page.locator("#browserPreviewPageTitle")).toHaveText(
      "Example Domain",
      { timeout: 30000 },
    );
    await expect(page.locator("#browserPreviewImage")).toBeVisible();
    if (searchEngine !== "bing") {
      await page.locator(".browser-preview-help summary").click();
      await page.locator("#browserSearchEngine").selectOption(searchEngine);
      await page.locator(".browser-preview-help summary").click();
    }
    await page.locator("#browserPreviewUrl").fill("typescript documentation");
    await page.locator("#browserPreviewStart").click();
    try {
      await expect
        .poll(
          async () =>
            URL.canParse(await page.locator("#browserPreviewUrl").inputValue()),
          { timeout: 30_000 },
        )
        .toBe(true);
      const currentUrl = new URL(
        await page.locator("#browserPreviewUrl").inputValue(),
      );
      // Keep provider challenge tokens out of assertion output.
      const destination = `${currentUrl.hostname}${currentUrl.pathname}`;
      expect(destination).toMatch(
        searchEngine === "bing"
          ? /bing\.com\/search$/
          : searchEngine === "baidu"
            ? /baidu\.com\/s$/
            : searchEngine === "google"
              ? /google\.com\/search$/
              : /duckduckgo\.com\/$/,
      );
      expect(
        currentUrl.searchParams.get(searchEngine === "baidu" ? "wd" : "q"),
      ).toBe("typescript documentation");
      await expect(page.locator("#browserPreviewPageTitle")).toContainText(
        /typescript|搜索|Search/i,
        { timeout: 30000 },
      );
      await expect
        .poll(() => readText(runtime), { timeout: 30000 })
        .toMatch(/typescriptlang\.org/i);
      await settleViewport(page, runtime);
    } finally {
      let browserEvidence: unknown;
      try {
        browserEvidence = await runtime.execute({ action: "snapshot" });
      } catch (error: unknown) {
        // A pending navigation can legitimately keep the runtime busy here.
        // Preserve the original search failure rather than masking it.
        const live = await runtime.live.read();
        delete live.image;
        browserEvidence = {
          live,
          snapshotError: error instanceof Error ? error.message : String(error),
        };
      }
      await testInfo.attach("public-search-evidence", {
        body: JSON.stringify({
          searchEngine,
          browser: browserEvidence,
        }),
        contentType: "application/json",
      });
      await page.screenshot({
        path: testInfo.outputPath("browser-public-search.png"),
        animations: "disabled",
      });
      // Read-only network comparison, not a fallback or a change to Orbit's policy.
      const comparison = await page.context().newPage();
      const failedResources: string[] = [];
      comparison.on("requestfailed", (request) => {
        if (failedResources.length < 20)
          failedResources.push(
            `${new URL(request.url()).hostname}: ${request.failure()?.errorText}`,
          );
      });
      try {
        await comparison.goto(searchUrl, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        await testInfo.attach("direct-network-comparison", {
          body: JSON.stringify({
            searchEngine,
            hostname: new URL(comparison.url()).hostname,
            title: await comparison.title(),
            hasDocumentationResult: /typescriptlang\.org/i.test(
              await comparison.locator("body").innerText(),
            ),
            failedResources,
          }),
          contentType: "application/json",
        });
      } catch (error) {
        await testInfo.attach("direct-network-comparison", {
          body: JSON.stringify({
            searchEngine,
            message:
              error instanceof Error
                ? error.message.split("\n")[0]
                : "Comparison failed",
            failedResources,
          }),
          contentType: "application/json",
        });
      } finally {
        await comparison.close();
      }
    }
    const search = await runtime.execute({ action: "snapshot" });
    const documentation = search.controls?.find(
      (control) =>
        control.type === "a" &&
        /starting point for learning TypeScript/i.test(control.label),
    );
    expect(
      documentation,
      "Official documentation link is present in the search results",
    ).toBeTruthy();
    await runtime.execute({
      action: "click",
      selector: documentation!.selector,
    });
    await expect(page.locator("#browserPreviewUrl")).toHaveValue(
      /typescriptlang\.org/,
      { timeout: 30000 },
    );
    await expect
      .poll(() => readText(runtime), { timeout: 30000 })
      .toMatch(/TypeScript/);
    await settleViewport(page, runtime);
    await page.locator("#prompt").fill("Explain the TypeScript documentation.");
    await page.locator("#browserPreviewAsk").click();
    await expect(page.locator("#prompt")).toBeFocused();
    await expect(page.locator("#prompt")).toHaveValue(
      "Explain the TypeScript documentation.",
    );
    await expect(page.locator("#browserHandoff")).toBeVisible();
    const documentPage = (await runtime.live.read()).pageId;
    await page.locator("#changesTab").click();
    await page.locator("#browserTab").click();
    expect((await runtime.live.read()).pageId).toBe(documentPage);
    await page.screenshot({
      path: testInfo.outputPath("browser-public-documentation.png"),
      animations: "disabled",
    });
  } finally {
    await stopOrbitWebUi();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("public documentation opens and stays attached to the Agent question", async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.ORBIT_BROWSER_PUBLIC_SMOKE,
    "Opt-in live internet check; deterministic tests do not depend on external sites.",
  );
  test.setTimeout(120_000);
  const cwd = mkdtempSync(join(tmpdir(), "orbit-live-public-docs-"));
  let runtime!: BrowserPreviewRuntime;
  try {
    const handle = await startOrbitWebUi({
      cwd,
      config: structuredClone(DEFAULT_CONFIG),
      port: 0,
      open: false,
      loop: {
        getSessionId: () => "live-public-docs-session",
        setBrowserPreviewService: (service) => {
          if (service) runtime = service as BrowserPreviewRuntime;
        },
      },
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(handle.url);
    await page.locator("#browserPreviewButton").click();
    await page
      .locator("#browserPreviewUrl")
      .fill("https://www.typescriptlang.org/docs/");
    await page.locator("#browserPreviewStart").click();
    await expect(page.locator("#browserPreviewUrl")).toHaveValue(
      /typescriptlang\.org\/docs/,
      { timeout: 30000 },
    );
    await expect
      .poll(() => readText(runtime), { timeout: 30000 })
      .toMatch(/TypeScript/i);
    await settleViewport(page, runtime);
    await page.locator("#prompt").fill("Explain the TypeScript documentation.");
    await page.locator("#browserPreviewAsk").click();
    await expect(page.locator("#browserHandoff")).toBeVisible();
    await expect(page.locator("#prompt")).toHaveValue(
      "Explain the TypeScript documentation.",
    );
    const documentPage = (await runtime.live.read()).pageId;
    await page.locator("#changesTab").click();
    await page.locator("#browserTab").click();
    expect((await runtime.live.read()).pageId).toBe(documentPage);
    await page.screenshot({
      path: testInfo.outputPath("browser-public-direct-documentation.png"),
      animations: "disabled",
    });
  } finally {
    await stopOrbitWebUi();
    rmSync(cwd, { recursive: true, force: true });
  }
});
async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>Local studio</title><style>
body{font:16px system-ui;margin:0;background:#f2f4ef;color:#233d36}main{margin:24px;position:relative;height:1500px}h1{font-size:38px;letter-spacing:-1.5px;margin:0;position:absolute;top:48px}p{line-height:1.7}.eyebrow{font-size:11px;letter-spacing:2px;color:#638176}.intro{position:absolute;top:106px;font-size:13px}
input,button{box-sizing:border-box;height:40px;padding:8px 12px;border:1px solid #8da69a;border-radius:8px;font:14px system-ui}input{position:absolute;top:180px;left:0;width:220px;background:white}button{background:#386f60;color:white;cursor:pointer}#hello{position:absolute;top:230px;left:0}#result{position:absolute;top:270px;font-size:13px}#next{position:absolute;top:330px;left:0;color:#386f60}#dialog{position:absolute;top:380px;left:0}footer{position:absolute;top:1250px}
@media(max-width:500px){h1{font-size:28px;letter-spacing:-1px}.intro{max-width:100%;font-size:12px}}
</style></head><body><main><span class="eyebrow">LOCAL STUDIO / ORBIT</span><h1>Build something useful.</h1><p class="intro">A real page. Click, type and explore — right here.</p><input id="name" aria-label="Your name" placeholder="Your name"><button id="hello" onclick="document.getElementById('result').textContent='Hello '+document.getElementById('name').value">Say hello</button><p id="result" role="status">Ready to try</p><a id="next" href="/next">Explore the next page →</a><button id="dialog" onclick="document.getElementById('result').textContent=prompt('What should we build?', 'Orbit') || 'Cancelled'">Open a page dialog</button><footer>You reached the bottom.</footer></main></body></html>`;

test("attaches an Agent question to its tab and refuses a later tab switch", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const cwd = mkdtempSync(join(tmpdir(), "orbit-browser-handoff-"));
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(fixture);
  });
  const url = await listen(server);
  let runtime!: BrowserPreviewRuntime;
  let activeSession = "handoff-session";
  let submitted = 0;
  const submittedPrompts: string[] = [];
  const submittedBrowserContexts: boolean[] = [];
  let completeTurn!: () => void;
  const chatBodies: Array<{
    browserTabId?: string;
    browserTabUrl?: string;
    prompt: string;
  }> = [];
  try {
    const handle = await startOrbitWebUi({
      cwd,
      config: structuredClone(DEFAULT_CONFIG),
      port: 0,
      open: false,
      loop: {
        getSessionId: () => activeSession,
        setBrowserPreviewService: (service) => {
          if (service) runtime = service as BrowserPreviewRuntime;
        },
      },
      submitPrompt: (prompt, _attachments, context) => {
        submitted++;
        submittedPrompts.push(prompt);
        submittedBrowserContexts.push(context?.browserAttached === true);
        return new Promise<{ ok: true }>((resolve) => {
          completeTurn = () => resolve({ ok: true });
        });
      },
    });
    page.on("request", (request) => {
      if (request.url().endsWith("/api/chat") && request.method() === "POST")
        chatBodies.push(request.postDataJSON());
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(handle.url);
    await expect(page.locator("#connectionState")).toHaveClass(/is-connected/);
    await page.locator("#browserPreviewButton").click();
    await runtime.live.handle({ action: "open", address: url });
    await settleViewport(page, runtime);
    await expect(page.locator("#browserPreviewAsk")).toBeEnabled();
    const attachedTabId = runtime.live.activeTabId;
    const attachedUrl = runtime.live.activeTabUrl;
    await page.locator("#prompt").fill("Check the attached page.");
    await page.locator("#browserPreviewAsk").click();
    await expect(page.locator("#prompt")).toHaveValue(
      "Check the attached page.",
    );
    await expect(page.locator("#browserHandoffTitle")).toHaveText(
      "Local studio",
    );
    await expect(page.locator("#browserHandoff")).toHaveAttribute(
      "data-state",
      "ready",
    );
    await expect(page.locator("#browserPreviewImage")).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator("#browserPreviewImage")
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await page.screenshot({
      path: testInfo.outputPath("browser-attachment-desktop.png"),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1200, height: 760 });
    await settleViewport(page, runtime);
    await expect(page.locator("#browserHandoff")).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("browser-attachment-narrow.png"),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await settleViewport(page, runtime);
    await expect.poll(async () => (await runtime.live.read()).busy).toBe(false);

    await runtime.live.handle({ action: "tab", operation: "new" });
    await expect(page.locator("#browserHandoff")).toHaveAttribute(
      "data-state",
      "changed",
    );
    await page.locator("#sendButton").click();
    await expect.poll(() => chatBodies.length).toBe(1);
    expect(chatBodies[0]?.browserTabId).toBe(attachedTabId);
    expect(chatBodies[0]?.browserTabUrl).toBe(attachedUrl);
    await expect(page.locator("#prompt")).toHaveValue(
      "Check the attached page.",
    );
    expect(submitted).toBe(0);

    await runtime.live.handle({
      action: "tab",
      operation: "select",
      id: attachedTabId!,
    });
    await runtime.live.handle({ action: "open", address: url + "/next" });
    await expect(page.locator("#browserHandoff")).toHaveAttribute(
      "data-state",
      "changed",
    );
    await page.locator("#sendButton").click();
    await expect.poll(() => chatBodies.length).toBe(2);
    expect(chatBodies[1]?.browserTabUrl).toBe(attachedUrl);
    await expect(page.locator("#prompt")).toHaveValue(
      "Check the attached page.",
    );
    expect(submitted).toBe(0);

    await runtime.live.handle({ action: "open", address: url });
    await expect(page.locator("#browserHandoff")).toHaveAttribute(
      "data-state",
      "ready",
    );
    await page.locator("#sendButton").click();
    await expect.poll(() => submitted).toBe(1);
    expect(chatBodies[2]?.browserTabId).toBe(attachedTabId);
    expect(submittedPrompts[0]).toBe("Check the attached page.");
    expect(submittedBrowserContexts[0]).toBe(true);
    await runtime.live.handle({ action: "tab", operation: "new" });
    await expect(runtime.execute({ action: "snapshot" })).rejects.toThrow(
      "no longer active",
    );
    completeTurn();
    await expect(page.locator("#sendButton")).not.toHaveClass(/is-stop/);

    await runtime.live.handle({
      action: "tab",
      operation: "select",
      id: attachedTabId!,
    });
    await expect(page.locator("#browserPreviewAsk")).toBeEnabled();
    await page.evaluate(() => {
      const toast = document.createElement("div");
      toast.id = "blocking-toast-fixture";
      toast.className = "toast is-error";
      toast.style.position = "fixed";
      toast.style.right = "18px";
      toast.style.bottom = "18px";
      const body = document.createElement("div");
      body.textContent =
        "The attached browser page changed. Add the current page again before asking.";
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "×";
      close.addEventListener("click", () => toast.remove());
      toast.append(body, close);
      document.getElementById("toasts")!.append(toast);
    });
    expect(
      await page.evaluate(() => {
        const toast = document
          .getElementById("blocking-toast-fixture")!
          .getBoundingClientRect();
        const button = document
          .getElementById("browserPreviewAsk")!
          .getBoundingClientRect();
        return (
          toast.left < button.right &&
          toast.right > button.left &&
          toast.top < button.bottom &&
          toast.bottom > button.top
        );
      }),
    ).toBe(true);
    await page.locator("#browserPreviewAsk").click();
    await page.locator("#blocking-toast-fixture button").click();
    await expect(page.locator("#blocking-toast-fixture")).toHaveCount(0);
    await page.locator("#prompt").fill("Review this page again.");
    activeSession = "next-session";
    await runtime.reset();
    await page.locator("#sendButton").click();
    await expect.poll(() => chatBodies.length).toBe(4);
    expect(chatBodies[3]?.browserTabId).toBe(attachedTabId);
    await expect(page.locator("#prompt")).toHaveValue(
      "Review this page again.",
    );
    expect(submitted).toBe(1);
    await page.locator("#browserHandoffRemove").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#browserHandoff")).toBeHidden();
    await expect(page.locator("#prompt")).toHaveValue(
      "Review this page again.",
    );
    await expect(page.locator("#prompt")).toBeFocused();
  } finally {
    completeTurn?.();
    await stopOrbitWebUi();
    await close(server);
    rmSync(cwd, { recursive: true, force: true });
  }
});

async function clickPage(
  page: Page,
  runtime: BrowserPreviewRuntime,
  x: number,
  y: number,
  waitForInput = true,
) {
  const image = page.locator("#browserPreviewImage");
  await expect(image).toBeVisible();
  await expect.poll(async () => (await runtime.live.read()).busy).toBe(false);
  await expect(page.locator("#browserPreviewStage")).not.toHaveClass(
    /is-input-blocked/,
  );
  const state = await runtime.live.read();
  const rect = await image.boundingBox();
  if (!rect) throw new Error("Missing page image");
  const dispatched = waitForInput
    ? page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/browser-preview") &&
          response.request().method() === "POST" &&
          response.request().postDataJSON().action === "input" &&
          response
            .request()
            .postDataJSON()
            .events.some(
              (event: { phase?: string; x?: number; y?: number }) =>
                event.phase === "up" &&
                Math.abs((event.x || 0) - x) < 2 &&
                Math.abs((event.y || 0) - y) < 2,
            ),
        { timeout: 10_000 },
      )
    : undefined;
  await page.mouse.click(
    rect.x + (x * rect.width) / state.width,
    rect.y + (y * rect.height) / state.height,
  );
  if (dispatched) {
    await (await dispatched).finished();
    await expect.poll(async () => (await runtime.live.read()).busy).toBe(false);
    await expect(page.locator("#browserPreviewStage")).not.toHaveClass(
      /is-input-blocked/,
    );
  }
}
async function readText(runtime: BrowserPreviewRuntime): Promise<string> {
  try {
    return (await runtime.execute({ action: "snapshot" })).text;
  } catch {
    return "";
  }
}

async function settleViewport(page: Page, runtime: BrowserPreviewRuntime) {
  await expect
    .poll(async () => {
      const current = await runtime.live.read();
      const size = await page
        .locator("#browserPreviewStage")
        .evaluate((element) => ({
          width: element.clientWidth,
          height: element.clientHeight,
        }));
      return Math.max(
        Math.abs(current.width - size.width),
        Math.abs(current.height - size.height),
      );
    })
    .toBeLessThanOrEqual(2);
  await expect(page.locator("#browserPreviewImage")).toBeVisible({
    timeout: 10_000,
  });
  // Live frames may replace src while decode() is in flight; inspect the
  // currently displayed frame instead of awaiting a superseded one.
  await expect
    .poll(() =>
      page.locator("#browserPreviewImage").evaluate((element) => {
        const image = element as HTMLImageElement;
        return image.complete && image.naturalWidth > 0;
      }),
    )
    .toBe(true);
  await expect.poll(async () => (await runtime.live.read()).busy).toBe(false);
  await expect(page.locator("#browserPreviewStage")).not.toHaveClass(
    /is-input-blocked/,
  );
}

async function openPageOutline(page: Page) {
  await page.locator("#browserPageActions").click();
  await expect(page.locator("#browserFindPage")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#browserReadPage")).toBeFocused();
  await page.keyboard.press("Enter");
}

test("reads a private page outline on demand and discards stale results", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const cwd = mkdtempSync(join(tmpdir(), "orbit-live-reader-"));
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      `<title>Reader fixture</title><h1>Accessible page</h1><p>Only read on request.</p><label for="reader-query">Reader query</label><input id="reader-query"><label for="reader-password">Password</label><input id="reader-password" type="password" value="fixture-private-password-9f2b"><button id="reader-apply" onclick="document.getElementById('reader-result').textContent = document.getElementById('reader-query').value">Apply query</button><a href="/second">Open second</a><p id="reader-result">Not applied</p>${Array.from({ length: 80 }, (_, index) => `<p>Outline section ${index + 1}</p>`).join("")}`,
    );
  });
  const url = await listen(server);
  let runtime!: BrowserPreviewRuntime;
  let release: (() => void) | undefined;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const handle = await startOrbitWebUi({
      cwd,
      config: structuredClone(DEFAULT_CONFIG),
      port: 0,
      open: false,
      loop: {
        getSessionId: () => "reader-session",
        setBrowserPreviewService: (service) => {
          if (service) runtime = service as BrowserPreviewRuntime;
        },
      },
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(handle.url);
    await page.locator("#browserPreviewButton").click();
    await page.locator("#browserPreviewUrl").fill(url);
    await page.locator("#browserPreviewStart").click();
    await settleViewport(page, runtime);
    const actions = page.locator("#browserPageActions");
    const reader = page.locator("#browserPageReader");
    const readerText = page.locator("#browserPageReaderText");
    const controlList = page.locator("#browserPageReaderControlList");
    await openPageOutline(page);
    await expect(reader).toBeVisible();
    await expect(page.locator("#browserPreviewStage")).toHaveCSS(
      "visibility",
      "hidden",
    );
    await expect(readerText).toContainText("Accessible page");
    await expect(page.locator(".browser-page-reader-pan-hint")).toBeHidden();
    await expect(readerText).toContainText("Only read on request.");
    await expect(controlList.getByRole("listitem")).toHaveCount(4);
    await expect(
      controlList.getByRole("button", {
        name: "Focus Reader query · Text field",
      }),
    ).toBeVisible();
    await expect(
      controlList.getByRole("button", {
        name: "Activate Apply query · Button",
      }),
    ).toBeVisible();
    expect(await readText(runtime)).not.toContain(
      "fixture-private-password-9f2b",
    );
    expect(await readerText.innerText()).not.toContain(
      "fixture-private-password-9f2b",
    );
    expect(
      (await runtime.live.execute({ action: "snapshot" })).controls,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selector: "#reader-password",
          label: "Password",
        }),
      ]),
    );
    expect(await page.locator("#messages").innerText()).not.toContain(
      "Only read on request.",
    );
    await page.screenshot({
      path: testInfo.outputPath("browser-page-outline-desktop.png"),
      animations: "disabled",
    });
    await readerText.focus();
    await page.keyboard.press("PageDown");
    await expect
      .poll(() => readerText.evaluate((node) => node.scrollTop))
      .toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await expect(reader).toBeHidden();
    await expect(page.locator("#browserPreviewStage")).toHaveCSS(
      "visibility",
      "visible",
    );
    await expect(readerText).toBeEmpty();
    await expect(controlList).toBeEmpty();
    await expect(actions).toBeFocused();

    await openPageOutline(page);
    await expect(readerText).toContainText("Accessible page");
    await runtime.live.handle({ action: "open", address: url + "/external" });
    await expect(reader).toBeHidden();
    await expect(page.locator("#browserPreviewStage")).toBeFocused();

    await page.locator("#browserPreviewFocus").click();
    await settleViewport(page, runtime);
    const dockedPageId = (await runtime.live.read()).pageId;
    await openPageOutline(page);
    await expect(readerText).toContainText("Accessible page");
    await expect(page.locator(".browser-page-reader-pan-hint")).toBeVisible();
    await expect(page.locator("#browserPreviewStage")).toHaveCSS(
      "visibility",
      "visible",
    );
    const dockedBounds = await page.evaluate(() => {
      const stage = document.getElementById("browserPreviewStage")!;
      return {
        stageRight: stage.getBoundingClientRect().right,
        readerLeft: document
          .getElementById("browserPageReader")!
          .getBoundingClientRect().left,
        imageWidth: document
          .getElementById("browserPreviewImage")!
          .getBoundingClientRect().width,
        stageWidth: stage.clientWidth,
        scrollWidth: stage.scrollWidth,
      };
    });
    expect(dockedBounds.stageRight).toBeLessThan(dockedBounds.readerLeft);
    expect(dockedBounds.imageWidth).toBeGreaterThan(dockedBounds.stageWidth);
    expect(dockedBounds.scrollWidth).toBeGreaterThan(dockedBounds.stageWidth);
    expect((await runtime.live.read()).pageId).toBe(dockedPageId);
    await page.screenshot({
      path: testInfo.outputPath("browser-page-outline-docked.png"),
      animations: "disabled",
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({
      path: testInfo.outputPath("browser-page-outline-docked-dark.png"),
      animations: "disabled",
    });
    await page.emulateMedia({ colorScheme: "light" });
    const stage = page.locator("#browserPreviewStage");
    await stage.hover({ position: { x: 100, y: 100 } });
    await page.keyboard.down("Shift");
    await page.mouse.wheel(0, 300);
    await page.keyboard.up("Shift");
    await expect
      .poll(() => stage.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
    await clickPage(page, runtime, 800, 100);
    await expect(page.locator("#browserPageReaderStatus")).toContainText(
      "Refresh the outline",
    );
    await expect(controlList).toBeEmpty();
    await page.locator("#browserPageReaderRefresh").click();
    await expect(controlList.getByRole("listitem")).toHaveCount(4);
    expect((await runtime.live.read()).pageId).toBe(dockedPageId);
    await page.setViewportSize({ width: 1000, height: 760 });
    await expect(page.locator("#browserPreviewStage")).toHaveCSS(
      "visibility",
      "hidden",
    );
    await expect(reader).toBeVisible();
    await page.waitForTimeout(350);
    expect((await runtime.live.read()).pageId).toBe(dockedPageId);
    await controlList
      .getByRole("button", { name: "Focus Reader query · Text field" })
      .click();
    await expect(page.locator("#browserPageInput")).toBeFocused();
    await page.waitForTimeout(350);
    expect((await runtime.live.read()).pageId).toBe(dockedPageId);
    await page.locator("#browserPreviewUrl").focus();
    await settleViewport(page, runtime);
    expect((await runtime.live.read()).pageId).not.toBe(dockedPageId);
    await page.setViewportSize({ width: 1440, height: 900 });
    await settleViewport(page, runtime);
    await page.locator("#browserPreviewFocus").click();
    await settleViewport(page, runtime);

    await openPageOutline(page);
    await expect(controlList.getByRole("listitem")).toHaveCount(4);
    let failControlOnce = true;
    await page.route("**/api/browser-preview", async (route) => {
      if (
        failControlOnce &&
        route.request().method() === "POST" &&
        route.request().postDataJSON().action === "control"
      ) {
        failControlOnce = false;
        await route.fulfill({
          status: 400,
          json: { ok: false, message: "Control fixture failed" },
        });
      } else await route.continue();
    });
    const queryControl = controlList.getByRole("button", {
      name: "Focus Reader query · Text field",
    });
    await queryControl.click();
    await expect(page.locator("#browserPageReaderStatus")).toContainText(
      "Control fixture failed",
    );
    await expect(queryControl).toBeEnabled();
    await queryControl.click();
    await expect(reader).toBeHidden();
    await expect(page.locator("#browserPageInput")).toBeFocused();
    await expect(page.locator("#browserPageInput")).toHaveAttribute(
      "aria-label",
      /Type into Reader query/,
    );
    await page.keyboard.type("Orbit keyboard");
    await openPageOutline(page);
    await expect(controlList.getByRole("listitem")).toHaveCount(4);
    await controlList
      .getByRole("button", { name: "Activate Apply query · Button" })
      .click();
    await expect(reader).toBeHidden();
    await expect.poll(() => readText(runtime)).toContain("Orbit keyboard");

    await openPageOutline(page);
    await expect(controlList.getByRole("listitem")).toHaveCount(4);
    await controlList
      .getByRole("button", { name: "Activate Open second · Link" })
      .click();
    await expect
      .poll(async () => (await runtime.live.read()).url)
      .toContain("/second");
    await expect(reader).toBeHidden();

    await page.setViewportSize({ width: 1100, height: 760 });
    await settleViewport(page, runtime);
    let failOnce = true;
    await page.route("**/api/browser-preview", async (route) => {
      if (
        failOnce &&
        route.request().method() === "POST" &&
        route.request().postDataJSON().action === "read-page"
      ) {
        failOnce = false;
        await route.fulfill({
          status: 400,
          json: { ok: false, message: "Reader fixture failed" },
        });
      } else await route.continue();
    });
    await openPageOutline(page);
    await expect(page.locator("#browserPageReaderStatus")).toContainText(
      "Reader fixture failed",
    );
    await expect(page.locator("#browserPageReaderRefresh")).toBeEnabled();
    await page.locator("#browserPageReaderRefresh").click();
    await expect(readerText).toContainText("Accessible page");
    await expect(page.locator(".browser-page-reader-pan-hint")).toBeHidden();
    await page.screenshot({
      path: testInfo.outputPath("browser-page-outline-narrow.png"),
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({
      path: testInfo.outputPath("browser-page-outline-dark.png"),
      animations: "disabled",
    });
    await expect(reader).toBeVisible();
    await actions.focus();
    await expect(actions).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(reader).toBeHidden();
    await expect(page.locator("#browserPreviewPanel")).toBeVisible();

    let held = false;
    await page.route("**/api/browser-preview", async (route) => {
      if (
        route.request().method() !== "POST" ||
        route.request().postDataJSON().action !== "read-page"
      ) {
        await route.continue();
        return;
      }
      held = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route
        .fulfill({ json: { ok: true, pageText: "Stale private page" } })
        .catch(() => undefined);
    });
    await openPageOutline(page);
    await expect.poll(() => held).toBe(true);
    await page.locator("#browserPreviewStop").click();
    await expect(reader).toBeHidden();
    const late = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/browser-preview") &&
        response.request().method() === "POST" &&
        response.request().postDataJSON().action === "read-page",
    );
    release?.();
    await (await late).finished();
    await expect(readerText).toBeEmpty();
    expect(errors).toEqual([]);
  } finally {
    release?.();
    await page.unrouteAll({ behavior: "wait" });
    await page.close().catch(() => undefined);
    await stopOrbitWebUi();
    await close(server);
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("recovers the browser connection without navigating or losing page and address drafts", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const cwd = mkdtempSync(join(tmpdir(), "orbit-live-recovery-"));
  let visits = 0;
  const server = createServer((req, res) => {
    if (req.url === "/") visits++;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(fixture);
  });
  const url = await listen(server);
  let runtime!: BrowserPreviewRuntime;
  let disconnected = false;
  let allowRetry = false;
  let failedPolls = 0;
  let mutations = 0;
  let heldFind = false;
  let releaseFind: (() => void) | undefined;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const handle = await startOrbitWebUi({
      cwd,
      config: structuredClone(DEFAULT_CONFIG),
      port: 0,
      open: false,
      loop: {
        getSessionId: () => "recovery-session",
        setBrowserPreviewService: (service) => {
          if (service) runtime = service as BrowserPreviewRuntime;
        },
      },
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(handle.url);
    await page.locator("#browserPreviewButton").click();
    await page.locator("#browserPreviewUrl").fill(url);
    await page.locator("#browserPreviewStart").click();
    await settleViewport(page, runtime);
    await expect.poll(async () => (await runtime.live.read()).busy).toBe(false);
    await runtime.execute({
      action: "fill",
      selector: "#name",
      value: "Keep this unsent page input",
    });
    await runtime.execute({ action: "scroll", direction: "down" });
    const before = await runtime.live.read();
    await page.locator("#prompt").fill("Keep my task draft");
    await page.locator("#browserPreviewStage").focus();
    await page.keyboard.press("ControlOrMeta+f");
    const findQuery = page.locator("#browserFindQuery");
    await findQuery.fill("Unsent find query");
    await expect(findQuery).toBeFocused();
    await page.route("**/api/browser-preview*", async (route) => {
      if (route.request().method() === "POST") {
        if (route.request().postDataJSON().action === "find") {
          heldFind = true;
          await new Promise<void>((resolve) => {
            releaseFind = resolve;
          });
          await route.fulfill({ json: { ok: true, found: true } });
          return;
        }
        mutations++;
        await route.continue();
      } else if (disconnected && !allowRetry) {
        failedPolls++;
        await route.abort("connectionfailed");
      } else await route.continue();
    });
    const lateFind = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/browser-preview") &&
        response.request().method() === "POST" &&
        response.request().postDataJSON().action === "find",
    );
    await findQuery.press("Enter");
    await expect.poll(() => heldFind).toBe(true);
    disconnected = true;
    await expect(page.locator("#browserPreviewNotice")).toBeVisible();
    await expect(page.locator("#browserPreviewStatus")).toHaveText(
      "Disconnected",
    );
    const failedPollsBeforePause = failedPolls;
    await page.waitForTimeout(1300);
    expect(failedPolls - failedPollsBeforePause).toBeLessThanOrEqual(3);
    await expect(page.locator("#browserPreviewAsk")).toBeDisabled();
    await expect(page.locator("#browserPreviewRetry")).toHaveText("Reconnect");
    await expect(page.locator("#browserPreviewReload")).toBeDisabled();
    await expect(page.locator("#browserNewTab")).toBeDisabled();
    await expect(page.locator("#browserTabs [role=tab]")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(findQuery).toBeFocused();
    await expect(findQuery).toBeEditable();
    await expect(findQuery).toHaveValue("Unsent find query");
    releaseFind?.();
    await lateFind;
    await expect(page.locator("#browserFindStatus")).toHaveText(
      "Reconnect to find",
    );
    await findQuery.fill("Edited while offline");
    await expect(findQuery).toHaveValue("Edited while offline");
    await expect(page.locator("#browserFindStatus")).toHaveText(
      "Reconnect to find",
    );
    await page.screenshot({
      path: testInfo.outputPath("browser-disconnected.png"),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1100, height: 760 });
    await expect(findQuery).toBeFocused();
    await expect(page.locator("#browserFindBar")).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("browser-disconnected-narrow.png"),
      animations: "disabled",
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({
      path: testInfo.outputPath("browser-disconnected-narrow-dark.png"),
      animations: "disabled",
    });
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await findQuery.press("Enter");
    await expect(page.locator("#browserPreviewRetry")).toBeFocused();
    await page
      .locator("#browserPreviewUrl")
      .fill("A query I have not submitted");
    await expect(page.locator("#browserPreviewStart")).toBeDisabled();
    await page.keyboard.press("ControlOrMeta+r");
    await page.keyboard.press("ControlOrMeta+t");
    await page.keyboard.press("ControlOrMeta+w");
    await page.keyboard.press("ControlOrMeta+f");
    await expect(page.locator("#browserPreviewRetry")).toBeFocused();
    await expect(page.locator("#browserFindBar")).toBeVisible();
    await expect(findQuery).toHaveValue("Edited while offline");
    await page.locator("#browserPreviewUrl").focus();
    await page.keyboard.press("Enter");
    expect(mutations).toBe(0);
    expect((await runtime.live.read()).tabs).toHaveLength(before.tabs.length);
    const reconnect = page.locator("#browserPreviewRetry");
    await reconnect.focus();
    await page.keyboard.press("Enter");
    // A failed reconnect must remain visible and must never open the address draft.
    await expect(page.locator("#browserPreviewStatus")).toHaveText(
      "Disconnected",
    );
    expect(mutations).toBe(0);
    allowRetry = true;
    await expect(page.locator("#browserPreviewNotice")).toBeHidden();
    await expect(page.locator("#browserPreviewStatus")).toHaveText("Live");
    await expect(findQuery).toBeEnabled();
    await expect(findQuery).toHaveValue("Edited while offline");
    await expect(page.locator("#browserFindStatus")).toBeEmpty();
    await expect(page.locator("#browserPreviewUrl")).toHaveValue(
      "A query I have not submitted",
    );
    expect(visits).toBe(1);
    expect((await runtime.live.read()).pageId).toBe(before.pageId);
    expect(await readText(runtime)).not.toContain(
      "Keep this unsent page input",
    );
    await runtime.execute({ action: "click", selector: "#hello" });
    await expect
      .poll(() => readText(runtime))
      .toContain("Hello Keep this unsent page input");
    await expect(page.locator("#prompt")).toHaveValue("Keep my task draft");
    await page.locator("#browserPreviewAsk").click();
    await expect(page.locator("#prompt")).toBeFocused();
    await page.locator("#changesTab").click();
    await page.locator("#browserTab").click();
    await expect(page.locator("#browserPreviewUrl")).toHaveValue(
      "A query I have not submitted",
    );
    expect((await runtime.live.read()).pageId).toBe(before.pageId);
    expect(errors).toEqual([]);
  } finally {
    releaseFind?.();
    await stopOrbitWebUi();
    await close(server);
    rmSync(cwd, { recursive: true, force: true });
  }
});

for (const language of ["en", "zh", "zh-TW"] as const) {
  test(`explains incomplete pages and restores them with explicit reload in ${language}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    const cwd = mkdtempSync(join(tmpdir(), "orbit-live-resource-"));
    let broken = true;
    let visits = 0;
    const server = createServer((req, res) => {
      if (req.url === "/style.css") {
        res.writeHead(broken ? 503 : 200, { "Content-Type": "text/css" });
        res.end(
          broken
            ? "Unavailable"
            : "body{background:#edf4f1;color:#244d42;font-family:system-ui}",
        );
        return;
      }
      visits++;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        '<title>Resource recovery</title><link rel="stylesheet" href="/style.css"><h1>Page resources</h1><p>This page stays visible when a stylesheet cannot load.</p>',
      );
    });
    const url = await listen(server);
    const errors: string[] = [];
    let runtime!: BrowserPreviewRuntime;
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
          getSessionId: () => "resources-session",
          setBrowserPreviewService: (service) => {
            if (service) runtime = service as BrowserPreviewRuntime;
          },
        },
      });
      await page.setViewportSize({
        width: language === "en" ? 1440 : 1100,
        height: 900,
      });
      await page.emulateMedia({
        colorScheme: language === "zh-TW" ? "dark" : "light",
      });
      await page.goto(handle.url);
      await page.locator("#browserPreviewButton").click();
      await expect(page.locator("#browserSearchDestination")).toHaveText(
        language === "en"
          ? "Search: Bing"
          : language === "zh"
            ? "搜索：Bing"
            : "搜尋：Bing",
      );
      await page.locator("#browserPreviewUrl").fill(url);
      await page.locator("#browserPreviewStart").click();
      await expect(page.locator("#browserPreviewErrorTitle")).toHaveText(
        /Page incomplete|页面未完整加载|頁面未完整載入/,
      );
      await expect(page.locator("#browserPreviewImage")).toBeVisible();
      await expect(page.locator("#browserPreviewStatus")).not.toHaveText(
        /^(Live|实时|即時)$/,
      );
      await expect(page.locator("#browserPreviewRetry")).toHaveText(
        /Reload page|刷新页面|重新載入/,
      );
      await expect(page.locator("#browserPreviewRetry")).toBeInViewport();
      await expect(page.locator("#browserPreviewChangeEngine")).toBeHidden();
      await settleViewport(page, runtime);
      await expect
        .poll(async () => (await runtime.live.read()).busy)
        .toBe(false);
      await page.screenshot({
        path: testInfo.outputPath(`browser-incomplete-${language}.png`),
        animations: "disabled",
      });
      let mockedSearchUrl = "https://www.bing.com/account?q=orbit%20design";
      let simulatedBusy = false;
      const searchState = async (route: Route) => {
        const action =
          route.request().method() === "POST"
            ? route.request().postDataJSON()
            : undefined;
        if (action?.action === "open" && action.address === "orbit design") {
          await route.fulfill({
            status: 409,
            json: { ok: false, message: "Search was not submitted." },
          });
          return;
        }
        const response = await route.fetch();
        const data = await response.json();
        if (!data.browser) {
          await route.fulfill({ response });
          return;
        }
        data.browser.url = mockedSearchUrl;
        data.browser.busy = simulatedBusy;
        await route.fulfill({ response, json: data });
      };
      await page.route("**/api/browser-preview*", searchState);
      await expect(page.locator("#browserPreviewUrl")).toHaveValue(
        mockedSearchUrl,
      );
      await expect(page.locator("#browserPreviewChangeEngine")).toBeHidden();
      mockedSearchUrl =
        language === "en"
          ? "https://cn.bing.com/search?q=orbit%20design"
          : language === "zh"
            ? "https://www.google.co.uk/search?q=orbit%20design"
            : "https://www.baidu.com/s?wd=orbit%20design";
      await expect(page.locator("#browserPreviewChangeEngine")).toBeVisible();
      const beforeChoice = visits;
      let searchSubmissions = 0;
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname === "/api/browser-preview"
        ) {
          const action = request.postDataJSON();
          if (action.action === "open" && action.address === "orbit design")
            searchSubmissions++;
        }
      });
      await page.locator("#browserPreviewChangeEngine").click();
      await expect(page.locator("#browserSearchEngine")).toBeFocused();
      await expect(page.locator("#browserPreviewUrl")).toHaveValue(
        "orbit design",
      );
      await page.locator(".browser-preview-help summary").click();
      await expect(page.locator(".browser-preview-help")).not.toHaveAttribute(
        "open",
        "",
      );
      await page.locator("#browserPreviewChangeEngine").click();
      await expect(page.locator("#browserSearchEngine")).toBeFocused();
      if (language === "en") {
        simulatedBusy = true;
        await expect(page.locator("#browserPreviewStart")).toBeDisabled();
      }
      await page.locator("#browserSearchEngine").selectOption("duckduckgo");
      await expect(page.locator("#browserSearchDestination")).toHaveText(
        language === "en"
          ? "Search: DuckDuckGo"
          : language === "zh"
            ? "搜索：DuckDuckGo"
            : "搜尋：DuckDuckGo",
      );
      simulatedBusy = false;
      await expect(page.locator("#browserPreviewStart")).toBeFocused();
      await expect(page.locator(".browser-preview-help")).not.toHaveAttribute(
        "open",
        "",
      );
      await expect(page.locator("#browserPreviewUrl")).toHaveValue(
        "orbit design",
      );
      await expect(page.locator("#browserPreviewError")).toContainText(
        language === "en"
          ? "DuckDuckGo selected. Press Go"
          : language === "zh"
            ? "已选择 DuckDuckGo。点击“访问”"
            : "已選擇 DuckDuckGo。點擊「開啟」",
      );
      if (language === "en") {
        const beforeResize = (await runtime.live.read()).pageId;
        await page.setViewportSize({ width: 1360, height: 820 });
        await expect
          .poll(async () => (await runtime.live.read()).pageId)
          .not.toBe(beforeResize);
        await settleViewport(page, runtime);
        await expect(page.locator("#browserPreviewError")).toContainText(
          "DuckDuckGo selected. Press Go",
        );
        await page.setViewportSize({ width: 1440, height: 900 });
        await settleViewport(page, runtime);
      }
      expect(
        await page.evaluate(() =>
          localStorage.getItem("orbit.webui.browserSearchEngine"),
        ),
      ).toBe("duckduckgo");
      expect(visits).toBe(beforeChoice);
      await page.waitForTimeout(150);
      expect(searchSubmissions).toBe(0);
      await page.screenshot({
        path: testInfo.outputPath(`browser-search-recovery-${language}.png`),
        animations: "disabled",
      });
      await page.locator(".browser-preview-help summary").click();
      await page.locator("#browserSearchEngine").focus();
      await page.locator("#browserSearchEngine").selectOption("bing");
      await expect(page.locator("#browserSearchDestination")).toContainText(
        "Bing",
      );
      await expect(page.locator(".browser-preview-help")).toHaveAttribute(
        "open",
        "",
      );
      await expect(page.locator("#browserSearchEngine")).toBeFocused();
      await page.locator("#browserSearchEngine").press("Escape");
      await expect(page.locator(".browser-preview-help")).not.toHaveAttribute(
        "open",
        "",
      );
      await expect(page.locator(".browser-preview-help summary")).toBeFocused();
      await expect(page.locator("#browserPreviewPanel")).toBeVisible();
      await page.unroute("**/api/browser-preview*", searchState);
      broken = false;
      const before = visits;
      await page.locator("#browserPreviewRetry").click();
      await expect(page.locator("#browserPreviewNotice")).toBeHidden();
      await expect(page.locator("#browserPreviewStatus")).toHaveText(
        /^(Live|实时|即時)$/,
      );
      expect(visits).toBeGreaterThan(before);
      await page.locator("#browserPreviewUrl").fill("unsubmitted search");
      await page.keyboard.press("Escape");
      await expect(page.locator("#browserPreviewUrl")).toHaveValue(url + "/");
      await expect(page.locator("#browserPreviewPanel")).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await stopOrbitWebUi();
      await close(server);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test(`direct browsing, Chinese input, navigation and shared Agent page in ${language}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const cwd = mkdtempSync(join(tmpdir(), "orbit-live-e2e-"));
    const server = createServer((req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        req.url === "/next"
          ? "<title>Next page</title><h1>The next page</h1><a href='/'>Return to studio</a>"
          : fixture,
      );
    });
    const url = await listen(server);
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
          getSessionId: () => "live-session",
          setBrowserPreviewService: (service) => {
            if (service) runtime = service as BrowserPreviewRuntime;
          },
        },
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(handle.url);
      await expect(page.locator("#connectionState")).toHaveClass(
        /is-connected/,
      );
      await page.locator("#prompt").fill("Keep my existing draft.");
      await expect(page.locator("#queueButton")).toBeHidden();
      await page.locator("#browserPreviewButton").click();
      await expect(page.locator("#browserPreviewUrl")).toBeFocused();
      await expect(page.locator(".topbar .workspace-tools")).toBeHidden();
      await expect(page.locator(".workbench-tabs")).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`browser-${language}-empty.png`),
        animations: "disabled",
      });
      const searchEngine = page.locator("#browserSearchEngine");
      const settings = page.locator(".browser-preview-help summary");
      await settings.focus();
      await page.keyboard.press("Enter");
      await expect(searchEngine).toBeVisible();
      await searchEngine.selectOption("duckduckgo");
      await expect
        .poll(() =>
          page.evaluate(() =>
            localStorage.getItem("orbit.webui.browserSearchEngine"),
          ),
        )
        .toBe("duckduckgo");
      expect((await runtime.live.read()).active).toBe(false);
      await page.reload();
      await page.locator("#browserPreviewButton").click();
      await settings.click();
      await expect(searchEngine).toHaveValue("duckduckgo");
      const testToast = await addSettingsTestToast(page);
      await expectToastAboveSettings(page, testToast);
      await page.screenshot({
        path: testInfo.outputPath(`browser-${language}-settings.png`),
        animations: "disabled",
      });
      await testToast.evaluate((element) => element.remove());
      await settings.click();
      await expect
        .poll(() =>
          page
            .locator("#toasts")
            .evaluate((element) =>
              element.style.getPropertyValue("--browser-settings-toast-lift"),
            ),
        )
        .toBe("0px");
      await page.locator("#prompt").fill("Keep my existing draft.");
      const address = page.locator("#browserPreviewUrl");
      await page.route("**/api/browser-preview", async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        expect(route.request().postDataJSON()).toMatchObject({
          action: "open",
          address: "中文查询",
          searchEngine: "duckduckgo",
        });
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            error: "page.goto: Timeout 20000ms exceeded.",
          }),
        });
      });
      await address.fill("中文查询");
      await page.locator("#browserPreviewStart").click();
      await expect(page.locator("#browserPreviewError")).toContainText(
        /taking too long|加载超时|載入逾時/,
      );
      await page.unroute("**/api/browser-preview");
      await address.fill("");
      await page.locator("#browserPreviewHide").click();
      await expect(page.locator(".topbar .workspace-tools")).toBeVisible();
      await page.locator("#browserPreviewButton").click();
      await page.locator("#browserPreviewUrl").fill("javascript:alert(1)");
      await page.locator("#browserPreviewStart").click();
      await expect(page.locator("#browserPreviewError")).toBeVisible();
      await page.locator("#browserPreviewUrl").fill(url);
      // Editing a failed address is a new explicit navigation, not a retry of
      // the original request. Retry must never submit this unsent draft.
      await page.locator("#browserPreviewStart").click();
      await expect(page.locator("#browserPreviewPageTitle")).toHaveText(
        "Local studio",
        { timeout: 20000 },
      );
      await expect(page.locator("#browserPreviewImage")).toBeVisible();
      const divider = page.locator("#browserPreviewDivider");
      const split = await divider.getAttribute("aria-valuenow");
      await divider.focus();
      await page.keyboard.press("ArrowLeft");
      await expect(divider).not.toHaveAttribute("aria-valuenow", split!);
      await page.keyboard.press("Home");
      await expect(divider).toHaveAttribute(
        "aria-valuenow",
        String(
          Math.max(54, Number(await divider.getAttribute("aria-valuemin"))),
        ),
      );
      await expect(page.locator("#browserPreviewFocusLabel")).toHaveText(
        language === "en" ? "Expand" : language === "zh" ? "展开" : "展開",
      );
      await page.locator("#browserPreviewFocus").click();
      await expect(page.locator("#conversation")).toBeHidden();
      const returnLabel =
        language === "en"
          ? "Back to chat"
          : language === "zh"
            ? "返回对话"
            : "返回對話";
      const returnToChat = page.locator("#browserPreviewHide");
      await expect(returnToChat).toHaveAccessibleName(returnLabel);
      await expect(returnToChat.locator(".workbench-hide-label")).toBeVisible();
      await expect(page.locator("#browserPreviewFocusLabel")).toHaveText(
        language === "en" ? "Split view" : language === "zh" ? "并排" : "並排",
      );
      await page.locator("#browserPreviewFocus").click();
      await expect(page.locator("#conversation")).toBeVisible();
      await expect(returnToChat.locator(".workbench-hide-label")).toBeHidden();
      const keptTabs = (await runtime.live.read()).tabs.map((tab) => tab.id);
      await address.fill("Keep this unsubmitted browser draft");
      await page.setViewportSize({ width: 1100, height: 760 });
      await expect(page.locator("#conversation")).toBeHidden();
      await expect(page.locator("#browserPreviewFocus")).toBeHidden();
      await expect(returnToChat).toHaveAccessibleName(returnLabel);
      await settleViewport(page, runtime);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      if (language === "zh-TW")
        await page.emulateMedia({ colorScheme: "dark" });
      await page.screenshot({
        path: testInfo.outputPath(`browser-return-${language}.png`),
        animations: "disabled",
      });
      await returnToChat.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#browserPreviewPanel")).toBeHidden();
      await expect(page.locator("#prompt")).toBeFocused();
      await expect(page.locator("#prompt")).toHaveValue(
        "Keep my existing draft.",
      );
      expect((await runtime.live.read()).active).toBe(true);
      await page.locator("#browserPreviewButton").click();
      await expect(address).toHaveValue("Keep this unsubmitted browser draft");
      expect((await runtime.live.read()).tabs.map((tab) => tab.id)).toEqual(
        keptTabs,
      );
      await address.press("Escape");
      await expect(address).toHaveValue(url + "/");
      await page.emulateMedia({ colorScheme: "light" });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await expect(page.locator("#conversation")).toBeVisible();
      await expect
        .poll(async () =>
          Math.abs(
            (await runtime.live.read()).width -
              (await page
                .locator("#browserPreviewStage")
                .evaluate((el) => el.clientWidth)),
          ),
        )
        .toBeLessThanOrEqual(2);
      await clickPage(page, runtime, 80, 224);
      await expect(page.locator("#browserPageInput")).toBeFocused();
      await page.keyboard.insertText("你好 Orbit");
      await clickPage(page, runtime, 70, 274);
      await expect.poll(() => readText(runtime)).toContain("Hello 你好 Orbit");
      await clickPage(page, runtime, 80, 224);
      const selectionSent = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/browser-preview") &&
          response.request().method() === "POST" &&
          response.request().postDataJSON().action === "input" &&
          response
            .request()
            .postDataJSON()
            .events.some(
              (event: { type: string; key?: string }) =>
                event.type === "key" && event.key === "ControlOrMeta+A",
            ),
        { timeout: 10_000 },
      );
      await page.keyboard.press("ControlOrMeta+A");
      await selectionSent;
      if (language === "en") {
        await page
          .context()
          .grantPermissions(["clipboard-read", "clipboard-write"], {
            origin: new URL(handle.url).origin,
          });
        await page.keyboard.press("ControlOrMeta+C");
        await expect(page.locator("#toasts")).toContainText(
          "Selected text copied",
        );
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
          "你好 Orbit",
        );
        await page.locator("#browserPageActions").click();
        await expect(page.locator("#browserPageContextMenu")).toBeVisible();
        await page.screenshot({
          path: testInfo.outputPath("browser-actions-en.png"),
          animations: "disabled",
        });
        await page.locator("#browserCopyAddress").click();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
          url + "/",
        );
        await page.locator("#browserPreviewImage").click({ button: "right" });
        await expect(page.locator("#browserPageContextMenu")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.locator("#browserPageContextMenu")).toBeHidden();
        await page.locator("#browserPageInput").focus();
      }
      await expect
        .poll(async () => (await runtime.live.read()).busy)
        .toBe(false);
      await expect(page.locator("#browserPreviewStage")).not.toHaveClass(
        /is-input-blocked/,
      );
      const composed = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/browser-preview") &&
          response.request().method() === "POST" &&
          response.request().postDataJSON().action === "input" &&
          response
            .request()
            .postDataJSON()
            .events.some(
              (event: { type: string; text?: string }) =>
                event.type === "text" && event.text === "中文输入法",
            ),
        { timeout: 10_000 },
      );
      await page.locator("#browserPageInput").evaluate((element) => {
        const input = element as HTMLTextAreaElement;
        input.dispatchEvent(new CompositionEvent("compositionstart"));
        input.value = "中文输入法";
        input.dispatchEvent(
          new InputEvent("input", { isComposing: true, data: "中文输入法" }),
        );
        input.dispatchEvent(
          new CompositionEvent("compositionend", { data: "中文输入法" }),
        );
        input.dispatchEvent(new InputEvent("input", { data: "中文输入法" }));
      });
      await (await composed).finished();
      await clickPage(page, runtime, 70, 274);
      await expect
        .poll(() => readText(runtime))
        .toContain("status: Hello 中文输入法");
      await page.keyboard.press("Escape");
      await expect(page.locator("#browserPreviewUrl")).toBeFocused();
      await expect(page.locator("#browserPreviewPanel")).toBeVisible();
      await clickPage(page, runtime, 70, 364);
      await expect(page.locator("#browserPreviewPageTitle")).toHaveText(
        "Next page",
      );
      await expect(page.locator("#browserBack")).toBeEnabled();
      await page.locator("#browserBack").click();
      await expect(page.locator("#browserPreviewPageTitle")).toHaveText(
        "Local studio",
      );
      await expect(page.locator("#browserForward")).toBeEnabled();
      await page.locator("#browserForward").click();
      await expect(page.locator("#browserPreviewPageTitle")).toHaveText(
        "Next page",
      );
      await page.locator("#browserBack").click();
      await expect(page.locator("#browserPreviewPageTitle")).toHaveText(
        "Local studio",
      );
      await clickPage(page, runtime, 100, 424, false);
      await expect(page.locator("#browserPageDialog")).toBeVisible();
      await expect(page.locator("#browserPageDialog")).toHaveAttribute(
        "aria-modal",
        "false",
      );
      await expect(page.locator("#browserPageDialogBackdrop")).toBeVisible();
      await expect(page.locator("#browserDialogTitle")).toBeVisible();
      await expect(page.locator("#browserDialogDismiss")).toBeFocused();
      await expect(page.locator("#browserPreviewUrl")).toBeDisabled();
      await expect(page.locator("#browserBack")).toBeDisabled();
      await expect(page.locator("#browserNewTab")).toBeDisabled();
      await expect(
        page.locator("#browserTabs [role=tab]").first(),
      ).toBeDisabled();
      await expect(page.locator("#browserPreviewAsk")).toBeDisabled();
      await expect(page.locator("#browserPageActions")).toBeDisabled();
      await expect(page.locator("#browserPreviewStop")).toBeEnabled();
      await page.locator("#browserDialogAccept").focus();
      await page.keyboard.press("Tab");
      await expect(page.locator(".browser-preview-help summary")).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(page.locator("#browserDialogAccept")).toBeFocused();
      await page.screenshot({
        path: testInfo.outputPath(`browser-dialog-${language}.png`),
        animations: "disabled",
      });
      if (language === "en") {
        await page.setViewportSize({ width: 1100, height: 760 });
        await expect(page.locator("#browserPageDialog")).toBeInViewport();
        await page.screenshot({
          path: testInfo.outputPath("browser-dialog-narrow.png"),
          animations: "disabled",
        });
        await page.setViewportSize({ width: 1440, height: 1000 });
      }
      if (language === "zh-TW") {
        await page.emulateMedia({ colorScheme: "dark" });
        await page.screenshot({
          path: testInfo.outputPath("browser-dialog-dark.png"),
          animations: "disabled",
        });
        await page.emulateMedia({ colorScheme: "light" });
      }
      await page.locator("#browserDialogInput").fill("精致的浏览器");
      await page.locator("#browserDialogAccept").click();
      await expect(page.locator("#browserPageDialog")).toBeHidden();
      await expect(page.locator("#browserPageDialogBackdrop")).toBeHidden();
      await expect(page.locator("#browserPageInput")).toBeFocused();
      await expect(page.locator("#browserPreviewUrl")).toBeEnabled();
      await expect(page.locator("#browserBack")).toBeEnabled();
      await expect.poll(() => readText(runtime)).toContain("精致的浏览器");
      await clickPage(page, runtime, 100, 424, false);
      await expect(page.locator("#browserPageDialog")).toBeVisible();
      await page.locator(".browser-preview-help summary").focus();
      await page.keyboard.press("Escape");
      await expect(page.locator("#browserPageDialog")).toBeHidden();
      await expect(page.locator("#browserPreviewPanel")).toBeVisible();
      await runtime.execute({
        action: "fill",
        selector: "#name",
        value: "Shared with Agent",
      });
      await runtime.execute({ action: "click", selector: "#hello" });
      const snapshot = await runtime.execute({ action: "snapshot" });
      expect(snapshot.text).toContain("Hello Shared with Agent");
      expect(
        snapshot.controls?.some((control) => control.selector === "#hello"),
      ).toBe(true);
      expect(snapshot.image).toBeUndefined();
      await page.locator("#browserNewTab").click();
      await expect(page.locator("#browserTabs [role=tab]")).toHaveCount(2);
      await expect(address).toHaveValue("");
      await expect(address).toBeFocused();
      await page.locator("#browserTabs [role=tab]").last().focus();
      await page.keyboard.press("ArrowLeft");
      await expect(page.locator("#browserPreviewPageTitle")).toHaveText(
        "Local studio",
      );
      const focusedClose = page.locator(".browser-live-tab-close").first();
      await focusedClose.focus();
      await runtime.live.handle({ action: "open", address: url + "/next" });
      await expect(page.locator("#browserPreviewPageTitle")).toHaveText(
        "Next page",
      );
      await expect(focusedClose).toBeFocused();
      await runtime.live.handle({ action: "open", address: url });
      await expect(page.locator("#browserPreviewPageTitle")).toHaveText(
        "Local studio",
      );
      await expect(focusedClose).toBeFocused();
      await page.locator(".browser-live-tab-close").last().click();
      await expect(page.locator("#browserTabs [role=tab]")).toHaveCount(1);
      await settleViewport(page, runtime);
      await page.screenshot({
        path: testInfo.outputPath(`browser-${language}-live.png`),
        animations: "disabled",
      });
      const before = await page
        .locator("#browserPreviewImage")
        .getAttribute("src");
      let holdingHover = false;
      let holdNextHover = true;
      let releaseHover!: () => void;
      let markHoverStarted!: () => void;
      const hoverGate = new Promise<void>((resolve) => {
        releaseHover = resolve;
      });
      const hoverStarted = new Promise<void>((resolve) => {
        markHoverStarted = resolve;
      });
      const holdInput: (route: Route) => Promise<void> = async (route) => {
        const action =
          route.request().method() === "POST"
            ? route.request().postDataJSON()
            : undefined;
        if (
          holdNextHover &&
          action?.action === "input" &&
          action.events.every(
            (event: { type: string; phase?: string }) =>
              event.type === "pointer" && event.phase === "move",
          )
        ) {
          holdNextHover = false;
          holdingHover = true;
          const response = await route.fetch();
          markHoverStarted();
          await hoverGate;
          holdingHover = false;
          await route.fulfill({ response });
          return;
        }
        if (holdingHover && route.request().method() === "GET") {
          const response = await route.fetch();
          const data = await response.json();
          if (data.browser) data.browser.busy = true;
          await route.fulfill({ response, json: data });
          return;
        }
        await route.continue();
      };
      await page.route("**/api/browser-preview*", holdInput);
      try {
        await page.locator("#browserPreviewImage").hover();
        await hoverStarted;
        // A busy poll belonging to our own held input must not drop the next wheel.
        await page.waitForTimeout(250);
        const scrolled = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname === "/api/browser-preview" &&
            response.request().postDataJSON().action === "input" &&
            response
              .request()
              .postDataJSON()
              .events.some(
                (event: { type: string; deltaY?: number }) =>
                  event.type === "wheel" && (event.deltaY || 0) > 0,
              ),
        );
        await page.mouse.wheel(0, 600);
        releaseHover();
        await (await scrolled).finished();
      } finally {
        releaseHover();
        await page.unroute("**/api/browser-preview*", holdInput);
      }
      await expect
        .poll(
          async () =>
            (await page.locator("#browserPreviewImage").getAttribute("src")) !==
            before,
        )
        .toBe(true);
      await settleViewport(page, runtime);
      await page.mouse.wheel(0, -600);
      await expect
        .poll(
          async () =>
            (await page.locator("#browserPreviewImage").getAttribute("src")) ===
            before,
        )
        .toBe(true);
      await page.setViewportSize({ width: 1200, height: 760 });
      await settleViewport(page, runtime);
      await expect(page.locator("#conversation")).toBeVisible();
      const splitHeading = page.locator("#emptyState h1");
      await expect(splitHeading).toBeVisible();
      expect(
        await splitHeading.evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).fontSize),
        ),
      ).toBeLessThanOrEqual(22);
      const quickAction = page.locator("#emptyState .suggestion-card").first();
      expect((await quickAction.boundingBox())!.height).toBeLessThanOrEqual(40);
      await quickAction.focus();
      await expect(quickAction).toBeFocused();
      await page.screenshot({
        path: testInfo.outputPath(`browser-${language}-split-narrow.png`),
        animations: "disabled",
      });
      if (language === "en") {
        await page.emulateMedia({ colorScheme: "dark" });
        await page.screenshot({
          path: testInfo.outputPath("browser-en-split-narrow-dark.png"),
          animations: "disabled",
        });
        await page.emulateMedia({ colorScheme: "light" });
      }
      await expect(page.locator("#emptyState .suggestion-card")).toHaveCount(4);
      await page.keyboard.press("Tab");
      const nextQuickAction = page
        .locator("#emptyState .suggestion-card")
        .nth(1);
      await expect(nextQuickAction).toBeFocused();
      expect(
        await nextQuickAction.evaluate(
          (element) => getComputedStyle(element).outlineStyle,
        ),
      ).not.toBe("none");
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      expect(
        (await page.locator("#browserPreviewStage").boundingBox())!.width,
      ).toBeGreaterThanOrEqual(740);
      await expect(page.locator("#browserPreviewPanel")).toBeInViewport();
      await expect(page.locator("#browserPreviewAsk")).toBeInViewport();
      for (const selector of [
        ".browser-preview-help summary",
        "#browserPreviewStop",
        "#browserPreviewAsk",
      ]) {
        const fontSize = await page
          .locator(selector)
          .evaluate((element) =>
            Number.parseFloat(getComputedStyle(element).fontSize),
          );
        expect(fontSize).toBeGreaterThanOrEqual(12);
      }
      const browserSettings = page.locator(".browser-preview-help summary");
      await browserSettings.focus();
      await expect(browserSettings).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator(".browser-preview-help")).toHaveAttribute(
        "open",
        "",
      );
      const footerBounds = await page
        .locator(".browser-preview-footer")
        .boundingBox();
      const settingsBounds = await page
        .locator(".browser-settings-popover")
        .boundingBox();
      expect(settingsBounds!.y + settingsBounds!.height).toBeLessThanOrEqual(
        footerBounds!.y - 4,
      );
      const narrowTestToast = await addSettingsTestToast(page);
      await expectToastAboveSettings(page, narrowTestToast);
      await page.screenshot({
        path: testInfo.outputPath(`browser-${language}-settings-narrow.png`),
        animations: "disabled",
      });
      await narrowTestToast.evaluate((element) => element.remove());
      await page.keyboard.press("Enter");
      await expect(page.locator(".browser-preview-help")).not.toHaveAttribute(
        "open",
        "",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`browser-${language}-narrow.png`),
        animations: "disabled",
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.emulateMedia({ colorScheme: "dark" });
      await settleViewport(page, runtime);
      await page.screenshot({
        path: testInfo.outputPath(`browser-${language}-dark.png`),
        animations: "disabled",
      });
      await page.locator("#browserPreviewAsk").click();
      await expect(page.locator("#prompt")).toHaveValue(
        /^Keep my existing draft\./,
      );
      await expect(page.locator("#browserHandoff")).toBeVisible();
      await expect(page.locator("#browserHandoffTitle")).toHaveText(
        "Local studio",
      );
      const activeTab = (await runtime.live.read()).pageId;
      await page.locator("#changesTab").focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#changesPanel")).toBeVisible();
      await expect(page.locator("#prompt")).toBeEditable();
      await page.keyboard.press("ArrowRight");
      await expect(page.locator("#runTab")).toBeFocused();
      await expect(page.locator("#runPanel")).toBeVisible();
      await page.keyboard.press("Home");
      await expect(page.locator("#browserTab")).toBeFocused();
      await expect(page.locator("#browserPreviewImage")).toBeVisible();
      expect((await runtime.live.read()).pageId).toBe(activeTab);
      await expect(page.locator("#prompt")).toHaveValue(
        /^Keep my existing draft\./,
      );
      await page.locator("#browserPreviewHide").click();
      expect((await runtime.live.read()).active).toBe(true);
      await page.locator("#browserPreviewButton").click();
      await page.locator("#browserPreviewStop").click();
      await expect(page.locator("#browserPreviewImage")).toBeHidden();
      await expect(page.locator("#browserPreviewPanel")).toHaveAttribute(
        "data-status",
        "closed",
        { timeout: 15000 },
      );
      await expect(runtime.execute({ action: "snapshot" })).rejects.toThrow();
      await page.keyboard.press("Escape");
      await expect(page.locator("#browserPreviewButton")).toBeFocused();
      expect(errors).toEqual([]);
    } finally {
      await stopOrbitWebUi();
      await close(server);
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}

test("discards stopped and previous-session frames without overwriting the draft", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const cwd = mkdtempSync(join(tmpdir(), "orbit-live-race-"));
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(fixture);
  });
  const url = await listen(server);
  let runtime!: BrowserPreviewRuntime,
    session = "before",
    release: (() => void) | undefined;
  try {
    const handle = await startOrbitWebUi({
      cwd,
      config: structuredClone(DEFAULT_CONFIG),
      port: 0,
      open: false,
      loop: {
        getSessionId: () => session,
        setBrowserPreviewService: (service) => {
          if (service) runtime = service as BrowserPreviewRuntime;
        },
      },
      updateSession: async () => {
        session = "after";
        // Session changes revoke browser ownership before Chromium teardown finishes.
        void runtime.reset().catch(() => undefined);
        return { ok: true };
      },
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(handle.url);
    await page.locator("#browserPreviewButton").click();
    await page.locator("#browserPreviewUrl").fill(url);
    await page.locator("#browserPreviewStart").click();
    await expect(page.locator("#browserPreviewImage")).toBeVisible();
    const captured = await runtime.live.read();
    let held = false,
      hold: "GET" | "POST" | undefined = "POST";
    await page.route("**/api/browser-preview*", async (route) => {
      if (
        route.request().method() !== hold ||
        (hold === "POST" && route.request().postDataJSON().action !== "reload")
      ) {
        await route.continue();
        return;
      }
      hold = undefined;
      held = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route
        .fulfill({ json: { ok: true, browser: captured } })
        .catch(() => undefined);
    });
    await page.locator("#browserPreviewReload").click();
    await expect.poll(() => held).toBe(true);
    await page.locator("#prompt").fill("Keep this draft while browsing.");
    await page.locator("#browserPreviewStop").click();
    await expect(page.locator("#browserPreviewPanel")).toHaveAttribute(
      "data-status",
      "closed",
      { timeout: 15000 },
    );
    const late = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/browser-preview") &&
        response.request().method() === "POST" &&
        response.request().postDataJSON().action === "reload",
    );
    release!();
    await (await late).finished();
    await expect(page.locator("#browserPreviewImage")).toBeHidden();
    await expect(page.locator("#prompt")).toHaveValue(
      "Keep this draft while browsing.",
    );
    await page.locator("#browserPreviewUrl").fill(url);
    await page.locator("#browserPreviewStart").click();
    await expect(page.locator("#browserPreviewImage")).toBeVisible();
    held = false;
    hold = "GET";
    await expect.poll(() => held).toBe(true);
    const cancelled = page.waitForEvent(
      "requestfailed",
      (request) =>
        request.url().includes("/api/browser-preview?") &&
        request.method() === "GET",
    );
    await page.locator("#newTaskButton").click();
    await expect(page.locator("#browserPreviewUrl")).toHaveValue("");
    release!();
    await cancelled;
    await expect(page.locator("#browserPreviewImage")).toBeHidden();
    await expect(page.locator("#browserPreviewPanel")).toHaveAttribute(
      "data-status",
      "closed",
    );
    await page.locator("#browserPreviewUrl").fill(url);
    await page.locator("#browserPreviewStart").click();
    await expect(page.locator("#browserPreviewImage")).toBeVisible();
  } finally {
    release?.();
    await page.unrouteAll({ behavior: "wait" });
    await stopOrbitWebUi();
    await close(server);
    rmSync(cwd, { recursive: true, force: true });
  }
});
