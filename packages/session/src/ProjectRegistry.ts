import { createHash } from "crypto";
import { realpathSync, statSync } from "fs";
import { homedir } from "os";
import { basename, dirname, isAbsolute, join, parse, resolve } from "path";
import { z } from "zod";
import {
  ensurePrivateDirectory,
  readBoundedRegularFile,
  replacePrivateFileAtomically,
} from "@orbit-build/shared";

const MAX_PROJECTS = 200;
const MAX_PROJECT_REGISTRY_BYTES = 2 * 1024 * 1024;

export const ProjectRecordSchema = z.object({
  id: z.string().regex(/^proj_[a-f0-9]{16}$/),
  path: z
    .string()
    .min(1)
    .max(4096)
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value)),
  name: z.string().trim().min(1).max(200),
  createdAt: z.string().datetime(),
  lastOpenedAt: z.string().datetime(),
  lastSessionId: z.string().min(1).optional(),
  archivedAt: z.string().datetime().optional(),
});

export const ProjectRegistrySnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  projects: z.array(ProjectRecordSchema).max(MAX_PROJECTS),
});

const LegacyProjectRegistrySnapshotSchema = z.object({
  projects: z.array(ProjectRecordSchema).max(MAX_PROJECTS),
});

export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;
export type ProjectRegistrySnapshot = z.infer<
  typeof ProjectRegistrySnapshotSchema
>;
export type ProjectRegistryEntry = ProjectRecord & { available: boolean };

/** Accept the pre-versioned registry shape and normalize it to the current schema. */
export function parseProjectRegistrySnapshot(
  value: unknown,
): ProjectRegistrySnapshot {
  const current = ProjectRegistrySnapshotSchema.safeParse(value);
  if (current.success) return current.data;
  const legacy = LegacyProjectRegistrySnapshotSchema.safeParse(value);
  if (legacy.success) {
    return ProjectRegistrySnapshotSchema.parse({
      schemaVersion: 1,
      projects: legacy.data.projects,
    });
  }
  throw current.error;
}

/** Durable user-level registry for project identities and recent workspaces. */
export class ProjectRegistry {
  private readonly filePath: string;

  constructor(rootPath = join(homedir(), ".orbit")) {
    const root = resolve(rootPath);
    this.filePath = join(root, "projects.json");
  }

  register(projectPath: string, sessionId?: string): ProjectRecord {
    const canonicalPath = canonicalizeProjectPath(projectPath);
    const now = new Date().toISOString();
    const snapshot = this.readSnapshot();
    const identity = projectIdentity(canonicalPath);
    const existing = snapshot.projects.find(
      (project) => project.id === identity,
    );
    const record: ProjectRecord = existing
      ? {
          ...existing,
          path: canonicalPath,
          name: basename(canonicalPath),
          lastOpenedAt: now,
          ...(sessionId ? { lastSessionId: sessionId } : {}),
          archivedAt: undefined,
        }
      : {
          id: identity,
          path: canonicalPath,
          name: basename(canonicalPath),
          createdAt: now,
          lastOpenedAt: now,
          ...(sessionId ? { lastSessionId: sessionId } : {}),
        };

    snapshot.projects = [
      record,
      ...snapshot.projects.filter((project) => project.id !== identity),
    ].slice(0, MAX_PROJECTS);
    this.writeSnapshot(snapshot);
    return record;
  }

  list(options: { includeArchived?: boolean } = {}): ProjectRegistryEntry[] {
    return this.readSnapshot()
      .projects.filter(
        (project) => options.includeArchived || !project.archivedAt,
      )
      .map((project) => ({ ...project, available: isDirectory(project.path) }))
      .sort((left, right) =>
        right.lastOpenedAt.localeCompare(left.lastOpenedAt),
      );
  }

  archive(projectId: string): boolean {
    return this.update(projectId, (project) => ({
      ...project,
      archivedAt: new Date().toISOString(),
    }));
  }

  restore(projectId: string): boolean {
    return this.update(projectId, (project) => ({
      ...project,
      archivedAt: undefined,
      lastOpenedAt: new Date().toISOString(),
    }));
  }

  remove(projectId: string): boolean {
    const snapshot = this.readSnapshot();
    const next = snapshot.projects.filter(
      (project) => project.id !== projectId,
    );
    if (next.length === snapshot.projects.length) return false;
    snapshot.projects = next;
    this.writeSnapshot(snapshot);
    return true;
  }

  private update(
    projectId: string,
    updater: (project: ProjectRecord) => ProjectRecord,
  ): boolean {
    const snapshot = this.readSnapshot();
    const index = snapshot.projects.findIndex(
      (project) => project.id === projectId,
    );
    if (index < 0) return false;
    snapshot.projects[index] = ProjectRecordSchema.parse(
      updater(snapshot.projects[index]),
    );
    this.writeSnapshot(snapshot);
    return true;
  }

  private readSnapshot(): ProjectRegistrySnapshot {
    for (const candidate of [this.filePath, `${this.filePath}.bak`]) {
      try {
        const raw = readBoundedRegularFile(
          candidate,
          MAX_PROJECT_REGISTRY_BYTES,
        );
        if (raw === undefined) continue;
        return parseProjectRegistrySnapshot(JSON.parse(raw));
      } catch {
        // Try the last known-good snapshot before returning an empty registry.
      }
    }
    return { schemaVersion: 1, projects: [] };
  }

  private writeSnapshot(snapshot: ProjectRegistrySnapshot): void {
    const validated = ProjectRegistrySnapshotSchema.parse(snapshot);
    ensurePrivateDirectory(dirname(this.filePath), { windowsAcl: false });
    const current = readBoundedRegularFile(
      this.filePath,
      MAX_PROJECT_REGISTRY_BYTES,
    );
    if (current !== undefined) {
      let previous: ProjectRegistrySnapshot | undefined;
      try {
        previous = parseProjectRegistrySnapshot(JSON.parse(current));
      } catch {
        // Preserve an existing last-known-good backup if the primary is corrupt.
      }
      if (previous) {
        replacePrivateFileAtomically(
          `${this.filePath}.bak`,
          `${JSON.stringify(previous, null, 2)}\n`,
        );
      }
    }
    replacePrivateFileAtomically(
      this.filePath,
      `${JSON.stringify(validated, null, 2)}\n`,
    );
  }
}

function canonicalizeProjectPath(projectPath: string): string {
  if (!isAbsolute(projectPath))
    throw new Error("Project path must be absolute.");
  const requested = resolve(projectPath);
  if (requested === parse(requested).root) {
    throw new Error(
      "A filesystem root cannot be registered as an Orbit project.",
    );
  }
  if (!isDirectory(requested))
    throw new Error("Project path must be an existing directory.");
  return realpathSync.native(requested);
}

function projectIdentity(projectPath: string): string {
  const normalized = projectPath.replace(/\\/g, "/");
  const platformStable =
    process.platform === "win32" ? normalized.toLowerCase() : normalized;
  return `proj_${createHash("sha256").update(platformStable).digest("hex").slice(0, 16)}`;
}

function isDirectory(targetPath: string): boolean {
  try {
    return statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}
