import { describe, expect, it, mockTools as vi } from "../../../../../scripts/testing/support.mjs";
import { openAuthenticatedWebUi } from "./WebUiBrowserLauncher.js";

const url = `http://127.0.0.1:6047/#token=${"a".repeat(43)}`;

describe("openAuthenticatedWebUi", () => {
  it.each(["darwin", "linux"] as const)(
    "passes the complete authentication fragment to the %s launcher",
    async (platform) => {
      const execute = vi.fn(async () => {});
      expect(await openAuthenticatedWebUi(url, { platform, execute })).toBe(
        true,
      );
      expect(execute).toHaveBeenCalledWith(
        platform === "darwin" ? "/usr/bin/open" : "xdg-open",
        [url],
      );
    },
  );

  it("opens an authenticated IPv6 loopback workspace", async () => {
    const execute = vi.fn(async () => {});
    const ipv6 = url.replace("127.0.0.1", "[::1]");
    expect(await openAuthenticatedWebUi(ipv6, { platform: "darwin", execute })).toBe(true);
    expect(execute).toHaveBeenCalledWith("/usr/bin/open", [ipv6]);
  });

  it("keeps the Windows URL out of PowerShell source", async () => {
    const execute = vi.fn(async () => {});
    expect(
      await openAuthenticatedWebUi(url, { platform: "win32", execute }),
    ).toBe(true);
    expect(execute).toHaveBeenCalledWith(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Start-Process -FilePath $env:ORBIT_WEBUI_LAUNCH_URL",
      ],
      expect.objectContaining({ ORBIT_WEBUI_LAUNCH_URL: url }),
    );
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

  it("degrades safely when the platform has no supported desktop launcher", async () => {
    const execute = vi.fn(async () => {});
    expect(
      await openAuthenticatedWebUi(url, { platform: "aix", execute }),
    ).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});
