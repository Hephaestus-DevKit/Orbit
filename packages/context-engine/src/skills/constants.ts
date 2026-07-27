/** Directory names never descended into while searching for SKILL.md. */
export const IGNORED_DIRECTORY_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
]);

/** Hard cap on discovered SKILL.md files per run; hitting it is diagnosed. */
export const MAX_SKILL_FILES = 200;

/** Refuse to read pathological files instead of materializing them fully. */
export const MAX_SKILL_FILE_BYTES = 1024 * 1024;

/** Presentation sidecar location relative to the skill directory. */
export const PRESENTATION_SIDECAR_SEGMENTS = ["agents", "openai.yaml"] as const;

/**
 * Frontmatter keys from the Claude Code skill format that Orbit recognizes
 * but does not act on. Their presence must never reject a skill — the
 * `.claude/skills` directories are first-class discovery roots.
 */
export const RECOGNIZED_FOREIGN_KEYS = new Set([
  "license",
  "allowed-tools",
  "metadata",
  "version",
  "model",
  "argument-hint",
  "context",
  "agent",
  "user-facing-name",
  "when-to-use",
  "disable-model-invocation",
]);

/** English tokens too generic to carry activation signal. */
export const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "use",
]);

/**
 * Activation scoring. An explicit marker always wins; auto activation needs
 * MIN_AUTO_SCORE so a single 3-character token overlap cannot pull an
 * unrelated skill (and its byte budget) into the turn.
 */
export const EXPLICIT_SCORE = 10_000;
export const STRONG_TERM_SCORE = 3;
export const WEAK_TERM_SCORE = 1;
export const NAME_MENTION_SCORE = 8;
export const STRONG_TERM_MIN_LENGTH = 5;
export const MIN_AUTO_SCORE = 3;
