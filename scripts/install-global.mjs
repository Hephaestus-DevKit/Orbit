import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = dirname(dirname(scriptPath));
const cliDirectory = join(repositoryRoot, "packages", "cli");
const PackageManifestSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
});
const npmCommand =
  process.platform === "win32"
    ? (process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe")
    : "npm";
const npmArgumentPrefix =
  process.platform === "win32" ? ["/d", "/s", "/c", "npm.cmd"] : [];

function run(command, args, cwd, environment = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: environment,
    shell: false,
    stdio: ["inherit", "pipe", "pipe"],
    windowsHide: true,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} exited with status ${result.status ?? "unknown"}.`,
    );
  }
  return result.stdout.trim();
}

const unsupportedInheritedNpmConfig = new Set([
  "npm_config__jsr_registry",
  "npm_config_npm_globalconfig",
  "npm_config_overrides",
  "npm_config_verify_deps_before_run",
]);

export function sanitizeNpmEnvironment(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) => !unsupportedInheritedNpmConfig.has(key.toLowerCase()),
    ),
  );
}

function runNpm(args, cwd = repositoryRoot) {
  return run(
    npmCommand,
    [...npmArgumentPrefix, ...args],
    cwd,
    sanitizeNpmEnvironment(process.env),
  );
}

function buildCliDependencyGraph() {
  if (process.platform === "win32") {
    run(
      process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe",
      [
        "/d",
        "/s",
        "/c",
        "corepack",
        "pnpm",
        "--filter",
        "@orbit-build/cli...",
        "build",
      ],
      repositoryRoot,
    );
    return;
  }
  run(
    "corepack",
    ["pnpm", "--filter", "@orbit-build/cli...", "build"],
    repositoryRoot,
  );
}

export function resolveGlobalPackageDirectory(
  globalPrefix,
  platform = process.platform,
) {
  return platform === "win32"
    ? join(globalPrefix, "node_modules", "@orbit-build", "cli")
    : join(globalPrefix, "lib", "node_modules", "@orbit-build", "cli");
}

export function assertStandalonePackageDirectory(
  sourceDirectory,
  globalPackageDirectory,
) {
  if (!existsSync(globalPackageDirectory)) {
    throw new Error(
      `Global Orbit package was not created: ${globalPackageDirectory}.`,
    );
  }
  if (realpathSync(globalPackageDirectory) === realpathSync(sourceDirectory)) {
    throw new Error(
      `Global Orbit install still links to the source workspace: ${sourceDirectory}.`,
    );
  }
}

function packCli(temporaryRoot) {
  runNpm([
    "pack",
    cliDirectory,
    "--pack-destination",
    temporaryRoot,
    "--ignore-scripts",
    "--silent",
  ]);
  const archives = readdirSync(temporaryRoot).filter((file) =>
    file.endsWith(".tgz"),
  );
  if (archives.length !== 1) {
    throw new Error(`Expected one CLI archive, found ${archives.length}.`);
  }
  return join(temporaryRoot, archives[0]);
}

function verifyInstalledCli(expectedVersion, globalPrefix) {
  const globalPackageDirectory = resolveGlobalPackageDirectory(globalPrefix);
  const globalBin =
    process.platform === "win32"
      ? join(globalPrefix, "orbit.cmd")
      : join(globalPrefix, "bin", "orbit");
  assertStandalonePackageDirectory(cliDirectory, globalPackageDirectory);
  if (!existsSync(globalBin)) {
    throw new Error(`Global Orbit executable was not created: ${globalBin}.`);
  }

  const installedPackage = PackageManifestSchema.parse(
    JSON.parse(
      readFileSync(join(globalPackageDirectory, "package.json"), "utf8"),
    ),
  );
  if (installedPackage.version !== expectedVersion) {
    throw new Error(
      `Global Orbit version verification failed: expected ${expectedVersion}, received ${installedPackage.version}.`,
    );
  }

  const installedVersion = run(
    process.execPath,
    [join(globalPackageDirectory, "dist", "index.js"), "--version"],
    repositoryRoot,
  );
  if (installedVersion !== expectedVersion) {
    throw new Error(
      `Global Orbit executable reported ${JSON.stringify(installedVersion)} instead of ${expectedVersion}.`,
    );
  }
}

export function main() {
  const cliPackage = PackageManifestSchema.parse(
    JSON.parse(readFileSync(join(cliDirectory, "package.json"), "utf8")),
  );
  const temporaryRoot = mkdtempSync(join(tmpdir(), "orbit-global-install-"));
  try {
    buildCliDependencyGraph();
    const archivePath = packCli(temporaryRoot);
    runNpm([
      "install",
      "--global",
      archivePath,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ]);
    const globalPrefix = runNpm(["prefix", "--global"]);
    verifyInstalledCli(cliPackage.version, globalPrefix);
    console.log(
      `✔ Installed standalone global orbit from ${basename(archivePath)} and verified ${cliPackage.version}.`,
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 3 });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main();
}
