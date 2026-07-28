import { describe, expect, it, vi } from "vitest";
import { assertPublicHttpUrl, WebFetchTool } from "./fetch.js";

const publicResolver = vi.fn(async () => ["93.184.216.34"]);
const verifiedPublicResolver = vi.fn(async () => ["151.101.2.137"]);

describe("WebFetchTool", () => {
  it("blocks local targets and URL credentials before fetching", async () => {
    await expect(assertPublicHttpUrl("http://localhost/admin")).rejects.toThrow(
      "Local and private",
    );
    await expect(
      assertPublicHttpUrl("https://user:secret@example.com/", publicResolver),
    ).rejects.toThrow("credentials");
  });

  it("returns bounded readable page text without scripts", async () => {
    const fetchImplementation = vi.fn(
      async () =>
        new Response(
          "<html><head><style>.x{}</style></head><body><h1>Orbit Docs</h1><script>secret()</script><p>Useful text &amp; examples.</p></body></html>",
          { headers: { "content-type": "text/html; charset=utf-8" } },
        ),
    );
    const tool = new WebFetchTool(
      fetchImplementation as unknown as typeof fetch,
      publicResolver,
    );

    const result = await tool.execute(
      { url: "https://example.com/docs", maxChars: 1000 },
      { cwd: process.cwd(), sessionId: "test" },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toContain("Orbit Docs");
    expect(result.data).toContain("Useful text & examples.");
    expect(result.data).not.toContain("secret()");
  });

  it("verifies proxy Fake-IP hostnames through public DNS before fetching", async () => {
    const fetchImplementation = vi.fn(
      async () =>
        new Response("<main>BBC News</main>", {
          headers: { "content-type": "text/html" },
        }),
    );
    const syntheticResolver = vi.fn(async () => ["198.18.0.92"]);
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
  });

  it("keeps synthetic literal IPs and unverified hostnames blocked", async () => {
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
});
