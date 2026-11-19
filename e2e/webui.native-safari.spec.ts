import { expect, test } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../packages/config/src/defaults.js";
import { startOrbitWebUi, stopOrbitWebUi } from "../packages/cli/src/runtime/webui/WebUiServer.js";
import { clickSafari, readSafari, withSafari } from "./native-safari-driver.js";

test("native Safari opens and dismisses the command palette", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "orbit-native-safari-"));
  try {
    const handle = await startOrbitWebUi({
      cwd,
      config: structuredClone(DEFAULT_CONFIG),
      port: 0,
      open: false,
      loop: { getSessionId: () => "native-safari-test" },
    });
    await withSafari(async (safari) => {
      await safari("POST", "/window/rect", { width: 1200, height: 800 });
      await safari("POST", "/url", { url: handle.url });
      await expect.poll(
        () =>
          readSafari(
            safari,
            'return document.querySelector("#connectionState")?.classList.contains("is-connected")',
          ),
        { timeout: 10_000 },
      ).toBe(true);
      await clickSafari(safari, "#commandsButton");
      await expect.poll(() =>
        readSafari(safari, 'return document.querySelector("#commandPalette").hidden')
      ).toBe(false);
      await safari("POST", "/actions", {
        actions: [{
          type: "key",
          id: "keyboard",
          actions: [{ type: "keyDown", value: "\uE00C" }, { type: "keyUp", value: "\uE00C" }],
        }],
      });
      await expect.poll(() =>
        readSafari(safari, 'return document.querySelector("#commandPalette").hidden')
      ).toBe(true);
      await expect.poll(() => readSafari(safari, "return document.activeElement.id")).toBe(
        "commandsButton",
      );
    });
  } finally {
    await stopOrbitWebUi();
    rmSync(cwd, { recursive: true, force: true });
  }
});
