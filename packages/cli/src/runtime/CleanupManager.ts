import {
  lstatSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  type Stats,
} from "fs";
import { homedir } from "os";
import { basename, join, parse, resolve } from "path";
import { z } from "zod";

export const CleanupScopeSchema = z.enum(["user", "project"]);
export type CleanupScope = z.infer<typeof CleanupScopeSchema>;

export interface CleanupTarget {
  scopes: CleanupScope[];
  path: string;
  exists: boolean;
  files: number;
  directories: number;
  bytes: number;
  warnings: string[];
}

export interface CleanupPlan {
  targets: CleanupTarget[];
  totals: {
    files: number;
    directories: number;
    bytes: number;
  };
}

export interface BuildCleanupPlanOptions {
  cwd: string;
  scopes: CleanupScope[];
  homeDirectory?: string;
  projectDirectory?: string;
}

export interface CleanupResult {
  removed: string[];
  skipped: string[];
}

/** Build a bounded inventory without following symbolic links. */
export function buildCleanupPlan(
  options: BuildCleanupPlanOptions,
): CleanupPlan {
  const scopes = z.array(CleanupScopeSchema).min(1).parse(options.scopes);
  const homeDirectory = resolve(options.homeDirectory ?? homedir());
  const projectDirectory = resolve(options.projectDirectory ?? options.cwd);
  const candidates = scopes.map((scope) => ({
    scope,
    path:
      scope === "user"
        ? join(homeDirectory, ".orbit")
        : join(projectDirectory, ".orbit"),
  }));
  const grouped = new Map<string, { path: string; scopes: CleanupScope[] }>();

  for (const candidate of candidates) {
    assertSafeOrbitDataPath(candidate.path);
    const key = pathIdentity(candidate.path);
    const existing = grouped.get(key);
    if (existing) {
      if (!existing.scopes.includes(candidate.scope)) {
        existing.scopes.push(candidate.scope);
      }
    } else {
      grouped.set(key, { path: candidate.path, scopes: [candidate.scope] });
    }
  }

  const targets = [...grouped.values()].map((candidate) => ({
    ...candidate,
    ...inspectPath(candidate.path),
  }));
  return {
    targets,
    totals: targets.reduce(
      (totals, target) => ({
        files: totals.files + target.files,
        directories: totals.directories + target.directories,
        bytes: totals.bytes + target.bytes,
      }),
      { files: 0, directories: 0, bytes: 0 },
    ),
  };
}

/** Apply a previously displayed cleanup plan after revalidating every target. */
export function executeCleanupPlan(plan: CleanupPlan): CleanupResult {
  const result: CleanupResult = { removed: [], skipped: [] };
  for (const target of plan.targets) {
    assertSafeOrbitDataPath(target.path);
    let stat: Stats;
    try {
      stat = lstatSync(target.path);
    } catch (error: unknown) {
      if (!isMissingPathError(error)) {
        throw new Error(
          `Unable to verify cleanup target (${safeInventoryWarning(target.path, error)}).`,
          { cause: error },
        );
      }
      result.skipped.push(target.path);
      continue;
    }
    if (stat.isSymbolicLink()) {
      unlinkSync(target.path);
    } else {
      rmSync(target.path, { recursive: true, force: true, maxRetries: 3 });
    }
    result.removed.push(target.path);
  }
  return result;
}

function inspectPath(
  targetPath: string,
): Omit<CleanupTarget, "path" | "scopes"> {
  let targetStat: Stats;
  try {
    targetStat = lstatSync(targetPath);
  } catch (error: unknown) {
    if (!isMissingPathError(error)) {
      return {
        exists: true,
        files: 0,
        directories: 0,
        bytes: 0,
        warnings: [safeInventoryWarning(targetPath, error)],
      };
    }
    return {
      exists: false,
      files: 0,
      directories: 0,
      bytes: 0,
      warnings: [],
    };
  }

  const totals = { files: 0, directories: 0, bytes: 0 };
  const warnings: string[] = [];
  const visit = (currentPath: string, knownStat?: Stats): void => {
    let stat: Stats;
    if (knownStat) {
      stat = knownStat;
    } else {
      try {
        stat = lstatSync(currentPath);
      } catch (error) {
        warnings.push(safeInventoryWarning(currentPath, error));
        return;
      }
    }
    if (stat.isSymbolicLink()) {
      totals.files++;
      totals.bytes += stat.size;
      return;
    }
    if (!stat.isDirectory()) {
      totals.files++;
      totals.bytes += stat.size;
      return;
    }
    totals.directories++;
    try {
      for (const entry of readdirSync(currentPath)) {
        visit(join(currentPath, entry));
      }
    } catch (error) {
      warnings.push(safeInventoryWarning(currentPath, error));
    }
  };

  visit(targetPath, targetStat);
  return { exists: true, ...totals, warnings };
}

function assertSafeOrbitDataPath(targetPath: string): void {
  const absolutePath = resolve(targetPath);
  if (absolutePath === parse(absolutePath).root) {
    throw new Error("Refusing to clean a filesystem root.");
  }
  if (basename(absolutePath).toLowerCase() !== ".orbit") {
    throw new Error("Cleanup targets must be an Orbit data directory.");
  }
  const parentPath = resolve(absolutePath, "..");
  if (parentPath === parse(absolutePath).root) {
    throw new Error(
      "Refusing to clean an Orbit directory directly under a filesystem root.",
    );
  }
  try {
    const canonicalParent = realpathSync.native(parentPath);
    if (canonicalParent === parse(canonicalParent).root) {
      throw new Error(
        "Refusing to clean an Orbit directory through a filesystem-root link.",
      );
    }
  } catch (error: unknown) {
    if (!isMissingPathError(error)) throw error;
  }
}

function pathIdentity(targetPath: string): string {
  const normalized = resolve(targetPath).replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function safeInventoryWarning(targetPath: string, error: unknown): string {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "unreadable";
  return `${code}: ${targetPath}`;
}
