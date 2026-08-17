import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { randomUUID } from "crypto";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "path";
import { homedir } from "os";
import {
  loadOrbitExtensionManifest,
  loadExtensionToolDefinition,
  AgentProfileSchema,
  ExtensionDigestAlgorithmSchema,
  InstalledExtensionIdSchema,
  hashExtensionDirectory,
  MAX_AGENT_PROFILE_FILE_BYTES,
  MAX_EXTENSION_FILE_BYTES,
  MAX_EXTENSION_REGISTRY_BYTES,
  MAX_EXTENSION_TREE_BYTES,
  MAX_EXTENSION_TREE_DEPTH,
  MAX_EXTENSION_TREE_ENTRIES,
  type OrbitExtensionManifest,
} from "@orbit-build/config";
import { z } from "zod";
import { parse as parseYaml } from "yaml";
import {
  readBoundedRegularFile,
  readBoundedRegularFileBuffer,
  replacePrivateFileAtomically,
} from "@orbit-build/shared";
import { readCliVersion } from "./CliVersion.js";

const InstalledExtensionSchema = z.object({
  id: InstalledExtensionIdSchema,
  displayName: z.string().min(1).max(256),
  version: z.string().min(1).max(128),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  digestAlgorithm: ExtensionDigestAlgorithmSchema.default("sha256-v1"),
  installedAt: z.string().datetime(),
  trusted: z.boolean(),
  path: z.string().min(1).max(4096),
  manifestFile: z.string().min(1).max(4096).default("extension.yaml"),
});
const ExtensionRegistrySchema = z.object({
  schemaVersion: z.literal(1),
  extensions: z.array(InstalledExtensionSchema).max(500).default([]),
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
    try {
      return this.readRegistry().filter(
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
    const requiresTrust = extensionRequiresTrust(manifest, sourceRoot);
    if (requiresTrust && !options.trust) {
      throw new Error(
        "This extension requests process, network, credential, write, or executable lifecycle-hook access. Review the manifest and rerun with --trust.",
      );
    }

    const target = join(this.extensionsDir, manifest.id);
    const staging = join(
      this.extensionsDir,
      `.install-${manifest.id}-${randomUUID()}`,
    );
    const transactionId = randomUUID();
    const targetBackup = join(
      this.extensionsDir,
      `.rollback-${manifest.id}-${transactionId}`,
    );
    const promptRollbackRoot = join(
      this.orbitDir,
      `.extension-rollback-${manifest.id}-${transactionId}`,
    );
    const declarativeTargets = ["commands", "skills", "agents"].map((kind) => ({
      target: join(this.orbitDir, kind, "extensions", manifest.id),
      backup: join(promptRollbackRoot, kind),
      backedUp: false,
    }));
    assertSafeManagedPath(this.extensionsDir, this.extensionsDir);
    for (const target of declarativeTargets) {
      assertSafeManagedPath(target.target, this.orbitDir);
    }
    let previousRegistry: InstalledExtension[];
    try {
      previousRegistry = this.readRegistryForMutation();
    } catch (error) {
      throw new Error(
        "Extension registry is invalid; repair or remove it before installing extensions.",
        { cause: error },
      );
    }
    mkdirSync(this.extensionsDir, { recursive: true });
    let targetBackedUp = false;
    let targetInstalled = false;
    let promptMutationStarted = false;
    try {
      copyDirectorySafely(sourceRoot, staging);
      const digest = hashExtensionDirectory(staging);
      if (existsSync(target)) {
        renameSync(target, targetBackup);
        targetBackedUp = true;
      }
      for (const target of declarativeTargets) {
        if (!existsSync(target.target)) continue;
        mkdirSync(dirname(target.backup), { recursive: true });
        renameSync(target.target, target.backup);
        target.backedUp = true;
      }
      renameSync(staging, target);
      targetInstalled = true;
      promptMutationStarted = true;
      materializeDeclarativeContributions(target, manifest, this.orbitDir);
      const installed: InstalledExtension = {
        id: manifest.id,
        displayName: manifest.displayName,
        version: manifest.version,
        digest,
        digestAlgorithm: "sha256-v2",
        installedAt: new Date().toISOString(),
        trusted: options.trust === true || !requiresTrust,
        path: target,
        manifestFile: relative(sourceRoot, resolve(cwd, manifestPath)).replace(
          /\\/g,
          "/",
        ),
      };
      const registry = previousRegistry.filter(
        (entry) => entry.id !== manifest.id,
      );
      registry.push(installed);
      this.writeRegistry(registry);
      removeTransactionArtifact(targetBackup);
      removeTransactionArtifact(promptRollbackRoot);
      return installed;
    } catch (error) {
      try {
        if (targetInstalled) {
          rmSync(target, { recursive: true, force: true });
        }
        if (targetBackedUp && existsSync(targetBackup)) {
          renameSync(targetBackup, target);
        }
        for (const target of declarativeTargets) {
          if (promptMutationStarted) {
            rmSync(target.target, { recursive: true, force: true });
          }
          if (target.backedUp && existsSync(target.backup)) {
            mkdirSync(dirname(target.target), { recursive: true });
            renameSync(target.backup, target.target);
          }
        }
        rmSync(promptRollbackRoot, { recursive: true, force: true });
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `Extension installation failed and rollback was incomplete. Recovery files remain under ${this.orbitDir}.`,
        );
      }
      throw error;
    } finally {
      removeTransactionArtifact(staging);
    }
  }

  public remove(id: string): boolean {
    let registry: InstalledExtension[];
    try {
      registry = this.readRegistryForMutation();
    } catch (error) {
      throw new Error(
        "Extension registry is invalid; repair it before removing extensions.",
        { cause: error },
      );
    }
    const installed = registry.find(
      (entry) =>
        entry.id === id &&
        existsSync(entry.path) &&
        !lstatSync(entry.path).isSymbolicLink(),
    );
    if (!installed) return false;
    const rollbackRoot = join(
      this.orbitDir,
      `.extension-remove-rollback-${id}-${randomUUID()}`,
    );
    const targets = [
      { target: installed.path, backup: join(rollbackRoot, "package") },
      {
        target: join(this.orbitDir, "commands", "extensions", id),
        backup: join(rollbackRoot, "commands"),
      },
      {
        target: join(this.orbitDir, "skills", "extensions", id),
        backup: join(rollbackRoot, "skills"),
      },
      {
        target: join(this.orbitDir, "agents", "extensions", id),
        backup: join(rollbackRoot, "agents"),
      },
    ].map((entry) => ({ ...entry, backedUp: false }));
    for (const entry of targets) {
      assertSafeManagedPath(entry.target, this.orbitDir);
    }
    try {
      for (const entry of targets) {
        if (!existsSync(entry.target)) continue;
        mkdirSync(dirname(entry.backup), { recursive: true });
        renameSync(entry.target, entry.backup);
        entry.backedUp = true;
      }
      this.writeRegistry(registry.filter((entry) => entry.id !== id));
      removeTransactionArtifact(rollbackRoot);
      return true;
    } catch (error) {
      try {
        for (const entry of targets) {
          if (!entry.backedUp || !existsSync(entry.backup)) continue;
          mkdirSync(dirname(entry.target), { recursive: true });
          renameSync(entry.backup, entry.target);
        }
        rmSync(rollbackRoot, { recursive: true, force: true });
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `Extension removal failed and rollback was incomplete. Recovery files remain under ${rollbackRoot}.`,
        );
      }
      throw error;
    }
  }

  private writeRegistry(extensions: InstalledExtension[]): void {
    const registry = ExtensionRegistrySchema.parse({
      schemaVersion: 1,
      extensions,
    });
    replacePrivateFileAtomically(
      this.registryPath,
      `${JSON.stringify(registry, null, 2)}\n`,
    );
  }

  private isManagedExtensionPath(extension: InstalledExtension): boolean {
    const expected = resolve(this.extensionsDir, extension.id);
    const slot = relative(this.extensionsDir, expected);
    const remainsInsideManagedRoot =
      slot.length > 0 &&
      slot !== ".." &&
      !slot.startsWith(`..${sep}`) &&
      !isAbsolute(slot);
    return remainsInsideManagedRoot && resolve(extension.path) === expected;
  }

  private readRegistry(): InstalledExtension[] {
    const raw = readBoundedRegularFile(
      this.registryPath,
      MAX_EXTENSION_REGISTRY_BYTES,
    );
    if (raw === undefined) return [];
    return ExtensionRegistrySchema.parse(JSON.parse(raw)).extensions;
  }

  private readRegistryForMutation(): InstalledExtension[] {
    const registry = this.readRegistry();
    const unmanaged = registry.find(
      (extension) => !this.isManagedExtensionPath(extension),
    );
    if (unmanaged) {
      throw new Error(
        `Extension registry entry "${unmanaged.id}" points outside its managed slot.`,
      );
    }
    return registry;
  }
}

function extensionRequiresTrust(
  manifest: OrbitExtensionManifest,
  extensionRoot: string,
): boolean {
  return (
    manifest.permissions.process ||
    manifest.permissions.network.length > 0 ||
    manifest.permissions.credentials.length > 0 ||
    manifest.permissions.filesystem.some((entry) => entry.mode === "write") ||
    manifest.contributes.hooks.length > 0 ||
    Object.keys(manifest.contributes.mcpServers).length > 0 ||
    manifest.contributes.agents.some((agent) => {
      const raw = readBoundedRegularFile(
        resolve(extensionRoot, agent.path),
        MAX_AGENT_PROFILE_FILE_BYTES,
      );
      if (raw === undefined) return false;
      const profile = AgentProfileSchema.parse(parseYaml(raw));
      return Object.values(profile.hooks ?? {}).some(
        (hooks) => (hooks?.length ?? 0) > 0,
      );
    })
  );
}

function validateContributionPermissions(
  manifest: OrbitExtensionManifest,
): void {
  if (manifest.contributes.hooks.length > 0 && !manifest.permissions.process) {
    throw new Error(
      "Lifecycle hooks require process permission so Orbit can enforce the extension sandbox.",
    );
  }
  if (manifest.contributes.tools.length > 0 && !manifest.permissions.process) {
    throw new Error(
      "Extension tools require process permission so Orbit can enforce the extension sandbox.",
    );
  }
  const networkTool = manifest.contributes.tools.find(
    (tool) => tool.risk === "network",
  );
  if (networkTool) {
    throw new Error(
      `Extension tool "${networkTool.name}" requests network risk, but extension process tools are network-denied. Use a governed MCP contribution for remote capabilities.`,
    );
  }
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
        if (server.oauth.authorizationUrl) {
          const authorizationHost = new URL(
            server.oauth.authorizationUrl,
          ).hostname.toLowerCase();
          if (!declaredHosts.has(authorizationHost)) {
            throw new Error(
              `MCP server "${name}" requires network permission for OAuth host ${authorizationHost}.`,
            );
          }
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
  for (const agent of manifest.contributes.agents) {
    const target = resolve(root, agent.path);
    if (
      !lstatSync(target).isFile() ||
      !/\.(?:ya?ml|json)$/i.test(extname(target))
    ) {
      throw new Error(
        `Agent Profile contribution must be a YAML or JSON file: ${agent.path}`,
      );
    }
    const raw = readBoundedRegularFile(target, MAX_AGENT_PROFILE_FILE_BYTES);
    if (raw === undefined) {
      throw new Error(
        `Agent Profile contribution could not be read: ${agent.path}`,
      );
    }
    let document: unknown;
    try {
      document = parseYaml(raw);
    } catch (error: unknown) {
      throw new Error(
        `Agent Profile contribution is not valid YAML or JSON: ${agent.path}`,
        { cause: error },
      );
    }
    const parsed = AgentProfileSchema.safeParse(document);
    if (!parsed.success) {
      throw new Error(
        `Agent Profile contribution is invalid: ${agent.path} (${parsed.error.issues
          .slice(0, 2)
          .map(
            (issue) => `${issue.path.join(".") || "profile"}: ${issue.message}`,
          )
          .join("; ")})`,
      );
    }
    if (parsed.data.name !== agent.name) {
      throw new Error(
        `Agent Profile contribution name must match ${agent.name}: ${agent.path}`,
      );
    }
  }
  for (const tool of manifest.contributes.tools) {
    const target = resolve(root, tool.path);
    if (
      !lstatSync(target).isFile() ||
      !/\.(?:ya?ml|json)$/i.test(extname(target))
    ) {
      throw new Error(
        `Extension tool contribution must be a YAML or JSON definition: ${tool.path}`,
      );
    }
    const definition = loadExtensionToolDefinition(root, tool.path);
    const entrypoint = resolve(root, definition.entrypoint);
    const relation = relative(root, entrypoint);
    if (
      relation.startsWith("..") ||
      relation === "" ||
      !existsSync(entrypoint) ||
      lstatSync(entrypoint).isSymbolicLink() ||
      !lstatSync(entrypoint).isFile()
    ) {
      throw new Error(
        `Extension tool entrypoint is missing or unsafe: ${definition.entrypoint}`,
      );
    }
  }
}

function copyDirectorySafely(source: string, target: string): void {
  copyDirectoryEntry(source, target, { entries: 0, bytes: 0 }, 0);
}

function copyDirectoryEntry(
  source: string,
  target: string,
  budget: { entries: number; bytes: number },
  depth: number,
): void {
  if (depth > MAX_EXTENSION_TREE_DEPTH) {
    throw new Error("Extension tree exceeds the maximum depth.");
  }
  budget.entries += 1;
  if (budget.entries > MAX_EXTENSION_TREE_ENTRIES) {
    throw new Error("Extension tree contains too many entries.");
  }
  const stats = lstatSync(source);
  if (stats.isSymbolicLink())
    throw new Error("Extension directories cannot contain symlinks.");
  if (stats.isDirectory()) {
    mkdirSync(target, { recursive: true });
    for (const entry of readdirSync(source)) {
      if (entry === "node_modules" || entry === ".git") continue;
      copyDirectoryEntry(
        join(source, entry),
        join(target, entry),
        budget,
        depth + 1,
      );
    }
    return;
  }
  if (!stats.isFile())
    throw new Error("Extension contains an unsupported filesystem entry.");
  const data = readBoundedRegularFileBuffer(source, MAX_EXTENSION_FILE_BYTES);
  if (data === undefined) throw new Error("Extension file disappeared.");
  budget.bytes += data.byteLength;
  if (budget.bytes > MAX_EXTENSION_TREE_BYTES) {
    throw new Error("Extension tree exceeds the 256 MiB limit.");
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data, { mode: 0o600 });
}

function materializeDeclarativeContributions(
  extensionRoot: string,
  manifest: OrbitExtensionManifest,
  orbitDir: string,
): void {
  for (const [kind, contributions] of [
    ["commands", manifest.contributes.commands],
    ["skills", manifest.contributes.skills],
    ["agents", manifest.contributes.agents],
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
          : kind === "skills"
            ? join(destinationRoot, contribution.name, "SKILL.md")
            : join(destinationRoot, `${contribution.name}${extname(source)}`);
      copyDirectorySafely(source, destination);
    }
  }
}

function removeTransactionArtifact(path: string): boolean {
  try {
    rmSync(path, { recursive: true, force: true });
    return true;
  } catch {
    // The installation is already committed; a hidden rollback artifact is
    // safer than reverting files after the registry has been replaced.
    return false;
  }
}

/** Refuse to mutate an Orbit-managed path through a replaced parent. */
function assertSafeManagedPath(target: string, managedRoot: string): void {
  const root = resolve(managedRoot);
  const absoluteTarget = resolve(target);
  const relation = relative(root, absoluteTarget);
  if (
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    throw new Error(`Managed extension path escapes ${root}.`);
  }
  let current = absoluteTarget;
  while (true) {
    try {
      const stats = lstatSync(current);
      if (stats.isSymbolicLink()) {
        throw new Error(
          `Managed extension path contains a symbolic link: ${current}`,
        );
      }
      if (current !== absoluteTarget && !stats.isDirectory()) {
        throw new Error(
          `Managed extension path contains a non-directory parent: ${current}`,
        );
      }
    } catch (error: unknown) {
      if (
        !(error instanceof Error) ||
        !/ENOENT|not found/i.test(error.message)
      ) {
        throw error;
      }
    }
    if (current === root) return;
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Managed extension path could not reach ${root}.`);
    }
    current = parent;
  }
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
