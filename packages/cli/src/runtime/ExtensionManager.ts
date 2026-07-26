import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { createHash, randomUUID } from "crypto";
import { dirname, join, relative, resolve } from "path";
import { homedir } from "os";
import {
  loadOrbitExtensionManifest,
  type OrbitExtensionManifest,
} from "@orbit-build/config";
import { z } from "zod";
import { readCliVersion } from "./CliVersion.js";

const InstalledExtensionSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  version: z.string(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  installedAt: z.string().datetime(),
  trusted: z.boolean(),
  path: z.string(),
  manifestFile: z.string().default("extension.yaml"),
});
const ExtensionRegistrySchema = z.object({
  schemaVersion: z.literal(1),
  extensions: z.array(InstalledExtensionSchema).default([]),
});

export type InstalledExtension = z.infer<typeof InstalledExtensionSchema>;

/** Install, inventory, update, and remove trusted local Orbit extensions. */
export class ExtensionManager {
  private readonly orbitDir: string;
  private readonly extensionsDir: string;
  private readonly registryPath: string;

  public constructor(homeDirectory = homedir()) {
    this.orbitDir = join(homeDirectory, ".orbit");
    this.extensionsDir = join(this.orbitDir, "extensions");
    this.registryPath = join(this.orbitDir, "extensions.json");
  }

  public list(): InstalledExtension[] {
    if (!existsSync(this.registryPath)) return [];
    try {
      return ExtensionRegistrySchema.parse(
        JSON.parse(readFileSync(this.registryPath, "utf8")),
      ).extensions.filter(
        (extension) =>
          this.isManagedExtensionPath(extension) &&
          existsSync(extension.path) &&
          !lstatSync(extension.path).isSymbolicLink(),
      );
    } catch {
      return [];
    }
  }

  public install(
    cwd: string,
    manifestPath: string,
    options: { trust?: boolean } = {},
  ): InstalledExtension {
    const manifest = loadOrbitExtensionManifest(cwd, manifestPath);
    verifyOrbitCompatibility(manifest, readCliVersion());
    const sourceRoot = dirname(resolve(cwd, manifestPath));
    validateContributionFiles(sourceRoot, manifest);
    validateContributionPermissions(manifest);
    const requiresTrust = extensionRequiresTrust(manifest);
    if (requiresTrust && !options.trust) {
      throw new Error(
        "This extension requests process, network, credential, or write access. Review the manifest and rerun with --trust.",
      );
    }

    mkdirSync(this.extensionsDir, { recursive: true });
    const target = join(this.extensionsDir, manifest.id);
    const staging = join(
      this.extensionsDir,
      `.install-${manifest.id}-${randomUUID()}`,
    );
    try {
      copyDirectorySafely(sourceRoot, staging);
      const digest = hashDirectory(staging);
      if (existsSync(target)) rmSync(target, { recursive: true, force: true });
      renameSync(staging, target);
      materializePromptContributions(target, manifest, this.orbitDir);
      const installed: InstalledExtension = {
        id: manifest.id,
        displayName: manifest.displayName,
        version: manifest.version,
        digest,
        installedAt: new Date().toISOString(),
        trusted: options.trust === true || !requiresTrust,
        path: target,
        manifestFile: relative(sourceRoot, resolve(cwd, manifestPath)).replace(
          /\\/g,
          "/",
        ),
      };
      const registry = this.list().filter((entry) => entry.id !== manifest.id);
      registry.push(installed);
      this.writeRegistry(registry);
      return installed;
    } finally {
      if (existsSync(staging))
        rmSync(staging, { recursive: true, force: true });
    }
  }

  public remove(id: string): boolean {
    const installed = this.list().find((entry) => entry.id === id);
    if (!installed) return false;
    rmSync(installed.path, { recursive: true, force: true });
    rmSync(join(this.orbitDir, "commands", "extensions", id), {
      recursive: true,
      force: true,
    });
    rmSync(join(this.orbitDir, "skills", "extensions", id), {
      recursive: true,
      force: true,
    });
    this.writeRegistry(this.list().filter((entry) => entry.id !== id));
    return true;
  }

  private writeRegistry(extensions: InstalledExtension[]): void {
    mkdirSync(this.orbitDir, { recursive: true });
    const temp = `${this.registryPath}.${process.pid}.tmp`;
    writeFileSync(
      temp,
      `${JSON.stringify({ schemaVersion: 1, extensions }, null, 2)}\n`,
      { mode: 0o600 },
    );
    rmSync(this.registryPath, { force: true });
    renameSync(temp, this.registryPath);
  }

  private isManagedExtensionPath(extension: InstalledExtension): boolean {
    const expected = resolve(this.extensionsDir, extension.id);
    return resolve(extension.path) === expected;
  }
}

function extensionRequiresTrust(manifest: OrbitExtensionManifest): boolean {
  return (
    manifest.permissions.process ||
    manifest.permissions.network.length > 0 ||
    manifest.permissions.credentials.length > 0 ||
    manifest.permissions.filesystem.some((entry) => entry.mode === "write") ||
    manifest.contributes.hooks.length > 0 ||
    Object.keys(manifest.contributes.mcpServers).length > 0
  );
}

function validateContributionPermissions(
  manifest: OrbitExtensionManifest,
): void {
  const declaredCredentials = new Set(manifest.permissions.credentials);
  const declaredHosts = new Set(
    manifest.permissions.network.map((host) => host.toLowerCase()),
  );
  for (const [name, server] of Object.entries(
    manifest.contributes.mcpServers,
  )) {
    if (server.transport === "stdio" && !manifest.permissions.process) {
      throw new Error(`MCP server "${name}" requires process permission.`);
    }
    if (server.transport === "streamable-http") {
      const host = new URL(server.url || "").hostname.toLowerCase();
      if (!declaredHosts.has(host)) {
        throw new Error(
          `MCP server "${name}" requires network permission for ${host}.`,
        );
      }
      if (server.oauth) {
        const tokenHost = new URL(server.oauth.tokenUrl).hostname.toLowerCase();
        if (!declaredHosts.has(tokenHost)) {
          throw new Error(
            `MCP server "${name}" requires network permission for OAuth host ${tokenHost}.`,
          );
        }
      }
    }
    const credentialNames = [
      server.bearerTokenEnv,
      server.oauth?.clientIdEnv,
      server.oauth?.clientSecretEnv,
    ].filter((value): value is string => Boolean(value));
    for (const credential of credentialNames) {
      if (!declaredCredentials.has(credential)) {
        throw new Error(
          `MCP server "${name}" must declare credential ${credential}.`,
        );
      }
    }
    if (
      Object.keys(server.headers || {}).some((header) =>
        /^(authorization|proxy-authorization|x-api-key|api-key)$/i.test(header),
      )
    ) {
      throw new Error(
        `MCP server "${name}" cannot embed credential headers in its manifest.`,
      );
    }
  }
}

function validateContributionFiles(
  root: string,
  manifest: OrbitExtensionManifest,
): void {
  const contributions = [
    ...manifest.contributes.commands,
    ...manifest.contributes.skills,
    ...manifest.contributes.agents,
    ...manifest.contributes.tools,
    ...manifest.contributes.templates,
  ];
  for (const contribution of contributions) {
    const target = resolve(root, contribution.path);
    const relation = relative(root, target);
    if (relation.startsWith("..") || relation === "") {
      throw new Error(
        `Invalid extension contribution path: ${contribution.path}`,
      );
    }
    if (!existsSync(target) || lstatSync(target).isSymbolicLink()) {
      throw new Error(
        `Extension contribution is missing or unsafe: ${contribution.path}`,
      );
    }
  }
}

function copyDirectorySafely(source: string, target: string): void {
  const stats = lstatSync(source);
  if (stats.isSymbolicLink())
    throw new Error("Extension directories cannot contain symlinks.");
  if (stats.isDirectory()) {
    mkdirSync(target, { recursive: true });
    for (const entry of readdirSync(source)) {
      if (entry === "node_modules" || entry === ".git") continue;
      copyDirectorySafely(join(source, entry), join(target, entry));
    }
    return;
  }
  if (!stats.isFile())
    throw new Error("Extension contains an unsupported filesystem entry.");
  const data = readFileSync(source);
  if (data.byteLength > 8 * 1024 * 1024)
    throw new Error("Extension file exceeds the 8 MiB limit.");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data, { mode: 0o600 });
}

function materializePromptContributions(
  extensionRoot: string,
  manifest: OrbitExtensionManifest,
  orbitDir: string,
): void {
  for (const [kind, contributions] of [
    ["commands", manifest.contributes.commands],
    ["skills", manifest.contributes.skills],
  ] as const) {
    const destinationRoot = join(orbitDir, kind, "extensions", manifest.id);
    rmSync(destinationRoot, { recursive: true, force: true });
    for (const contribution of contributions) {
      const source = resolve(extensionRoot, contribution.path);
      const sourceIsDirectory = lstatSync(source).isDirectory();
      const destination = sourceIsDirectory
        ? join(destinationRoot, contribution.name)
        : kind === "commands"
          ? join(destinationRoot, `${contribution.name}.md`)
          : join(destinationRoot, contribution.name, "SKILL.md");
      copyDirectorySafely(source, destination);
    }
  }
}

function hashDirectory(root: string): string {
  const hash = createHash("sha256");
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry);
      const stats = lstatSync(path);
      const name = relative(root, path).replace(/\\/g, "/");
      hash.update(name);
      if (stats.isDirectory()) visit(path);
      else hash.update(readFileSync(path));
    }
  };
  visit(root);
  return hash.digest("hex");
}

function verifyOrbitCompatibility(
  manifest: OrbitExtensionManifest,
  currentVersion: string,
): void {
  if (compareVersions(currentVersion, manifest.orbit.minVersion) < 0) {
    throw new Error(
      `Extension requires Orbit ${manifest.orbit.minVersion} or newer.`,
    );
  }
  if (
    manifest.orbit.maxVersion &&
    compareVersions(currentVersion, manifest.orbit.maxVersion) > 0
  ) {
    throw new Error(
      `Extension supports Orbit up to ${manifest.orbit.maxVersion}.`,
    );
  }
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string) =>
    value.split("-", 1)[0].split(".").map(Number);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] || 0) !== (b[index] || 0))
      return (a[index] || 0) - (b[index] || 0);
  }
  return 0;
}
