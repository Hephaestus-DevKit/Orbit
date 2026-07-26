/**
 * Bundles serve.ts with esbuild (workspace imports stay external) and runs
 * it. The bundle lands directly in packages/cli (gitignored) so Node
 * resolves both the workspace packages and the CLI's own package.json
 * exactly as the shipped CLI would.
 */
import { spawnSync, spawn } from "child_process";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const cliDir = join(root, "packages", "cli");
const outFile = join(cliDir, ".webui-preview.bundle.mjs");

const bundle = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  [
    "esbuild",
    join(here, "serve.ts"),
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--packages=external",
    `--outfile=${outFile}`,
  ],
  { cwd: cliDir, stdio: "inherit", shell: process.platform === "win32" },
);
if (bundle.status !== 0) process.exit(bundle.status ?? 1);

const server = spawn(process.execPath, [outFile], {
  cwd: cliDir,
  stdio: "inherit",
});
server.on("exit", (code) => process.exit(code ?? 0));
