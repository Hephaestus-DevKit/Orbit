import { spawnSync } from "node:child_process";
import {
  existsSync,
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
const temporaryRoot = mkdtempSync(join(tmpdir(), "orbit-installed-cli-"));
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
  for (const command of ["clean", "doctor", "exec", "update"]) {
    if (!help.includes(command)) {
      throw new Error(`Installed CLI help is missing ${command}.`);
    }
  }
  const doctor = JSON.parse(runInstalledOrbit(["doctor", "--json"]));
  if (doctor.orbit?.version !== manifest.version) {
    throw new Error("Installed CLI doctor output has a stale Orbit version.");
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
  rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 3 });
}
