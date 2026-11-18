import { describe, expect, it } from "./testing/support.mjs";
import { dirname, join } from "node:path";
import { resolveNpmInvocation } from "./npm-runner.mjs";

describe("shell-free npm invocation", () => {
  it("preserves metacharacters as arguments without executing ComSpec", () => {
    const execPath = join(process.cwd(), "Node & tools", "node");
    const entry = join(dirname(execPath), "node_modules/npm/bin/npm-cli.js");
    const args = ["install", "a & echo injected", "$(command)"];
    expect(
      resolveNpmInvocation(args, {
        execPath,
        path: "",
        exists: (candidate) => candidate === entry,
        realpath: (candidate) => candidate,
      }),
    ).toEqual({ command: execPath, args: [entry, ...args] });
  });
  it("fails explicitly when npm is unavailable", () => {
    expect(() =>
      resolveNpmInvocation([], { path: "", exists: () => false }),
    ).toThrow("Cannot locate npm-cli.js");
  });
});
