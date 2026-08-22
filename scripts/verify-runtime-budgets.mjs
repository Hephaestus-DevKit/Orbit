import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cliRoot = join(repositoryRoot, "packages", "cli");
const cliEntry = join(cliRoot, "dist", "index.js");
const manifest = JSON.parse(
  readFileSync(join(cliRoot, "package.json"), "utf8"),
);
const startupBudgetMs = readBudget(
  "ORBIT_CLI_STARTUP_BUDGET_MS",
  2_500,
  250,
  30_000,
);
const bundleBudgetBytes = readBudget(
  "ORBIT_CLI_BUNDLE_BUDGET_BYTES",
  20_000_000,
  1_000_000,
  100_000_000,
);
const bundleBytes = statSync(cliEntry).size;
const childEnvironment = { ...process.env, FORCE_COLOR: "0" };
delete childEnvironment.NO_COLOR;
if (bundleBytes > bundleBudgetBytes) {
  throw new Error(
    `CLI bundle budget exceeded: ${bundleBytes} > ${bundleBudgetBytes} bytes.`,
  );
}

// One warm-up separates filesystem cache noise from the five release samples.
measureStartup();
const samples = Array.from({ length: 5 }, () => measureStartup()).sort(
  (left, right) => left - right,
);
const median = percentile(samples, 0.5);
const p90 = percentile(samples, 0.9);
if (p90 > startupBudgetMs) {
  throw new Error(
    `CLI startup budget exceeded: p90 ${p90.toFixed(1)} ms > ${startupBudgetMs} ms.`,
  );
}

console.log(
  `✔ Runtime budgets passed: CLI bundle ${bundleBytes} bytes; process-start median ${median.toFixed(1)} ms, p90 ${p90.toFixed(1)} ms after one filesystem warm-up (${samples.map((sample) => sample.toFixed(1)).join(", ")}).`,
);

function measureStartup() {
  const startedAt = performance.now();
  const result = spawnSync(process.execPath, [cliEntry, "--version"], {
    cwd: cliRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
    windowsHide: true,
    env: childEnvironment,
  });
  const durationMs = performance.now() - startedAt;
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `CLI startup probe failed: ${(result.stderr || result.stdout || `exit ${result.status}`).trim()}`,
    );
  }
  if (result.stdout.trim() !== manifest.version) {
    throw new Error(
      `CLI startup probe reported ${JSON.stringify(result.stdout.trim())}; expected ${manifest.version}.`,
    );
  }
  return durationMs;
}

function percentile(sorted, ratio) {
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function readBudget(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}
