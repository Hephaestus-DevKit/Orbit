import { dirname, join, relative, resolve } from "path";
import {
  readBoundedRegularFile,
  resolveSafePath,
  truncateTextToTokenBudget,
} from "@orbit-build/shared";

/** Maximum combined bytes that may enter one model context pack. */
export const PROJECT_INSTRUCTIONS_MAX_BYTES = 1024 * 1024;

/**
 * Ordered instruction conventions understood by Orbit.
 *
 * Orbit-specific guidance is listed first, followed by compatible agent
 * conventions. Keeping the order explicit makes the resulting prompt
 * deterministic when a workspace contains more than one instruction file.
 */
export const PROJECT_INSTRUCTION_CANDIDATES = [
  "ORBIT.md",
  ".agents/AGENTS.md",
  "AGENTS.md",
  "CLAUDE.md",
  ".helix/instructions.md",
  "RUNE.md",
  ".cursorrules",
  ".copilotrules",
] as const;

const SCOPED_INSTRUCTION_CANDIDATES = [
  "ORBIT.md",
  ".agents/AGENTS.md",
  "AGENTS.md",
  "CLAUDE.md",
  ".helix/instructions.md",
  "RUNE.md",
  ".cursorrules",
  ".copilotrules",
] as const;

const INSTRUCTION_FILE_MAX_BYTES = PROJECT_INSTRUCTIONS_MAX_BYTES;

/**
 * Load bounded, labeled workspace guidance without following instruction
 * symlinks. Relevant files may opt into nested instruction scopes, which are
 * ordered after root guidance so the nearest module can refine its rules.
 */
export function loadProjectInstructions(
  cwd: string,
  relevantFiles: readonly string[] = [],
): string {
  const specialized = readInstructionSources(cwd, [
    ...PROJECT_INSTRUCTION_CANDIDATES,
    ...discoverScopedInstructionPaths(cwd, relevantFiles),
  ]);
  if (specialized.length > 0) return renderInstructionSources(specialized);

  // README remains a compatibility fallback for small projects that have no
  // dedicated agent instructions. It is intentionally excluded when a
  // dedicated file exists so product documentation cannot drown out rules.
  const readme = readInstructionSources(cwd, ["README.md"]);
  return renderInstructionSources(readme);
}

function discoverScopedInstructionPaths(
  cwd: string,
  relevantFiles: readonly string[],
): string[] {
  const root = resolve(cwd);
  const discovered = new Set<string>();
  for (const file of relevantFiles) {
    let target: string;
    try {
      target = resolveSafePath(cwd, file);
    } catch {
      continue;
    }
    let directory = dirname(target);
    const ancestors: string[] = [];
    while (true) {
      ancestors.push(directory);
      if (directory === root) break;
      const parent = dirname(directory);
      if (parent === directory || !isWithin(root, parent)) break;
      directory = parent;
    }
    for (const ancestor of ancestors.reverse()) {
      const relativeDirectory = relative(root, ancestor).replace(/\\/g, "/");
      for (const candidate of SCOPED_INSTRUCTION_CANDIDATES) {
        discovered.add(
          relativeDirectory ? `${relativeDirectory}/${candidate}` : candidate,
        );
      }
    }
  }
  return [...discovered].sort((left, right) => {
    const leftDepth = left.split("/").length;
    const rightDepth = right.split("/").length;
    return leftDepth - rightDepth || left.localeCompare(right);
  });
}

function isWithin(root: string, target: string): boolean {
  const relativePath = relative(resolve(root), resolve(target));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !relativePath.includes("/.."))
  );
}

function readInstructionSources(
  cwd: string,
  candidates: readonly string[],
): Array<{ path: string; content: string }> {
  const sources: Array<{ path: string; content: string }> = [];
  const seen = new Set<string>();
  let remainingBytes = PROJECT_INSTRUCTIONS_MAX_BYTES;

  for (const relativePath of candidates) {
    if (remainingBytes <= 0) break;
    const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const path = join(cwd, ...relativePath.split("/"));
    try {
      const content = readBoundedRegularFile(
        path,
        Math.min(INSTRUCTION_FILE_MAX_BYTES, remainingBytes),
      );
      if (content === undefined || content.trim().length === 0) continue;
      const bytes = Buffer.byteLength(content, "utf8");
      if (bytes > remainingBytes) continue;
      sources.push({ path: relativePath, content });
      remainingBytes -= bytes;
    } catch {
      // Missing, oversized, or non-regular instruction files are ignored. A
      // malformed optional convention must never prevent an agent turn.
    }
  }
  return sources;
}

function renderInstructionSources(
  sources: Array<{ path: string; content: string }>,
): string {
  if (sources.length === 0) return "";
  const rendered = sources
    .map(({ path, content }) => {
      const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      return `## Orbit instruction source: ${path}\n${normalized.trim()}`;
    })
    .join("\n\n");
  // Headers are tiny, but the final guard keeps future convention additions
  // bounded even if a caller changes the source list without noticing.
  return truncateTextToTokenBudget(
    rendered,
    Math.ceil(PROJECT_INSTRUCTIONS_MAX_BYTES / 4),
  );
}
