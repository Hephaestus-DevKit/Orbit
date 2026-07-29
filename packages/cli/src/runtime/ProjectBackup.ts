import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { createHash, randomUUID } from "crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";
import { z } from "zod";
import {
  readBoundedRegularFile,
  readBoundedRegularFileBuffer,
} from "@orbit-build/shared";

const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
const MAX_SERIALIZED_BACKUP_BYTES = 96 * 1024 * 1024;
const MAX_BACKUP_FILES = 10_000;
const MAX_BACKUP_TREE_ENTRIES = 50_000;
const MAX_BACKUP_TREE_DEPTH = 64;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const BackupFileSchema = z.object({
  path: z.string().min(1).max(4096),
  size: z.number().int().min(0).max(MAX_BACKUP_BYTES),
  sha256: z.string().regex(SHA256_PATTERN),
  content: z.string().max(Math.ceil((MAX_BACKUP_BYTES * 4) / 3) + 8),
});

export const ProjectBackupBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("orbit-project-backup"),
    createdAt: z.string().datetime(),
    sourceName: z.string().min(1).max(512),
    files: z.array(BackupFileSchema).max(MAX_BACKUP_FILES),
  })
  .superRefine((bundle, context) => {
    let totalBytes = 0;
    const seen = new Set<string>();
    for (const file of bundle.files) {
      totalBytes += file.size;
      if (totalBytes > MAX_BACKUP_BYTES) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Backup exceeds ${MAX_BACKUP_BYTES} bytes.`,
        });
        break;
      }
      const normalized = normalizeBundlePath(file.path);
      if (!normalized || normalized !== file.path) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unsafe backup path: ${file.path}`,
        });
        continue;
      }
      if (seen.has(normalized.toLowerCase())) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate backup path: ${file.path}`,
        });
      }
      seen.add(normalized.toLowerCase());
    }
  });

export type ProjectBackupBundle = z.infer<typeof ProjectBackupBundleSchema>;

const EXCLUDED_TOP_LEVEL = new Set([
  "autocomplete.json",
  "bm25_store.json",
  "branches",
  "cache-slabs",
  "evaluations",
  "exports",
  "provider-benchmarks.json",
  "provider-capabilities.json",
  "state.json",
  "symbols.json",
  "vector_store.json",
]);

/** Create a portable, credential-free snapshot of durable project data. */
export function createProjectBackup(
  projectDirectory: string,
): ProjectBackupBundle {
  const projectRoot = resolve(projectDirectory);
  const orbitRoot = join(projectRoot, ".orbit");
  const files: ProjectBackupBundle["files"] = [];
  let totalBytes = 0;

  if (existsSync(orbitRoot)) {
    for (const absolutePath of listBackupFiles(orbitRoot)) {
      if (files.length >= MAX_BACKUP_FILES) {
        throw new Error(`Project backup exceeds ${MAX_BACKUP_FILES} files.`);
      }
      const remainingBytes = MAX_BACKUP_BYTES - totalBytes;
      if (remainingBytes <= 0) {
        throw new Error(
          `Project backup exceeds ${formatBytes(MAX_BACKUP_BYTES)}. Remove large generated data and retry.`,
        );
      }
      const content = readBoundedRegularFileBuffer(
        absolutePath,
        remainingBytes,
      );
      if (content === undefined) continue;
      totalBytes += content.byteLength;
      if (totalBytes > MAX_BACKUP_BYTES) {
        throw new Error(
          `Project backup exceeds ${formatBytes(MAX_BACKUP_BYTES)}. Remove large generated data and retry.`,
        );
      }
      const bundlePath = normalizeBundlePath(relative(orbitRoot, absolutePath));
      if (!bundlePath) throw new Error("Unable to create a safe backup path.");
      files.push({
        path: bundlePath,
        size: content.byteLength,
        sha256: hash(content),
        content: content.toString("base64"),
      });
    }
  }

  return ProjectBackupBundleSchema.parse({
    schemaVersion: 1,
    kind: "orbit-project-backup",
    createdAt: new Date().toISOString(),
    sourceName: projectRoot.split(sep).filter(Boolean).at(-1) ?? "project",
    files,
  });
}

/** Write a bundle atomically so an interrupted export cannot replace a good backup. */
export function writeProjectBackup(
  outputPath: string,
  bundle: ProjectBackupBundle,
): string {
  const destination = resolve(outputPath);
  mkdirSync(dirname(destination), { recursive: true });
  const temporaryPath = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(
      temporaryPath,
      `${JSON.stringify(ProjectBackupBundleSchema.parse(bundle), null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    renameSync(temporaryPath, destination);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  return destination;
}

/** Parse and cryptographically validate a project backup before any restore writes. */
export function readProjectBackup(inputPath: string): ProjectBackupBundle {
  const absolutePath = resolve(inputPath);
  const raw = readBoundedRegularFile(absolutePath, MAX_SERIALIZED_BACKUP_BYTES);
  if (raw === undefined) throw new Error("Backup file not found.");
  const bundle = ProjectBackupBundleSchema.parse(JSON.parse(raw) as unknown);
  for (const file of bundle.files) {
    const content = Buffer.from(file.content, "base64");
    if (content.byteLength !== file.size || hash(content) !== file.sha256) {
      throw new Error(`Backup integrity check failed for ${file.path}.`);
    }
  }
  return bundle;
}

export interface RestoreProjectBackupResult {
  restored: string[];
  conflicts: string[];
}

/** Restore a fully validated bundle without allowing traversal or implicit overwrite. */
export function restoreProjectBackup(
  projectDirectory: string,
  bundle: ProjectBackupBundle,
  options: { force?: boolean } = {},
): RestoreProjectBackupResult {
  const validated = ProjectBackupBundleSchema.parse(bundle);
  validateBundleContents(validated);
  const orbitRoot = resolve(projectDirectory, ".orbit");
  assertDirectoryChainHasNoSymlink(resolve(projectDirectory), orbitRoot);
  const planned = validated.files.map((file) => ({
    file,
    destination: resolveBackupDestination(orbitRoot, file.path),
  }));
  const conflicts = planned
    .filter(({ destination }) => existsSync(destination))
    .map(({ file }) => file.path);
  if (conflicts.length > 0 && !options.force) {
    throw new Error(
      `Restore would overwrite ${conflicts.length} file(s). Re-run with --force after reviewing the backup.`,
    );
  }

  const restored: string[] = [];
  for (const { file, destination } of planned) {
    assertDirectoryChainHasNoSymlink(orbitRoot, dirname(destination));
    mkdirSync(dirname(destination), { recursive: true });
    const temporaryPath = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporaryPath, Buffer.from(file.content, "base64"), {
        mode: 0o600,
      });
      replaceFileAtomically(temporaryPath, destination);
      restored.push(file.path);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  }
  return { restored, conflicts };
}

function listBackupFiles(root: string): string[] {
  const output: string[] = [];
  let visitedEntries = 0;
  const visit = (directory: string, depth: number): void => {
    if (depth > MAX_BACKUP_TREE_DEPTH) {
      throw new Error(
        `Project backup tree exceeds ${MAX_BACKUP_TREE_DEPTH} directory levels.`,
      );
    }
    for (const name of readdirSync(directory).sort()) {
      visitedEntries += 1;
      if (visitedEntries > MAX_BACKUP_TREE_ENTRIES) {
        throw new Error(
          `Project backup tree exceeds ${MAX_BACKUP_TREE_ENTRIES} entries.`,
        );
      }
      const absolutePath = join(directory, name);
      const relativePath = relative(root, absolutePath).split(sep).join("/");
      const topLevel = relativePath.split("/")[0]?.toLowerCase() ?? "";
      if (EXCLUDED_TOP_LEVEL.has(topLevel)) continue;
      const status = lstatSync(absolutePath);
      if (status.isSymbolicLink()) continue;
      if (status.isDirectory()) visit(absolutePath, depth + 1);
      else if (status.isFile()) {
        output.push(absolutePath);
        if (output.length > MAX_BACKUP_FILES) {
          throw new Error(`Project backup exceeds ${MAX_BACKUP_FILES} files.`);
        }
      }
    }
  };
  visit(root, 0);
  return output;
}

function validateBundleContents(bundle: ProjectBackupBundle): void {
  let totalBytes = 0;
  for (const file of bundle.files) {
    const content = Buffer.from(file.content, "base64");
    totalBytes += content.byteLength;
    if (
      content.byteLength !== file.size ||
      hash(content) !== file.sha256 ||
      totalBytes > MAX_BACKUP_BYTES
    ) {
      throw new Error(`Backup integrity check failed for ${file.path}.`);
    }
  }
}

function resolveBackupDestination(root: string, filePath: string): string {
  const normalized = normalizeBundlePath(filePath);
  if (!normalized || normalized !== filePath) {
    throw new Error(`Unsafe backup path: ${filePath}`);
  }
  const destination = resolve(root, ...normalized.split("/"));
  const prefix = `${resolve(root)}${sep}`;
  if (!destination.startsWith(prefix)) {
    throw new Error(`Backup path escapes the project: ${filePath}`);
  }
  return destination;
}

function assertDirectoryChainHasNoSymlink(root: string, target: string): void {
  const absoluteRoot = resolve(root);
  const absoluteTarget = resolve(target);
  const relativeTarget = relative(absoluteRoot, absoluteTarget);
  if (relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) {
    throw new Error("Backup restore directory escapes the project.");
  }
  let current = absoluteRoot;
  if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
    throw new Error(`Refusing to restore through symbolic link: ${current}`);
  }
  for (const part of relativeTarget.split(sep).filter(Boolean)) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing to restore through symbolic link: ${current}`);
    }
  }
}

function replaceFileAtomically(
  temporaryPath: string,
  destination: string,
): void {
  if (!existsSync(destination)) {
    renameSync(temporaryPath, destination);
    return;
  }
  const previousPath = `${destination}.${process.pid}.${randomUUID()}.bak`;
  renameSync(destination, previousPath);
  try {
    renameSync(temporaryPath, destination);
    rmSync(previousPath, { force: true });
  } catch (error) {
    if (!existsSync(destination) && existsSync(previousPath)) {
      renameSync(previousPath, destination);
    }
    throw error;
  }
}

function normalizeBundlePath(filePath: string): string | undefined {
  const normalized = filePath.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    isAbsolute(normalized) ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    return undefined;
  }
  return normalized;
}

function hash(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MiB`;
}
