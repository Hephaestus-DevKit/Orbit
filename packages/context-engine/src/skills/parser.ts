import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { SKILL_NAME_MAX_LENGTH, SKILL_NAME_PATTERN } from "@orbit-build/shared";
import { RECOGNIZED_FOREIGN_KEYS } from "./constants.js";
import { normalizePath } from "./discovery.js";
import type { SkillDiagnostic } from "./types.js";

/**
 * Tolerant frontmatter schema. Orbit acts on `name`, `description`, and
 * `disable-model-invocation`; every other key — including the Claude Code
 * ecosystem's `license`/`allowed-tools`/`metadata` — passes through so a
 * `.claude/skills` directory loads unmodified. Rejecting unknown keys here
 * used to drop every Anthropic-published skill with a cryptic error.
 */
const SkillMetadataSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(SKILL_NAME_MAX_LENGTH)
      .regex(SKILL_NAME_PATTERN),
    description: z.string().trim().min(1).max(2_000),
    "disable-model-invocation": z.boolean().optional(),
  })
  .passthrough();

export interface ParsedSkillFile {
  name: string;
  description: string;
  path: string;
  /** Markdown body with the frontmatter block stripped. */
  content: string;
  loadedBytes: number;
  truncated: boolean;
  /** From `disable-model-invocation`; the sidecar policy can override. */
  allowImplicitInvocation: boolean;
  /** Non-fatal observations (e.g. unrecognized frontmatter keys). */
  warnings: SkillDiagnostic[];
}

export type ParseSkillResult =
  | { skill: ParsedSkillFile }
  | { diagnostic: SkillDiagnostic };

export function parseSkillFile(
  filePath: string,
  raw: string,
  maxBytes: number,
): ParseSkillResult {
  const path = normalizePath(filePath);
  const text = raw.replace(/^\uFEFF/, "");
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) {
    return {
      diagnostic: {
        path,
        severity: "error",
        code: "missing-frontmatter",
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
        path,
        severity: "error",
        code: "invalid-yaml",
        message: `Invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
  const validated = SkillMetadataSchema.safeParse(metadata);
  if (!validated.success) {
    return {
      diagnostic: {
        path,
        severity: "error",
        code: "invalid-metadata",
        message: validated.error.issues
          .map((issue) => issue.message)
          .join("; "),
      },
    };
  }

  const warnings: SkillDiagnostic[] = [];
  const unknownKeys = Object.keys(validated.data).filter(
    (key) =>
      key !== "name" &&
      key !== "description" &&
      key !== "disable-model-invocation" &&
      !RECOGNIZED_FOREIGN_KEYS.has(key),
  );
  if (unknownKeys.length > 0) {
    warnings.push({
      path,
      severity: "warning",
      code: "unknown-keys",
      message: `Ignored unrecognized frontmatter key(s): ${unknownKeys.join(", ")}. The skill still loads.`,
    });
  }

  const body = text.slice(frontmatter[0].length).replace(/^\r?\n/, "");
  const bounded = truncateUtf8(body, maxBytes);
  return {
    skill: {
      name: validated.data.name,
      description: validated.data.description,
      path,
      content: bounded.text,
      loadedBytes: bounded.bytes,
      truncated: bounded.truncated,
      allowImplicitInvocation:
        validated.data["disable-model-invocation"] !== true,
      warnings,
    },
  };
}

export function truncateUtf8(
  value: string,
  maxBytes: number,
): { text: string; bytes: number; truncated: boolean } {
  const source = Buffer.from(value, "utf8");
  if (source.length <= maxBytes) {
    return { text: value, bytes: source.length, truncated: false };
  }
  let text = source.subarray(0, maxBytes).toString("utf8");
  while (text.endsWith("�")) text = text.slice(0, -1);
  return {
    text,
    bytes: Buffer.byteLength(text, "utf8"),
    truncated: true,
  };
}
