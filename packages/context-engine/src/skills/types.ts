export interface SkillSummary {
  name: string;
  description: string;
  path: string;
}

export interface ActiveSkill extends SkillSummary {
  content: string;
  activation: "explicit" | "auto";
  loadedBytes: number;
  truncated: boolean;
  /** Directory containing SKILL.md; grants read access to bundled files. */
  rootDir: string;
}

/** Stable machine-readable reasons a skill or directory was flagged. */
export type SkillDiagnosticCode =
  | "missing-frontmatter"
  | "invalid-yaml"
  | "invalid-metadata"
  | "unknown-keys"
  | "duplicate-skill"
  | "unreadable-directory"
  | "discovery-limit"
  | "oversized-file"
  | "missing-resource"
  | "unsafe-resource"
  | "oversized-resource"
  | "bundle-limit"
  | "presentation-warning"
  | "read-error";

export interface SkillDiagnostic {
  path: string;
  severity: "warning" | "error";
  code: SkillDiagnosticCode;
  message: string;
}

export interface RegisteredSkill extends SkillSummary {
  /** Markdown body with the frontmatter block stripped. */
  content: string;
  loadedBytes: number;
  truncated: boolean;
  disabled: boolean;
  displayName?: string;
  shortDescription?: string;
  defaultPrompt?: string;
  allowImplicitInvocation: boolean;
  /** Directory containing SKILL.md; the root for bundled resource reads. */
  rootDir: string;
}

export interface SkillCatalog {
  skills: RegisteredSkill[];
  diagnostics: SkillDiagnostic[];
  directories: string[];
}
