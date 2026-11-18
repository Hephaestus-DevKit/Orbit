import { createHash } from "node:crypto";
import { test as base, expect } from "@playwright/test";

// Playwright's WebKit screenshot implementation injects this exact empty rule
// to synchronize animations. Permit only those bytes on the test document.
const screenshotHash = createHash("sha256").update("body {}").digest("base64");

export const test = base.extend({
  page: async ({ page, browserName }, use) => {
    if (browserName === "webkit") {
      await page.route(
        /^http:\/\/127\.0\.0\.1:\d+\/(?:\?.*)?$/,
        async (route) => {
          if (route.request().resourceType() !== "document")
            return route.fallback();
          const response = await route.fetch({ maxRedirects: 0 });
          const headers = response.headers();
          const policy = headers["content-security-policy"];
          if (policy)
            headers["content-security-policy"] = policy.replace(
              "style-src 'self';",
              `style-src 'self' 'sha256-${screenshotHash}';`,
            );
          await route.fulfill({ response, headers });
        },
      );
    }
    await use(page);
  },
});
export { expect };
