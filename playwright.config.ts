import { defineConfig } from "@playwright/test";

const useSafari = process.platform === "darwin"
  && !process.env.CI
  && !process.env.ORBIT_E2E_BROWSER_CHANNEL;
const browserChannel = process.env.ORBIT_E2E_BROWSER_CHANNEL
  ?? (process.platform === "win32" ? "msedge" : "chrome");

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "**/*.native-safari.spec.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  use: {
    browserName: useSafari ? "webkit" : "chromium",
    channel: useSafari ? undefined : browserChannel,
    headless: true,
    locale: "en-US",
    trace: "retain-on-failure",
  },
});
