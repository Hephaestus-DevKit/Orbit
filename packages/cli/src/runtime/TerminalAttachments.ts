import { lstatSync, readFileSync, statSync } from "fs";
import { basename, extname } from "path";
import { resolveSafePath } from "@orbit-build/shared";
import type { OrbitContentBlock } from "@orbit-build/model-providers";

export const MAX_TERMINAL_IMAGE_BYTES = 5 * 1024 * 1024;

type ImageBlock = Extract<OrbitContentBlock, { type: "image" }>;

const IMAGE_TYPES: Record<string, ImageBlock["mediaType"]> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export interface TerminalImageOptions {
  cwd: string;
  allowSymbolicLink?: boolean;
}

export function loadTerminalImage(
  requestedPath: string,
  options: TerminalImageOptions,
): ImageBlock {
  const relative = requestedPath.trim().replace(/^(["'])(.*)\1$/, "$2");
  if (!relative || /[\u0000-\u001f\u007f]/.test(relative)) {
    throw new Error("Image path must be a non-empty workspace-relative path.");
  }
  const path = resolveSafePath(options.cwd, relative);
  const leaf = lstatSync(path);
  if (leaf.isSymbolicLink() && !options.allowSymbolicLink) {
    throw new Error(
      "TUI image attachment rejects symbolic links in normal mode.",
    );
  }
  if (!leaf.isFile())
    throw new Error(`Image is not a regular file: ${relative}`);
  const stats = statSync(path);
  if (stats.size <= 0 || stats.size > MAX_TERMINAL_IMAGE_BYTES) {
    throw new Error(
      `Image must be between 1 byte and ${MAX_TERMINAL_IMAGE_BYTES / (1024 * 1024)} MiB.`,
    );
  }
  const mediaType = IMAGE_TYPES[extname(path).toLowerCase()];
  if (!mediaType)
    throw new Error("TUI attachments support PNG, JPEG, GIF, and WebP images.");
  const bytes = readFileSync(path);
  if (!matchesImageSignature(mediaType, bytes)) {
    throw new Error(
      `Image bytes do not match the declared ${mediaType} format.`,
    );
  }
  return {
    type: "image",
    mediaType,
    data: bytes.toString("base64"),
    name: basename(path),
  };
}

function matchesImageSignature(
  mediaType: ImageBlock["mediaType"],
  bytes: Buffer,
): boolean {
  if (mediaType === "image/png")
    return (
      bytes.length >= 8 &&
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    );
  if (mediaType === "image/jpeg")
    return (
      bytes.length >= 3 &&
      bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    );
  if (mediaType === "image/gif")
    return (
      bytes.length >= 6 &&
      (bytes.subarray(0, 6).toString("ascii") === "GIF87a" ||
        bytes.subarray(0, 6).toString("ascii") === "GIF89a")
    );
  return (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  );
}
