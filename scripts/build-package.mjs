import { build } from "esbuild";
import { generateDtsBundle } from "dts-bundle-generator";
import { chmodSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const entry = "src/index.ts";
const cli = manifest.name === "@orbit-build/cli";
const dependencies = Object.keys(manifest.dependencies ?? {});

// The published CLI includes workspace implementations and their private
// dependencies. Its declared runtime dependencies remain external.
const declarations = generateDtsBundle(
  [{ filePath: entry, output: { noBanner: true } }],
  { preferredConfigPath: "tsconfig.json" },
);
rmSync("dist", { recursive: true, force: true });
await build({
  entryPoints: [entry],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "es2022",
  external: dependencies,
  ...(cli && {
    banner: {
      js: `import { createRequire as _createRequire } from "node:module";
import { fileURLToPath as _fileURLToPath } from "node:url";
import { dirname as _dirname } from "node:path";
const require = _createRequire(import.meta.url);
const __filename = _fileURLToPath(import.meta.url);
const __dirname = _dirname(__filename);`,
    },
  }),
});
writeFileSync("dist/index.d.ts", declarations[0]);
if (cli) chmodSync("dist/index.js", 0o755);
