/** Capture the local Web UI preview in system Safari on macOS or WebKit on other hosts. */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startSafariWebDriver } from "../../packages/cli/src/runtime/browser/SafariWebDriver.ts";
import { sanitizeLocalWebUiUrl } from "../../packages/cli/src/runtime/webui/WebUiSecurity.ts";

const url = sanitizeLocalWebUiUrl(process.argv[2]);
if (!url) throw new Error("Pass the authenticated loopback URL printed by pnpm webui:preview.");
const outDir = resolve(process.argv[3] ?? join(dirname(fileURLToPath(import.meta.url)), ".shots"));
mkdirSync(outDir, { recursive: true });

// This function executes in the preview document in both browsers.
async function preparePreview({ theme, panel }) {
  async function waitUntil(ready, state) {
    const deadline = performance.now() + 8000;
    while (!ready()) {
      if (performance.now() > deadline) throw Error("Timed out waiting for " + state + ".");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  await waitUntil(
    () => document.querySelector("#connectionState.is-connected"),
    "the workspace connection",
  );
  document.querySelector('[data-theme-value="' + theme + '"]').click();
  if (panel === "changes") {
    document.querySelector("#changesButton").click();
    await waitUntil(() => !document.querySelector("#changesPanel").hidden, "the changes panel");
    const card = document.querySelector("#changesList .change-card");
    if (card && !card.open) card.querySelector("summary").click();
  } else if (panel === "palette") {
    document.querySelector("#commandsButton").click();
    await waitUntil(() => !document.querySelector("#commandPalette").hidden, "the command palette");
  }
  await document.fonts.ready;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const transitions = document.getAnimations().filter(animation =>
    animation.playState === "running"
    && Number.isFinite(animation.effect?.getComputedTiming().endTime)
  );
  // New status updates can animate continuously. Only wait for this view's transitions.
  await Promise.race([
    Promise.allSettled(transitions.map(animation => animation.finished)),
    new Promise(resolve => setTimeout(resolve, 1000)),
  ]);
}

async function captureSafari(viewport, options) {
  const session = await startSafariWebDriver();
  try {
    await session.command("POST", "/window/rect", viewport);
    await session.command("POST", "/url", { url });
    const rect = await session.command("GET", "/window/rect");
    const [width, height] = await session.command("POST", "/execute/sync", {
      script: "return [innerWidth, innerHeight]",
      args: [],
    });
    // WebDriver sizes the outer window. Account for Safari's actual toolbar height.
    await session.command("POST", "/window/rect", {
      width: rect.width + viewport.width - width,
      height: rect.height + viewport.height - height,
    });
    const result = await session.command("POST", "/execute/async", {
      script: `const [options, done] = arguments;
        (${preparePreview})(options).then(() => done([innerWidth, innerHeight]), () => done(null));`,
      args: [options],
    });
    if (!result) throw Error("Safari could not prepare the local preview.");
    if (result[0] !== viewport.width || result[1] !== viewport.height) {
      throw Error(
        "Safari viewport was " + result.join("×") + ", expected " + viewport.width + "×"
          + viewport.height + ".",
      );
    }
    return Buffer.from((await session.captureFrame()).image, "base64");
  } finally {
    await session.close();
  }
}

const browser = process.platform === "darwin"
  ? undefined
  : await (await import("@playwright/test")).webkit.launch();
try {
  for (const [name, width, height, theme, panel] of [
    ["desktop-light", 1440, 900, "light"],
    ["desktop-dark", 1440, 900, "dark"],
    ["mobile-light", 390, 844, "light"],
    ["mobile-dark", 390, 844, "dark"],
    ["inspector-changes", 1440, 900, "light", "changes"],
    ["inspector-changes-dark", 1440, 900, "dark", "changes"],
    ["palette", 1440, 900, "light", "palette"],
  ]) {
    const viewport = { width, height };
    const options = { theme, panel };
    const path = join(outDir, name + ".png");
    if (browser) {
      const page = await browser.newPage({ viewport, colorScheme: theme });
      try {
        await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {
          throw new Error("Could not open the local preview in WebKit.");
        });
        await page.evaluate(preparePreview, options);
        await page.screenshot({ path });
      } finally {
        await page.close();
      }
    } else {
      writeFileSync(path, await captureSafari(viewport, options));
    }
    console.log("SHOT " + name);
  }
} finally {
  await browser?.close();
}
