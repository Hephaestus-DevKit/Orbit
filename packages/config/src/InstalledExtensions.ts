import { existsSync, lstatSync, readdirSync } from "fs";
import { createHash } from "crypto";
import { join, relative, resolve } from "path";
import { z } from "zod";
import {
  readBoundedRegularFile,
  readBoundedRegularFileBuffer,
} from "@orbit-build/shared";
import type { OrbitConfig } from "./schema.js";
import { loadOrbitExtensionManifest } from "./ExtensionManifest.js";

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
  const extensionsRoot = resolve(homeDirectory, ".orbit", "extensions");
  for (const extension of parsed.data.extensions) {
    if (!extension.trusted) continue;
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
      for (const [name, server] of Object.entries(
        manifest.contributes.mcpServers,
      )) {
        const key = `${extension.id}.${name}`;
        if (!config.mcpServers[key]) config.mcpServers[key] = server;
      }
    } catch {
      continue;
    }
  }
  if (Object.keys(config.mcpServers).length > 0)
    config.tools.mcp.enabled = true;
  return config;
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
