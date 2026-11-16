import type { OrbitContentBlock } from "../types.js";

const MAX_IMAGE_TOKENS = 1024;
const MAX_HEADER_BYTES = 256 * 1024;

/** Project DeepSeek's published 14px patches, 3:1 grid and 1024-token image cap. */
export function deepSeekImageTokens(width: number, height: number): number {
  if (
    ![width, height].every(
      (n) => Number.isSafeInteger(n) && n > 0 && n <= 1_000_000,
    )
  )
    return MAX_IMAGE_TOKENS;
  let w = width,
    h = height;
  let previousWidth = -1,
    previousHeight = -1;
  let tokens = MAX_IMAGE_TOKENS;
  for (let iteration = 0; iteration < 10; iteration++) {
    const scale = Math.max(1, Math.sqrt((544 * 544) / (w * h)));
    w = Math.floor(w * scale);
    h = Math.floor(h * scale);
    const paddedW = Math.ceil(w / 14) * 14;
    const paddedH = Math.ceil(h / 14) * 14;
    tokens = Math.ceil(paddedH / 42) * (Math.ceil(paddedW / 42) + 1) + 2;
    if (tokens <= MAX_IMAGE_TOKENS) {
      w = paddedW;
      h = paddedH;
    } else {
      const ratio = h / w;
      const gridW = Math.sqrt((MAX_IMAGE_TOKENS - 2) / ratio + 0.25) - 0.5;
      const gridH = gridW * ratio;
      if (gridW < 1) {
        w = 42;
        h = 511 * 42;
      } else if (gridH < 1) {
        w = 1021 * 42;
        h = 42;
      } else {
        const resize = Math.min(
          (Math.floor(gridW) * 42) / w,
          (Math.floor(gridH) * 42) / h,
        );
        w = Math.floor((w * resize) / 14) * 14;
        h = Math.floor((h * resize) / 14) * 14;
      }
      tokens = Math.ceil(h / 42) * (Math.ceil(w / 42) + 1) + 2;
    }
    if (w === previousWidth && h === previousHeight) return tokens;
    previousWidth = w;
    previousHeight = h;
  }
  return tokens;
}

/** Read bounded image headers only; unknown/truncated encodings retain the full allowance. */
export function estimateDeepSeekImageTokens(
  image: Extract<OrbitContentBlock, { type: "image" }>,
): number {
  const bytes = Buffer.from(
    image.data.slice(0, Math.ceil(MAX_HEADER_BYTES / 3) * 4),
    "base64",
  );
  const size = imageDimensions(bytes);
  return size ? deepSeekImageTokens(size[0], size[1]) : MAX_IMAGE_TOKENS;
}

function imageDimensions(b: Buffer): [number, number] | undefined {
  if (
    b.length >= 24 &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    b.toString("ascii", 12, 16) === "IHDR"
  )
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b.length >= 10 && /^GIF8[79]a$/.test(b.toString("ascii", 0, 6)))
    return [b.readUInt16LE(6), b.readUInt16LE(8)];
  if (
    b.length >= 30 &&
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  ) {
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8X")
      return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (kind === "VP8 " && b.subarray(23, 26).equals(Buffer.from([157, 1, 42])))
      return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    if (kind === "VP8L" && b[20] === 0x2f)
      return [
        1 + ((((b[22] ?? 0) & 0x3f) << 8) | b[21]!),
        1 + (((b[24]! & 0xf) << 10) | (b[23]! << 2) | (b[22]! >> 6)),
      ];
  }
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  for (let at = 2; at + 4 <= b.length;) {
    if (b[at++] !== 0xff) return undefined;
    while (b[at] === 0xff) at++;
    const marker = b[at++];
    if (
      marker === undefined ||
      marker === 0xda ||
      marker === 0xd9 ||
      at + 2 > b.length
    )
      return undefined;
    const length = b.readUInt16BE(at);
    if (length < 2 || at + length > b.length) return undefined;
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker) &&
      length >= 7
    )
      return [b.readUInt16BE(at + 5), b.readUInt16BE(at + 3)];
    at += length;
  }
  return undefined;
}
