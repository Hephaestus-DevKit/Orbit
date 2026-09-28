import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, request, type Server } from "node:http";
import { BrowserNetworkProxy } from "./BrowserNetworkProxy.js";

const proxies: BrowserNetworkProxy[] = [];
const servers: Server[] = [];
async function fixture() {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(req.url || "");
    expect(req.headers["proxy-authorization"]).toBeUndefined();
    expect(req.headers["x-orbit-local-access"]).toBeUndefined();
    res.end("local page");
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fixture address");
  return { url: `http://127.0.0.1:${address.port}/`, seen };
}
async function transport(blockedPort = 6047) {
  const resolve = vi.fn(async () => ["127.0.0.1"]);
  const proxy = new BrowserNetworkProxy({
    blockedPort: () => blockedPort,
    resolve,
  });
  proxies.push(proxy);
  const details = await proxy.start();
  const authorization =
    "Basic " +
    Buffer.from(details.username + ":" + details.password).toString("base64");
  const fetch = (url: string, ticket?: string, authenticated = true) =>
    new Promise<{ status: number; body: string }>((accept, reject) => {
      const upstream = request(
        details.server,
        {
          path: url,
          headers: {
            ...(authenticated ? { "Proxy-Authorization": authorization } : {}),
            ...(ticket ? { "x-orbit-local-access": ticket } : {}),
          },
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            body += chunk;
          });
          res.on("end", () => accept({ status: res.statusCode!, body }));
        },
      );
      upstream.on("error", reject);
      upstream.end();
    });
  const tunnel = (target: string, payload: string) =>
    new Promise<void>((done, reject) => {
      const req = request(details.server, {
        method: "CONNECT",
        path: target,
        headers: { "Proxy-Authorization": authorization },
      });
      req.on("error", reject);
      req.on("connect", (_res, socket) => {
        socket.on("error", reject);
        socket.on("close", done);
        socket.write(payload);
      });
      req.end();
    });
  return { proxy, fetch, resolve, tunnel };
}
describe("isolated browser network proxy", () => {
  it("does not turn a local WebSocket CONNECT into arbitrary local TCP access", async () => {
    const { url, seen } = await fixture();
    const { proxy, tunnel } = await transport();
    proxy.authorizeLocal(new URL(url));
    const host = new URL(url).host;
    const websocketKey = Buffer.from("the sample nonce").toString("base64");
    await tunnel(host, `GET /private HTTP/1.1\r\nHost: ${host}\r\n\r\n`);
    await tunnel(
      host,
      `GET /hmr HTTP/1.1\r\nHost: ${host}\r\nOrigin: https://example.com\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${websocketKey}\r\n\r\n`,
    );
    expect(seen).toEqual([]);
  });
  afterEach(async () => {
    await Promise.all(proxies.splice(0).map((proxy) => proxy.stop()));
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      ),
    );
  });
  it("requires proxy authentication and a one-use exact local request grant", async () => {
    const { url, seen } = await fixture();
    const { proxy, fetch } = await transport();
    proxy.authorizeLocal(new URL(url));
    expect((await fetch(url, undefined, false)).status).toBe(407);
    expect((await fetch(url)).status).toBe(403);
    const ticket = proxy.localTicket(url, "GET");
    expect(await fetch(url, ticket)).toEqual({
      status: 200,
      body: "local page",
    });
    expect((await fetch(url, ticket)).status).toBe(403);
    expect(seen).toEqual(["/"]);
  });
  it("does not let a ticket authorize another URL or method", async () => {
    const { url, seen } = await fixture();
    const { proxy, fetch } = await transport();
    proxy.authorizeLocal(new URL(url));
    expect(
      (await fetch(url + "other", proxy.localTicket(url, "GET"))).status,
    ).toBe(403);
    expect((await fetch(url, proxy.localTicket(url, "POST"))).status).toBe(403);
    expect(seen).toEqual([]);
  });
  it("blocks private DNS answers, aliases, metadata services and control ports", async () => {
    const { url, seen } = await fixture();
    const { proxy, fetch, resolve } = await transport(
      Number(new URL(url).port),
    );
    expect(() => proxy.authorizeLocal(new URL(url))).toThrow("control port");
    expect(() =>
      proxy.authorizeLocal(new URL("http://127.0.0.1:80")),
    ).toThrow();
    for (const target of [
      url,
      "http://169.254.169.254/latest",
      "http://10.0.0.1/",
      "http://[::1]/",
      "http://example.com/",
      "http://localhost:5173/",
    ])
      expect((await fetch(target)).status).toBe(403);
    expect(resolve).toHaveBeenCalledWith(
      "example.com",
      expect.any(AbortSignal),
    );
    expect(seen).toEqual([]);
  });
  it("revokes pending tickets and all local grants on stop", async () => {
    const { url } = await fixture();
    const { proxy } = await transport();
    proxy.authorizeLocal(new URL(url));
    proxy.localTicket(url, "GET");
    await proxy.stop();
    await proxy.stop();
    const next = await proxy.start();
    expect(next.server).toMatch(/^http:\/\/127\.0\.0\.1:/);
  });
});
