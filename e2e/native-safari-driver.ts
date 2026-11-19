import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

export async function withSafari(run: (request: SafariRequest) => Promise<void>): Promise<void> {
  if (process.platform !== "darwin") throw new Error("Native Safari tests require macOS.");
  const probe = createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  if (!address || typeof address === "string")
    throw new Error("Cannot allocate SafariDriver port.");
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => error ? reject(error) : resolve())
  );

  const driver = spawn("/usr/bin/safaridriver", ["--port", String(address.port)], {
    stdio: "ignore",
  });
  let spawnError: Error | undefined;
  driver.once("error", (error) => {
    spawnError = error;
  });
  const endpoint = `http://127.0.0.1:${address.port}`;
  const request: SafariRequest = async <T>(method: string, route: string, body?: object) => {
    const response = await fetch(endpoint + route, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const { value } = await response.json();
    if (!response.ok) throw new Error(value?.message || `SafariDriver returned ${response.status}`);
    return value as T;
  };
  let session = "";
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      if (spawnError) throw spawnError;
      if (driver.exitCode !== null) throw new Error(`SafariDriver exited (${driver.exitCode}).`);
      ready = await request<{ ready: boolean }>("GET", "/status").then(
        (status) => status.ready,
        () => false,
      );
      if (ready) break;
      await delay(100);
    }
    if (!ready) throw new Error("SafariDriver did not become ready.");
    const result = await request<{ sessionId: string; capabilities: { browserName: string } }>(
      "POST",
      "/session",
      {
        capabilities: { alwaysMatch: { browserName: "safari" } },
      },
    );
    session = `/session/${result.sessionId}`;
    if (result.capabilities.browserName.toLowerCase() !== "safari")
      throw new Error("Safari session was not created.");
    await run((method, route, body) => request(method, session + route, body));
  } finally {
    try {
      if (session) await request("DELETE", session);
    } finally {
      driver.kill();
    }
  }
}

type SafariRequest = <T = unknown>(method: string, route: string, body?: object) => Promise<T>;

export async function clickSafari(request: SafariRequest, selector: string): Promise<void> {
  const element = await request<Record<string, string>>("POST", "/element", {
    using: "css selector",
    value: selector,
  });
  await request("POST", `/element/${element["element-6066-11e4-a52e-4f735466cecf"]}/click`, {});
}

export function readSafari<T>(request: SafariRequest, script: string): Promise<T> {
  return request<T>("POST", "/execute/sync", { script, args: [] });
}
