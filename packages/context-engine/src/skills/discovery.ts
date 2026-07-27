import { isAbsolute, join, resolve } from "path";
import { homedir } from "os";
import { promises as fs } from "fs";
import { IGNORED_DIRECTORY_NAMES, MAX_SKILL_FILES } from "./constants.js";
import type { SkillDiagnostic } from "./types.js";

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function resolveSkillDirectory(cwd: string, directory: string): string {
  if (directory === "~") return homedir();
  if (directory.startsWith("~/") || directory.startsWith("~\\")) {
    return resolve(homedir(), directory.slice(2));
  }
  return isAbsolute(directory) ? resolve(directory) : resolve(cwd, directory);
}

/**
 * Resolve configured directories against cwd and home, deduplicating on the
 * resolved path so `.orbit/skills` and `~/.orbit/skills` collapse when cwd
 * is the home directory instead of producing duplicate-skill warnings.
 */
export function resolveSkillDirectories(
  cwd: string,
  directories: string[],
): string[] {
  const resolved = new Map<string, string>();
  for (const directory of directories) {
    const path = resolveSkillDirectory(cwd, directory);
    const key = normalizePath(path).toLowerCase();
    if (!resolved.has(key)) resolved.set(key, path);
  }
  return [...resolved.values()];
}

export interface SkillFileSearch {
  files: string[];
  diagnostics: SkillDiagnostic[];
}

/**
 * Breadth-first search for files literally named SKILL.md. Unreadable
 * subdirectories and a hit of the discovery cap are reported instead of
 * silently swallowed; a missing root is normal and stays quiet.
 */
export async function findSkillFiles(root: string): Promise<SkillFileSearch> {
  const files: string[] = [];
  const diagnostics: SkillDiagnostic[] = [];
  const queue = [root];
  while (queue.length > 0) {
    if (files.length >= MAX_SKILL_FILES) {
      diagnostics.push({
        path: normalizePath(root),
        severity: "warning",
        code: "discovery-limit",
        message: `Skill discovery stopped after ${MAX_SKILL_FILES} SKILL.md files; remaining directories were not scanned.`,
      });
      break;
    }
    const directory = queue.shift()!;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error: unknown) {
      if (directory !== root || !isMissing(error)) {
        diagnostics.push({
          path: normalizePath(directory),
          severity: "warning",
          code: "unreadable-directory",
          message: `Skill directory could not be read: ${message(error)}`,
        });
      }
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !IGNORED_DIRECTORY_NAMES.has(entry.name)) {
        queue.push(join(directory, entry.name));
      } else if (
        entry.isFile() &&
        entry.name === "SKILL.md" &&
        files.length < MAX_SKILL_FILES
      ) {
        files.push(join(directory, entry.name));
      }
    }
  }
  return { files, diagnostics };
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
