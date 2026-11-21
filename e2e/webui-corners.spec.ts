import { expect, test, type Locator } from "@playwright/test";
import { DEFAULT_CONFIG } from "../packages/config/src/defaults.js";
import { startOrbitWebUi, stopOrbitWebUi } from "../packages/cli/src/runtime/webui/WebUiServer.js";
import type { WebUiApprovalSnapshot } from "../packages/cli/src/runtime/webui/WebUiContracts.js";

async function reachable(locator: Locator) {
  await expect
    .poll(() =>
      locator.evaluate((node) => {
        const r = node.getBoundingClientRect();
        return (
          r.width > 0
          && r.height > 0
          && r.top >= 0
          && r.bottom <= innerHeight
          && r.left >= 0
          && r.right <= innerWidth
          && node.contains(
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
          )
        );
      })
    )
    .toBe(true);
}

async function contained(locator: Locator) {
  await expect
    .poll(() =>
      locator.evaluate((node) => {
        const r = node.getBoundingClientRect();
        return (
          r.top >= 0
          && r.bottom <= innerHeight
          && r.left >= 0
          && r.right <= innerWidth
        );
      })
    )
    .toBe(true);
}

for (const language of ["en", "zh", "zh-TW"] as const) {
  test(`keeps stacked controls and small dialogs usable in ${language}`, async ({
    page,
  }, testInfo) => {
    let decisions = 0;
    let approval: WebUiApprovalSnapshot | undefined = {
      id: "b2a4c5ce-0000-4000-8000-000000000095",
      kind: "tool",
      title: "Review a long workspace path",
      reason: "workspace/" + "nested_directory_".repeat(25),
      preview: "Review this command before continuing.\n".repeat(30),
      requestedAt: new Date().toISOString(),
    };
    const errors: string[] = [];
    const title = "Long conversation title ".repeat(6);
    const handle = await startOrbitWebUi({
      cwd: process.cwd(),
      config: { ...structuredClone(DEFAULT_CONFIG), language },
      port: 0,
      open: false,
      loop: {
        getSessionId: () => "active",
        getHistory: () => [
          {
            id: "ready",
            role: "assistant",
            content: [{ type: "text", text: "Review the pending operation." }],
          },
        ],
        getSessions: () =>
          ["active", "previous"].map((id) => ({
            id,
            title,
            model: "deepseek-flash",
            updatedAt: new Date().toISOString(),
          })),
        getQueuedInputs: () =>
          Array.from({ length: 4 }, (_, index) => ({
            id: `queued-${index}`,
            mode: "follow_up",
            source: "web",
            text: "Keep this queued request.",
            attachments: [],
            createdAt: new Date().toISOString(),
          })),
      },
      getPendingApproval: () => approval,
      respondToApproval: () => {
        decisions++;
        approval = undefined;
        return { ok: true };
      },
      openProject: () => ({
        ok: false,
        message: "Cannot open this project: " + "long_path_".repeat(35),
      }),
    });
    try {
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(handle.url);
      await expect(page.locator("#connectionState")).toHaveClass(
        /is-connected/,
      );
      await page
        .locator("#prompt")
        .fill("Preserve my multiline draft.\n".repeat(15));
      for (const [width, height] of [
        [390, 480],
        [844, 390],
        [320, 360],
      ]) {
        await page.setViewportSize({ width: width!, height: height! });
        await page
          .locator("#appShell")
          .evaluate((node) =>
            Promise.all(
              node
                .getAnimations()
                .map((animation) => animation.finished.catch(() => undefined)),
            )
          );
        const conversation = page.locator("#conversation");
        const rect = await conversation.boundingBox();
        await page.mouse.move(rect!.x + 2, rect!.y + rect!.height / 2);
        await page.mouse.wheel(0, 2000);
        await expect
          .poll(() =>
            conversation.evaluate(
              (node) => node.scrollTop + node.clientHeight >= node.scrollHeight - 1,
            )
          )
          .toBe(true);
        await reachable(page.locator("#sendButton"));
        await expect(page.locator("#promptQueue")).not.toHaveAttribute("open", "");
        await expect(page.locator("#queueCount")).toHaveText("4");
        await page.locator("#jumpApproval").click();
        await page.locator("#prompt").focus();
        await page.locator("#denyApprovalButton").focus();
        await page.locator("#denyApprovalButton").scrollIntoViewIfNeeded();
        await reachable(page.locator("#denyApprovalButton"));
        expect(
          await page
            .locator("#approvalReason")
            .evaluate((node) => node.scrollWidth <= node.clientWidth),
        ).toBe(true);
        expect(decisions).toBe(0);
        await page.screenshot({
          path: testInfo.outputPath(`approval-${width}.png`),
          animations: "disabled",
        });
      }
      await page.locator("#denyApprovalButton").click();
      await expect(page.locator("#approvalPanel")).toBeHidden();
      expect(decisions).toBe(1);
      await page.locator("#contextPickerButton").click();
      await expect(page.locator("#contextSearch")).toBeFocused();
      await contained(page.locator("#contextPicker"));
      await reachable(page.locator("#contextPickerClose"));
      await page.screenshot({
        path: testInfo.outputPath("context-short.png"),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await expect(page.locator("#contextPickerButton")).toBeFocused();
      await expect(page.locator("#prompt")).toHaveValue(
        "Preserve my multiline draft.\n".repeat(15),
      );

      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        await page.keyboard.press("Control+k");
        await expect(page.locator("#commandSearch")).toBeFocused();
        await contained(page.locator(".command-palette-dialog"));
        await reachable(page.locator(".command-palette-footer"));
        await page.keyboard.press("Escape");
        await page.locator("#menuButton").click();
        await page.locator("#newProjectButton").click();
        await contained(page.locator(".project-dialog-card"));
        await page.locator("#projectPathInput").fill("/missing/project");
        await page.locator("#projectDialogCreate").focus();
        await reachable(page.locator("#projectDialogCreate"));
        await page.keyboard.press("Enter");
        await expect(page.locator(".toast.is-error")).toBeVisible();
        await expect(page.locator("#projectPathInput")).toHaveValue(
          "/missing/project",
        );
        await expect(page.locator("#projectDialogCreate")).toBeEnabled();
        expect(
          await page
            .locator(".toast.is-error")
            .evaluate((node) => node.scrollWidth <= node.clientWidth),
        ).toBe(true);
        await page.keyboard.press("Escape");
        const deleteButton = page.locator(
          '[data-session-action="delete"][data-session-id="previous"]',
        );
        await page
          .locator(".session-row")
          .filter({ has: deleteButton })
          .hover();
        await page.screenshot({
          path: testInfo.outputPath(`sidebar-${colorScheme}.png`),
        });
        await reachable(deleteButton);
        await deleteButton.click();
        await contained(page.locator(".session-delete-card"));
        await expect(page.locator(".session-delete-copy strong")).toHaveText(
          title.trim(),
        );
        expect(
          await page
            .locator(".session-delete-copy strong")
            .evaluate((node) => node.scrollWidth <= node.clientWidth),
        ).toBe(true);
        const confirm = page.locator(".session-delete-confirm");
        const contrast = await confirm.evaluate((node) => {
          const style = getComputedStyle(node);
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const ctx = canvas.getContext("2d")!;
          const luminance = (color: string) => {
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 1, 1);
            const rgb = Array.from(ctx.getImageData(0, 0, 1, 1).data)
              .slice(0, 3)
              .map((v) => {
                const x = v / 255;
                return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
              });
            return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
          };
          const a = luminance(style.color),
            b = luminance(style.backgroundColor);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        });
        expect(contrast).toBeGreaterThanOrEqual(4.5);
        await confirm.focus();
        await reachable(confirm);
        await page.screenshot({
          path: testInfo.outputPath(`delete-${colorScheme}.png`),
          animations: "disabled",
        });
        await page.keyboard.press("Escape");
        await expect(
          page.locator(
            '[data-session-action="delete"][data-session-id="previous"]',
          ),
        ).toBeFocused();
        await page.keyboard.press("Escape");
      }
      expect(errors).toEqual([]);
    } finally {
      await page.close();
      await stopOrbitWebUi(handle.id);
    }
  });
}
