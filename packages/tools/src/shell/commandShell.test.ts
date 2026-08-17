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
      dialect: "bash",
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
      dialect: "sh",
    });
  });

  it("uses native PowerShell on Windows", () => {
    const executable =
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    const invocation = resolveCommandShellInvocation("Write-Output ok", {
      platform: "win32",
      environment: { SystemRoot: "C:\\Windows" },
      pathExists: (candidate) => candidate === executable,
    });

    expect(invocation).toEqual({
      file: executable,
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$ErrorActionPreference = 'Stop'; $global:LASTEXITCODE = 0; & { Write-Output ok }; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
      ],
      dialect: "powershell",
    });
  });

  it("invokes a quoted Windows executable path with the PowerShell call operator", () => {
    const powershell =
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    const invocation = resolveCommandShellInvocation(
      '"C:\\Program Files\\nodejs\\node.exe" --check verification.js',
      {
        platform: "win32",
        environment: { SystemRoot: "C:\\Windows" },
        pathExists: (candidate) => candidate === powershell,
      },
    );

    expect(invocation.args.at(-1)).toContain(
      '& { & "C:\\Program Files\\nodejs\\node.exe" --check verification.js }',
    );
  });

  it("does not duplicate an existing PowerShell call operator", () => {
    const powershell =
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    const invocation = resolveCommandShellInvocation(
      '& "C:\\Program Files\\nodejs\\node.exe" --version',
      {
        platform: "win32",
        environment: { SystemRoot: "C:\\Windows" },
        pathExists: (candidate) => candidate === powershell,
      },
    );

    expect(invocation.args.at(-1)).toContain(
      '& { & "C:\\Program Files\\nodejs\\node.exe" --version }',
    );
    expect(invocation.args.at(-1)).not.toContain("& { & &");
  });

  it("retains the Windows cmd fallback when PowerShell is unavailable", () => {
    const invocation = resolveCommandShellInvocation("echo ok", {
      platform: "win32",
      environment: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      pathExists: () => false,
    });

    expect(invocation).toEqual({
      file: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "echo ok"],
      dialect: "cmd",
    });
  });

  it("resolves cmd fallback to an absolute SystemRoot path", () => {
    const invocation = resolveCommandShellInvocation("echo ok", {
      platform: "win32",
      environment: { SystemRoot: "C:\\Windows" },
      pathExists: () => false,
    });

    expect(invocation.file).toBe("C:\\Windows\\System32\\cmd.exe");
  });
});
