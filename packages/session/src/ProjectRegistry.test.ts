import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join, parse } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ProjectRegistry,
  ProjectRegistrySnapshotSchema,
  parseProjectRegistrySnapshot,
} from "./ProjectRegistry.js";

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const path of temporaryPaths.splice(0))
    rmSync(path, { recursive: true, force: true });
});

describe("ProjectRegistry", () => {
  it("keeps construction and read-only listing side-effect free", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-project-registry-"));
    temporaryPaths.push(root);
    const storage = join(root, "missing-storage");
    const registry = new ProjectRegistry(storage);

    expect(existsSync(storage)).toBe(false);
    expect(registry.list()).toEqual([]);
    expect(existsSync(storage)).toBe(false);
  });

  it("registers one stable project identity and tracks its latest session", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-project-registry-"));
    temporaryPaths.push(root);
    const storage = join(root, "storage");
    const project = join(root, "project");
    mkdirSync(project);
    const registry = new ProjectRegistry(storage);

    const first = registry.register(project, "sess-first");
    const second = registry.register(project, "sess-second");

    expect(second.id).toBe(first.id);
    expect(registry.list()).toEqual([
      expect.objectContaining({
        id: first.id,
        lastSessionId: "sess-second",
        available: true,
      }),
    ]);
    expect(
      ProjectRegistrySnapshotSchema.parse(
        JSON.parse(readFileSync(join(storage, "projects.json"), "utf8")),
      ).projects,
    ).toHaveLength(1);
    expect(existsSync(join(storage, "projects.json.lock"))).toBe(false);
  });

  it("never registers a filesystem root as a project", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-project-registry-"));
    temporaryPaths.push(root);
    const registry = new ProjectRegistry(join(root, "storage"));

    expect(() => registry.register(parse(root).root)).toThrow(
      "filesystem root",
    );
    expect(existsSync(join(root, "storage"))).toBe(false);
  });

  it("rejects oversized session metadata without changing the registry", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-project-registry-"));
    temporaryPaths.push(root);
    const storage = join(root, "storage");
    const project = join(root, "project");
    mkdirSync(project);
    const registry = new ProjectRegistry(storage);
    const first = registry.register(project, "sess-first");
    const registryPath = join(storage, "projects.json");
    const before = readFileSync(registryPath, "utf8");

    expect(() => registry.register(project, "s".repeat(1_001))).toThrow();
    expect(readFileSync(registryPath, "utf8")).toBe(before);
    expect(registry.list()).toEqual([
      expect.objectContaining({
        id: first.id,
        lastSessionId: "sess-first",
      }),
    ]);
  });

  it("recovers a stale mutation lock left by an interrupted process", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-project-registry-"));
    temporaryPaths.push(root);
    const storage = join(root, "storage");
    const project = join(root, "project");
    mkdirSync(storage);
    mkdirSync(project);
    const lockPath = join(storage, "projects.json.lock");
    writeFileSync(lockPath, "interrupted");
    const staleTime = new Date(Date.now() - 60_000);
    utimesSync(lockPath, staleTime, staleTime);

    const registry = new ProjectRegistry(storage);
    expect(registry.register(project).path).toContain("project");
    expect(existsSync(lockPath)).toBe(false);
  });

  it("archives, restores, removes, and reports missing projects", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-project-registry-"));
    temporaryPaths.push(root);
    const project = join(root, "project");
    mkdirSync(project);
    const registry = new ProjectRegistry(join(root, "storage"));
    const record = registry.register(project);

    expect(registry.archive(record.id)).toBe(true);
    expect(registry.list()).toHaveLength(0);
    expect(registry.list({ includeArchived: true })[0].archivedAt).toBeTruthy();
    expect(registry.restore(record.id)).toBe(true);
    rmSync(project, { recursive: true, force: true });
    expect(registry.list()[0].available).toBe(false);
    expect(registry.remove(record.id)).toBe(true);
    expect(registry.list({ includeArchived: true })).toHaveLength(0);
  });

  it("recovers from a corrupt primary snapshot using its backup", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-project-registry-"));
    temporaryPaths.push(root);
    const storage = join(root, "storage");
    const firstProject = join(root, "first");
    const secondProject = join(root, "second");
    mkdirSync(firstProject);
    mkdirSync(secondProject);
    const registry = new ProjectRegistry(storage);
    const first = registry.register(firstProject);
    registry.register(secondProject);
    writeFileSync(join(storage, "projects.json"), "{broken", "utf8");

    expect(registry.list()).toEqual([
      expect.objectContaining({ id: first.id, available: true }),
    ]);
  });

  it("migrates the pre-versioned registry without losing project identity", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-project-registry-"));
    temporaryPaths.push(root);
    const project = join(root, "legacy-project");
    mkdirSync(project);
    const current = new ProjectRegistry(join(root, "source")).register(project);
    const migrated = parseProjectRegistrySnapshot({ projects: [current] });

    expect(migrated).toEqual({ schemaVersion: 1, projects: [current] });
  });

  it("refuses an unsafe backup without changing the project registry", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-project-registry-"));
    temporaryPaths.push(root);
    const storage = join(root, "storage");
    const firstProject = join(root, "first");
    const secondProject = join(root, "second");
    mkdirSync(firstProject);
    mkdirSync(secondProject);
    const registry = new ProjectRegistry(storage);
    const first = registry.register(firstProject);
    const registryPath = join(storage, "projects.json");
    const before = readFileSync(registryPath, "utf8");
    mkdirSync(`${registryPath}.bak`);

    expect(() => registry.register(secondProject)).toThrow("regular file");
    expect(readFileSync(registryPath, "utf8")).toBe(before);
    expect(registry.list()).toEqual([
      expect.objectContaining({ id: first.id, available: true }),
    ]);
  });

  it("bounds primary registry input and recovers from its backup", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-project-registry-"));
    temporaryPaths.push(root);
    const storage = join(root, "storage");
    const firstProject = join(root, "first");
    const secondProject = join(root, "second");
    mkdirSync(firstProject);
    mkdirSync(secondProject);
    const registry = new ProjectRegistry(storage);
    const first = registry.register(firstProject);
    registry.register(secondProject);
    writeFileSync(
      join(storage, "projects.json"),
      "x".repeat(2 * 1024 * 1024 + 1),
    );

    expect(registry.list()).toEqual([
      expect.objectContaining({ id: first.id, available: true }),
    ]);
  });
});
