import { basename, join } from "path";
import { getGitBranch, resolveSafePath } from "@orbit-build/shared";

/** Returns a branch-isolated Orbit cache path for the current workspace. */
export function getOrbitCachePath(cwd: string, fileName: string): string {
  if (
    basename(fileName) !== fileName
    || fileName === "."
    || fileName === ".."
  ) {
    throw new Error(`Invalid Orbit cache file name: "${fileName}"`);
  }
  const branchName = getGitBranch(cwd);
  const relativePath = branchName
    ? join(".orbit", "branches", branchName, fileName)
    : join(".orbit", fileName);
  return resolveSafePath(cwd, relativePath);
}
