import { dirname, isAbsolute, normalize, relative, resolve } from "path";
import { execSync } from "child_process";
import { HIDDEN_CHILD_PROCESS_OPTIONS } from "./childProcess.js";
import { existsSync, realpathSync } from "fs";

export function normalizePath(p: string): string {
  return normalize(p).replace(/\\/g, "/");
}

export function checkWorkspaceBoundary(
  workspaceRoot: string,
  targetPath: string,
): boolean {
  return isSameOrDescendant(resolve(workspaceRoot), resolve(targetPath));
}

export function resolveSafePath(
  workspaceRoot: string,
  relativeOrAbsolutePath: string,
): string {
  const resolvedPath = isAbsolute(relativeOrAbsolutePath)
    ? resolve(relativeOrAbsolutePath)
    : resolve(workspaceRoot, relativeOrAbsolutePath);

  const safe = checkWorkspaceBoundary(workspaceRoot, resolvedPath);
  if (!safe) {
    throw new Error(
      `Path validation failed: "${relativeOrAbsolutePath}" is outside workspace boundary "${workspaceRoot}"`,
    );
  }

  const resolvedRoot = resolve(workspaceRoot);
  const canonicalRoot = canonicalizeExistingPath(resolvedRoot);
  const canonicalAncestor = canonicalizeNearestExistingPath(resolvedPath);
  if (!isSameOrDescendant(canonicalRoot, canonicalAncestor)) {
    throw new Error(
      `Path validation failed: "${relativeOrAbsolutePath}" resolves through a symbolic link or junction outside workspace boundary "${workspaceRoot}"`,
    );
  }

  return normalizePath(resolvedPath);
}

function canonicalizeExistingPath(filePath: string): string {
  try {
    return realpathSync.native(filePath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to resolve safe path "${filePath}": ${message}`);
  }
}

function canonicalizeNearestExistingPath(filePath: string): string {
  let current = filePath;
  while (true) {
    try {
      return realpathSync.native(current);
    } catch (error: unknown) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : "";
      if (code && code !== "ENOENT" && code !== "ENOTDIR") {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Unable to resolve safe path "${current}": ${message}`);
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Unable to find an existing ancestor for "${filePath}".`);
    }
    current = parent;
  }
}

function isSameOrDescendant(rootPath: string, targetPath: string): boolean {
  const normalizedRoot = normalizeForComparison(rootPath);
  const normalizedTarget = normalizeForComparison(targetPath);
  const relativePath = relative(normalizedRoot, normalizedTarget);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function normalizeForComparison(filePath: string): string {
  const normalized = resolve(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function getGitBranch(cwd: string): string {
  const gitDir = resolve(cwd, ".git");
  if (!existsSync(gitDir)) {
    return "";
  }
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    })
      .toString()
      .trim();
    return branch.replace(/[^a-zA-Z0-9_\-]/g, "_") || "main";
  } catch {
    return "";
  }
}
