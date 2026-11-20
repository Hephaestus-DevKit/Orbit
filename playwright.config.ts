import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  projects: [
    ...(process.platform === "darwin"
      ? [{
        name: "system-safari",
        testMatch: "**/*.native-safari.spec.ts",
        timeout: 60_000,
      }]
      : []),
    {
      name: "webkit",
      testIgnore: "**/*.native-safari.spec.ts",
      use: {
        browserName: "webkit",
        headless: true,
        locale: "en-US",
        trace: "retain-on-failure",
      },
    },
  ],
});
