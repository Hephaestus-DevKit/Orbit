import { describe, expect, it } from "../../../../../scripts/testing/support.mjs";
import { createPreviewGeometry } from "./WebUiBrowserPreviewLayout.js";
import { renderBrowserPreview } from "./WebUiBrowserPreview.js";
import { renderWebUiPage } from "./WebUiPage.js";

describe("desktop browser preview", () => {
  const geometry = createPreviewGeometry();
  it("reserves usable space for both chat and preview", () => {
    for (const width of [1180, 1208, 1680]) {
      for (const preferred of [-50, 0, 54, 100, 150, NaN]) {
        const layout = geometry.dock(width, preferred);
        expect(layout.narrow).toBe(false);
        expect((width * layout.percent) / 100).toBeGreaterThanOrEqual(740);
        expect(
          Math.round(width * (1 - layout.percent / 100)),
        ).toBeGreaterThanOrEqual(420);
      }
    }
  });
  it("uses a focused preview when the workbench cannot fit two useful panes", () => {
    for (const width of [760, 1080]) {
      expect(geometry.dock(width, 54)).toEqual({
        narrow: true,
        min: 100,
        max: 100,
        percent: 100,
      });
    }
  });
  it("fits both dimensions without upscaling or changes to original-size inspection", () => {
    expect(geometry.image(640, 432, 1280, 800, false)).toEqual({
      scale: 0.475,
      width: 608,
      height: 380,
    });
    const portrait = geometry.image(640, 432, 390, 844, false);
    expect(portrait.height).toBeLessThanOrEqual(400);
    expect(geometry.image(640, 432, 1280, 800, true)).toEqual({
      scale: 1,
      width: 1280,
      height: 800,
    });
    expect(geometry.image(1600, 1200, 1280, 800, false).scale).toBe(1);
    expect(geometry.image(0, 0, 0, 0, false).width).toBe(0);
  });
  it.each(["en", "zh", "zh-TW"] as const)(
    "renders a nonmodal, keyboard accessible dock in %s",
    (language) => {
      const html = renderBrowserPreview(language);
      expect(html).not.toContain("<dialog");
      expect(html).toContain('id="browserAddressForm"');
      expect(html).toContain('id="browserViewport"');
      expect(html).not.toContain("<iframe"); // No website is requested on opening the panel.
      const page = renderWebUiPage(language);
      expect(page).toContain('role="separator"');
      expect(page).toContain('aria-orientation="vertical"');
      expect(page).toContain('id="workbench"');
      expect(page).toContain(
        `data-return-label="${
          language === "en" ? "Back to chat" : language === "zh" ? "返回对话" : "返回對話"
        }"`,
      );
      expect(html).toContain('role="tabpanel" aria-labelledby="browserTab"');
      expect(html).toContain('id="browserPreviewPanel"');
      expect(html).toContain("orbit webui --safari-extension-path");
      expect(html).toContain("Orbit for Safari");
    },
  );
});
