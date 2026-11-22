import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { listenOnLoopback } from "../packages/cli/src/runtime/webui/WebUiHttp.js";
import { clearWebUiStorage } from "../packages/cli/src/runtime/webui/WebUiStorageCleanup.js";
import { readSafari, withSafari } from "./native-safari-driver.js";

async function close(server: Server) {
  await new Promise<void>(resolve => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

test("full uninstall clears Safari drafts at each Orbit origin and preserves unrelated storage", async () => {
  const servers: Server[] = [];
  try {
    await withSafari(async safari => {
      const ports: number[] = [];
      for (let i = 0; i < 2; i++) {
        const server = createServer((_request, response) => {
          response.setHeader("Content-Type", "text/html");
          response.end("<title>Orbit uninstall fixture</title>");
        });
        servers.push(server);
        ports.push(await listenOnLoopback(server, 0));
        await safari.command("POST", "/url", { url: "http://127.0.0.1:" + ports[i] });
        await readSafari(
          safari,
          `localStorage.setItem('orbit.webui.draft', 'fixture');
          localStorage.setItem('other-app', 'keep'); sessionStorage.setItem('orbit.webui.bootstrap-token', 'fixture');`,
        );
      }
      await safari.command("POST", "/cookie", {
        cookie: { name: "orbit_web_token", value: "fixture", path: "/", httpOnly: true },
      });
      await Promise.all(servers.map(close));
      await clearWebUiStorage(ports, {
        open: async url => {
          // Force navigation even if the fixture was at the same URL without a fragment.
          await safari.command("POST", "/url", { url: "about:blank" });
          await safari.command("POST", "/url", { url });
          return true;
        },
      });
      for (const [i, port] of ports.entries()) {
        await listenOnLoopback(servers[i]!, port);
        await safari.command("POST", "/url", { url: "http://127.0.0.1:" + port + "/verify" });
        expect(
          await readSafari(
            safari,
            `return [localStorage.getItem('orbit.webui.draft'),
          localStorage.getItem('other-app'), sessionStorage.getItem('orbit.webui.bootstrap-token')];`,
          ),
        ).toEqual([null, "keep", null]);
        expect(await safari.command("GET", "/cookie")).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ name: "orbit_web_token" })]),
        );
      }
    });
  } finally {
    await Promise.all(servers.filter(server => server.listening).map(close));
  }
});
