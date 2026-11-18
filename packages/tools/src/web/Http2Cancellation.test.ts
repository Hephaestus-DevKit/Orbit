import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "../../../../scripts/testing/support.mjs";

// Run in a child: an unhandled stream error must fail the test, never be swallowed
// by a process-wide handler or affect unrelated tests in this worker.
describe("HTTP/2 cancellation lifecycle", () => {
  it("survives idle teardown after aborting a reused session", async () => {
    const script = `
      import assert from 'node:assert/strict';
      import { once } from 'node:events';
      import { createServer } from 'node:http2';
      import { setTimeout as delay } from 'node:timers/promises';
      await globalThis.fetch('data:text/plain,initialize-native-fetch');
      const { initializeHttpTransport } = await import(${JSON.stringify(new URL("./HttpTransport.ts", import.meta.url).href)});
      const { Client, fetch, Agent, getGlobalDispatcher } = await import(${JSON.stringify(import.meta.resolve("undici"))});
      initializeHttpTransport();
      assert.ok(getGlobalDispatcher() instanceof Agent);
      const server = createServer();
      server.on('session', session => session.on('error', () => {}));
      server.on('stream', stream => {
        stream.on('error', () => {});
        stream.respond({ ':status': 200 }); stream.end('ok');
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const url = 'http://127.0.0.1:' + server.address().port;
      const client = new Client(url, { useH2c: true, keepAliveTimeout: 100 });
      try {
        assert.equal(await (await fetch(url, { dispatcher: client })).text(), 'ok');
        const controller = new AbortController();
        const request = fetch(url, { dispatcher: client, signal: controller.signal });
        controller.abort();
        await assert.rejects(request, { name: 'AbortError' });
        await delay(350);
        assert.equal(await (await fetch(url, { dispatcher: client })).text(), 'ok');
      } finally {
        await client.destroy();
        await new Promise(resolve => server.close(resolve));
      }
    `;
    const result = await promisify(execFile)(
      process.execPath,
      ["--input-type=module", "-e", script],
      { timeout: 5000 },
    );
    expect(result.stderr).toBe("");
  });
});
