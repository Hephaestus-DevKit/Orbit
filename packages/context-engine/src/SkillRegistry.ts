import { dirname, isAbsolute, join, resolve } from "path";
import { homedir } from "os";
import { promises as fs } from "fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { OrbitConfig } from "@orbit-build/config";
import type { ActiveSkill, SkillSummary } from "./types.js";

const SkillMetadataSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9-]*$/),
    description: z.string().trim().min(1).max(2_000),
  })
  .strict();

const SkillPresentationSchema = z
  .object({
    interface: z
      .object({
        display_name: z.string().trim().min(1).max(100).optional(),
        short_description: z.string().trim().min(1).max(200).optional(),
        default_prompt: z.string().trim().min(1).max(2_000).optional(),
      })
      .passthrough()
      .optional(),
    policy: z
      .object({
        allow_implicit_invocation: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export interface SkillDiagnostic {
  path: string;
  severity: "warning" | "error";
  message: string;
}

export interface RegisteredSkill extends SkillSummary {
  content: string;
  loadedBytes: number;
  truncated: boolean;
  disabled: boolean;
  displayName?: string;
  shortDescription?: string;
  defaultPrompt?: string;
  allowImplicitInvocation: boolean;
}

export interface SkillCatalog {
  skills: RegisteredSkill[];
  diagnostics: SkillDiagnostic[];
  directories: string[];
}

/** Discover and validate skills without loading optional bundled resources. */
export async function discoverSkills(
  cwd: string,
  config: OrbitConfig["skills"],
): Promise<SkillCatalog> {
  const directories = Array.from(new Set(config.directories)).map((directory) =>
    resolveSkillDirectory(cwd, directory),
  );
  const diagnostics: SkillDiagnostic[] = [];
  const loaded: RegisteredSkill[] = [];
  const disabled = new Set(
    (config.disabled || []).map((name) => name.toLowerCase()),
  );

  for (const directory of directories) {
    for (const filePath of await findSkillFiles(directory)) {
      try {
        const raw = await fs.readFile(filePath, "utf8");
        const parsed = parseSkill(filePath, raw, config.maxSkillBytes);
        if ("diagnostic" in parsed) {
          diagnostics.push(parsed.diagnostic);
          continue;
        }
        const presentation = await loadSkillPresentation(filePath);
        if (presentation.diagnostic) {
          diagnostics.push(presentation.diagnostic);
        }
        loaded.push({
          ...parsed.skill,
          ...presentation.metadata,
          allowImplicitInvocation:
            presentation.metadata.allowImplicitInvocation ?? true,
          disabled: disabled.has(parsed.skill.name.toLowerCase()),
        });
      } catch (error: unknown) {
        diagnostics.push({
          path: normalizePath(filePath),
          severity: "error",
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

/** Select bounded active skills using explicit names or metadata relevance. */
export function selectSkills(
  skills: RegisteredSkill[],
  userQuery: string | undefined,
  config: OrbitConfig["skills"],
): ActiveSkill[] {
  const query = normalize(userQuery || "");
  if (!query || config.maxActive <= 0) return [];
  const queryTerms = terms(query);

  return skills
    .filter((skill) => !skill.disabled)
    .map((skill) => {
      const name = skill.name.toLowerCase();
      const explicit = [`$${name}`, `skill:${name}`, `技能:${name}`].some(
        (marker) => query.includes(marker),
      );
      let score = explicit ? 10_000 : 0;
      if (
        !explicit &&
        config.activation === "auto" &&
        skill.allowImplicitInvocation
      ) {
        const metadata = normalize(`${skill.name} ${skill.description}`);
        const metadataTerms = new Set(terms(metadata));
        for (const term of queryTerms) {
          if (metadataTerms.has(term)) score += term.length >= 5 ? 3 : 1;
        }
        if (query.includes(name)) score += 8;
      }
      return { skill, explicit, score };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.skill.name.localeCompare(right.skill.name),
    )
    .slice(0, config.maxActive)
    .map(({ skill, explicit }) => {
      const limit = explicit
        ? config.maxSkillBytes
        : Math.min(config.maxAutoSkillBytes, config.maxSkillBytes);
      const bounded = truncateUtf8(skill.content, limit);
      return {
        name: skill.name,
        description: skill.description,
        path: skill.path,
        content: bounded.text,
        activation: explicit ? "explicit" : "auto",
        loadedBytes: bounded.bytes,
        truncated: skill.truncated || bounded.truncated,
      };
    });
}

function parseSkill(
  filePath: string,
  raw: string,
  maxBytes: number,
):
  | {
      skill: Omit<
        RegisteredSkill,
        | "disabled"
        | "displayName"
        | "shortDescription"
        | "defaultPrompt"
        | "allowImplicitInvocation"
      >;
    }
  | { diagnostic: SkillDiagnostic } {
  const text = raw.replace(/^\uFEFF/, "");
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) {
    return {
      diagnostic: {
        path: normalizePath(filePath),
        severity: "error",
        message:
          "SKILL.md requires YAML frontmatter with name and description.",
      },
    };
  }
  let metadata: unknown;
  try {
    metadata = parseYaml(frontmatter[1]);
  } catch (error: unknown) {
    return {
      diagnostic: {
        path: normalizePath(filePath),
        severity: "error",
        message: `Invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
  const validated = SkillMetadataSchema.safeParse(metadata);
  if (!validated.success) {
    return {
      diagnostic: {
        path: normalizePath(filePath),
        severity: "error",
        message: validated.error.issues
          .map((issue) => issue.message)
          .join("; "),
      },
    };
  }
  const bounded = truncateUtf8(text, maxBytes);
  return {
    skill: {
      name: validated.data.name,
      description: validated.data.description,
      path: normalizePath(filePath),
      content: bounded.text,
      loadedBytes: bounded.bytes,
      truncated: bounded.truncated,
    },
  };
}

async function loadSkillPresentation(filePath: string): Promise<{
  metadata: Partial<
    Pick<
      RegisteredSkill,
      | "displayName"
      | "shortDescription"
      | "defaultPrompt"
      | "allowImplicitInvocation"
    >
  >;
  diagnostic?: SkillDiagnostic;
}> {
  const metadataPath = join(dirname(filePath), "agents", "openai.yaml");
  let raw: string;
  try {
    raw = await fs.readFile(metadataPath, "utf8");
  } catch (error: unknown) {
    if (isFileMissing(error)) return { metadata: {} };
    return {
      metadata: {},
      diagnostic: {
        path: normalizePath(metadataPath),
        severity: "warning",
        message: `Skill UI metadata could not be read: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }

  try {
    const validated = SkillPresentationSchema.safeParse(parseYaml(raw));
    if (!validated.success) {
      return {
        metadata: {},
        diagnostic: {
          path: normalizePath(metadataPath),
          severity: "warning",
          message: `Invalid Skill UI metadata: ${validated.error.issues.map((issue) => issue.message).join("; ")}`,
        },
      };
    }
    return {
      metadata: {
        displayName: validated.data.interface?.display_name,
        shortDescription: validated.data.interface?.short_description,
        defaultPrompt: validated.data.interface?.default_prompt,
        allowImplicitInvocation:
          validated.data.policy?.allow_implicit_invocation,
      },
    };
  } catch (error: unknown) {
    return {
      metadata: {},
      diagnostic: {
        path: normalizePath(metadataPath),
        severity: "warning",
        message: `Invalid Skill UI metadata YAML: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
}

function isFileMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function truncateUtf8(
  value: string,
  maxBytes: number,
): { text: string; bytes: number; truncated: boolean } {
  const source = Buffer.from(value, "utf8");
  if (source.length <= maxBytes) {
    return { text: value, bytes: source.length, truncated: false };
  }
  let text = source.subarray(0, maxBytes).toString("utf8");
  while (text.endsWith("\uFFFD")) text = text.slice(0, -1);
  return {
    text,
    bytes: Buffer.byteLength(text, "utf8"),
    truncated: true,
  };
}

function resolveSkillDirectory(cwd: string, directory: string): string {
  if (directory === "~") return homedir();
  if (directory.startsWith("~/") || directory.startsWith("~\\")) {
    return resolve(homedir(), directory.slice(2));
  }
  return isAbsolute(directory) ? resolve(directory) : resolve(cwd, directory);
}

async function findSkillFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  const queue = [root];
  const ignored = new Set(["node_modules", ".git", "dist", "build"]);
  while (queue.length > 0 && results.length < 200) {
    const directory = queue.shift()!;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !ignored.has(entry.name)) {
        queue.push(join(directory, entry.name));
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        results.push(join(directory, entry.name));
      }
    }
  }
  return results;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().normalize("NFKC");
}

function terms(value: string): string[] {
  const output = new Set<string>();
  for (const token of value.match(
    /[a-z0-9][a-z0-9-]{2,}|[\p{Script=Han}]+/gu,
  ) || []) {
    if (/^[\p{Script=Han}]+$/u.test(token)) {
      if (token.length <= 4) output.add(token);
      for (let index = 0; index < token.length - 1; index += 1) {
        output.add(token.slice(index, index + 2));
      }
    } else if (
      !["the", "and", "for", "with", "this", "that", "use"].includes(token)
    ) {
      output.add(token);
    }
  }
  return [...output];
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}
