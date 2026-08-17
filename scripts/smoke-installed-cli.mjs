import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cliRoot = join(repositoryRoot, "packages", "cli");
// On managed Windows runners, child npm processes may receive a different
// token from the parent and cannot traverse a freshly-created %TEMP% ACL.
// Keep the install sandbox inside Orbit's ignored workspace test root there;
// it remains isolated while inheriting the same access boundary as the CLI.
const temporaryBase =
  process.platform === "win32"
    ? join(repositoryRoot, "rag-test-temp")
    : tmpdir();
mkdirSync(temporaryBase, { recursive: true });
const temporaryRoot = mkdtempSync(join(temporaryBase, "orbit-installed-cli-"));
const installRoot = join(temporaryRoot, "install");

const ManifestSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
});

function run(command, args, cwd = repositoryRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    timeout: 180_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}): ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout.trim();
}

function runInstalledOrbit(args) {
  const binRoot = join(installRoot, "node_modules", ".bin");
  if (process.platform === "win32") {
    return run(
      process.env.ComSpec || "cmd.exe",
      ["/d", "/s", "/c", join(binRoot, "orbit.cmd"), ...args],
      temporaryRoot,
    );
  }
  return run(join(binRoot, "orbit"), args, temporaryRoot);
}

function runNpm(args) {
  return process.platform === "win32"
    ? run(process.env.ComSpec || "cmd.exe", [
        "/d",
        "/s",
        "/c",
        "npm.cmd",
        ...args,
      ])
    : run("npm", args);
}

try {
  const manifest = ManifestSchema.parse(
    JSON.parse(readFileSync(join(cliRoot, "package.json"), "utf8")),
  );
  runNpm([
    "pack",
    cliRoot,
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
  const archivePath = join(temporaryRoot, archives[0]);
  runNpm([
    "install",
    "--prefix",
    installRoot,
    archivePath,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ]);

  const version = runInstalledOrbit(["--version"]);
  if (version !== manifest.version) {
    throw new Error(
      `Installed orbit reports ${JSON.stringify(version)} instead of ${manifest.version}.`,
    );
  }
  const help = runInstalledOrbit(["--help"]);
  for (const command of [
    "clean",
    "doctor",
    "exec",
    "update",
    "daemon",
    "acp",
    "sessions",
  ]) {
    if (!help.includes(command)) {
      throw new Error(`Installed CLI help is missing ${command}.`);
    }
  }
  const daemonHelp = runInstalledOrbit(["daemon", "--help"]);
  for (const command of [
    "submit",
    "inspect",
    "events",
    "cancel",
    "resume",
    "remove",
  ]) {
    if (!daemonHelp.includes(command)) {
      throw new Error(`Installed CLI daemon help is missing ${command}.`);
    }
  }
  if (!runInstalledOrbit(["daemon", "status", "--help"]).includes("--url")) {
    throw new Error("Installed CLI daemon status help is missing --url.");
  }
  if (!runInstalledOrbit(["sessions", "--help"]).includes("retention")) {
    throw new Error("Installed CLI sessions help is missing retention.");
  }
  const reviewHelp = runInstalledOrbit(["review", "--help"]);
  for (const command of ["github-check", "github-comment", "github-dispatch"]) {
    if (!reviewHelp.includes(command)) {
      throw new Error(`Installed CLI review help is missing ${command}.`);
    }
  }
  const doctor = JSON.parse(runInstalledOrbit(["doctor", "--json"]));
  if (doctor.orbit?.version !== manifest.version) {
    throw new Error("Installed CLI doctor output has a stale Orbit version.");
  }
  const acpRegistry = JSON.parse(
    runInstalledOrbit(["acp", "registry", "validate", "--json"]),
  );
  if (acpRegistry.schemaVersion !== 1 || acpRegistry.ok !== true) {
    throw new Error("Installed CLI local ACP registry validation failed.");
  }
  if (
    !runInstalledOrbit(["acp", "registry", "validate", "--help"]).includes(
      "--require-signature",
    )
  ) {
    throw new Error(
      "Installed CLI ACP registry help is missing signature enforcement.",
    );
  }
  if (!runInstalledOrbit(["acp", "--help"]).includes("import")) {
    throw new Error("Installed CLI ACP help is missing history import.");
  }
  const skills = JSON.parse(runInstalledOrbit(["skills", "list", "--json"]));
  if (
    !Array.isArray(skills.skills) ||
    !skills.skills.some((skill) => skill.name === "cumcm-draft")
  ) {
    throw new Error("Installed CLI did not discover cumcm-draft.");
  }

  runNpm([
    "uninstall",
    "--prefix",
    installRoot,
    "@orbit-build/cli",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ]);
  const installedPackage = join(
    installRoot,
    "node_modules",
    "@orbit-build",
    "cli",
  );
  const installedExecutable = join(
    installRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "orbit.cmd" : "orbit",
  );
  if (existsSync(installedPackage) || existsSync(installedExecutable)) {
    throw new Error(
      "npm uninstall left the Orbit package or executable behind.",
    );
  }

  console.log(
    `✔ Installed CLI install/uninstall smoke passed for ${basename(archivePath)} (${manifest.version}).`,
  );
} finally {
  rmSync(temporaryRoot, {
    recursive: true,
    force: true,
    maxRetries: process.platform === "win32" ? 10 : 3,
    retryDelay: 100,
  });
}
