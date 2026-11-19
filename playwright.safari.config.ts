import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.native-safari.spec.ts",
  outputDir: "native-safari-results",
  workers: 1,
  timeout: 60_000,
});
