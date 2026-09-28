import { z } from "zod";
import { isValidSkillName } from "@orbit-build/shared";

const Id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/);
export const WorkflowArtifactPathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (path) =>
      !path.includes("\\") &&
      !path.includes(":") &&
      !/[<>"|?*]/.test(path) &&
      !Array.from(path).some((character) => character.charCodeAt(0) < 32) &&
      !path.startsWith("/") &&
      !path
        .split("/")
        .some(
          (part) =>
            !part ||
            part === "." ||
            part === ".." ||
            /[. ]$/.test(part) ||
            /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) ||
            [".git", ".orbit", ".agents", ".codex"].includes(
              part.toLowerCase(),
            ),
        ),
    "Artifacts must be workspace-relative files outside protected runtime directories.",
  );
export const WorkflowStageSchema = z
  .object({
    id: Id,
    title: z.string().trim().min(1).max(120),
    prompt: z.string().trim().min(1).max(12000),
    skills: z.array(z.string().refine(isValidSkillName)).max(8).default([]),
    verification: z.boolean().default(false),
    artifacts: z.array(WorkflowArtifactPathSchema).max(20).default([]),
  })
  .strict();
export const WorkflowStagesSchema = z
  .array(WorkflowStageSchema)
  .min(1)
  .max(12)
  .refine(
    (stages) => new Set(stages.map((stage) => stage.id)).size === stages.length,
    "Stage IDs must be unique.",
  )
  .refine(
    (stages) =>
      stages.every((stage) => stage.verification || stage.artifacts.length > 0),
    "Every stage must declare verification or at least one artifact gate.",
  )
  .refine((stages) => {
    const paths = stages.flatMap((stage) =>
      stage.artifacts.map((path) => path.toLowerCase()),
    );
    return new Set(paths).size === paths.length;
  }, "Stage artifacts must be distinct; completed artifacts are immutable.");
export type WorkflowStage = z.infer<typeof WorkflowStageSchema>;
/** Unique dependencies required across the supplied stages. */
export function workflowSkillDependencies(
  skills: string[],
  stages: WorkflowStage[] = [],
): string[] {
  return [...new Set([...skills, ...stages.flatMap((stage) => stage.skills)])];
}
const EvidenceSchema = z.object({
  path: WorkflowArtifactPathSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const WorkflowRunSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^wf_[a-f0-9-]{36}$/),
    command: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/),
    definitionHash: z.string().regex(/^[a-f0-9]{64}$/),
    sessionId: z.string().min(1).max(200),
    input: z.string().max(20000),
    status: z.enum([
      "running",
      "failed",
      "interrupted",
      "completed",
      "cancelled",
    ]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    stages: z
      .array(
        z.object({
          id: Id,
          status: z.enum([
            "pending",
            "running",
            "failed",
            "interrupted",
            "completed",
          ]),
          attempts: z.number().int().nonnegative().max(1000),
          verification: z
            .enum(["passed", "failed", "not_run"])
            .default("not_run"),
          artifacts: z.array(EvidenceSchema).max(20),
          error: z.string().max(2000).optional(),
        }),
      )
      .min(1)
      .max(12),
  })
  .strict();
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;
