import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Package a universal WebKit host. Linux publishing consumes the verified macOS CI bundle. */
export function buildOrbitBrowser(destination, prebuilt) {
  const source = fileURLToPath(new URL("../native/orbit-browser/", import.meta.url));
  const bundle = join(destination, "Orbit Browser.app");
  if (prebuilt) {
    for (const [installed, local] of [
      ["Info.plist", "Info.plist"],
      ["Resources/Targets.js", "Targets.js"],
    ]) {
      if (
        !readFileSync(join(prebuilt, "Contents", installed)).equals(
          readFileSync(join(source, local)),
        )
      )
        throw new Error("The supplied Orbit Browser bundle does not match this checkout.");
    }
    for (const name of ["MacOS/OrbitBrowser", "_CodeSignature/CodeResources"]) {
      if (!statSync(join(prebuilt, "Contents", name)).isFile())
        throw new Error("Incomplete Orbit Browser bundle.");
    }
    cpSync(prebuilt, bundle, { recursive: true });
    return;
  }
  const contents = join(bundle, "Contents");
  mkdirSync(join(contents, "MacOS"), { recursive: true });
  mkdirSync(join(contents, "Resources"), { recursive: true });
  copyFileSync(join(source, "Info.plist"), join(contents, "Info.plist"));
  copyFileSync(join(source, "Targets.js"), join(contents, "Resources", "Targets.js"));
  const executable = join(contents, "MacOS", "OrbitBrowser");
  const scratch = mkdtempSync(join(tmpdir(), "orbit-browser-build-"));
  try {
    for (const arch of ["x86_64", "arm64"]) {
      execFileSync("/usr/bin/xcrun", [
        "swiftc",
        "-O",
        "-target",
        arch + "-apple-macos14.0",
        join(source, "OrbitBrowser.swift"),
        join(source, "BrowserCommands.swift"),
        join(source, "BrowserChrome.swift"),
        join(source, "main.swift"),
        "-o",
        join(scratch, arch),
      ], { stdio: "inherit" });
    }
    execFileSync("/usr/bin/lipo", [
      "-create",
      join(scratch, "arm64"),
      join(scratch, "x86_64"),
      "-output",
      executable,
    ]);
    execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", bundle]);
    execFileSync("/usr/bin/codesign", ["--verify", "--strict", bundle]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  chmodSync(executable, 0o755);
}
