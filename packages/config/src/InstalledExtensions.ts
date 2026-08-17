import { existsSync, lstatSync, readdirSync } from "fs";
import { createHash } from "crypto";
import { join, relative, resolve } from "path";
import { z } from "zod";
import {
  readBoundedRegularFile,
  readBoundedRegularFileBuffer,
} from "@orbit-build/shared";
import type { OrbitConfig } from "./schema.js";
import type { LifecycleHookEvent } from "./LifecycleHooks.js";
import {
  loadOrbitExtensionManifest,
  verifyOrbitExtensionSignature,
  type OrbitExtensionManifest,
} from "./ExtensionManifest.js";
import {
  createExtensionToolRuntimeName,
  loadExtensionToolDefinition,
  type ExtensionToolDefinition,
} from "./ExtensionTool.js";

export const ExtensionDigestAlgorithmSchema = z.enum([
  "sha256-v1",
  "sha256-v2",
]);
export type ExtensionDigestAlgorithm = z.infer<
  typeof ExtensionDigestAlgorithmSchema
>;
export const MAX_EXTENSION_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_EXTENSION_TREE_BYTES = 256 * 1024 * 1024;
export const MAX_EXTENSION_TREE_ENTRIES = 10_000;
export const MAX_EXTENSION_TREE_DEPTH = 64;
export const MAX_EXTENSION_REGISTRY_BYTES = 1024 * 1024;
export const InstalledExtensionIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{1,127}$/);

const InstalledExtensionSchema = z.object({
  id: InstalledExtensionIdSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  digestAlgorithm: ExtensionDigestAlgorithmSchema.default("sha256-v1"),
  trusted: z.boolean(),
  path: z.string(),
  manifestFile: z.string().min(1).max(4096).default("extension.yaml"),
});
const ExtensionRegistrySchema = z.object({
  schemaVersion: z.literal(1),
  extensions: z.array(InstalledExtensionSchema).max(500).default([]),
});

export interface InstalledExtensionToolContribution {
  extensionId: string;
  extensionRoot: string;
  contributionName: string;
  runtimeName: string;
  risk: "read" | "write" | "execute" | "dangerous";
  definition: ExtensionToolDefinition;
  filesystem: Array<{
    mode: "read" | "write";
    scope: string;
  }>;
}

const installedExtensionTools = new WeakMap<
  OrbitConfig,
  readonly InstalledExtensionToolContribution[]
>();

/** Read runtime-only tool provenance that cannot be injected by config files. */
export function getInstalledExtensionToolContributions(
  config: OrbitConfig,
): readonly InstalledExtensionToolContribution[] {
  return installedExtensionTools.get(config) ?? [];
}

/** Preserve verified runtime provenance across final policy/schema cloning. */
export function setInstalledExtensionToolContributions(
  config: OrbitConfig,
  contributions: readonly InstalledExtensionToolContribution[],
): void {
  installedExtensionTools.set(
    config,
    Object.freeze(contributions.map((entry) => structuredClone(entry))),
  );
}

/** Merge integrity-checked, explicitly trusted MCP contributions. */
export function applyInstalledExtensionContributions(
  source: OrbitConfig,
  homeDirectory: string,
): OrbitConfig {
  const registryPath = join(homeDirectory, ".orbit", "extensions.json");
  if (!existsSync(registryPath)) return source;
  let registry: unknown;
  try {
    const raw = readBoundedRegularFile(
      registryPath,
      MAX_EXTENSION_REGISTRY_BYTES,
    );
    if (raw === undefined) return source;
    registry = JSON.parse(raw);
  } catch {
    return source;
  }
  const parsed = ExtensionRegistrySchema.safeParse(registry);
  if (!parsed.success) return source;

  const config = structuredClone(source);
  const runtimeTools: InstalledExtensionToolContribution[] = [];
  const runtimeToolNames = new Set<string>();
  const extensionsRoot = resolve(homeDirectory, ".orbit", "extensions");
  const allowedExtensions = source.managedPolicy?.allowedExtensions;
  for (const extension of parsed.data.extensions) {
    if (!extension.trusted) continue;
    if (allowedExtensions && !allowedExtensions.includes(extension.id)) {
      continue;
    }
    const root = resolve(extension.path);
    if (root !== resolve(extensionsRoot, extension.id)) continue;
    try {
      if (!existsSync(root) || lstatSync(root).isSymbolicLink()) continue;
      if (
        hashExtensionDirectory(root, extension.digestAlgorithm) !==
        extension.digest
      ) {
        continue;
      }
      const manifest = loadOrbitExtensionManifest(root, extension.manifestFile);
      if (manifest.id !== extension.id) continue;
      const trustRoots = source.security.extensionTrustRoots;
      if (
        Object.keys(trustRoots).length > 0 &&
        !verifyOrbitExtensionSignature(manifest, extension.digest, trustRoots)
      ) {
        continue;
      }
      if (!config.managedPolicy?.disableMcp) {
        for (const [name, server] of Object.entries(
          manifest.contributes.mcpServers,
        )) {
          const key = `${extension.id}.${name}`;
          if (!config.mcpServers[key]) config.mcpServers[key] = server;
        }
      }
      applyTrustedExtensionHooks(config, manifest, root);
      applyTrustedExtensionTools(
        config,
        manifest,
        root,
        runtimeTools,
        runtimeToolNames,
      );
    } catch {
      continue;
    }
  }
  if (
    Object.keys(config.mcpServers).length > 0 &&
    !config.managedPolicy?.disableMcp
  )
    config.tools.mcp.enabled = true;
  setInstalledExtensionToolContributions(config, runtimeTools);
  return config;
}

function applyTrustedExtensionTools(
  config: OrbitConfig,
  manifest: OrbitExtensionManifest,
  extensionRoot: string,
  target: InstalledExtensionToolContribution[],
  names: Set<string>,
): void {
  if (
    manifest.contributes.tools.length === 0 ||
    !manifest.permissions.process ||
    config.managedPolicy?.disableExtensionTools
  ) {
    return;
  }
  for (const contribution of manifest.contributes.tools) {
    // A native sandbox can enforce all-or-nothing network isolation, not an
    // exact hostname allow-list. Network tools therefore remain fail-closed;
    // extensions should expose remote capabilities through governed MCP.
    if (contribution.risk === "network") continue;
    const definition = loadExtensionToolDefinition(
      extensionRoot,
      contribution.path,
    );
    const entrypoint = resolve(extensionRoot, definition.entrypoint);
    const relation = relative(extensionRoot, entrypoint);
    if (
      !relation ||
      relation.startsWith("..") ||
      !existsSync(entrypoint) ||
      lstatSync(entrypoint).isSymbolicLink() ||
      !lstatSync(entrypoint).isFile()
    ) {
      throw new Error(
        `Extension tool entrypoint is missing or unsafe: ${definition.entrypoint}`,
      );
    }
    const runtimeName = createExtensionToolRuntimeName(
      manifest.id,
      contribution.name,
    );
    if (names.has(runtimeName)) {
      throw new Error(`Duplicate extension tool runtime name: ${runtimeName}`);
    }
    names.add(runtimeName);
    target.push({
      extensionId: manifest.id,
      extensionRoot,
      contributionName: contribution.name,
      runtimeName,
      risk: contribution.risk,
      definition,
      filesystem: structuredClone(manifest.permissions.filesystem),
    });
  }
}

/**
 * Materialize only trusted, integrity-checked extension hooks.
 *
 * The runtime receives provenance metadata and will force these hooks through
 * a required process sandbox with a read-only extension working directory.
 * Keeping this conversion here makes it impossible for a loose manifest file
 * to become an executable lifecycle hook merely by being discoverable.
 */
function applyTrustedExtensionHooks(
  config: OrbitConfig,
  manifest: OrbitExtensionManifest,
  extensionRoot: string,
): void {
  if (
    manifest.contributes.hooks.length === 0 ||
    !manifest.permissions.process ||
    config.managedPolicy?.disableExtensionHooks
  ) {
    return;
  }
  const lifecycle = (config.hooks.lifecycle ??= {});
  for (const hook of manifest.contributes.hooks) {
    const event = extensionHookEvent(hook.event);
    if (!event) continue;
    const list = lifecycle[event] ?? [];
    if (list.length >= 16) continue;
    list.push({
      command: hook.command,
      ...(hook.matcher ? { matcher: hook.matcher } : {}),
      timeoutMs: hook.timeoutMs,
      onFailure: hook.onFailure,
      extension: { id: manifest.id, root: extensionRoot },
    });
    lifecycle[event] = list;
  }
}

function extensionHookEvent(value: string): LifecycleHookEvent | undefined {
  const events: Record<string, LifecycleHookEvent> = {
    session_start: "sessionStart",
    prompt_submit: "promptSubmit",
    permission_request: "permissionRequest",
    pre_tool: "preToolUse",
    post_tool: "postToolUse",
    post_tool_failure: "postToolFailure",
    pre_compact: "preCompact",
    post_compact: "postCompact",
    verification_start: "verificationStart",
    verification_end: "verificationEnd",
    agent_start: "subagentStart",
    agent_end: "subagentStop",
    subagent_stop: "subagentStop",
    session_stop: "stop",
  };
  return events[value];
}

/**
 * Hash a copied extension tree with explicit entry and content framing.
 * v1 remains available solely to verify registries written before Orbit 0.3.8.
 */
export function hashExtensionDirectory(
  root: string,
  algorithm: ExtensionDigestAlgorithm = "sha256-v2",
): string {
  const hash = createHash("sha256");
  let entries = 0;
  let totalBytes = 0;
  const visit = (directory: string, depth: number): void => {
    if (depth > MAX_EXTENSION_TREE_DEPTH) {
      throw new Error("Extension tree exceeds the maximum depth.");
    }
    for (const entry of readdirSync(directory).sort()) {
      entries += 1;
      if (entries > MAX_EXTENSION_TREE_ENTRIES) {
        throw new Error("Extension tree contains too many entries.");
      }
      const path = join(directory, entry);
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) {
        throw new Error("Symlinked extension entry.");
      }
      const name = relative(root, path).replace(/\\/g, "/");
      if (algorithm === "sha256-v1") {
        hash.update(name);
        if (stats.isDirectory()) visit(path, depth + 1);
        else if (stats.isFile()) {
          validateExtensionFileSize(stats.size, totalBytes);
          totalBytes += stats.size;
          const content = readBoundedRegularFileBuffer(
            path,
            MAX_EXTENSION_FILE_BYTES,
          );
          if (content === undefined) throw new Error("Extension file missing.");
          hash.update(content);
        } else throw new Error("Unsupported extension entry.");
        continue;
      }
      if (stats.isDirectory()) {
        hash.update(`directory\0${Buffer.byteLength(name)}\0${name}\0`);
        visit(path, depth + 1);
      } else if (stats.isFile()) {
        validateExtensionFileSize(stats.size, totalBytes);
        totalBytes += stats.size;
        const content = readBoundedRegularFileBuffer(
          path,
          MAX_EXTENSION_FILE_BYTES,
        );
        if (content === undefined) throw new Error("Extension file missing.");
        hash.update(
          `file\0${Buffer.byteLength(name)}\0${name}\0${content.byteLength}\0`,
        );
        hash.update(content);
      } else {
        throw new Error("Unsupported extension entry.");
      }
    }
  };
  visit(root, 0);
  return hash.digest("hex");
}

function validateExtensionFileSize(
  fileBytes: number,
  previousTotalBytes: number,
): void {
  if (fileBytes > MAX_EXTENSION_FILE_BYTES) {
    throw new Error("Extension file exceeds the 8 MiB limit.");
  }
  if (previousTotalBytes + fileBytes > MAX_EXTENSION_TREE_BYTES) {
    throw new Error("Extension tree exceeds the 256 MiB limit.");
  }
}
