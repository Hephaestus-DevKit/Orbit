import { spawn } from "node:child_process";
import { once } from "node:events";
import { request } from "node:http";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { HIDDEN_CHILD_PROCESS_OPTIONS } from "@orbit-build/shared";
import { z } from "zod";

const RESPONSE_LIMIT = 6_500_000;
const FRAME_LIMIT = 6_000_000;
const PNG_SIGNATURE = "89504e470d0a1a0a";
const SessionSchema = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  capabilities: z.object({ browserName: z.string() }),
});
const ResponseSchema = z.object({ value: z.unknown() });

export interface SafariFrame {
  readonly image: string;
  readonly width: number;
  readonly height: number;
}

export interface SafariWebDriver {
  command(method: "GET" | "POST", route: string, body?: object): Promise<unknown>;
  captureFrame(): Promise<SafariFrame>;
  close(): Promise<void>;
}

/** Validate the image envelope before giving its dimensions or payload to the Web UI. */
export function parseSafariFrame(value: unknown): SafariFrame {
  if (
    typeof value !== "string" || value.length > FRAME_LIMIT || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new Error("SafariDriver returned an invalid or oversized screenshot.");
  }
  const header = Buffer.from(value.slice(0, 44), "base64");
  if (
    header.length < 33
    || header.subarray(0, 8).toString("hex") !== PNG_SIGNATURE
    || header.readUInt32BE(8) !== 13
    || header.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    throw new Error("SafariDriver did not return a PNG screenshot.");
  }
  const width = header.readUInt32BE(16);
  const height = header.readUInt32BE(20);
  if (width < 1 || height < 1 || width * height > 16_000_000) {
    throw new Error("SafariDriver returned invalid screenshot dimensions.");
  }
  return { image: value, width, height };
}

async function reservePort(): Promise<number> {
  const socket = createServer().listen(0, "127.0.0.1");
  try {
    await once(socket, "listening");
    const address = socket.address();
    if (!address || typeof address === "string")
      throw new Error("Cannot allocate a port for SafariDriver.");
    return address.port;
  } finally {
    if (socket.listening) await new Promise<void>((resolve) => socket.close(() => resolve()));
  }
}

function send(
  port: number,
  method: string,
  path: string,
  body?: object,
  timeout = 20_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: "127.0.0.1",
      port,
      path,
      method,
      agent: false,
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeout),
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("error", reject);
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > RESPONSE_LIMIT) {
          response.destroy(new Error("SafariDriver response is too large."));
          return;
        }
        chunks.push(chunk);
      });
      response.once("end", () => {
        const status = response.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          reject(new Error("SafariDriver request failed (HTTP " + status + ")."));
          return;
        }
        try {
          resolve(ResponseSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))).value);
        } catch {
          reject(new Error("SafariDriver returned an invalid response."));
        }
      });
    });
    req.on("error", reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

/**
 * Start a private driver for trusted local fixtures. The loopback connection
 * protects driver commands; it does not isolate Safari page traffic.
 */
export async function startSafariWebDriver(): Promise<SafariWebDriver> {
  if (process.platform !== "darwin") throw new Error("System Safari requires macOS.");
  const port = await reservePort();
  const child = spawn("/usr/bin/safaridriver", ["--port", String(port)], {
    ...HIDDEN_CHILD_PROCESS_OPTIONS,
    stdio: "ignore",
  });
  let processError: Error | undefined;
  child.once("error", (error) => {
    processError = error;
  });
  let sessionPath: string | undefined;
  let closing: Promise<void> | undefined;
  const close = () =>
    closing ??= (async () => {
      try {
        if (sessionPath) await send(port, "DELETE", sessionPath, undefined, 2500);
      } finally {
        child.kill();
      }
    })();

  try {
    let ready = false;
    const deadline = Date.now() + 5000;
    while (!ready && Date.now() < deadline) {
      if (processError) throw new Error("Could not launch SafariDriver.", { cause: processError });
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error("SafariDriver exited before opening a session.");
      const status = await send(port, "GET", "/status", undefined, 250).catch(() => undefined);
      ready = z.object({ ready: z.literal(true) }).safeParse(status).success;
      if (!ready) await delay(100);
    }
    if (!ready) throw new Error("SafariDriver did not become ready.");

    const session = SessionSchema.parse(
      await send(port, "POST", "/session", {
        capabilities: { alwaysMatch: { browserName: "safari" } },
      }).catch((error) => {
        throw new Error(
          "Could not open system Safari. Enable Allow Remote Automation and close other Safari test sessions.",
          { cause: error },
        );
      }),
    );
    sessionPath = "/session/" + session.sessionId;
    if (session.capabilities.browserName.toLowerCase() !== "safari")
      throw new Error("SafariDriver did not start Safari.");

    const command: SafariWebDriver["command"] = (method, route, body) => {
      if (closing) return Promise.reject(new Error("SafariDriver session is closed."));
      if (!/^\/[a-zA-Z0-9/_-]+$/.test(route))
        return Promise.reject(new Error("Invalid SafariDriver command path."));
      return send(port, method, sessionPath + route, body);
    };
    return {
      command,
      captureFrame: async () => parseSafariFrame(await command("GET", "/screenshot")),
      close,
    };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}
