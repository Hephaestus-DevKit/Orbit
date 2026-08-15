import { SessionStore } from "@orbit-build/session";
import { z } from "zod";
import { createProjectCapability } from "../runtime/CapabilityScaffolder.js";
import { compileWorkflowSkill } from "../runtime/WorkflowCompiler.js";

const WorkflowExportOptionsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(48)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
  description: z.string().trim().min(1).max(240).optional(),
  scope: z.enum(["local", "versioned"]).default("local"),
  json: z.boolean().default(false),
});

export type WorkflowExportOptions = z.input<typeof WorkflowExportOptionsSchema>;

/** Turn an existing redacted session trace into a reviewable project Skill. */
export async function runWorkflowExport(
  cwd: string,
  sessionId: string,
  options: WorkflowExportOptions,
): Promise<{ schemaVersion: 1; name: string; path: string }> {
  const value = WorkflowExportOptionsSchema.parse(options);
  const trace = new SessionStore(cwd).exportTrace(sessionId, {
    includeHistory: false,
  });
  const compiled = compileWorkflowSkill(trace, value.description);
  const created = await createProjectCapability(cwd, {
    kind: "skill",
    name: value.name,
    description: compiled.description,
    instructions: compiled.instructions,
    scope: value.scope,
  });
  const result = {
    schemaVersion: 1 as const,
    name: created.name,
    path: created.path,
  };
  if (value.json) console.log(JSON.stringify(result, null, 2));
  return result;
}
