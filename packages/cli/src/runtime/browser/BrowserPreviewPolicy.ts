import { z } from "zod";
import { BrowserPreviewActionSchema } from "@orbit-build/core";

export const BrowserPreviewRequestSchema = z.union([
  z
    .object({
      action: z.literal("connect"),
      url: z.string().trim().min(1).max(2048),
    })
    .strict(),
  z.object({ action: z.literal("disconnect") }).strict(),
  BrowserPreviewActionSchema,
]);

/** Pin previews to a user-selected loopback origin, never the Orbit control port. */
export function parsePreviewUrl(input: string, blockedPort?: number): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter an HTTP URL such as http://127.0.0.1:5173.");
  }
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !url.port ||
    Number(url.port) < 1024 ||
    Number(url.port) === blockedPort ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Preview requires a local HTTP project port (1024–65535), without credentials, query, or fragment. Orbit's own port is not allowed.",
    );
  }
  // Do not rely on DNS for localhost, including on hosts with modified hosts files.
  url.hostname = "127.0.0.1";
  return url;
}

/** Same-origin subresources only; no external/private-network expansion. */
export function isPreviewRequestAllowed(
  input: string,
  origin: string,
  websocket = false,
): boolean {
  try {
    const url = new URL(input);
    if (url.username || url.password) return false;
    if (websocket) {
      if (url.protocol !== "ws:") return false;
      url.protocol = "http:";
    }
    return url.protocol === "http:" && url.origin === origin;
  } catch {
    return false;
  }
}
