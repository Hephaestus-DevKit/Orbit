import { describe, expect, it, mockTools as vi } from "../../../../scripts/testing/support.mjs";
import { UpdatePlanInputSchema, UpdatePlanTool } from "./updatePlan.js";

describe("UpdatePlanTool", () => {
  it("rejects ambiguous plans with multiple active steps", () => {
    const result = UpdatePlanInputSchema.safeParse({
      plan: [
        { step: "Inspect", status: "in_progress" },
        { step: "Implement", status: "in_progress" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("passes a validated durable plan to the active loop service", async () => {
    const updatePlan = vi.fn(async (input) => ({ items: input.plan }));
    const input = {
      explanation: "Starting implementation",
      plan: [
        { step: "Inspect", status: "completed" as const },
        { step: "Implement", status: "in_progress" as const },
      ],
    };

    const result = await new UpdatePlanTool().execute(input, {
      cwd: process.cwd(),
      sessionId: "test",
      services: { updatePlan },
    });

    expect(result.ok).toBe(true);
    expect(updatePlan).toHaveBeenCalledWith(input);
  });
});
