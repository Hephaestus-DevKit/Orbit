import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSafariFrame } from "./SafariWebDriver.js";

function pngHeader(width: number, height: number): string {
  const header = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(header);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12);
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header.toString("base64");
}

test("reads the captured Safari viewport dimensions from its PNG", () => {
  const image = pngHeader(2560, 1440);
  assert.deepEqual(parseSafariFrame(image), { image, width: 2560, height: 1440 });
});

test("rejects truncated, invalid, or excessively large Safari frames", () => {
  for (const value of ["bad!", "iVBORw0KGgo=", pngHeader(0, 400), pngHeader(9000, 9000)]) {
    assert.throws(() => parseSafariFrame(value), /screenshot/);
  }
  assert.throws(() => parseSafariFrame("A".repeat(6_000_001)), /oversized/);
});
