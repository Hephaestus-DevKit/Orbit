import { spawnSync } from "node:child_process";
import { globSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { testExcludes } from "./workspace.mjs";
import { reportCoverage } from "./coverage.mjs";

const args = process.argv.slice(2);
const filters = args.filter(arg => !arg.startsWith("--")).map(arg => arg.replaceAll("\\", "/").replace(/^\.\//, ""));
const exclusions = testExcludes.map(pattern => pattern.replace(/\/\*\*$/, ""));
const files = globSync("**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}", { exclude: exclusions })
  .map(file => file.split(sep).join("/"))
  .filter(file => !filters.length || filters.some(filter => file.includes(filter)))
  .sort();
if (!files.length) throw new Error("No test files matched the requested paths.");
const coverage = args.includes("--coverage") ? mkdtempSync(join(tmpdir(), "orbit-v8-")) : undefined;
try {
  const child = spawnSync(process.execPath, [
    "--experimental-test-module-mocks", "--enable-source-maps",
    "--import", new URL("./register.mjs", import.meta.url).href,
    "--test", "--test-concurrency=" + (process.platform === "win32" ? 1 : 4),
    "--test-timeout=" + (process.platform === "win32" ? 60000 : 20000),
    ...(args.includes("--watch") ? ["--watch"] : []),
    ...files,
  ], { stdio: "inherit", env: coverage ? {...process.env, NODE_V8_COVERAGE: coverage} : process.env });
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
  if (coverage && child.status === 0) await reportCoverage(coverage);
} finally {
  if (coverage) rmSync(coverage, {recursive:true,force:true});
}
