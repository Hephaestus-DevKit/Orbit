import { readFileSync, readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preProcessFile } from "typescript";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const builtins = new Set(
  builtinModules.flatMap((moduleName) => [moduleName, `node:${moduleName}`]),
);
const hostProvidedDependencies = new Map([
  ["orbit-autocomplete", new Set(["vscode"])],
]);

/**
 * Extract the installable package name from an ESM import specifier.
 *
 * @param {string} specifier
 * @returns {string | undefined}
 */
function packageNameFromSpecifier(specifier) {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("#") ||
    builtins.has(specifier)
  ) {
    return undefined;
  }

  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/", 1)[0];
}

/**
 * Recursively list production source files while excluding tests and fixtures.
 *
 * @param {string} directory
 * @returns {string[]}
 */
function listProductionSources(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__" && entry.name !== "fixtures") {
        files.push(...listProductionSources(entryPath));
      }
      continue;
    }

    const extension = entry.name.slice(entry.name.lastIndexOf("."));
    if (
      sourceExtensions.has(extension) &&
      !/\.(?:bench|e2e|spec|test)\.[cm]?[jt]sx?$/u.test(entry.name)
    ) {
      files.push(entryPath);
    }
  }
  return files;
}

/**
 * Return dependency declaration failures for publishable workspace projects.
 * Runtime dependencies must be used by production source, and every production
 * import must be declared by the importing project.
 *
 * @param {string} root
 * @param {string[]} [workspaceDirectories]
 * @returns {string[]}
 */
export function findWorkspaceDependencyFailures(
  root,
  workspaceDirectories = ["packages", "editors"],
) {
  const failures = [];

  for (const workspaceDirectory of workspaceDirectories) {
    const workspacePath = resolve(root, workspaceDirectory);
    for (const entry of readdirSync(workspacePath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const projectPath = join(workspacePath, entry.name);
      const manifestPath = join(projectPath, "package.json");
      const sourcePath = join(projectPath, "src");
      let manifest;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        readdirSync(sourcePath);
      } catch {
        continue;
      }

      const imports = new Map();
      for (const sourceFile of listProductionSources(sourcePath)) {
        const source = readFileSync(sourceFile, "utf8");
        const importedFiles = preProcessFile(source, true, true).importedFiles;
        for (const importedFile of importedFiles) {
          const dependency = packageNameFromSpecifier(importedFile.fileName);
          if (!dependency) continue;

          const importers = imports.get(dependency) ?? new Set();
          importers.add(relative(root, sourceFile).replaceAll("\\", "/"));
          imports.set(dependency, importers);
        }
      }

      const runtimeDependencies = new Set(
        Object.keys(manifest.dependencies ?? {}),
      );
      const declaredDependencies = new Set([
        ...runtimeDependencies,
        ...Object.keys(manifest.devDependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ]);
      const hostDependencies =
        hostProvidedDependencies.get(manifest.name) ?? new Set();

      for (const [dependency, importers] of [...imports].sort(
        ([left], [right]) => left.localeCompare(right),
      )) {
        if (
          !declaredDependencies.has(dependency) &&
          !hostDependencies.has(dependency)
        ) {
          failures.push(
            `${manifest.name}: missing declaration for ${dependency} (imported by ${[
              ...importers,
            ].join(", ")})`,
          );
        }
      }

      for (const dependency of [...runtimeDependencies].sort()) {
        if (!imports.has(dependency)) {
          failures.push(
            `${manifest.name}: unused runtime dependency ${dependency}`,
          );
        }
      }
    }
  }

  return failures;
}

function main() {
  const failures = findWorkspaceDependencyFailures(repositoryRoot);
  if (failures.length > 0) {
    throw new Error(
      `Workspace dependency verification failed:\n${failures
        .map((failure) => `- ${failure}`)
        .join("\n")}`,
    );
  }

  console.log(
    "✔ Workspace production imports match package dependency declarations.",
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
