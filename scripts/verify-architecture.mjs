import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preProcessFile } from "typescript";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

/**
 * The package graph is deliberately explicit.  A package may depend on a
 * lower layer only when it is listed here; this keeps new features from
 * quietly turning `core` or `cli` into a dependency sink.
 */
export const allowedPackageImports = Object.freeze({
  "@orbit-build/shared": [],
  "@orbit-build/config": ["@orbit-build/shared"],
  "@orbit-build/model-providers": ["@orbit-build/shared"],
  "@orbit-build/permissions": ["@orbit-build/shared", "@orbit-build/config"],
  "@orbit-build/sandbox": ["@orbit-build/shared", "@orbit-build/config"],
  "@orbit-build/session": ["@orbit-build/shared"],
  "@orbit-build/tools": [
    "@orbit-build/shared",
    "@orbit-build/config",
    "@orbit-build/sandbox",
  ],
  "@orbit-build/context-engine": [
    "@orbit-build/shared",
    "@orbit-build/config",
    "@orbit-build/tools",
    "@orbit-build/model-providers",
  ],
  "@orbit-build/mcp": [
    "@orbit-build/shared",
    "@orbit-build/config",
    "@orbit-build/tools",
  ],
  "@orbit-build/core": [
    "@orbit-build/shared",
    "@orbit-build/config",
    "@orbit-build/model-providers",
    "@orbit-build/tools",
    "@orbit-build/permissions",
    "@orbit-build/sandbox",
    "@orbit-build/context-engine",
    "@orbit-build/session",
    "@orbit-build/mcp",
  ],
  "@orbit-build/acp": ["@orbit-build/shared", "@orbit-build/config"],
  "@orbit-build/daemon": ["@orbit-build/shared"],
  "@orbit-build/tui": [],
  "@orbit-build/cli": [
    "@orbit-build/shared",
    "@orbit-build/config",
    "@orbit-build/core",
    "@orbit-build/tui",
    "@orbit-build/model-providers",
    "@orbit-build/context-engine",
    "@orbit-build/permissions",
    "@orbit-build/session",
    "@orbit-build/mcp",
    "@orbit-build/acp",
    "@orbit-build/daemon",
    "@orbit-build/sandbox",
  ],
});

/**
 * Hotspot budgets prevent already-large composition modules from growing
 * silently. A budget is a guardrail for intentional extraction, not a demand
 * for mechanical line-count splitting.
 */
export const hotspotLineBudgets = Object.freeze({
  "packages/core/src/agent/AgentLoop.ts": 5718,
  "packages/cli/src/tui/FullscreenTui.ts": 3080,
  "packages/cli/src/runtime/CommandRouter.ts": 2558,
  "packages/mcp/src/MCPClient.ts": 1798,
  "packages/mcp/src/StreamableHttpMCPClient.ts": 1580,
  "packages/model-providers/src/openai-compatible/OpenAICompatibleProvider.ts": 1539,
  "packages/cli/src/runtime/webui/WebUiPage.ts": 1459,
  "packages/cli/src/runtime/webui/WebUiClientSession.ts": 1454,
  "packages/cli/src/runtime/webui/WebUiRuntime.ts": 1329,
  "packages/context-engine/src/SymbolIndexer.ts": 1067,
  "packages/session/src/SessionStore.ts": 961,
  "packages/daemon/src/DaemonServer.ts": 965,
});

function listSourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__" && entry.name !== "fixtures") {
        files.push(...listSourceFiles(entryPath));
      }
      continue;
    }
    if (
      /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u.test(entry.name) &&
      !/\.(?:bench|e2e|spec|test)\.[cm]?[jt]sx?$/u.test(entry.name)
    ) {
      files.push(entryPath);
    }
  }
  return files;
}

function workspacePackageName(directory) {
  try {
    return JSON.parse(readFileSync(join(directory, "package.json"), "utf8"))
      .name;
  } catch {
    return undefined;
  }
}

/**
 * Check both declared imports and the stronger architectural layer policy.
 * @param {string} root
 * @returns {string[]}
 */
export function findArchitectureFailures(root) {
  const failures = [];
  const packagesRoot = resolve(root, "packages");
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageDirectory = join(packagesRoot, entry.name);
    const sourceDirectory = join(packageDirectory, "src");
    const packageName = workspacePackageName(packageDirectory);
    if (!packageName) {
      failures.push(
        `${relative(root, packageDirectory).replaceAll("\\", "/")}: package.json has no package name`,
      );
      continue;
    }
    if (
      !Object.prototype.hasOwnProperty.call(allowedPackageImports, packageName)
    ) {
      failures.push(`${packageName}: missing architecture contract`);
      continue;
    }

    const allowed = new Set(allowedPackageImports[packageName]);
    for (const sourceFile of listSourceFiles(sourceDirectory)) {
      const source = readFileSync(sourceFile, "utf8");
      const importedFiles = preProcessFile(source, true, true).importedFiles;
      for (const importedFile of importedFiles) {
        const dependency = importedFilesPackageName(importedFile.fileName);
        if (!dependency || dependency === packageName) continue;
        if (!allowed.has(dependency)) {
          failures.push(
            `${relative(root, sourceFile).replaceAll("\\", "/")}: ${packageName} may not import ${dependency}`,
          );
        }
      }
    }
  }
  return failures;
}

/**
 * Return focused diagnostics when a known hotspot grows beyond its reviewed
 * baseline. Missing files are failures because a rename must update this
 * contract deliberately instead of silently dropping the guard.
 * @param {string} root
 * @returns {string[]}
 */
export function findHotspotBudgetFailures(root) {
  const failures = [];
  for (const [relativePath, budget] of Object.entries(hotspotLineBudgets)) {
    const file = resolve(root, relativePath);
    let lineCount;
    try {
      const raw = readFileSync(file, "utf8");
      lineCount = raw.split(/\r?\n/u).length - (raw.endsWith("\n") ? 1 : 0);
    } catch {
      failures.push(`${relativePath}: hotspot file is missing`);
      continue;
    }
    if (lineCount > budget) {
      failures.push(
        `${relativePath}: ${lineCount} lines exceeds reviewed hotspot budget ${budget}; extract a focused module or update the budget with review evidence`,
      );
    }
  }
  return failures;
}

function importedFilesPackageName(specifier) {
  if (!specifier.startsWith("@orbit-build/")) return undefined;
  return specifier.split("/").slice(0, 2).join("/");
}

function main() {
  const failures = [
    ...findArchitectureFailures(repositoryRoot),
    ...findHotspotBudgetFailures(repositoryRoot),
  ];
  if (failures.length > 0) {
    throw new Error(
      `Architecture verification failed:\n${failures
        .map((failure) => `- ${failure}`)
        .join("\n")}`,
    );
  }
  console.log(
    "✔ Workspace package dependency direction matches the architecture contract.",
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
