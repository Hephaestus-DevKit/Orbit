import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/** Choose Corepack or an installed pnpm matching the repository's pinned version.
 * @param {{ corepackAvailable: boolean, pnpmVersion?: string, packageManager: string, args: string[], platform?: string, commandShell?: string }} options
 * @returns {{command: string, args: string[]}}
 */
export function resolvePnpmInvocation(options) {
  const packageManager = z
    .string()
    .regex(/^pnpm@\d+\.\d+\.\d+$/)
    .parse(options.packageManager);
  const expected = packageManager.slice(5);
  if (!options.corepackAvailable && options.pnpmVersion !== expected) {
    throw new Error(
      `Corepack is unavailable and pnpm ${expected} is required. Run npm exec --yes --package=pnpm@${expected} -- pnpm ${options.args.join(" ")}.`,
    );
  }
  const runner = options.corepackAvailable ? "corepack" : "pnpm";
  const args = [
    ...(options.corepackAvailable ? ["pnpm"] : []),
    ...options.args,
  ];
  return options.platform === "win32"
    ? {
        command: options.commandShell ?? "C:\\Windows\\System32\\cmd.exe",
        args: ["/d", "/s", "/c", runner, ...args],
      }
    : { command: runner, args };
}

function probeVersion(command, repositoryRoot) {
  const windows = process.platform === "win32";
  const result = spawnSync(
    windows
      ? (process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe")
      : command,
    windows ? ["/d", "/s", "/c", command, "--version"] : ["--version"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: 5000,
    },
  );
  return result.status === 0 ? result.stdout.trim() : undefined;
}

/** Resolve the pinned runner without installing or changing the user's tooling. */
export function resolvePinnedPnpmCommand(args, repositoryRoot) {
  const manifest = z
    .object({ packageManager: z.string() })
    .parse(
      JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")),
    );
  const corepackAvailable =
    probeVersion("corepack", repositoryRoot) !== undefined;
  return resolvePnpmInvocation({
    corepackAvailable,
    pnpmVersion: corepackAvailable
      ? undefined
      : probeVersion("pnpm", repositoryRoot),
    packageManager: manifest.packageManager,
    args,
    platform: process.platform,
    commandShell: process.env.ComSpec,
  });
}
