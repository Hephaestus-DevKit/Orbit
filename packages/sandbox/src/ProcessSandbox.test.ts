import { createHash, generateKeyPairSync, sign } from "crypto";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { detectProcessSandbox, sandboxInvocation } from "./ProcessSandbox.js";

describe("ProcessSandbox", () => {
  it("selects a Windows helper only after digest and Ed25519 verification", () => {
    const cwd = mkdtempSync(
      join(process.env.TEMP ?? process.cwd(), "orbit-sandbox-"),
    );
    const helperPath = join(cwd, "orbit-sandbox-helper.exe");
    const helperBytes = Buffer.from("signed native helper fixture", "utf8");
    writeFileSync(helperPath, helperBytes);
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const digest = createHash("sha256").update(helperBytes).digest("hex");
    const payload = JSON.stringify({
      schemaVersion: 1,
      protocol: "orbit-process-sandbox-v1",
      digest,
    });
    const signature = sign(
      null,
      Buffer.from(payload, "utf8"),
      privateKey,
    ).toString("base64");
    const environment = {
      ORBIT_WINDOWS_SANDBOX_HELPER: helperPath,
      ORBIT_WINDOWS_SANDBOX_HELPER_SHA256: digest,
      ORBIT_WINDOWS_SANDBOX_HELPER_KEY_ID: "release",
      ORBIT_WINDOWS_SANDBOX_HELPER_SIGNATURE: signature,
    };
    const capabilities = detectProcessSandbox({
      platform: "win32",
      environment,
      trustRoots: {
        release: publicKey.export({ type: "spki", format: "pem" }).toString(),
      },
    });
    expect(capabilities).toMatchObject({
      selectedBackend: "windows-appcontainer-helper",
      native: true,
      networkIsolation: true,
      helperDigest: digest,
      helperKeyId: "release",
    });
  });

  it("fails closed for an unsigned or tampered Windows helper", () => {
    const cwd = mkdtempSync(
      join(process.env.TEMP ?? process.cwd(), "orbit-sandbox-"),
    );
    const helperPath = join(cwd, "orbit-sandbox-helper.exe");
    writeFileSync(helperPath, "unsigned helper");
    const capabilities = detectProcessSandbox({
      platform: "win32",
      environment: {
        ORBIT_WINDOWS_SANDBOX_HELPER: helperPath,
        ORBIT_WINDOWS_SANDBOX_HELPER_SHA256: "0".repeat(64),
        ORBIT_WINDOWS_SANDBOX_HELPER_KEY_ID: "release",
        ORBIT_WINDOWS_SANDBOX_HELPER_SIGNATURE: "invalid",
      },
      trustRoots: { release: "not-a-public-key" },
    });
    expect(capabilities).toMatchObject({
      selectedBackend: "none",
      native: false,
    });
  });

  it("passes Windows helper boundaries as argv without shell concatenation", () => {
    const cwd = mkdtempSync(
      join(process.env.TEMP ?? process.cwd(), "orbit-sandbox-"),
    );
    const helperPath = join(cwd, "orbit-sandbox-helper.exe");
    const helperBytes = Buffer.from("signed native helper fixture", "utf8");
    writeFileSync(helperPath, helperBytes);
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const digest = createHash("sha256").update(helperBytes).digest("hex");
    const signature = sign(
      null,
      Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          protocol: "orbit-process-sandbox-v1",
          digest,
        }),
        "utf8",
      ),
      privateKey,
    ).toString("base64");
    const wrapped = sandboxInvocation(
      {
        file: "powershell.exe",
        args: ["-NoProfile", "-Command", "Write-Output 'ok'"],
      },
      {
        cwd,
        mode: "required",
        network: "deny",
        platform: "win32",
        environment: {
          ORBIT_WINDOWS_SANDBOX_HELPER: helperPath,
          ORBIT_WINDOWS_SANDBOX_HELPER_SHA256: digest,
          ORBIT_WINDOWS_SANDBOX_HELPER_KEY_ID: "release",
          ORBIT_WINDOWS_SANDBOX_HELPER_SIGNATURE: signature,
        },
        trustRoots: {
          release: publicKey.export({ type: "spki", format: "pem" }).toString(),
        },
        writableRoots: [join(cwd, "writable")],
        readOnlyRoots: [join(cwd, "readonly")],
      },
    );
    expect(wrapped.file).toBe(helperPath);
    expect(wrapped.args).toEqual([
      "--orbit-sandbox-protocol",
      "1",
      "--cwd",
      cwd,
      "--network",
      "deny",
      "--read-only",
      join(cwd, "readonly").replaceAll("\\", "/"),
      "--writable",
      join(cwd, "writable").replaceAll("\\", "/"),
      "--",
      "powershell.exe",
      "-NoProfile",
      "-Command",
      "Write-Output 'ok'",
    ]);
  });

  it("fails closed for required isolation on Windows", () => {
    const capabilities = detectProcessSandbox({
      platform: "win32",
      pathExists: () => false,
    });
    expect(capabilities.native).toBe(false);
    expect(capabilities.selectedBackend).toBe("none");
    expect(() =>
      sandboxInvocation(
        {
          file: "powershell.exe",
          args: ["-NoProfile", "-Command", "Get-Date"],
        },
        {
          cwd: process.cwd(),
          mode: "required",
          network: "deny",
          platform: "win32",
          pathExists: () => false,
        },
      ),
    ).toThrow(/Required process sandbox is unavailable/);
  });

  it("wraps macOS commands with a deny-network profile", () => {
    const cwd = mkdtempSync(
      join(process.env.TEMP ?? process.cwd(), "orbit-sandbox-"),
    );
    const wrapped = sandboxInvocation(
      { file: "/bin/bash", args: ["--noprofile", "--norc", "-c", "echo ok"] },
      {
        cwd,
        mode: "required",
        network: "deny",
        platform: "darwin",
        environment: { ORBIT_SANDBOX_EXEC_PATH: "/usr/bin/sandbox-exec" },
        pathExists: (candidate) => candidate === "/usr/bin/sandbox-exec",
      },
    );
    expect(wrapped).toMatchObject({
      file: "/usr/bin/sandbox-exec",
      backend: "macos-sandbox-exec",
      networkIsolation: true,
      degraded: false,
    });
    expect(wrapped.args[0]).toBe("-p");
    expect(wrapped.args[1]).toContain("deny network");
    expect(wrapped.args[1]).toContain("allow process-exec");
    expect(wrapped.args[1]).toContain("allow process-fork");
    expect(wrapped.args[1]).toContain("allow sysctl-read");
    expect(wrapped.args).toContain("/bin/bash");
  });

  it("admits macOS toolchain search paths as read-only runtime roots", () => {
    const cwd = mkdtempSync(
      join(process.env.TEMP ?? process.cwd(), "orbit-sandbox-paths-"),
    );
    const wrapped = sandboxInvocation(
      { file: "/bin/bash", args: ["--noprofile", "--norc", "-c", "node -v"] },
      {
        cwd,
        mode: "required",
        network: "deny",
        platform: "darwin",
        environment: {
          ORBIT_SANDBOX_EXEC_PATH: "/usr/bin/sandbox-exec",
          PATH: "/opt/homebrew/bin:/Users/runner/hostedtoolcache/node/22/bin",
        },
        pathExists: (candidate) => candidate === "/usr/bin/sandbox-exec",
      },
    );

    const profile = wrapped.args[1];
    expect(profile).toContain(
      '(allow file-read* (subpath "/opt/homebrew/bin"))',
    );
    expect(profile).toContain(
      '(allow file-read* (subpath "/Users/runner/hostedtoolcache/node/22/bin"))',
    );
    expect(profile).not.toContain(
      '(allow file-write* (subpath "/opt/homebrew/bin"))',
    );
    expect(profile).not.toContain(
      '(allow file-write* (subpath "/Users/runner/hostedtoolcache/node/22/bin"))',
    );
  });

  it("admits disjoint roots only through explicit canonical boundaries", () => {
    const cwd = mkdtempSync(
      join(process.env.TEMP ?? process.cwd(), "orbit-sandbox-workspace-"),
    );
    const extensionRoot = mkdtempSync(
      join(process.env.TEMP ?? process.cwd(), "orbit-sandbox-extension-"),
    );
    const wrapped = sandboxInvocation(
      { file: "/usr/bin/node", args: [join(extensionRoot, "tool.mjs")] },
      {
        cwd,
        mode: "required",
        network: "deny",
        platform: "darwin",
        environment: { ORBIT_SANDBOX_EXEC_PATH: "/usr/bin/sandbox-exec" },
        pathExists: (candidate) => candidate === "/usr/bin/sandbox-exec",
        boundaryRoots: [extensionRoot],
        readOnlyRoots: [extensionRoot],
        writableRoots: [],
      },
    );
    expect(wrapped.args[1]).toContain(extensionRoot.replaceAll("\\", "/"));

    expect(() =>
      sandboxInvocation(
        { file: "/usr/bin/node", args: [] },
        {
          cwd,
          mode: "required",
          network: "deny",
          platform: "darwin",
          environment: { ORBIT_SANDBOX_EXEC_PATH: "/usr/bin/sandbox-exec" },
          pathExists: (candidate) => candidate === "/usr/bin/sandbox-exec",
          readOnlyRoots: [extensionRoot],
          writableRoots: [],
        },
      ),
    ).toThrow("outside every authorized boundary");
  });

  it("uses bubblewrap and preserves a bounded writable root", () => {
    const cwd = mkdtempSync(
      join(process.env.TEMP ?? process.cwd(), "orbit-sandbox-"),
    );
    const wrapped = sandboxInvocation(
      { file: "/usr/bin/node", args: ["--version"] },
      {
        cwd,
        mode: "required",
        network: "deny",
        platform: "linux",
        environment: { ORBIT_BWRAP_PATH: "/usr/bin/bwrap" },
        pathExists: (candidate) => candidate === "/usr/bin/bwrap",
        writableRoots: [cwd],
      },
    );
    expect(wrapped.file).toBe("/usr/bin/bwrap");
    expect(wrapped.backend).toBe("linux-bubblewrap");
    expect(wrapped.args).toContain("--unshare-net");
    expect(wrapped.args).toContain("--bind");
    expect(wrapped.args).toContain(cwd);
    expect(wrapped.args.at(-1)).toBe("--version");
  });

  it("marks auto fallback explicitly instead of claiming isolation", () => {
    const wrapped = sandboxInvocation(
      { file: "cmd.exe", args: ["/c", "echo ok"] },
      {
        cwd: process.cwd(),
        mode: "auto",
        network: "deny",
        platform: "win32",
        pathExists: () => false,
      },
    );
    expect(wrapped).toMatchObject({
      backend: "none",
      networkIsolation: false,
      degraded: true,
    });
    expect(wrapped.reason).toContain("Windows OS sandbox");
  });
});
