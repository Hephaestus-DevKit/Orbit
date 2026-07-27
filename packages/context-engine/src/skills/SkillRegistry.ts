import { dirname } from "path";
import { promises as fs } from "fs";
import type { OrbitConfig } from "@orbit-build/config";
import { MAX_SKILL_FILE_BYTES } from "./constants.js";
import {
  findSkillFiles,
  normalizePath,
  resolveSkillDirectories,
} from "./discovery.js";
import { parseSkillFile } from "./parser.js";
import { loadSkillPresentation } from "./presentation.js";
import type {
  RegisteredSkill,
  SkillCatalog,
  SkillDiagnostic,
} from "./types.js";

/**
 * Discover and validate skills across the configured directories.
 * Orchestrates discovery → parsing → presentation → dedup; each stage lives
 * in its own module so matching policy, file I/O, and format tolerance can
 * evolve independently.
 */
export async function discoverSkills(
  cwd: string,
  config: OrbitConfig["skills"],
): Promise<SkillCatalog> {
  const directories = resolveSkillDirectories(cwd, config.directories);
  const diagnostics: SkillDiagnostic[] = [];
  const loaded: RegisteredSkill[] = [];
  const disabled = new Set(
    (config.disabled || []).map((name) => name.toLowerCase()),
  );

  for (const directory of directories) {
    const search = await findSkillFiles(directory);
    diagnostics.push(...search.diagnostics);
    for (const filePath of search.files) {
      try {
        const stats = await fs.stat(filePath);
        if (stats.size > MAX_SKILL_FILE_BYTES) {
          diagnostics.push({
            path: normalizePath(filePath),
            severity: "error",
            code: "oversized-file",
            message: `SKILL.md is ${stats.size} bytes; files above ${MAX_SKILL_FILE_BYTES} bytes are skipped.`,
          });
          continue;
        }
        const raw = await fs.readFile(filePath, "utf8");
        const parsed = parseSkillFile(filePath, raw, config.maxSkillBytes);
        if ("diagnostic" in parsed) {
          diagnostics.push(parsed.diagnostic);
          continue;
        }
        const presentation = await loadSkillPresentation(filePath);
        if (presentation.diagnostic) {
          diagnostics.push(presentation.diagnostic);
        }
        const { warnings, ...skill } = parsed.skill;
        diagnostics.push(...warnings);
        loaded.push({
          ...skill,
          ...presentation.metadata,
          allowImplicitInvocation:
            presentation.metadata.allowImplicitInvocation ??
            parsed.skill.allowImplicitInvocation,
          disabled: disabled.has(parsed.skill.name.toLowerCase()),
          rootDir: normalizePath(dirname(filePath)),
        });
      } catch (error: unknown) {
        diagnostics.push({
          path: normalizePath(filePath),
          severity: "error",
          code: "read-error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const unique = new Map<string, RegisteredSkill>();
  for (const skill of loaded) {
    const key = skill.name.toLowerCase();
    const existing = unique.get(key);
    if (existing) {
      diagnostics.push({
        path: skill.path,
        severity: "warning",
        code: "duplicate-skill",
        message: `Duplicate skill "${skill.name}" ignored; using ${existing.path}.`,
      });
      continue;
    }
    unique.set(key, skill);
  }

  return {
    skills: [...unique.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    diagnostics,
    directories: directories.map(normalizePath),
  };
}
