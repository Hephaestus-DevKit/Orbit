import { defineConfig } from "vitest/config";

import { testExcludes, workspaceAliases } from "./vitest.shared.js";

export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    testTimeout: 20000,
    exclude: [...testExcludes],
  },
});
