import { describe, expect, it, mockTools as vi } from "../../../../../scripts/testing/support.mjs";
import { openAuthenticatedWebUi, supportsOrbitBrowser } from "./WebUiBrowserLauncher.js";

const url = `http://127.0.0.1:6047/#token=${"a".repeat(43)}`;

describe("openAuthenticatedWebUi", () => {
  it("exposes the native host only on a supported local Mac", () => {
    expect(supportsOrbitBrowser("darwin", "23.0.0", {})).toBe(true);
    expect(supportsOrbitBrowser("darwin", "22.1.0", {})).toBe(false);
    expect(supportsOrbitBrowser("darwin", "26.0.0", { SSH_TTY: "remote" })).toBe(false);
    expect(supportsOrbitBrowser("linux", "26.0.0", {})).toBe(false);
  });

  it.each(["linux", "win32", "aix"] as const)("offers the manual URL on %s", async platform => {
    const execute = vi.fn(async () => {});
    expect(await openAuthenticatedWebUi(url, { platform, execute })).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("opens an authenticated IPv6 loopback workspace", async () => {
    const execute = vi.fn(async () => {});
    const ipv6 = url.replace("127.0.0.1", "[::1]");
    expect(await openAuthenticatedWebUi(ipv6, { platform: "darwin", execute })).toBe(true);
    expect(execute).toHaveBeenCalledWith("/usr/bin/open", ["-b", "com.apple.Safari", ipv6]);
  });

  it.each([
    "https://example.com/",
    url.replace("127.0.0.1", "127.0.0.1.example.com"),
    url.replace("127.0.0.1", "192.168.0.1"),
    url.replace("127.0.0.1", "[::2]"),
    url.replace("http:", "javascript:"),
    url.replace("127.0.0.1", "user:password@127.0.0.1"),
    url.replace("/#", "/api/#"),
    url.replace("/#", "/?redirect=https://example.com#"),
    `${url}&token=${"b".repeat(43)}`,
    "http://127.0.0.1:6047/",
    "http://127.0.0.1:6047/#token=short",
    `${url};$(touch /tmp/unsafe)`,
    "x".repeat(2049),
  ])("does not launch an invalid or unauthenticated URL", async (value) => {
    const execute = vi.fn(async () => {});
    expect(
      await openAuthenticatedWebUi(value, { platform: "darwin", execute }),
    ).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("contains native launcher failures without logging their credential-bearing errors", async () => {
    const log = vi.spyOn(console, "log");
    const error = vi.spyOn(console, "error");
    const warn = vi.spyOn(console, "warn");
    try {
      const execute = vi.fn(async () => {
        throw new Error(`Command failed: open ${url}`);
      });
      expect(
        await openAuthenticatedWebUi(url, { platform: "darwin", execute }),
      ).toBe(false);
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      error.mockRestore();
      warn.mockRestore();
    }
  });
});
