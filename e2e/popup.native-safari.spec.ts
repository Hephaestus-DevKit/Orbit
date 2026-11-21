import { test, expect } from "@playwright/test";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { clickSafari, readSafari, withSafari } from "./native-safari-driver.js";

// Serve the shipped popup as a document. Only Safari's privileged extension APIs are substituted.
const fixture = `<script>
  const calls = [];
  globalThis.browser = {
    storage: { session: { get: async () => ({ workspace: { tabId: 2, documentId: "orbit" } }) } },
    scripting: { executeScript: async () => [] },
    tabs: {
      query: async () => [{ id: 1, url: "https://example.org/article" }],
      update: async () => { throw Error("window closed"); },
      sendMessage: async (id, msg) => {
        if (msg.action === "identify" && id === 2) return { ok: true, data: { documentId: "orbit", workspace: true, workspaceName: "Orbit docs", chatName: "Fix sidebar", draftTarget: "first-chat" } };
        if (msg.action === "identify") return { ok: true, data: { documentId: "source" } };
        if (msg.action === "pageExcerpt") return { ok: true, data: { title: "Example", address: "https://example.org/article", selection: "selected" } };
        if (msg.action === "draftQuestion" && id === 2 && msg.documentId === "orbit" && msg.draftTarget === "first-chat") {
          calls.push(msg.append === true);
          return msg.append ? { ok: true } : { ok: false, reason: "draft" };
        }
        throw Error("unexpected message");
      },
    },
  };
</script>`;

test("Safari popup confirms or cancels adding a page to an existing draft", async () => {
  const assets = new Map([
    ["/popup.js", ["text/javascript", readFileSync("editors/safari/popup.js", "utf8")]],
    ["/popup.css", ["text/css", readFileSync("editors/safari/popup.css", "utf8")]],
    ["/", [
      "text/html",
      readFileSync("editors/safari/popup.html", "utf8").replace("</head>", fixture + "</head>"),
    ]],
  ]);
  const server = createServer((req, res) => {
    const asset = assets.get(req.url ?? "");
    res.writeHead(asset ? 200 : 404, {
      "Content-Type": (asset?.[0] ?? "text/plain") + "; charset=utf-8",
    });
    res.end(asset?.[1]);
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw Error("Missing test port");
    await withSafari(async safari => {
      await safari.command("POST", "/url", { url: "http://127.0.0.1:" + address.port });
      const first = "#actions button:first-child";
      const last = "#actions button:last-child";
      await expect.poll(() =>
        readSafari(safari, 'return document.querySelector("#route").textContent')
      ).toBe("example.org → Orbit docs / Fix sidebar");
      await clickSafari(safari, first);
      expect(
        await readSafari(
          safari,
          'return document.activeElement === document.querySelector("#actions button")',
        ),
      ).toBe(true);
      expect(await readSafari(safari, "return calls")).toEqual([false]);
      await clickSafari(safari, last);
      expect(await readSafari(safari, "return calls")).toEqual([false]);
      await clickSafari(safari, first);
      await clickSafari(safari, first);
      expect(await readSafari(safari, "return calls")).toEqual([false, false, true]);
      // Retrying a failed tab activation must never append the same page twice.
      await clickSafari(safari, first);
      expect(await readSafari(safari, "return calls")).toEqual([false, false, true]);
    });
  } finally {
    server.close();
  }
});
