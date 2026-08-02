import { existsSync, lstatSync, promises as fs } from "fs";
import { dirname, isAbsolute, join, win32 } from "path";
import { parse as parseYaml } from "yaml";
import { readBoundedRegularFile, resolveSafePath } from "@orbit-build/shared";
import {
  MAX_SKILL_BUNDLE_BYTES,
  MAX_SKILL_BUNDLE_ENTRIES,
  MAX_SKILL_BUNDLE_FILE_BYTES,
  MAX_SKILL_FILE_BYTES,
  PRESENTATION_SIDECAR_SEGMENTS,
} from "./constants.js";
import { normalizePath } from "./discovery.js";
import { parseSkillFile } from "./parser.js";
import type {
  RegisteredSkill,
  SkillDiagnostic,
  SkillDiagnosticCode,
} from "./types.js";

const MARKDOWN_LINK_PATTERN = /!?\[[^\]]*\]\(([^)]+)\)/gu;
const BUNDLED_PATH_CODE_PATTERN =
  /`((?:references|scripts|assets)\/[^`\r\n]+)`/gu;

/** Validate the complete bundle behind one already-discovered Skill. */
export async function validateSkillBundle(
  skill: RegisteredSkill,
): Promise<SkillDiagnostic[]> {
  const diagnostics: SkillDiagnostic[] = [];
  const root = dirname(skill.path);
  await validateBundleTree(root, diagnostics);

  let body = skill.content;
  try {
    const raw = readBoundedRegularFile(skill.path, MAX_SKILL_FILE_BYTES);
    if (raw !== undefined) {
      const parsed = parseSkillFile(skill.path, raw, MAX_SKILL_FILE_BYTES);
      if ("skill" in parsed) body = parsed.skill.content;
    }
  } catch {
    // Discovery already reports primary SKILL.md read failures.
  }

  for (const reference of extractBundledResourceReferences(body)) {
    validateReference(skill, reference, diagnostics);
  }
  await validatePresentationAssets(skill, diagnostics);
  return diagnostics;
}

export async function validateSkillCatalogBundles(
  skills: RegisteredSkill[],
): Promise<SkillDiagnostic[]> {
  return (
    await Promise.all(skills.map((skill) => validateSkillBundle(skill)))
  ).flat();
}

export function extractBundledResourceReferences(body: string): string[] {
  const references = new Set<string>();
  for (const match of body.matchAll(MARKDOWN_LINK_PATTERN)) {
    const target = markdownTarget(match[1]);
    if (isBundledReference(target)) references.add(target);
  }
  for (const match of body.matchAll(BUNDLED_PATH_CODE_PATTERN)) {
    const target = match[1].trim();
    if (isBundledReference(target)) references.add(target);
  }
  return [...references];
}

async function validateBundleTree(
  root: string,
  diagnostics: SkillDiagnostic[],
): Promise<void> {
  const queue = [root];
  let entries = 0;
  let bytes = 0;
  while (queue.length > 0) {
    const directory = queue.shift()!;
    let children;
    try {
      children = await fs.readdir(directory, { withFileTypes: true });
    } catch (error: unknown) {
      diagnostics.push(
        diagnostic(
          directory,
          "unsafe-resource",
          `Skill bundle directory could not be read: ${describe(error)}`,
        ),
      );
      continue;
    }
    for (const child of children) {
      const path = join(directory, child.name);
      entries += 1;
      if (entries > MAX_SKILL_BUNDLE_ENTRIES) {
        diagnostics.push(
          diagnostic(
            root,
            "bundle-limit",
            `Skill bundle exceeds ${MAX_SKILL_BUNDLE_ENTRIES} entries.`,
          ),
        );
        return;
      }
      if (child.isSymbolicLink()) {
        diagnostics.push(
          diagnostic(
            path,
            "unsafe-resource",
            "Skill bundles must not contain symbolic links or junctions.",
          ),
        );
        continue;
      }
      if (child.isDirectory()) {
        queue.push(path);
        continue;
      }
      if (!child.isFile()) {
        diagnostics.push(
          diagnostic(
            path,
            "unsafe-resource",
            "Skill bundle contains an unsupported filesystem entry.",
          ),
        );
        continue;
      }
      const stats = await fs.stat(path);
      if (stats.size > MAX_SKILL_BUNDLE_FILE_BYTES) {
        diagnostics.push(
          diagnostic(
            path,
            "oversized-resource",
            `Skill resource exceeds ${MAX_SKILL_BUNDLE_FILE_BYTES} bytes.`,
          ),
        );
      }
      bytes += stats.size;
      if (bytes > MAX_SKILL_BUNDLE_BYTES) {
        diagnostics.push(
          diagnostic(
            root,
            "bundle-limit",
            `Skill bundle exceeds ${MAX_SKILL_BUNDLE_BYTES} total bytes.`,
          ),
        );
        return;
      }
    }
  }
}

function validateReference(
  skill: RegisteredSkill,
  reference: string,
  diagnostics: SkillDiagnostic[],
): void {
  const root = dirname(skill.path);
  let relativePath = reference;
  if (reference.toLowerCase().startsWith("skill://")) {
    const match = /^skill:\/\/([a-z0-9][a-z0-9-]{0,63})(?:\/(.*))?$/iu.exec(
      reference,
    );
    if (!match || match[1].toLowerCase() !== skill.name.toLowerCase()) {
      diagnostics.push(
        diagnostic(
          skill.path,
          "unsafe-resource",
          `Skill resource reference targets another or invalid Skill: ${reference}`,
        ),
      );
      return;
    }
    relativePath = match[2] || "";
  }
  relativePath = stripQueryAndFragment(relativePath);
  try {
    relativePath = decodeURIComponent(relativePath);
  } catch {
    diagnostics.push(
      diagnostic(
        skill.path,
        "unsafe-resource",
        `Skill resource reference is not valid URI text: ${reference}`,
      ),
    );
    return;
  }
  if (!relativePath) return;
  if (isAbsolute(relativePath) || win32.isAbsolute(relativePath)) {
    diagnostics.push(
      diagnostic(
        skill.path,
        "unsafe-resource",
        `Skill resource reference must be bundle-relative: ${reference}`,
      ),
    );
    return;
  }
  try {
    const path = resolveSafePath(root, relativePath);
    if (!readable(path)) {
      diagnostics.push(
        diagnostic(
          path,
          "missing-resource",
          `Referenced Skill resource does not exist: ${reference}`,
        ),
      );
    }
  } catch (error: unknown) {
    diagnostics.push(
      diagnostic(
        skill.path,
        "unsafe-resource",
        `Unsafe Skill resource reference "${reference}": ${describe(error)}`,
      ),
    );
  }
}

async function validatePresentationAssets(
  skill: RegisteredSkill,
  diagnostics: SkillDiagnostic[],
): Promise<void> {
  const presentationPath = join(
    dirname(skill.path),
    ...PRESENTATION_SIDECAR_SEGMENTS,
  );
  let raw: string;
  try {
    raw = await fs.readFile(presentationPath, "utf8");
  } catch {
    return;
  }
  try {
    const parsed = parseYaml(raw) as {
      interface?: { icon_small?: unknown; icon_large?: unknown };
    };
    for (const value of [
      parsed?.interface?.icon_small,
      parsed?.interface?.icon_large,
    ]) {
      if (typeof value === "string" && value.trim()) {
        validateReference(skill, value.trim(), diagnostics);
      }
    }
  } catch {
    // Presentation parsing already emits a focused warning.
  }
}

function markdownTarget(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("<")) {
    const end = trimmed.indexOf(">");
    return end >= 0 ? trimmed.slice(1, end) : trimmed;
  }
  return trimmed.split(/\s+["']/u, 1)[0].trim();
}

function isBundledReference(target: string): boolean {
  const lowered = target.toLowerCase();
  return (
    Boolean(target) &&
    !target.startsWith("#") &&
    !lowered.startsWith("http://") &&
    !lowered.startsWith("https://") &&
    !lowered.startsWith("mailto:") &&
    !lowered.startsWith("data:")
  );
}

function stripQueryAndFragment(value: string): string {
  return value.split(/[?#]/u, 1)[0];
}

function readable(path: string): boolean {
  try {
    if (!existsSync(path)) return false;
    const stats = lstatSync(path);
    return !stats.isSymbolicLink() && (stats.isFile() || stats.isDirectory());
  } catch {
    return false;
  }
}

function diagnostic(
  path: string,
  code: SkillDiagnosticCode,
  message: string,
): SkillDiagnostic {
  return {
    path: normalizePath(path),
    severity: "error",
    code,
    message,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
