import { z } from "zod";
import type { OrbitTool, ToolContext, ToolResult } from "../types.js";

export const UpdatePlanInputSchema = z
  .object({
    explanation: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .describe("Brief reason for changing the plan.")
      .optional(),
    plan: z
      .array(
        z.object({
          step: z.string().trim().min(1).max(1000),
          status: z.enum(["pending", "in_progress", "completed"]),
        }),
      )
      .max(100),
  })
  .superRefine((value, ctx) => {
    if (value.plan.filter((item) => item.status === "in_progress").length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["plan"],
        message: "At most one plan item may be in progress.",
      });
    }
    const normalizedSteps = value.plan.map((item) => item.step.toLowerCase());
    if (new Set(normalizedSteps).size !== normalizedSteps.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["plan"],
        message: "Plan steps must be unique.",
      });
    }
  });

export type UpdatePlanInput = z.infer<typeof UpdatePlanInputSchema>;

/** Lets the model keep the active chat's durable task plan accurate. */
export class UpdatePlanTool implements OrbitTool<UpdatePlanInput, unknown> {
  public readonly name = "update_plan";
  public readonly description =
    "Create or replace the current chat's durable task plan. Use for multi-step work and update statuses as work progresses. Keep at most one step in progress.";
  public readonly inputSchema = UpdatePlanInputSchema;
  public readonly risk = "write" as const;

  public async execute(
    input: UpdatePlanInput,
    context: ToolContext,
  ): Promise<ToolResult<unknown>> {
    if (!context.services?.updatePlan) {
      return { ok: false, error: "Task-plan service is unavailable." };
    }
    try {
      const data = await context.services.updatePlan(input);
      return {
        ok: true,
        data,
        display: `Updated task plan with ${input.plan.length} step(s).`,
      };
    } catch (error: unknown) {
      return {
        ok: false,
        error: `Unable to update task plan: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}
