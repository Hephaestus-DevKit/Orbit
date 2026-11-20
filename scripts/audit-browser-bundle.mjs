// Check the driver used by the development WebKit test runner.
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

export function inspectBrowserBundle(root) {
  const lib = join(root, "lib");
  const matches = [];
  const expectedBundles = new Set(["serverRegistry.js", "utilsBundle.js"]);
  const inventoried = new Set();
  const javascript = new Set();
  for (const entry of readdirSync(lib, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const notice = entry.name.endsWith(".LICENSE");
    if (!notice && !/\.[cm]?js$/.test(entry.name)) continue;
    const file = join(entry.parentPath, entry.name);
    const source = readFileSync(file, "utf8");
    const name = relative(lib, file);
    if (
      notice
      && source.includes("npm packages are inlined into this bundle")
      && /^- \S+@\d/m.test(source)
    ) {
      inventoried.add(name.slice(0, -".LICENSE".length));
    }
    if (!notice) javascript.add(name);
    if (
      notice
        ? /^- picomatch@/m.test(source)
        : /node_modules[/\\]picomatch[/\\]/.test(source)
    ) {
      matches.push(relative(root, file));
    }
  }
  if (
    [...expectedBundles].some(
      (name) => !inventoried.has(name) || !javascript.has(name),
    )
  )
    throw new Error(
      "Browser bundle layout changed. Review the upstream inventory and JavaScript before accepting this release.",
    );
  return {
    inventories: inventoried.size,
    scripts: javascript.size,
    matches: matches.sort(),
  };
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const requireTest = createRequire(new URL("../package.json", import.meta.url));
  const requirePlaywright = createRequire(
    createRequire(requireTest.resolve("@playwright/test/package.json")).resolve(
      "playwright/package.json",
    ),
  );
  const root = dirname(requirePlaywright.resolve("playwright-core/package.json"));
  const version = requirePlaywright("playwright-core/package.json").version;
  const { inventories, scripts, matches } = inspectBrowserBundle(root);
  if (matches.length)
    throw new Error(
      `playwright-core ${version} includes picomatch: ${matches.join(", ")}`,
    );
  console.log(
    `playwright-core ${version}: checked ${inventories} bundle inventories and ${scripts} JavaScript files for picomatch.`,
  );
}
