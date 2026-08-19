import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function splitPackageName(packageName) {
  if (!packageName.startsWith("@")) return { name: packageName };
  const separator = packageName.indexOf("/");
  if (separator < 2 || separator === packageName.length - 1) {
    throw new Error(`Invalid scoped package name: ${packageName}`);
  }
  return {
    group: packageName.slice(0, separator),
    name: packageName.slice(separator + 1),
  };
}

function packagePurl(packageName, version) {
  const { group, name } = splitPackageName(packageName);
  const path = group
    ? `${encodeURIComponent(group)}/${encodeURIComponent(name)}`
    : encodeURIComponent(name);
  return `pkg:npm/${path}@${encodeURIComponent(version)}`;
}

function readLicense(node) {
  if (!node.path) return undefined;
  try {
    const manifest = JSON.parse(
      readFileSync(join(node.path, "package.json"), "utf8"),
    );
    return typeof manifest.license === "string" && manifest.license.trim()
      ? manifest.license.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

function componentFor(packageName, node) {
  if (!node || typeof node.version !== "string" || !node.version.trim()) {
    throw new Error(`Production dependency ${packageName} has no version.`);
  }
  const version = node.version.trim();
  const purl = packagePurl(packageName, version);
  const identity = splitPackageName(packageName);
  const license = readLicense(node);
  return {
    type: "library",
    "bom-ref": purl,
    ...identity,
    version,
    purl,
    ...(license ? { licenses: [{ license: { name: license } }] } : {}),
  };
}

/** Build a deterministic CycloneDX dependency graph from `pnpm list`. */
export function buildCycloneDxBom(manifest, root) {
  if (!manifest?.name || !manifest?.version) {
    throw new Error("Release package manifest must declare name and version.");
  }
  if (root?.name !== manifest.name || root?.version !== manifest.version) {
    throw new Error(
      `pnpm production tree ${root?.name ?? "unknown"}@${root?.version ?? "unknown"} does not match ${manifest.name}@${manifest.version}.`,
    );
  }

  const components = new Map();
  const dependencies = new Map();
  const visit = (packageName, node) => {
    const component = componentFor(packageName, node);
    const reference = component["bom-ref"];
    if (!components.has(reference)) components.set(reference, component);
    const childReferences = Object.entries(node.dependencies ?? {}).map(
      ([childName, child]) => visit(childName, child),
    );
    const existing = dependencies.get(reference) ?? new Set();
    for (const childReference of childReferences) existing.add(childReference);
    dependencies.set(reference, existing);
    return reference;
  };

  const mainPurl = packagePurl(manifest.name, manifest.version);
  const directReferences = Object.entries(root.dependencies ?? {}).map(
    ([packageName, node]) => visit(packageName, node),
  );
  const mainIdentity = splitPackageName(manifest.name);
  const sortedComponents = [...components.values()].sort((left, right) =>
    left["bom-ref"].localeCompare(right["bom-ref"]),
  );
  const dependencyRows = [
    { ref: mainPurl, dependsOn: [...new Set(directReferences)].sort() },
    ...[...dependencies.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([ref, dependsOn]) => ({ ref, dependsOn: [...dependsOn].sort() })),
  ];
  const bom = {
    $schema: "https://cyclonedx.org/schema/bom-1.6.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      component: {
        type: "application",
        "bom-ref": mainPurl,
        ...mainIdentity,
        version: manifest.version,
        purl: mainPurl,
        ...(manifest.license
          ? { licenses: [{ license: { name: manifest.license } }] }
          : {}),
      },
    },
    components: sortedComponents,
    dependencies: dependencyRows,
  };
  validateCycloneDxBom(bom, manifest, Object.keys(root.dependencies ?? {}));
  return bom;
}

/** Fail closed when the generated SBOM loses identity or dependency evidence. */
export function validateCycloneDxBom(bom, manifest, directDependencies) {
  if (bom?.bomFormat !== "CycloneDX" || bom?.specVersion !== "1.6") {
    throw new Error("Release SBOM is not CycloneDX 1.6.");
  }
  const main = bom.metadata?.component;
  const expectedIdentity = splitPackageName(manifest.name);
  if (
    main?.name !== expectedIdentity.name ||
    main?.group !== expectedIdentity.group ||
    main?.version !== manifest.version
  ) {
    throw new Error("Release SBOM main component identity is incorrect.");
  }
  if (
    !Array.isArray(bom.components) ||
    bom.components.length < directDependencies.length
  ) {
    throw new Error("Release SBOM does not contain every direct dependency.");
  }
  const references = new Set([
    main["bom-ref"],
    ...bom.components.map((component) => component["bom-ref"]),
  ]);
  if (references.size !== bom.components.length + 1) {
    throw new Error("Release SBOM contains duplicate component references.");
  }
  for (const row of bom.dependencies ?? []) {
    if (!references.has(row.ref)) {
      throw new Error(`Release SBOM dependency source is unknown: ${row.ref}`);
    }
    for (const target of row.dependsOn ?? []) {
      if (!references.has(target)) {
        throw new Error(`Release SBOM dependency target is unknown: ${target}`);
      }
    }
  }
}

function runPnpmProductionTree(packageName) {
  if (
    !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/iu.test(packageName)
  ) {
    throw new Error(`Cannot query an invalid package name: ${packageName}`);
  }
  const executable =
    process.platform === "win32"
      ? (process.env.ComSpec ?? "cmd.exe")
      : "corepack";
  const command = `corepack pnpm --filter ${packageName} list --prod --json --depth Infinity`;
  const args =
    process.platform === "win32"
      ? ["/d", "/s", "/c", command]
      : [
          "pnpm",
          "--filter",
          packageName,
          "list",
          "--prod",
          "--json",
          "--depth",
          "Infinity",
        ];
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
  const roots = JSON.parse(result.stdout);
  if (!Array.isArray(roots) || roots.length !== 1) {
    throw new Error("pnpm did not return one release package tree.");
  }
  return roots[0];
}

function argumentValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function main() {
  const packagePath = resolve(
    repositoryRoot,
    argumentValue("--package", "packages/cli/package.json"),
  );
  const outputPath = resolve(
    repositoryRoot,
    argumentValue("--output", "orbit-cli.cdx.json"),
  );
  if (dirname(outputPath) === outputPath) {
    throw new Error("Release SBOM output must be a file path.");
  }
  const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
  const tree = runPnpmProductionTree(manifest.name);
  const bom = buildCycloneDxBom(manifest, tree);
  writeFileSync(outputPath, `${JSON.stringify(bom, null, 2)}\n`, "utf8");
  console.log(
    `✔ Generated CycloneDX 1.6 SBOM for ${manifest.name}@${manifest.version}: ${bom.components.length} production component(s).`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
