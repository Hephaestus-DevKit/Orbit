import { describe, expect, it } from "vitest";
import { resolveCommandShellInvocation } from "./commandShell.js";

describe("resolveCommandShellInvocation", () => {
  it("uses the system Bash on macOS instead of the user's interactive shell", () => {
    const invocation = resolveCommandShellInvocation("printf ok", {
      platform: "darwin",
      environment: { SHELL: "/bin/zsh" },
      pathExists: (candidate) => candidate === "/bin/bash",
    });

    expect(invocation).toEqual({
      file: "/bin/bash",
      args: ["--noprofile", "--norc", "-c", "printf ok"],
    });
  });

  it("honors an explicit Bash path on macOS", () => {
    const invocation = resolveCommandShellInvocation("printf ok", {
      platform: "darwin",
      environment: { ORBIT_BASH_PATH: "/opt/homebrew/bin/bash" },
      pathExists: (candidate) => candidate === "/opt/homebrew/bin/bash",
    });

    expect(invocation.file).toBe("/opt/homebrew/bin/bash");
  });

  it("falls back to POSIX sh when Bash is unavailable", () => {
    const invocation = resolveCommandShellInvocation("printf ok", {
      platform: "linux",
      environment: {},
      pathExists: () => false,
    });

    expect(invocation).toEqual({
      file: "/bin/sh",
      args: ["-c", "printf ok"],
    });
  });

  it("retains the Windows cmd fallback", () => {
    const invocation = resolveCommandShellInvocation("echo ok", {
      platform: "win32",
      environment: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      pathExists: () => false,
    });

    expect(invocation).toEqual({
      file: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "echo ok"],
    });
  });
});
