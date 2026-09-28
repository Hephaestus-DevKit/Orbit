import type { Browser, LaunchOptions } from "playwright-core";

/** Start an isolated installed Chromium engine, never downloading or reusing profiles. */
export async function launchPreviewBrowser(
  proxy?: LaunchOptions["proxy"],
): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  for (const channel of process.platform === "win32"
    ? ["msedge", "chrome", undefined]
    : ["chrome", "msedge", undefined]) {
    try {
      return await chromium.launch({
        channel,
        headless: true,
        chromiumSandbox: true,
        timeout: 5000,
        proxy,
        args: [
          "--disable-background-networking",
          "--disable-quic",
          "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
          ...(proxy ? ["--proxy-bypass-list=<-loopback>"] : []),
        ],
      });
    } catch {
      /* Try another installed engine without exposing host paths. */
    }
  }
  throw new Error(
    "No supported browser could start. Install Chrome or Edge and try again. No browser is downloaded automatically.",
  );
}
