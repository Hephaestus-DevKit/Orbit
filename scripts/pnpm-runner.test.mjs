import { describe, expect, it } from "./testing/support.mjs";
import { resolvePnpmInvocation } from "./pnpm-runner.mjs";

const pinned = {
  packageManager: "pnpm@10.34.5",
  args: ["licenses", "list", "--prod", "--json"],
};

describe("pinned pnpm script runner", () => {
  it("keeps Corepack arguments literal on Windows", () => {
    expect(
      resolvePnpmInvocation({
        ...pinned,
        corepackAvailable: true,
        platform: "win32",
        commandShell: "cmd.exe",
      }),
    ).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "corepack", "pnpm", ...pinned.args],
    });
  });
  it("supports a matching installed pnpm when Corepack is absent", () => {
    expect(
      resolvePnpmInvocation({
        ...pinned,
        corepackAvailable: false,
        pnpmVersion: "10.34.5",
      }),
    ).toEqual({ command: "pnpm", args: pinned.args });
  });
  it("rejects mismatched runners and malformed package manager declarations", () => {
    expect(() =>
      resolvePnpmInvocation({
        ...pinned,
        corepackAvailable: false,
        pnpmVersion: "11.0.0",
      }),
    ).toThrow("pnpm 10.34.5 is required");
    expect(() =>
      resolvePnpmInvocation({
        ...pinned,
        packageManager: "pnpm@latest",
        corepackAvailable: true,
      }),
    ).toThrow();
  });
});
