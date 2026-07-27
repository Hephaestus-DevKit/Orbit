/**
 * The single source of truth for skill identifiers. Config validation, the
 * discovery parser, the WebUI capability creator, and the CLI all reference
 * these values; before this constant existed the same rule lived in five
 * places with three different length limits.
 */
export const SKILL_NAME_MAX_LENGTH = 64;

/** Lowercase alphanumeric with inner hyphens, e.g. `code-review`. */
export const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function isValidSkillName(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= SKILL_NAME_MAX_LENGTH &&
    SKILL_NAME_PATTERN.test(value)
  );
}
