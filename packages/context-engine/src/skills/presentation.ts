import { dirname, join } from "path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { readBoundedRegularFile } from "@orbit-build/shared";
import {
  MAX_SKILL_PRESENTATION_BYTES,
  PRESENTATION_SIDECAR_SEGMENTS,
} from "./constants.js";
import { normalizePath } from "./discovery.js";
import type { RegisteredSkill, SkillDiagnostic } from "./types.js";

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
        review_status: z.enum(["draft", "approved"]).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type SkillPresentation = Partial<
  Pick<
    RegisteredSkill,
    | "displayName"
    | "shortDescription"
    | "defaultPrompt"
    | "allowImplicitInvocation"
    | "reviewStatus"
  >
>;

/**
 * Load the optional presentation sidecar next to SKILL.md. Failures are
 * warnings. Unreadable or invalid policy is quarantined until repaired,
 * preventing a damaged draft sidecar from silently enabling execution.
 */
export async function loadSkillPresentation(skillFilePath: string): Promise<{
  metadata: SkillPresentation;
  diagnostic?: SkillDiagnostic;
}> {
  const metadataPath = join(
    dirname(skillFilePath),
    ...PRESENTATION_SIDECAR_SEGMENTS,
  );
  let raw: string;
  try {
    const content = readBoundedRegularFile(
      metadataPath,
      MAX_SKILL_PRESENTATION_BYTES,
    );
    if (content === undefined) return { metadata: {} };
    raw = content;
  } catch (error: unknown) {
    if (isFileMissing(error)) return { metadata: {} };
    return {
      metadata: { reviewStatus: "draft", allowImplicitInvocation: false },
      diagnostic: warning(
        metadataPath,
        `Skill UI metadata could not be read: ${describe(error)}`,
      ),
    };
  }

  try {
    const validated = SkillPresentationSchema.safeParse(parseYaml(raw));
    if (!validated.success) {
      return {
        metadata: { reviewStatus: "draft", allowImplicitInvocation: false },
        diagnostic: warning(
          metadataPath,
          `Invalid Skill UI metadata: ${validated.error.issues.map((issue) => issue.message).join("; ")}`,
        ),
      };
    }
    return {
      metadata: {
        displayName: validated.data.interface?.display_name,
        shortDescription: validated.data.interface?.short_description,
        defaultPrompt: validated.data.interface?.default_prompt,
        allowImplicitInvocation:
          validated.data.policy?.allow_implicit_invocation,
        reviewStatus: validated.data.policy?.review_status,
      },
    };
  } catch (error: unknown) {
    return {
      metadata: { reviewStatus: "draft", allowImplicitInvocation: false },
      diagnostic: warning(
        metadataPath,
        `Invalid Skill UI metadata YAML: ${describe(error)}`,
      ),
    };
  }
}

function warning(path: string, message: string): SkillDiagnostic {
  return {
    path: normalizePath(path),
    severity: "warning",
    code: "presentation-warning",
    message,
  };
}

function isFileMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
