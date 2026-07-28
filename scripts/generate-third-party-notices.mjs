import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const noticePath = resolve(repositoryRoot, "THIRD_PARTY_NOTICES.md");
const checkOnly = process.argv.includes("--check");

const PackageSchema = z.object({
  name: z.string().min(1),
  versions: z.array(z.string().min(1)).min(1),
  license: z.string().min(1),
  homepage: z.string().url().optional(),
});
const LicenseReportSchema = z.record(z.array(PackageSchema));

function runPnpmLicenses() {
  // Always resolve pnpm through Corepack so nested package scripts cannot
  // accidentally inherit a different global pnpm/store than packageManager.
  const executable =
    process.platform === "win32"
      ? (process.env.ComSpec ?? "cmd.exe")
      : "corepack";
  const args =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "corepack pnpm licenses list --prod --json"]
      : ["pnpm", "licenses", "list", "--prod", "--json"];
  const result = spawnSync(executable, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout).trim());
  }
  return LicenseReportSchema.parse(JSON.parse(result.stdout));
}

function renderNotices(report) {
  const lines = [
    "# Third-party notices",
    "",
    "This file records the production dependency licenses included in Orbit's",
    "published runtime bundle. It is generated from the lockfile with",
    "`pnpm notices` and does not determine Orbit's own license.",
    "",
  ];
  for (const license of Object.keys(report).sort()) {
    lines.push(`## ${license}`, "");
    for (const dependency of [...report[license]].sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const versions = [...dependency.versions].sort().join(", ");
      const homepage = dependency.homepage ? ` — ${dependency.homepage}` : "";
      lines.push(`- \`${dependency.name}\` ${versions}${homepage}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

const expected = renderNotices(runPnpmLicenses());
if (checkOnly) {
  const current = readFileSync(noticePath, "utf8");
  if (current !== expected) {
    throw new Error(
      "THIRD_PARTY_NOTICES.md is stale. Run `pnpm notices` and commit the result.",
    );
  }
  console.log("✔ Third-party notices match the production lockfile.");
} else {
  writeFileSync(noticePath, expected, "utf8");
  console.log("✔ Updated THIRD_PARTY_NOTICES.md.");
}
