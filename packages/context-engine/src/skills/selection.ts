import type { OrbitConfig } from "@orbit-build/config";
import {
  EXPLICIT_SCORE,
  MIN_AUTO_SCORE,
  MIN_AUTO_MATCHED_TERMS,
  NAME_MENTION_SCORE,
  STOPWORDS,
  STRONG_TERM_MIN_LENGTH,
  STRONG_TERM_SCORE,
  WEAK_TERM_SCORE,
} from "./constants.js";
import { truncateUtf8 } from "./parser.js";
import type { ActiveSkill, RegisteredSkill } from "./types.js";
import { excludesSkill, invocationText } from "./invocation.js";

/**
 * Select bounded active skills for one turn. Explicit invocation markers
 * ($name, skill:name, 技能:name) always win; otherwise skills are scored
 * by lexical overlap between the query and the skill's name + description,
 * with a floor so a single incidental token cannot activate a skill.
 */
export function selectSkills(
  skills: RegisteredSkill[],
  userQuery: string | undefined,
  config: OrbitConfig["skills"],
): ActiveSkill[] {
  const query = normalize(invocationText(userQuery || ""));
  if (!query || !config.enabled || config.maxActive <= 0) return [];
  const queryTerms = terms(query);

  const ranked = skills
    .filter(
      (skill) =>
        !skill.disabled &&
        skill.reviewStatus !== "draft" &&
        !excludesSkill(query, skill.name),
    )
    .map((skill) => {
      const name = skill.name.toLowerCase();
      const explicit = hasExplicitMarker(query, name);
      let score = explicit ? EXPLICIT_SCORE : 0;
      let matchedTerms = 0;
      const nameMentioned = mentionsName(query, name);
      if (
        !explicit &&
        config.activation === "auto" &&
        skill.allowImplicitInvocation
      ) {
        const metadata = normalize(`${skill.name} ${skill.description}`);
        const metadataTerms = new Set(terms(metadata));
        for (const term of queryTerms) {
          if (metadataTerms.has(term)) {
            matchedTerms += 1;
            score +=
              term.length >= STRONG_TERM_MIN_LENGTH
                ? STRONG_TERM_SCORE
                : WEAK_TERM_SCORE;
          }
        }
        if (nameMentioned) score += NAME_MENTION_SCORE;
        if (
          score < MIN_AUTO_SCORE ||
          (!nameMentioned && matchedTerms < MIN_AUTO_MATCHED_TERMS)
        ) {
          score = 0;
        }
      }
      return { skill, explicit, score, matchedTerms, nameMentioned };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.skill.name.localeCompare(right.skill.name),
    );
  const explicit = ranked.filter((candidate) => candidate.explicit);
  const automatic = ranked
    .filter((candidate) => !candidate.explicit)
    .slice(0, Math.max(0, config.maxActive - explicit.length));

  return [...explicit, ...automatic]
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.skill.name.localeCompare(right.skill.name),
    )
    .map(({ skill, explicit, matchedTerms, nameMentioned }): ActiveSkill => {
      const limit = explicit
        ? config.maxSkillBytes
        : Math.min(config.maxAutoSkillBytes, config.maxSkillBytes);
      const bounded = truncateUtf8(skill.content, limit);
      return {
        name: skill.name,
        description: skill.description,
        path: skill.path,
        content: bounded.text,
        activation: explicit ? ("explicit" as const) : ("auto" as const),
        activationReason: explicit
          ? "explicit-marker"
          : nameMentioned
            ? "name-match"
            : "metadata-match",
        matchedTerms,
        loadedBytes: bounded.bytes,
        truncated: skill.truncated || bounded.truncated,
        truncationReason: skill.truncated
          ? "skill-size-limit"
          : bounded.truncated
            ? explicit
              ? "skill-size-limit"
              : "auto-size-limit"
            : undefined,
        rootDir: skill.rootDir,
      };
    });
}

/**
 * Word-boundary explicit markers: `$test` must not fire for `$test-runner`,
 * and `skill:release` must not fire for `skill:release-notes`.
 */
export function hasExplicitMarker(query: string, name: string): boolean {
  query = normalize(invocationText(query));
  if (excludesSkill(query, name)) return false;
  const escaped = escapeRegExp(name);
  return [
    new RegExp(`\\$${escaped}(?![a-z0-9-])`, "u"),
    new RegExp(`skill:${escaped}(?![a-z0-9-])`, "u"),
    new RegExp(`技能:${escaped}(?![a-z0-9-])`, "u"),
  ].some((marker) => marker.test(query));
}

export interface SkillSelectionExplanation {
  name: string;
  selected: boolean;
  reason:
    | "disabled-globally"
    | "disabled"
    | "draft"
    | "excluded"
    | "explicit-only"
    | "no-match"
    | "capacity"
    | "explicit-marker"
    | "name-match"
    | "metadata-match";
}

/** Explain selection without persisting or returning user query text. */
export function explainSkillSelection(
  skills: RegisteredSkill[],
  query: string,
  config: OrbitConfig["skills"],
): SkillSelectionExplanation[] {
  const normalized = normalize(invocationText(query));
  const active = new Map(
    selectSkills(skills, query, config).map((skill) => [skill.name, skill]),
  );
  return skills.map((skill) => {
    const chosen = active.get(skill.name);
    let reason: SkillSelectionExplanation["reason"];
    if (!config.enabled || config.maxActive <= 0) reason = "disabled-globally";
    else if (skill.disabled) reason = "disabled";
    else if (skill.reviewStatus === "draft") reason = "draft";
    else if (excludesSkill(normalized, skill.name)) reason = "excluded";
    else if (chosen) reason = chosen.activationReason ?? "explicit-marker";
    else if (selectSkills([skill], query, config).length) reason = "capacity";
    else if (config.activation === "explicit" || !skill.allowImplicitInvocation)
      reason = "explicit-only";
    else reason = "no-match";
    return { name: skill.name, selected: Boolean(chosen), reason };
  });
}

function mentionsName(query: string, name: string): boolean {
  return new RegExp(
    `(?<![a-z0-9-])${escapeRegExp(name)}(?![a-z0-9-])`,
    "u",
  ).test(query);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalize(value: string): string {
  return value.toLocaleLowerCase().normalize("NFKC");
}

/**
 * Tokenize for matching: Latin/numeric tokens of 3+ characters minus
 * stopwords, plus Han character bigrams (and whole runs of up to 4) so
 * Chinese queries match without segmentation.
 */
export function terms(value: string): string[] {
  const output = new Set<string>();
  for (const token of value.match(
    /[a-z0-9][a-z0-9-]{2,}|[\p{Script=Han}]+/gu,
  ) || []) {
    if (/^[\p{Script=Han}]+$/u.test(token)) {
      if (token.length <= 4) output.add(token);
      for (let index = 0; index < token.length - 1; index += 1) {
        output.add(token.slice(index, index + 2));
      }
    } else if (!STOPWORDS.has(token)) {
      output.add(token);
    }
  }
  return [...output];
}
