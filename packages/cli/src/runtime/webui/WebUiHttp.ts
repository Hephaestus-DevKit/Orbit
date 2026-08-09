import type { IncomingMessage, ServerResponse } from "http";
import { WebUiRequestError } from "./WebUiErrors.js";

const WEB_UI_BODY_LIMIT_BYTES = 256_000;

/** Send a no-cache JSON response with baseline browser hardening headers. */
export function sendJson(
  res: ServerResponse,
  status: number,
  data: unknown,
): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(data));
}

/** Send the application shell with a restrictive local-only CSP. */
export function sendHtml(
  res: ServerResponse,
  status: number,
  body: string,
): void {
  const headers: Record<string, string> = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
  res.writeHead(status, headers);
  res.end(body);
}

/** Send an in-memory Web UI asset without allowing browser caching. */
export function sendAsset(
  res: ServerResponse,
  contentType: "text/css" | "text/javascript" | "image/svg+xml",
  body: string,
): void {
  res.writeHead(200, {
    "Content-Type": `${contentType}; charset=utf-8`,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

/** Exchange the URL-fragment bearer secret for an HttpOnly session cookie. */
export function bootstrapWebSession(res: ServerResponse, token: string): void {
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Set-Cookie": createWebSessionCookie(token),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify({ ok: true }));
}

function createWebSessionCookie(token: string): string {
  return `orbit_web_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`;
}

/** Parse a bounded JSON request body. */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > WEB_UI_BODY_LIMIT_BYTES) {
      throw new WebUiRequestError(
        "request_body_too_large",
        413,
        "Request body too large.",
      );
    }
    chunks.push(buffer);
  }
  const body = Buffer.concat(chunks).toString("utf8").trim();
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new WebUiRequestError(
      "invalid_json",
      400,
      "Invalid JSON request body.",
    );
  }
}

/** Read a bounded binary body for local image attachments. */
export async function readBinaryBody(
  req: IncomingMessage,
  limitBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > limitBytes) {
      throw new WebUiRequestError(
        "attachment_too_large",
        413,
        "Attachment is too large.",
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
