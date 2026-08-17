import { defineConfig } from "vitest/config";

import { testExcludes, workspaceAliases } from "./vitest.shared.js";

export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    // Windows CI and managed desktop runners can spend tens of seconds
    // starting child processes after a large serial suite. Keep the timeout
    // bounded but leave room for a genuine lifecycle test to finish.
    testTimeout: process.platform === "win32" ? 60_000 : 20_000,
    exclude: [...testExcludes],
    // Windows process-tree and junction cleanup are global kernel resources;
    // concurrent test workers make otherwise isolated fixtures race. Keep
    // release verification deterministic on the supported Windows runner.
    ...(process.platform === "win32"
      ? {
          pool: "threads" as const,
          maxWorkers: 1,
          minWorkers: 1,
          fileParallelism: false,
        }
      : {}),
  },
});
