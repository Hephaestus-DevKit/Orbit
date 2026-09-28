import {
  createServer,
  request,
  type IncomingMessage,
  type IncomingHttpHeaders,
  type RequestOptions,
  type Server,
  type ServerResponse,
} from "node:http";
import { connect, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  createPinnedLookup,
  resolvePublicHttpTarget,
  type AddressResolver,
} from "@orbit-build/core";

/** Pinned-DNS browser transport; Chromium never resolves a validated host a second time. */
export class BrowserNetworkProxy {
  private server?: Server;
  private readonly sockets = new Set<Duplex>();
  private controller = new AbortController();
  private readonly localOrigins = new Set<string>();
  private readonly tickets = new Map<
    string,
    { url: string; method: string; until: number; hops: number }
  >();
  private authorization = "";
  constructor(
    private readonly options: {
      blockedPort: () => number | undefined;
      resolve?: AddressResolver;
    },
  ) {}

  authorizeLocal(url: URL): void {
    if (url.hostname !== "127.0.0.1") return;
    if (
      url.protocol !== "http:" ||
      Number(url.port) < 1024 ||
      Number(url.port) === this.options.blockedPort()
    )
      throw new Error(
        "Orbit's control port and privileged local services cannot be opened.",
      );
    this.localOrigins.add(url.origin);
  }
  /** One-use local tickets prevent redirect chains from borrowing a tab's local grant. */
  localTicket(url: string, method: string): string {
    const now = Date.now();
    for (const [key, ticket] of this.tickets)
      if (ticket.until < now) this.tickets.delete(key);
    if (this.tickets.size >= 512)
      throw new Error("Too many pending local requests.");
    const token = randomBytes(24).toString("hex");
    this.tickets.set(token, { url, method, until: now + 30_000, hops: 0 });
    return token;
  }

  async start(): Promise<{
    server: string;
    username: string;
    password: string;
  }> {
    if (this.server) throw new Error("Browser transport already started.");
    this.controller = new AbortController();
    const username = "orbit";
    const password = randomBytes(24).toString("hex");
    this.authorization =
      "Basic " + Buffer.from(username + ":" + password).toString("base64");
    const server = createServer((req, res) => {
      void this.http(req, res);
    });
    this.server = server;
    server.on("connection", (socket) => this.track(socket));
    server.on("connect", (req, socket, head) => {
      void this.tunnel(req, socket, head);
    });
    server.on("upgrade", (req, socket, head) => {
      void this.upgrade(req, socket, head);
    });
    server.on("clientError", (_error, socket) => socket.destroy());
    server.requestTimeout = 30_000;
    server.headersTimeout = 10_000;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (
      !address ||
      typeof address === "string" ||
      this.controller.signal.aborted ||
      this.server !== server
    ) {
      server.close();
      throw new Error("Browser transport stopped.");
    }
    return { server: `http://127.0.0.1:${address.port}`, username, password };
  }
  async stop(): Promise<void> {
    this.controller.abort();
    this.localOrigins.clear();
    this.tickets.clear();
    const server = this.server;
    this.server = undefined;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  private authenticated(req: IncomingMessage): boolean {
    const actual = Buffer.from(
      String(req.headers["proxy-authorization"] || ""),
    );
    const expected = Buffer.from(this.authorization);
    return (
      expected.length > 0 &&
      actual.length === expected.length &&
      timingSafeEqual(actual, expected)
    );
  }
  private track(socket: Duplex): void {
    if (this.controller.signal.aborted || this.sockets.size >= 128) {
      socket.destroy();
      return;
    }
    this.sockets.add(socket);
    socket.once("close", () => this.sockets.delete(socket));
    socket.on("error", () => socket.destroy());
  }
  private async target(
    raw: string,
    localAllowed = false,
  ): Promise<{
    url: URL;
    hostname: string;
    addresses: readonly string[];
    port: number;
  }> {
    const url = new URL(raw);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("Invalid browser destination.");
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    if (port === this.options.blockedPort())
      throw new Error("Orbit control port is blocked.");
    const signal = AbortSignal.any([
      this.controller.signal,
      AbortSignal.timeout(8000),
    ]);
    let hostname: string;
    let addresses: readonly string[];
    if (
      localAllowed &&
      this.localOrigins.has(url.origin) &&
      url.hostname === "127.0.0.1"
    ) {
      hostname = "127.0.0.1";
      addresses = [hostname];
    } else {
      const target = await resolvePublicHttpTarget(
        url.href,
        this.options.resolve,
        undefined,
        signal,
      );
      hostname = target.hostname;
      addresses = target.addresses;
    }
    if (signal.aborted || !this.server)
      throw new Error("Browser transport stopped.");
    return { url, hostname, addresses, port };
  }
  private async http(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.authenticated(req)) {
      res.writeHead(407, {
        "Proxy-Authenticate": 'Basic realm="Orbit browser"',
      });
      res.end();
      return;
    }
    try {
      const ticketKey = String(req.headers["x-orbit-local-access"] || "");
      const ticket = this.tickets.get(ticketKey);
      this.tickets.delete(ticketKey);
      const localAllowed = Boolean(
        ticket &&
        ticket.until >= Date.now() &&
        ticket.url === req.url &&
        ticket.method === req.method,
      );
      const { url, hostname, addresses, port } = await this.target(
        req.url || "",
        localAllowed,
      );
      if (url.protocol !== "http:") throw new Error("HTTPS requires a tunnel.");
      const headers: IncomingHttpHeaders = { ...req.headers, host: url.host };
      delete headers["proxy-authorization"];
      delete headers["proxy-connection"];
      delete headers["x-orbit-local-access"];
      // Node's HTTP types omit the net.Socket family-selection option, which
      // http.request forwards to its connection when no pooled agent is used.
      const requestOptions: RequestOptions & { autoSelectFamily: boolean } = {
        host: hostname,
        port,
        lookup: createPinnedLookup(hostname, addresses),
        autoSelectFamily: addresses.length > 1,
        method: req.method,
        path: url.pathname + url.search,
        headers,
        agent: false,
      };
      const upstream = request(requestOptions, (response) => {
        // Chromium retains route headers along redirect chains. Renew this
        // consumed ticket only for the exact next URL on the granted origin.
        if (
          localAllowed &&
          ticket &&
          ticket.hops < 16 &&
          [301, 302, 303, 307, 308].includes(response.statusCode || 0) &&
          response.headers.location
        ) {
          try {
            const next = new URL(response.headers.location, url);
            if (next.origin === url.origin)
              this.tickets.set(ticketKey, {
                url: next.href,
                method:
                  response.statusCode === 303 ||
                  ([301, 302].includes(response.statusCode || 0) &&
                    req.method === "POST")
                    ? "GET"
                    : req.method || "GET",
                until: Date.now() + 30_000,
                hops: ticket.hops + 1,
              });
          } catch {
            /* Invalid redirects receive no local grant. */
          }
        }
        res.writeHead(response.statusCode || 502, response.headers);
        response.pipe(res);
      });
      upstream.on("socket", (socket) => this.track(socket));
      upstream.setTimeout(30_000, () => upstream.destroy());
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      res.on("close", () => upstream.destroy());
      req.pipe(upstream);
    } catch {
      res.writeHead(403);
      res.end("Orbit browser blocked this destination.");
    }
  }
  private async tunnel(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    if (!this.authenticated(req)) {
      socket.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Orbit browser"\r\n\r\n',
      );
      return;
    }
    try {
      const raw = req.url || "";
      if (/[/?#@\s]/.test(raw)) throw new Error("Invalid CONNECT authority.");
      const local = new URL("http://" + raw);
      if (
        local.hostname === "127.0.0.1" &&
        this.localOrigins.has(local.origin) &&
        Number(local.port) !== this.options.blockedPort()
      ) {
        this.localWebSocketTunnel(socket, head, local);
        return;
      }
      const { hostname, addresses, port } = await this.target("https://" + raw);
      const upstream = this.dial(hostname, addresses, port, socket);
      upstream.once("connect", () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        socket.pipe(upstream).pipe(socket);
      });
    } catch {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    }
  }
  /** Chromium also tunnels unencrypted ws://. Validate its inner handshake
   * before dialing loopback; a CONNECT grant must never become a raw TCP grant. */
  private localWebSocketTunnel(
    socket: Duplex,
    head: Buffer,
    target: URL,
  ): void {
    let pending = head;
    const timeout = setTimeout(() => socket.destroy(), 5000);
    timeout.unref();
    socket.once("close", () => clearTimeout(timeout));
    const receive = (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length > 16_384) {
        socket.destroy();
        return;
      }
      const end = pending.indexOf("\r\n\r\n");
      if (end < 0) return;
      socket.removeListener("data", receive);
      clearTimeout(timeout);
      socket.pause();
      const lines = pending.subarray(0, end).toString("utf8").split("\r\n");
      if (!/^GET \/[^\s]* HTTP\/1\.1$/.test(lines.shift() || "")) {
        socket.destroy();
        return;
      }
      const headers: Record<string, string> = {};
      for (const line of lines) {
        const separator = line.indexOf(":");
        if (separator < 1) {
          socket.destroy();
          return;
        }
        const key = line.slice(0, separator).toLowerCase();
        if (key in headers) {
          socket.destroy();
          return;
        }
        headers[key] = line.slice(separator + 1).trim();
      }
      const handshake = z
        .object({
          origin: z.literal(target.origin),
          host: z.literal(target.host),
          upgrade: z.string().regex(/^websocket$/i),
          connection: z.string().regex(/(?:^|,)\s*upgrade\s*(?:,|$)/i),
          "sec-websocket-version": z.literal("13"),
          "sec-websocket-key": z.string().regex(/^[A-Za-z0-9+/]{22}==$/),
        })
        .safeParse(headers);
      if (
        !handshake.success ||
        !this.localOrigins.has(target.origin) ||
        this.controller.signal.aborted
      ) {
        socket.destroy();
        return;
      }
      const upstream = this.dial(
        "127.0.0.1",
        ["127.0.0.1"],
        Number(target.port),
        socket,
      );
      upstream.once("connect", () => {
        upstream.write(pending);
        socket.pipe(upstream).pipe(socket);
        socket.resume();
      });
    };
    socket.on("data", receive);
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) receive(Buffer.alloc(0));
  }
  private async upgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    if (!this.authenticated(req)) {
      socket.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Orbit browser"\r\nConnection: close\r\n\r\n',
      );
      return;
    }
    try {
      const raw = (req.url || "").replace(/^ws:/, "http:");
      const { url, hostname, addresses, port } = await this.target(
        raw,
        this.localOrigins.has(String(req.headers.origin)),
      );
      if (url.protocol !== "http:") throw new Error("Invalid WebSocket.");
      const upstream = this.dial(hostname, addresses, port, socket);
      upstream.once("connect", () => {
        const lines = Object.entries(req.headers)
          .filter(
            ([name]) =>
              ![
                "proxy-authorization",
                "proxy-connection",
                "x-orbit-local-access",
                "host",
              ].includes(name),
          )
          .map(
            ([name, value]) =>
              name + ": " + (Array.isArray(value) ? value.join(", ") : value),
          );
        upstream.write(
          `${req.method} ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.host}\r\n${lines.join("\r\n")}\r\n\r\n`,
        );
        if (head.length) upstream.write(head);
        socket.pipe(upstream).pipe(socket);
      });
    } catch {
      socket.destroy();
    }
  }
  private dial(
    hostname: string,
    addresses: readonly string[],
    port: number,
    downstream: Duplex,
  ): Socket {
    const upstream = connect({
      host: hostname,
      port,
      lookup: createPinnedLookup(hostname, addresses),
      autoSelectFamily: addresses.length > 1,
    });
    this.track(upstream);
    upstream.setTimeout(60_000, () => upstream.destroy());
    upstream.on("error", () => downstream.destroy());
    upstream.on("close", () => downstream.destroy());
    downstream.on("close", () => upstream.destroy());
    return upstream;
  }
}
