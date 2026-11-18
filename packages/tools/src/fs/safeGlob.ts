import { isAbsolute, relative, win32 } from "path";
import { findMatchingPaths, normalizePath, resolveSafePath } from "@orbit-build/shared";

const IGNORED_DIRECTORIES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
];

interface WorkspaceGlobOptions {
  deep?: number;
  dot?: boolean;
}

/**
 * Accept only glob patterns whose traversal is rooted at the selected search
 * directory. The final resolved paths are validated separately as defense in
 * depth.
 */
export function isWorkspaceRelativeGlob(pattern: string): boolean {
  const candidate = pattern.startsWith("!") ? pattern.slice(1) : pattern;
  const normalized = candidate.replace(/\\/g, "/");
  return (
    candidate.length > 0
    && !isAbsolute(candidate)
    && !win32.isAbsolute(candidate)
    && !normalized.includes("..")
  );
}

/**
 * Discover files without following directory links, then canonicalize every
 * result against the selected root before callers can read or return it.
 */
export async function findWorkspaceFiles(
  root: string,
  pattern: string,
  options: WorkspaceGlobOptions = {},
): Promise<string[]> {
  if (!isWorkspaceRelativeGlob(pattern)) {
    throw new Error("Glob pattern must stay inside the search directory.");
  }

  const files = await findMatchingPaths(pattern, {
    cwd: root,

    ...(options.deep === undefined
      ? {}
      : { deep: Math.max(0, options.deep - 1) }),
    ...(options.dot === undefined ? {} : { dot: options.dot }),
    ignore: IGNORED_DIRECTORIES,

    absolute: true,
  });

  return files.map((file) => resolveSafePath(root, file));
}

export function toRootRelativePath(root: string, file: string): string {
  return normalizePath(relative(root, file));
}
