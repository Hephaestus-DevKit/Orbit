import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePinnedPnpmCommand } from "./pnpm-runner.mjs";

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

/** Include workspace source bundled into the CLI even when declared as a build dependency. */
export function mergeBundledWorkspaceTrees(manifest, roots) {
  const workspaces = new Map(roots.map((root) => [root.name, root]));
  const root = workspaces.get(manifest.name);
  if (!root) throw new Error("pnpm did not return the release package tree.");
  const expand = (name, node, ancestors = new Set()) => {
    const workspace = workspaces.get(name);
    if (ancestors.has(name))
      throw new Error(`Cyclic bundled workspace dependency: ${name}`);
    if (!workspace && node.version?.startsWith("link:"))
      throw new Error(`Missing bundled workspace dependency: ${name}`);
    const source = workspace ?? node;
    const next = new Set(ancestors).add(name);
    return {
      ...source,
      dependencies: Object.fromEntries(
        Object.entries(source.dependencies ?? {}).map(([child, value]) => [
          child,
          expand(child, value, next),
        ]),
      ),
    };
  };
  const bundled = Object.entries(manifest.devDependencies ?? {}).filter(
    ([, version]) => version.startsWith("workspace:"),
  );
  for (const [name] of bundled) {
    if (!workspaces.has(name))
      throw new Error(`Missing bundled workspace dependency: ${name}`);
  }
  return {
    ...root,
    dependencies: Object.fromEntries(
      [
        ...Object.entries(root.dependencies ?? {}),
        ...bundled.map(([name]) => [name, workspaces.get(name)]),
      ].map(([name, node]) => [name, expand(name, node)]),
    ),
  };
}

/** Build a deterministic CycloneDX dependency graph from `pnpm list`. */
export function buildCycloneDxBom(manifest, root) {
  if (!manifest?.name || !manifest?.version) {
    throw new Error("Release package manifest must declare name and version.");
  }
  if (root?.name !== manifest.name || root?.version !== manifest.version) {
    throw new Error(
      `pnpm production tree ${root?.name ?? "unknown"}@${
        root?.version ?? "unknown"
      } does not match ${manifest.name}@${manifest.version}.`,
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
    left["bom-ref"].localeCompare(right["bom-ref"])
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
    main?.name !== expectedIdentity.name
    || main?.group !== expectedIdentity.group
    || main?.version !== manifest.version
  ) {
    throw new Error("Release SBOM main component identity is incorrect.");
  }
  if (
    !Array.isArray(bom.components)
    || bom.components.length < directDependencies.length
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

function runPnpmProductionTrees(packageName) {
  if (
    !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/iu.test(packageName)
  ) {
    throw new Error(`Cannot query an invalid package name: ${packageName}`);
  }
  const invocation = resolvePinnedPnpmCommand(
    [
      "--filter",
      `${packageName}...`,
      "list",
      "--prod",
      "--json",
      "--depth",
      "Infinity",
    ],
    repositoryRoot,
  );
  const result = spawnSync(invocation.command, invocation.args, {
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
  if (!Array.isArray(roots) || roots.length === 0) {
    throw new Error("pnpm did not return production package trees.");
  }
  return roots;
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
  const tree = mergeBundledWorkspaceTrees(
    manifest,
    runPnpmProductionTrees(manifest.name),
  );
  const bom = buildCycloneDxBom(manifest, tree);
  const patches = parseYaml(readFileSync(join(repositoryRoot, "pnpm-workspace.yaml"), "utf8"))
    .patchedDependencies ?? {};
  for (const component of bom.components) {
    const name = component.group
      ? `${component.group}/${component.name}`
      : component.name;
    const patch = patches[`${name}@${component.version}`];
    if (!patch) continue;
    const patchPath = realpathSync(resolve(repositoryRoot, patch));
    const local = relative(repositoryRoot, patchPath);
    if (
      isAbsolute(local)
      || local === ".."
      || local.startsWith("../")
      || local.startsWith("..\\")
    )
      throw new Error("Release patch must remain inside the repository.");
    const bytes = readFileSync(patchPath);
    component.properties = [
      { name: "orbit:source-patch", value: patch },
      {
        name: "orbit:source-patch:sha256",
        value: createHash("sha256").update(bytes).digest("hex"),
      },
    ];
  }
  writeFileSync(outputPath, `${JSON.stringify(bom, null, 2)}\n`, "utf8");
  console.log(
    `✔ Generated CycloneDX 1.6 SBOM for ${manifest.name}@${manifest.version}: ${bom.components.length} production component(s).`,
  );
}

if (
  process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
