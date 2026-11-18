import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const pnpmCandidates = [
  process.env.PNPM_HOME,
  process.env.APPDATA ? join(process.env.APPDATA, "npm") : undefined,
  process.env.npm_config_prefix,
]
  .filter((prefix) => Boolean(prefix))
  .map((prefix) => join(prefix, "node_modules", "pnpm", "bin", "pnpm.cjs"));
const pnpmEntry = pnpmCandidates.find((candidate) => existsSync(candidate));
const command = pnpmEntry
  ? process.execPath
  : process.platform === "win32"
  ? "pnpm.cmd"
  : "pnpm";
const commandArguments = pnpmEntry ? [pnpmEntry] : [];
const result = spawnSync(
  command,
  [
    ...commandArguments,
    "-r",
    "--no-bail",
    "--workspace-concurrency=4",
    "exec",
    "tsc",
    "--noEmit",
    "--pretty",
    "false",
    "-p",
    "tsconfig.json",
  ],
  {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: !pnpmEntry && process.platform === "win32",
    windowsHide: true,
  },
);

if (result.error) throw result.error;

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
const diagnostics = output
  .split(/\r?\n/u)
  .filter((line) => /error TS\d+:/u.test(line));
if (diagnostics.length > 0) {
  console.error(
    `✖ TypeScript check failed with ${diagnostics.length} diagnostic(s), including tests.`,
  );
  console.error(diagnostics.join("\n"));
  process.exitCode = 1;
} else if (result.status !== 0) {
  console.error(
    output.trim() || "TypeScript check failed without diagnostics.",
  );
  process.exitCode = result.status ?? 1;
} else {
  console.log(
    "✔ Production and test TypeScript checks passed without ignored diagnostics.",
  );
}
