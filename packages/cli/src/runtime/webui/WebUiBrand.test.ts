import { describe, expect, it } from "../../../../../scripts/testing/support.mjs";
import { WEB_UI_FAVICON_SVG, renderOrbitMark } from "./WebUiBrand.js";

describe("WebUiBrand", () => {
  it("renders the same recognizable cat geometry for UI marks and favicon", () => {
    const mark = renderOrbitMark("brand-mark");

    expect(mark).toContain('class="orbit-mark brand-mark"');
    expect(mark).toContain('class="orbit-cat-head"');
    expect(mark).toContain('class="orbit-cat-eye"');
    expect(mark).toContain('class="orbit-cat-satellite"');
    expect(mark).toContain('cx="18.5" cy="26.6" r="1.35"');
    expect(mark).toContain("M13 19 11.5 10.5");
    expect(mark).not.toContain("orbit-cat-orbit");
    expect(WEB_UI_FAVICON_SVG).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(WEB_UI_FAVICON_SVG).toContain('fill="#d97972"');
    expect(WEB_UI_FAVICON_SVG).toContain('r="1.35" fill="#587481"');
    expect(WEB_UI_FAVICON_SVG).not.toContain("<rect");
    expect(WEB_UI_FAVICON_SVG).not.toContain("<script");
  });
});
