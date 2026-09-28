import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { BrowserPreviewRuntime } from "../packages/cli/src/runtime/browser/BrowserPreviewRuntime.js";
async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture port");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
const fixture = `<!doctype html><html><head><title>Local studio</title><style>body{font:16px system-ui;margin:0;background:#f2f4ef;color:#233d36}main{max-width:760px;margin:60px auto;padding:28px}h1{font-size:42px;letter-spacing:-2px}input,button{padding:12px;border:1px solid #8da69a;border-radius:8px}button{background:#386f60;color:white}#result{margin:24px 0} @media(max-width:500px){main{margin:12px}h1{font-size:32px}}</style></head><body><main><p>LOCAL STUDIO</p><h1>Build something useful.</h1><p>A real local page, connected to Orbit.</p><label for="name">Your name</label><input id="name" placeholder="Name"><button id="hello" onclick="document.getElementById('result').textContent='Hello '+document.getElementById('name').value">Say hello</button><p id="result" role="status">Ready to try</p><button id="warn" onclick="console.error('Preview fixture warning')">Test console</button></main></body></html>`;

test("blocks cross-origin requests, redirects, sockets, and control-plane targets", async () => {
  // Several real browser launches/closes, including cancellation, share this test.
  test.setTimeout(60_000);
  let leakedRequests = 0;
  let localSocketRequests = 0;
  const forbidden = createServer((_req, res) => {
    leakedRequests++;
    res.end("private");
  });
  forbidden.on("upgrade", (_req, socket) => {
    leakedRequests++;
    socket.destroy();
  });
  const forbiddenUrl = await listen(forbidden);
  const project = createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: forbiddenUrl });
      res.end();
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      fixture +
        `<script>fetch('${forbiddenUrl}/steal').catch(()=>{});new WebSocket('${forbiddenUrl.replace("http:", "ws:")}/socket');new WebSocket('ws://'+location.host+'/hmr');</script><iframe src="${forbiddenUrl}"></iframe>`,
    );
  });
  project.on("upgrade", (_req, socket) => {
    localSocketRequests++;
    socket.destroy();
  });
  const projectUrl = await listen(project);
  const runtime = new BrowserPreviewRuntime({ blockedPort: () => 6047 });
  try {
    await expect(runtime.connect("http://127.0.0.1:6047")).rejects.toThrow();
    const snapshot = await runtime.connect(projectUrl);
    expect(snapshot.status).toBe("ready");
    expect(snapshot.errors.join(" ")).toContain("Blocked");
    await expect
      .poll(() => localSocketRequests, {
        message: JSON.stringify(snapshot.errors),
      })
      .toBe(1);
    expect(leakedRequests).toBe(0);
    await expect(runtime.connect(projectUrl + "/redirect")).rejects.toThrow();
    expect(leakedRequests).toBe(0);
    expect(runtime.getSnapshot().status).toBe("error");
    await runtime.connect(projectUrl);
    const controller = new AbortController();
    const action = runtime.execute(
      { action: "click", selector: "#missing" },
      controller.signal,
    );
    const rejection = expect(action).rejects.toThrow(/stopped|cancelled/);
    controller.abort();
    await rejection;
    expect(runtime.getSnapshot().status).toBe("closed");
  } finally {
    await runtime.reset();
    await close(project);
    await close(forbidden);
  }
});
