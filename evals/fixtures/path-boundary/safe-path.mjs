import { resolve } from "node:path";

export function resolveWorkspacePath(root, requested) {
  const absoluteRoot = resolve(root);
  const candidate = resolve(absoluteRoot, requested);
  if (!candidate.startsWith(absoluteRoot)) {
    throw new Error("path escapes workspace");
  }
  return candidate;
}
