import { describe, expect, it, vi } from "vitest";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { applyPermissionModePreset, ConfigSchema } from "@orbit-build/config";
import type { Dispatcher } from "undici";
import { assertPublicHttpUrl, WebFetchTool } from "./fetch.js";
import { resolveSystemAddresses } from "./publicHttpUrl.js";
import {
  createPinnedLookup,
  type PinnedDispatcherLease,
} from "./PinnedHttpDispatcher.js";

const publicResolver = vi.fn(async () => ["93.184.216.34"]);
const verifiedPublicResolver = vi.fn(async () => ["151.101.2.137"]);

describe("WebFetchTool", () => {
  it("pins connection lookups to the addresses approved by validation", () => {
    const lookup = createPinnedLookup("example.com", [
      "93.184.216.34",
      "2606:2800:220:1:248:1893:25c8:1946",
    ]);
    const callback = vi.fn();

    lookup("example.com", { all: true }, callback);

    expect(callback).toHaveBeenCalledWith(null, [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);
  });

  it("tries a second pinned address for HTTP requests and TCP tunnels", async () => {
    const server = createServer((_req, res) => res.end("connected"));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing fixture address.");
    const options = {
      host: "example.test",
      port: address.port,
      lookup: createPinnedLookup("example.test", ["127.0.0.2", "127.0.0.1"]),
      autoSelectFamily: true,
    };
    try {
      const body = await new Promise<string>((resolve, reject) => {
        const client = request(options, (response) => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => (text += chunk));
          response.on("end", () => resolve(text));
        });
        client.on("error", reject);
        client.end();
      });
      expect(body).toBe("connected");

      const socket = connect(options);
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      socket.destroy();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("rejects attempts to reuse a pinned lookup for another hostname", () => {
    const lookup = createPinnedLookup("example.com", ["93.184.216.34"]);
    const callback = vi.fn();

    lookup("internal.example", {}, callback);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ code: "EAI_NONAME" }),
      [],
    );
  });

  it("stops waiting for an in-flight system DNS lookup after cancellation", async () => {
    const controller = new AbortController();
    const lookupImplementation = vi.fn(
      () => new Promise<never>(() => undefined),
    );
    const pending = resolveSystemAddresses(
      "example.com",
      controller.signal,
      lookupImplementation as unknown as Parameters<
        typeof resolveSystemAddresses
      >[2],
    );

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(lookupImplementation).toHaveBeenCalledOnce();
  });

  it("blocks local targets and URL credentials before fetching", async () => {
    await expect(assertPublicHttpUrl("http://localhost/admin")).rejects.toThrow(
      "Local and private",
    );
    await expect(
      assertPublicHttpUrl("https://user:secret@example.com/", publicResolver),
    ).rejects.toThrow("credentials");
  });

  it("opens local and private targets only under unrestricted Full Access", async () => {
    const fetchImplementation = vi.fn(
      async () =>
        new Response("local service", {
          headers: { "content-type": "text/plain" },
        }),
    );
    const privateResolver = vi.fn(async () => ["127.0.0.1"]);
    const dispatcher = {} as Dispatcher;
    const createDispatcher = vi.fn(
      (): PinnedDispatcherLease => ({
        dispatcher,
        close: vi.fn(async () => undefined),
      }),
    );
    const tool = new WebFetchTool(
      fetchImplementation as unknown as typeof fetch,
      privateResolver,
      verifiedPublicResolver,
      createDispatcher,
    );

    const normal = await tool.execute(
      { url: "http://127.0.0.1:6047/status" },
      { cwd: process.cwd(), sessionId: "normal" },
    );
    expect(normal.ok).toBe(false);
    expect(normal.error).toContain("private");
    expect(fetchImplementation).not.toHaveBeenCalled();

    const config = ConfigSchema.parse({});
    applyPermissionModePreset(config, "auto");
    const fullAccess = await tool.execute(
      { url: "http://127.0.0.1:6047/status" },
      { cwd: process.cwd(), sessionId: "full", config },
    );

    expect(fullAccess.ok).toBe(true);
    expect(fullAccess.data).toContain("local service");
    expect(createDispatcher).toHaveBeenCalledWith("127.0.0.1", ["127.0.0.1"]);
  });

  it("returns bounded readable page text without scripts", async () => {
    const response = new Response(
      "<html><head><style>.x{}</style></head><body><h1>Orbit Docs</h1><script>secret()</script><p>Useful text &amp; examples.</p></body></html>",
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
    const fetchImplementation = vi.fn(async () => response);
    const dispatcher = {} as Dispatcher;
    const close = vi.fn(async () => undefined);
    const createDispatcher = vi.fn(
      (): PinnedDispatcherLease => ({ dispatcher, close }),
    );
    const tool = new WebFetchTool(
      fetchImplementation as unknown as typeof fetch,
      publicResolver,
      verifiedPublicResolver,
      createDispatcher,
    );

    const result = await tool.execute(
      { url: "https://example.com/docs", maxChars: 1000 },
      { cwd: process.cwd(), sessionId: "test" },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toContain("Orbit Docs");
    expect(result.data).toContain("Useful text & examples.");
    expect(result.data).not.toContain("secret()");
    expect(response.body?.locked).toBe(false);
    expect(createDispatcher).toHaveBeenCalledWith("example.com", [
      "93.184.216.34",
    ]);
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://example.com/docs",
      expect.objectContaining({ dispatcher }),
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([["198.18.0.92"], ["198.18.0.92", "2001:2::15"], ["2001:2::15"]])(
    "verifies proxy Fake-IP hostnames through public DNS before fetching (%j)",
    async (...addresses) => {
      const fetchImplementation = vi.fn(
        async () =>
          new Response("<main>BBC News</main>", {
            headers: { "content-type": "text/html" },
          }),
      );
      const syntheticResolver = vi.fn(async () => addresses);
      const tool = new WebFetchTool(
        fetchImplementation as unknown as typeof fetch,
        syntheticResolver,
        verifiedPublicResolver,
      );

      const result = await tool.execute(
        { url: "https://www.bbc.com/news" },
        { cwd: process.cwd(), sessionId: "test" },
      );

      expect(result.ok).toBe(true);
      expect(result.data).toContain("BBC News");
      expect(verifiedPublicResolver).toHaveBeenCalledWith(
        "www.bbc.com",
        expect.any(AbortSignal),
      );
      expect(fetchImplementation).toHaveBeenCalledOnce();
    },
  );

  it("keeps synthetic literal IPs and unverified hostnames blocked", async () => {
    await expect(
      assertPublicHttpUrl(
        "https://[2001:2::15]/",
        publicResolver,
        verifiedPublicResolver,
      ),
    ).rejects.toThrow("reserved");
    await expect(
      assertPublicHttpUrl(
        "https://internal.example/",
        async () => ["198.18.0.92", "2001:2::15"],
        async () => ["10.0.0.8"],
      ),
    ).rejects.toThrow("could not be verified");
    await expect(
      assertPublicHttpUrl(
        "https://mixed.example/",
        async () => ["198.18.0.92", "fd00::1"],
        verifiedPublicResolver,
      ),
    ).rejects.toThrow("mixture");
    await expect(
      assertPublicHttpUrl(
        "https://198.18.0.92/news",
        publicResolver,
        verifiedPublicResolver,
      ),
    ).rejects.toThrow("reserved");

    await expect(
      assertPublicHttpUrl(
        "https://internal.example/news",
        async () => ["198.18.0.92"],
        async () => ["10.0.0.8"],
      ),
    ).rejects.toThrow("could not be verified");
  });

  it("blocks reserved and transition IP ranges while allowing public unicast", async () => {
    for (const url of [
      "https://192.0.2.10/",
      "http://[ff02::1]/",
      "http://[64:ff9b::a00:1]/",
      "http://[2002:a00:1::]/",
    ]) {
      await expect(
        assertPublicHttpUrl(url, async (hostname) => [hostname]),
      ).rejects.toThrow("reserved");
    }

    await expect(
      assertPublicHttpUrl("https://[2606:4700:4700::1111]/", async () => [
        "2606:4700:4700::1111",
      ]),
    ).resolves.toBe("https://[2606:4700:4700::1111]/");
  });

  it("revalidates redirects and blocks redirects into localhost", async () => {
    const fetchImplementation = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/private" },
        }),
    );
    const tool = new WebFetchTool(
      fetchImplementation as unknown as typeof fetch,
      publicResolver,
    );

    const result = await tool.execute(
      { url: "https://example.com/redirect" },
      { cwd: process.cwd(), sessionId: "test" },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("private");
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("cancels redirect response bodies before following the next URL", async () => {
    const redirect = new Response("unused redirect body", {
      status: 302,
      headers: { location: "/final" },
    });
    const cancel = vi.spyOn(redirect.body!, "cancel");
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(redirect)
      .mockResolvedValueOnce(
        new Response("complete", {
          headers: { "content-type": "text/plain" },
        }),
      );
    const tool = new WebFetchTool(
      fetchImplementation as unknown as typeof fetch,
      publicResolver,
    );

    const result = await tool.execute(
      { url: "https://example.com/redirect" },
      { cwd: process.cwd(), sessionId: "test" },
    );

    expect(result.ok).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      2,
      "https://example.com/final",
      expect.objectContaining({ redirect: "manual" }),
    );
  });
});
