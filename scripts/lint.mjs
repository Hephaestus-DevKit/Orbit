import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { ESLint } from "eslint";

const requested = process.argv.slice(2);
const defaults = [
  "packages/*/src/**/*.ts",
  "editors/*/src/**/*.ts",
  "editors/safari/*.js",
  "e2e/**/*.ts",
  "scripts/**/*.mjs",
  "scripts/**/*.mts",
  "eslint.config.mjs",
  "playwright.config.ts",
];
const files = [...new Set((requested.length ? requested : defaults).flatMap(pattern => {
  const matches = globSync(pattern);
  if (!matches.length) throw new Error("No lint inputs matched " + pattern);
  return matches;
}))].sort();
const javascript = files.filter(file => /\.[cm]?js$/.test(file));
if (javascript.length) {
  const linter = new ESLint();
  const results = await linter.lintFiles(javascript);
  const formatted = (await linter.loadFormatter("stylish")).format(results);
  if (formatted) console.log(formatted);
  if (results.some(result => result.errorCount > 0)) process.exitCode = 1;
}
const require = createRequire(import.meta.url);
const manifest = require.resolve("oxlint/package.json");
const bin = join(dirname(manifest), require(manifest).bin.oxlint);
// Pass concrete paths on every platform. Bound each invocation to fit Windows'
// process command line limit even when a workspace has many long file names.
let batch = [];
let length = 0;
function lintBatch() {
  const result = spawnSync(process.execPath, [
    bin,
    "--config",
    ".oxlintrc.json",
    "--no-ignore",
    "--format=default",
    ...batch,
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  batch = [];
  length = 0;
}
for (const file of files) {
  if (length + file.length > 24000) lintBatch();
  batch.push(file);
  length += file.length + 3;
}
if (batch.length) lintBatch();
