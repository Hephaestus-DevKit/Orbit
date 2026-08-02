import { existsSync } from "fs";
import { normalizePath, resolveSafePath } from "@orbit-build/shared";
import type { ToolContext, ToolReadRoot } from "../types.js";

const SKILL_URI_PREFIX = "skill://";
const SKILL_URI_PATTERN = /^skill:\/\/([a-z0-9][a-z0-9-]{0,63})(?:\/(.*))?$/iu;

export interface ParsedSkillUri {
  name: string;
  relativePath: string;
}

export interface SkillResourceRoot extends ToolReadRoot {
  path: string;
}

export function parseSkillUri(value: string): ParsedSkillUri | undefined {
  if (!value.toLowerCase().startsWith(SKILL_URI_PREFIX)) return undefined;
  const match = SKILL_URI_PATTERN.exec(value);
  if (!match) {
    throw new Error(
      `Invalid Skill resource address "${value}". Use skill://<skill-name>/<relative-path>.`,
    );
  }
  return {
    name: match[1].toLowerCase(),
    relativePath: (match[2] || "").replace(/\\/g, "/"),
  };
}

export function resolveSkillRoot(
  ctx: ToolContext,
  skillName: string,
): SkillResourceRoot {
  const root = normalizedReadRoots(ctx).find(
    (candidate) => candidate.name.toLowerCase() === skillName.toLowerCase(),
  );
  if (!root) {
    throw new Error(
      `Skill resource access denied: "${skillName}" is not active for this turn.`,
    );
  }
  return root;
}

export function resolveSkillResource(
  ctx: ToolContext,
  uri: ParsedSkillUri,
): { root: SkillResourceRoot; path: string } {
  const root = resolveSkillRoot(ctx, uri.name);
  return {
    root,
    path: resolveSafePath(root.path, uri.relativePath || "."),
  };
}

export function resolveReadableFile(
  ctx: ToolContext,
  inputPath: string,
): string {
  const skillUri = parseSkillUri(inputPath);
  if (skillUri) return resolveSkillResource(ctx, skillUri).path;

  const fromRoots = (): string | undefined => {
    for (const root of normalizedReadRoots(ctx)) {
      try {
        const candidate = resolveSafePath(root.path, inputPath);
        if (existsSync(candidate)) return candidate;
      } catch {
        // Try the next active Skill root.
      }
    }
    return undefined;
  };

  try {
    const workspacePath = resolveSafePath(ctx.cwd, inputPath);
    if (existsSync(workspacePath)) return workspacePath;
    return fromRoots() ?? workspacePath;
  } catch (workspaceError) {
    const fallback = fromRoots();
    if (fallback) return fallback;
    throw workspaceError;
  }
}

export function skillResourceUri(
  skillName: string,
  relativePath: string,
): string {
  const normalized = normalizePath(relativePath).replace(/^\/+/, "");
  return normalized
    ? `${SKILL_URI_PREFIX}${skillName}/${normalized}`
    : `${SKILL_URI_PREFIX}${skillName}`;
}

function normalizedReadRoots(ctx: ToolContext): SkillResourceRoot[] {
  return (ctx.readRoots ?? []).map((root, index) => {
    if (typeof root === "string") {
      return { name: `legacy-${index + 1}`, path: root };
    }
    return { name: root.name, path: root.path };
  });
}
