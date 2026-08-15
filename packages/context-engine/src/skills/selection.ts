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
  const query = normalize(userQuery || "");
  if (!query || config.maxActive <= 0) return [];
  const queryTerms = terms(query);

  const ranked = skills
    .filter((skill) => !skill.disabled)
    .map((skill) => {
      const name = skill.name.toLowerCase();
      const explicit = hasExplicitMarker(query, name);
      let score = explicit ? EXPLICIT_SCORE : 0;
      if (
        !explicit &&
        config.activation === "auto" &&
        skill.allowImplicitInvocation
      ) {
        const metadata = normalize(`${skill.name} ${skill.description}`);
        const metadataTerms = new Set(terms(metadata));
        let matchedTerms = 0;
        for (const term of queryTerms) {
          if (metadataTerms.has(term)) {
            matchedTerms += 1;
            score +=
              term.length >= STRONG_TERM_MIN_LENGTH
                ? STRONG_TERM_SCORE
                : WEAK_TERM_SCORE;
          }
        }
        const nameMentioned = mentionsName(query, name);
        if (nameMentioned) score += NAME_MENTION_SCORE;
        if (
          score < MIN_AUTO_SCORE ||
          (!nameMentioned && matchedTerms < MIN_AUTO_MATCHED_TERMS)
        ) {
          score = 0;
        }
      }
      return { skill, explicit, score };
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
        activation: explicit ? ("explicit" as const) : ("auto" as const),
        loadedBytes: bounded.bytes,
        truncated: skill.truncated || bounded.truncated,
        rootDir: skill.rootDir,
      };
    });
}

/**
 * Word-boundary explicit markers: `$test` must not fire for `$test-runner`,
 * and `skill:release` must not fire for `skill:release-notes`.
 */
export function hasExplicitMarker(query: string, name: string): boolean {
  const escaped = escapeRegExp(name);
  return [
    new RegExp(`\\$${escaped}(?![a-z0-9-])`, "u"),
    new RegExp(`skill:${escaped}(?![a-z0-9-])`, "u"),
    new RegExp(`技能:${escaped}(?![a-z0-9-])`, "u"),
  ].some((marker) => marker.test(query));
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
