import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cliRoot = join(repositoryRoot, "packages", "cli");
const manifestPath = join(cliRoot, "package.json");

const ManifestSchema = z
  .object({
    name: z.literal("@orbit-build/cli"),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    license: z.literal("Apache-2.0"),
    description: z.string().min(20),
    // npm strips invalid executable paths while publishing. Keep this exact
    // npm-normalized value so global installs always expose the orbit command.
    bin: z.object({ orbit: z.literal("dist/index.js") }).strict(),
    files: z.array(z.string()).min(1),
    engines: z.object({ node: z.string().min(1) }),
    repository: z.object({
      type: z.literal("git"),
      url: z.string().url(),
      directory: z.literal("packages/cli"),
    }),
    publishConfig: z.object({ access: z.literal("public") }),
  })
  .passthrough();

const PackFileSchema = z.object({
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
});

const PackResultSchema = z
  .array(
    z.object({
      name: z.literal("@orbit-build/cli"),
      version: z.string(),
      size: z.number().int().positive(),
      unpackedSize: z.number().int().positive(),
      files: z.array(PackFileSchema).min(3),
    }),
  )
  .length(1);

const WorkspaceManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  license: z.literal("Apache-2.0"),
});

function fail(message) {
  throw new Error(`CLI package verification failed: ${message}`);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(
      (
        result.stderr ||
        result.stdout ||
        `${command} exited unsuccessfully`
      ).trim(),
    );
  }
  return result.stdout.trim();
}

const manifest = ManifestSchema.parse(
  JSON.parse(readFileSync(manifestPath, "utf8")),
);
const rootLicense = readFileSync(join(repositoryRoot, "LICENSE"), "utf8");
const cliLicense = readFileSync(join(cliRoot, "LICENSE"), "utf8");
if (cliLicense !== rootLicense) {
  fail("CLI LICENSE differs from the repository LICENSE");
}
const rootNotices = readFileSync(
  join(repositoryRoot, "THIRD_PARTY_NOTICES.md"),
  "utf8",
);
const cliNotices = readFileSync(
  join(cliRoot, "THIRD_PARTY_NOTICES.md"),
  "utf8",
);
if (cliNotices !== rootNotices) {
  fail("CLI third-party notices differ from the repository notices");
}
const rootManifest = WorkspaceManifestSchema.parse(
  JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")),
);
if (rootManifest.version !== manifest.version) {
  fail(
    `root version ${rootManifest.version} differs from CLI ${manifest.version}`,
  );
}
const editorRoot = join(repositoryRoot, "editors", "vscode");
const editorManifest = WorkspaceManifestSchema.parse(
  JSON.parse(readFileSync(join(editorRoot, "package.json"), "utf8")),
);
if (editorManifest.version !== manifest.version) {
  fail(
    `${editorManifest.name} version ${editorManifest.version} differs from CLI ${manifest.version}`,
  );
}
if (readFileSync(join(editorRoot, "LICENSE"), "utf8") !== rootLicense) {
  fail("VS Code extension LICENSE differs from the repository LICENSE");
}
for (const entry of readdirSync(join(repositoryRoot, "packages"), {
  withFileTypes: true,
})) {
  if (!entry.isDirectory()) continue;
  const workspaceManifest = WorkspaceManifestSchema.parse(
    JSON.parse(
      readFileSync(
        join(repositoryRoot, "packages", entry.name, "package.json"),
        "utf8",
      ),
    ),
  );
  if (workspaceManifest.version !== manifest.version) {
    fail(
      `${workspaceManifest.name} version ${workspaceManifest.version} differs from CLI ${manifest.version}`,
    );
  }
}
const runtimeVersionLiteral = new RegExp(
  String.raw`(?:version\s*:\s*|ORBIT_VERSION\s*=\s*)["']\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?["']`,
);
const inspectRuntimeSource = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      inspectRuntimeSource(entryPath);
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts")
    ) {
      const source = readFileSync(entryPath, "utf8");
      if (runtimeVersionLiteral.test(source)) {
        fail(
          `runtime source contains a hard-coded product version: ${entryPath}`,
        );
      }
    }
  }
};
inspectRuntimeSource(join(repositoryRoot, "packages"));
const cliOutput = run(
  process.execPath,
  [join(cliRoot, "dist", "index.js"), "--version"],
  cliRoot,
);
if (cliOutput !== manifest.version) {
  fail(
    `built CLI reports ${JSON.stringify(cliOutput)} instead of ${manifest.version}`,
  );
}

const packOutput =
  process.platform === "win32"
    ? run(
        process.env.ComSpec || "cmd.exe",
        ["/d", "/s", "/c", "npm pack --dry-run --json --ignore-scripts"],
        cliRoot,
      )
    : run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], cliRoot);
const [pack] = PackResultSchema.parse(JSON.parse(packOutput));
if (pack.version !== manifest.version) {
  fail(
    `tarball version ${pack.version} differs from manifest ${manifest.version}`,
  );
}
if (pack.unpackedSize > 30_000_000) {
  fail(`unpacked artifact is unexpectedly large (${pack.unpackedSize} bytes)`);
}

const paths = new Set(pack.files.map((file) => file.path.replace(/\\/g, "/")));
for (const requiredPath of [
  "LICENSE",
  "README.md",
  "THIRD_PARTY_NOTICES.md",
  "commands/math-draft.md",
  "dist/index.js",
  "dist/index.d.ts",
  "package.json",
  "skills/math-model-draft/SKILL.md",
  "skills/math-model-draft/scripts/finalize_project.py",
]) {
  if (!paths.has(requiredPath)) fail(`missing ${requiredPath}`);
}

const forbiddenPath = [...paths].find((path) =>
  /(^|\/)(?:\.env(?:\.|$)|src|test|tests|coverage|\.git|__pycache__)(?:\/|$)|\.(?:map|log|pem|key|pyc)$/i.test(
    path,
  ),
);
if (forbiddenPath)
  fail(`sensitive or development-only path included: ${forbiddenPath}`);

console.log(
  `✔ Verified @orbit-build/cli ${manifest.version}: ${pack.files.length} files, ${pack.size} packed bytes, ${pack.unpackedSize} unpacked bytes.`,
);
