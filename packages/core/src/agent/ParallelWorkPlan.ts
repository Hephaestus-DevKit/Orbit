import { z } from "zod";
import {
  AgentOwnershipScopeSchema,
  agentOwnershipScopesOverlap,
} from "./AgentOwnership.js";

const ParallelWriterTaskSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  task: z.string().trim().min(1).max(20_000),
  scopes: z.array(AgentOwnershipScopeSchema).min(1).max(50),
});

export const ParallelWorkPlanSchema = z
  .object({
    summary: z.string().trim().min(1).max(20_000),
    tasks: z.array(ParallelWriterTaskSchema).min(1).max(4),
  })
  .superRefine((plan, context) => {
    const ids = new Set<string>();
    for (const [index, task] of plan.tasks.entries()) {
      if (ids.has(task.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tasks", index, "id"],
          message: `Duplicate writer task id: ${task.id}`,
        });
      }
      ids.add(task.id);
    }
    if (plan.tasks.length < 2) return;
    for (let left = 0; left < plan.tasks.length; left++) {
      for (let right = left + 1; right < plan.tasks.length; right++) {
        const overlap = plan.tasks[left].scopes.some((leftScope) =>
          plan.tasks[right].scopes.some((rightScope) =>
            agentOwnershipScopesOverlap(leftScope, rightScope),
          ),
        );
        if (!overlap) continue;
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tasks", right, "scopes"],
          message: `Writer scopes overlap with task ${plan.tasks[left].id}.`,
        });
      }
    }
  });

export type ParallelWorkPlan = z.infer<typeof ParallelWorkPlanSchema>;
export type ParallelWriterTask = ParallelWorkPlan["tasks"][number];

/** Parse a planner's bounded JSON response; malformed plans fall back safely. */
export function parseParallelWorkPlan(
  text: string,
): ParallelWorkPlan | undefined {
  const candidate = extractJsonObject(text);
  if (!candidate) return undefined;
  try {
    const result = ParallelWorkPlanSchema.safeParse(JSON.parse(candidate));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

function extractJsonObject(text: string): string | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1]?.trim();
  const source = fenced || text.trim();
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  return source.slice(start, end + 1);
}
