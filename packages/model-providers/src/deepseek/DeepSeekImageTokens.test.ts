import { describe, expect, it } from "../../../../scripts/testing/support.mjs";
import { deepSeekImageTokens, estimateDeepSeekImageTokens } from "./DeepSeekImageTokens.js";

describe("DeepSeek image token projection", () => {
  it("applies the small-image floor and grid framing", () => {
    expect(deepSeekImageTokens(1, 1)).toBe(184);
    expect(deepSeekImageTokens(512, 512)).toBe(184);
    expect(deepSeekImageTokens(1024, 1024)).toBe(652);
  });
  it("reaches the published fixed point for narrow image geometries", () => {
    for (const [w, h, expected] of [
      [1, 1370, 1010],
      [2, 704, 506],
      [14, 4996, 506],
      [41, 3738, 380],
      [41, 6735, 338],
      [42, 6735, 338],
    ])
      expect(deepSeekImageTokens(w, h)).toBe(expected);
  });
  it("stays bounded across large and extreme aspect ratios", () => {
    for (const [w, h] of [
      [4000, 3000],
      [3000, 4000],
      [1000000, 1],
      [1, 1000000],
      [8000, 8000],
    ]) {
      const tokens = deepSeekImageTokens(w, h);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThanOrEqual(1024);
    }
    expect(deepSeekImageTokens(NaN, 1)).toBe(1024);
    expect(deepSeekImageTokens(0, 1)).toBe(1024);
  });
  it("reads supported image headers and falls back safely for malformed data", () => {
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.write("IHDR", 12);
    png.writeUInt32BE(1024, 16);
    png.writeUInt32BE(1024, 20);
    const gif = Buffer.alloc(10);
    gif.write("GIF89a");
    gif.writeUInt16LE(1024, 6);
    gif.writeUInt16LE(1024, 8);
    const webp = Buffer.alloc(30);
    webp.write("RIFF");
    webp.write("WEBPVP8X", 8);
    webp.writeUIntLE(1023, 24, 3);
    webp.writeUIntLE(1023, 27, 3);
    const jpeg = Buffer.from([255, 216, 255, 192, 0, 7, 8, 4, 0, 4, 0]);
    for (const header of [png, gif, webp, jpeg])
      expect(
        estimateDeepSeekImageTokens({
          type: "image",
          mediaType: "image/png",
          data: header.toString("base64"),
        }),
      ).toBe(652);
    for (const data of [
      "",
      "invalid",
      Buffer.from([255, 216, 255, 192, 255, 255]).toString("base64"),
    ])
      expect(
        estimateDeepSeekImageTokens({
          type: "image",
          mediaType: "image/png",
          data,
        }),
      ).toBe(1024);
  });
});
