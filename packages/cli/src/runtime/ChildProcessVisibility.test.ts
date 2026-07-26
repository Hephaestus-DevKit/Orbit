import { readFileSync } from "fs";
import glob from "fast-glob";
import { describe, expect, it } from "vitest";

describe("child process visibility policy", () => {
  it("keeps every production runtime child process hidden", async () => {
    const files = await glob("packages/*/src/**/*.ts", {
      cwd: process.cwd(),
      ignore: ["**/*.test.ts"],
      onlyFiles: true,
    });
    const missing = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      const ownsChildProcess =
        /from\s+["'](?:node:)?child_process["']/.test(source) ||
        /import\(["'](?:node:)?child_process["']\)/.test(source) ||
        /from\s+["']execa["']/.test(source);
      return (
        ownsChildProcess &&
        !source.includes("HIDDEN_CHILD_PROCESS_OPTIONS") &&
        !/windowsHide\s*:\s*true/.test(source)
      );
    });

    expect(missing).toEqual([]);
  });
});
