import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { DEFAULT_CONFIG } from "../packages/config/src/defaults.js";
import { startOrbitWebUi, stopOrbitWebUi } from "../packages/cli/src/runtime/webui/WebUiServer.js";
import type { SafariWebDriver } from "../packages/cli/src/runtime/browser/SafariWebDriver.js";
import { readSafari, withSafari } from "./native-safari-driver.js";

// SafariDriver opens clean automation windows. Substitute only extension messaging
// so the actual content script runs against real Safari controls and Orbit's renderer.
const content = readFileSync("editors/safari/page.js", "utf8");
async function connect(session: SafariWebDriver) {
  await readSafari(
    session,
    `
    globalThis.browser = { runtime: { id: "fixture", onMessage: { addListener(fn) { globalThis.receive = fn; } } } };
    ${content}
  `,
  );
  async function send(action: string, extra: object = {}) {
    return await session.command("POST", "/execute/async", {
      script:
        "const done = arguments[1]; Promise.resolve(receive(arguments[0], { id: 'fixture' })).then(done, () => done(null));",
      args: [{ channel: "orbit-safari", action, ...extra }],
    }) as { ok: boolean; reason?: string; data?: unknown };
  }
  const response = await send("identify");
  const { documentId } = response.data as { documentId: string };
  return (action: string, extra: object = {}) => send(action, { ...extra, documentId });
}

test("Safari hands a form to a connected Orbit draft and fills the reviewed reply once", async () => {
  const key = "test-handoff";
  const source = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      '<form onsubmit="document.body.dataset.submitted=1;return false"><label>Subject<input id="subject"></label><label>Notes<textarea></textarea></label><label>Password<input></label><input aria-label="Existing" value="preserve"><input type="hidden" value="hidden"><button>Submit</button></form>',
    );
  }).listen(0, "127.0.0.1");
  await once(source, "listening");
  try {
    const address = source.address();
    if (!address || typeof address === "string") throw Error("Missing test port");
    const url = "http://127.0.0.1:" + address.port;
    const reply = { handoff: key, values: ["Safari test", "Reviewed"] };
    const orbit = await startOrbitWebUi({
      cwd: process.cwd(),
      config: structuredClone(DEFAULT_CONFIG),
      port: 0,
      loop: {
        getSessionId: () => "handoff-test",
        getHistory: () => [{
          id: "reply",
          role: "assistant",
          content: [{ type: "text", text: ["```json", JSON.stringify(reply), "```"].join("\n") }],
        }],
      },
    });
    await withSafari(async (safari) => {
      const original = await safari.command("GET", "/window");
      await safari.command("POST", "/url", { url });
      const onForm = await connect(safari);
      const captured = await onForm("start", { key });
      expect(captured.data).toEqual({ site: url, labels: ["Subject", "Notes"] });
      const tab = await safari.command("POST", "/window/new", { type: "tab" }) as {
        handle: string;
      };
      await safari.command("POST", "/window", { handle: tab.handle });
      await safari.command("POST", "/url", { url: orbit.url });
      await expect.poll(() =>
        readSafari(safari, 'return !!document.querySelector("#connectionState.is-connected")')
      ).toBe(true);
      const onOrbit = await connect(safari);
      expect((await onOrbit("prepare", { key, ...captured.data as object })).ok).toBe(true);
      expect(await readSafari(safari, 'return document.querySelector("#prompt").value')).toContain(
        key,
      );
      expect((await onOrbit("prepare", { key, ...captured.data as object })).reason).toBe("draft");
      const proposal = await onOrbit("proposal", { key, length: 2 });
      expect(proposal.data).toEqual(reply.values);
      await safari.command("POST", "/window", { handle: original });
      expect((await onForm("apply", { key, values: proposal.data })).data).toEqual({
        count: 2,
        total: 2,
      });
      expect(
        await readSafari(
          safari,
          'return Array.from(document.querySelectorAll("input, textarea"), el => el.value)',
        ),
      ).toEqual(["Safari test", "Reviewed", "", "preserve", "hidden"]);
      expect(await readSafari(safari, "return !!document.body.dataset.submitted")).toBe(false);
      expect((await onForm("apply", { key, values: proposal.data })).reason).toBe("stale");
      await readSafari(safari, 'document.querySelector("#subject").value = ""');
      await onForm("start", { key });
      await readSafari(
        safari,
        'document.querySelector("#subject").replaceWith(document.querySelector("#subject").cloneNode())',
      );
      expect((await onForm("apply", { key, values: ["replacement"] })).reason).toBe("stale");
    });
  } finally {
    source.close();
    await stopOrbitWebUi();
  }
});
