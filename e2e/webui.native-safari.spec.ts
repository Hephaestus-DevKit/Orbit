import { expect, test } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../packages/config/src/defaults.js";
import { startOrbitWebUi, stopOrbitWebUi } from "../packages/cli/src/runtime/webui/WebUiServer.js";
import { clickSafari, readSafari, typeSafari, withSafari } from "./native-safari-driver.js";

test("system Safari captures the Web UI and handles real keyboard input", async () => {
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
      await safari.command("POST", "/window/rect", { width: 1200, height: 800 });
      await safari.command("POST", "/url", { url: handle.url });
      await expect.poll(
        () =>
          readSafari(
            safari,
            'return document.querySelector("#connectionState")?.classList.contains("is-connected")',
          ),
        { timeout: 10_000 },
      ).toBe(true);
      const before = await safari.captureFrame();
      await clickSafari(safari, "#commandsButton");
      await expect.poll(() =>
        readSafari(safari, 'return document.querySelector("#commandPalette").hidden')
      ).toBe(false);
      await expect.poll(async () => (await safari.captureFrame()).image === before.image)
        .toBe(false);
      await safari.command("POST", "/actions", {
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
      // Simulate the two observable keydown shapes while choosing an IME candidate.
      // Physical key input is exercised immediately afterwards.
      expect(
        await readSafari(
          safari,
          `
        const prompt = document.querySelector("#prompt");
        prompt.value = "/mo"; prompt.dispatchEvent(new Event("input", { bubbles: true }));
        prompt.focus();
        return [ { isComposing: true }, { keyCode: 229 } ].every(init =>
          prompt.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter", bubbles: true, cancelable: true, ...init
          })) && prompt.value === "/mo"
        );
      `,
        ),
      ).toBe(true);
      await readSafari(safari, 'document.querySelector("#prompt").value = "";');
      await typeSafari(safari, "#prompt", "System Safari input");
      await expect.poll(() => readSafari(safari, 'return document.querySelector("#prompt").value'))
        .toBe("System Safari input");
    });
  } finally {
    await stopOrbitWebUi();
    rmSync(cwd, { recursive: true, force: true });
  }
});
