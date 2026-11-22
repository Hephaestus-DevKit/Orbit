import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { z } from "zod";
import { openAuthenticatedWebUi } from "./WebUiBrowserLauncher.js";
import { listenOnLoopback, sendAsset, sendHtml, sendJson } from "./WebUiHttp.js";

const page =
  '<!doctype html><meta charset="utf-8"><title>Orbit</title><p role="status">Orbit · Safari</p><script src="/cleanup.js"></script>';
const script = `(async () => {
  const token = new URLSearchParams(location.hash.slice(1)).get('token');
  history.replaceState(null, '', '/');
  if (!token) return;
  const post = path => fetch(path, { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
  if (!(await post('/authorize')).ok) return;
  for (const storage of [localStorage, sessionStorage]) {
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key && key.startsWith('orbit.webui.')) storage.removeItem(key);
    }
  }
  const response = await post('/done');
  if (!response.ok) return;
  const { next } = await response.json();
  if (next) location.replace(next);
  else document.querySelector('[role=status]').textContent = navigator.language.startsWith('zh')
    ? '此地址的 Orbit 浏览器数据已清除。可以关闭此标签页。'
    : 'Orbit browser data cleared for this address. You can close this tab.';
})().catch(() => {});`;

interface BrowserCleanupOptions {
  open?: (url: string) => Promise<boolean>;
  timeoutMs?: number;
}

/** Clear Orbit storage in Safari at the exact loopback origins that hosted the Web UI. */
export async function clearWebUiStorage(
  ports: number[],
  options: BrowserCleanupOptions = {},
): Promise<void> {
  const pending = [...new Set(z.array(z.number().int().min(1024).max(65535)).parse(ports))];
  // Keep the number of simultaneously bound listening sockets bounded.
  while (pending.length) {
    const batch = pending.splice(0, 16);
    const listeners: Server[] = [];
    const urls = batch.map(port =>
      `http://127.0.0.1:${port}/#token=${randomBytes(32).toString("hex")}`
    );
    let index = 0;
    let finish!: () => void;
    const completed = new Promise<void>(resolve => {
      finish = resolve;
    });
    let timer: NodeJS.Timeout | undefined;
    try {
      for (const [i, port] of batch.entries()) {
        const url = new URL(urls[i]!);
        const bearer = "Bearer " + new URLSearchParams(url.hash.slice(1)).get("token");
        let authorized = false;
        const server = createServer((req, res) => {
          if (req.headers.host !== url.host) return sendJson(res, 403, {});
          if (req.method === "GET" && req.url === "/") return sendHtml(res, 200, page);
          if (req.method === "GET" && req.url === "/cleanup.js")
            return sendAsset(res, "text/javascript", script);
          if (
            i !== index || req.method !== "POST" || req.headers.origin !== url.origin
            || req.headers.authorization !== bearer
          )
            return sendJson(res, 403, {});
          if (req.url === "/authorize") {
            authorized = true;
            res.setHeader(
              "Set-Cookie",
              "orbit_web_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
            );
            return sendJson(res, 200, {});
          }
          if (!authorized || req.url !== "/done") return sendJson(res, 404, {});
          index++;
          if (index === urls.length) res.once("finish", finish);
          return sendJson(res, 200, { next: urls[index] ?? null });
        });
        listeners.push(server);
        try {
          await listenOnLoopback(server, port);
        } catch (cause) {
          throw new Error(
            `Cannot open the Safari cleanup page on 127.0.0.1:${port}. Close the running Web UI or free this port and retry.`,
            { cause },
          );
        }
      }
      if (!await (options.open ?? openAuthenticatedWebUi)(urls[0]!))
        throw new Error("Safari could not open the Orbit cleanup page.");
      await Promise.race([
        completed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Safari did not confirm cleanup on 127.0.0.1:${batch[index]}.`)),
            options.timeoutMs ?? 30_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      await Promise.all(
        listeners.filter(server => server.listening).map(server => new Promise<void>(resolve => {
          server.close(() => resolve());
          server.closeAllConnections();
        })),
      );
    }
  }
}
