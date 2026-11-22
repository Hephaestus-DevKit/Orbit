import { createServer } from "node:http";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "../../../../../scripts/testing/support.mjs";
import { listenOnLoopback } from "./WebUiHttp.js";
import { clearWebUiStorage } from "./WebUiStorageCleanup.js";

async function freePort() {
  const server = createServer();
  const port = await listenOnLoopback(server, 0);
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

function storage(keys: string[]) {
  return {
    get length() {
      return keys.length;
    },
    key: (i: number) => keys[i],
    removeItem: (key: string) => keys.splice(keys.indexOf(key), 1),
    keys,
  };
}

describe("Safari storage cleanup", () => {
  it("visits both confirmed origins, clears only Orbit keys and expires its exact cookie", async () => {
    const ports = [await freePort(), await freePort()];
    let visited = 0;
    await clearWebUiStorage(ports, {
      open: async first => {
        let url: string | undefined = first;
        while (url) {
          const current = new URL(url);
          expect(Number(current.port)).toBe(ports[visited++]);
          const local = storage([
            "other",
            "orbit.webui.draft",
            'orbit.webui.draft.["project","chat"]',
          ]);
          const session = storage(["other", "orbit.webui.bootstrap-token"]);
          const post = {
            method: "POST",
            headers: { Origin: current.origin, Authorization: "Bearer invalid" },
          };
          expect((await fetch(current.origin + "/authorize", post)).status).toBe(403);
          const foreign = {
            ...post,
            headers: {
              Origin: "https://example.com",
              Authorization: "Bearer " + current.hash.slice(7),
            },
          };
          expect((await fetch(current.origin + "/authorize", foreign)).status).toBe(403);
          expect((await fetch(url)).headers.get("content-security-policy")).toContain(
            "frame-ancestors 'none'",
          );
          const script = await (await fetch(current.origin + "/cleanup.js")).text();
          let next: string | undefined;
          await runInNewContext(script, {
            URLSearchParams,
            location: {
              hash: current.hash,
              replace: (value: string) => {
                next = value;
              },
            },
            history: { replaceState() {} },
            localStorage: local,
            sessionStorage: session,
            fetch: async (
              path: string,
              options: { method: string; headers: Record<string, string> },
            ) => {
              const response = await fetch(current.origin + path, {
                ...options,
                headers: { ...options.headers, Origin: current.origin },
              });
              if (path === "/authorize")
                expect(response.headers.get("set-cookie")).toMatch(/^orbit_web_token=;.*Max-Age=0/);
              return response;
            },
            navigator: { language: "en" },
            document: { querySelector: () => ({}) },
          });
          expect(local.keys).toEqual(["other"]);
          expect(session.keys).toEqual(["other"]);
          url = next;
        }
        return true;
      },
    });
    expect(visited).toBe(2);
  });
  it("reports occupied ports without visiting them, and releases listeners on failure", async () => {
    const occupied = createServer();
    const port = await listenOnLoopback(occupied, 0);
    const free = await freePort();
    try {
      await expect(clearWebUiStorage([free, port], {
        open: async () => {
          throw new Error("unexpected open");
        },
      })).rejects.toThrow(String(port));
      await expect(clearWebUiStorage([free], { open: async () => false })).rejects.toThrow(
        "Safari could not open",
      );
      await expect(clearWebUiStorage([free], { open: async () => true, timeoutMs: 10 })).rejects
        .toThrow("did not confirm");
    } finally {
      occupied.close();
    }
  });
});
