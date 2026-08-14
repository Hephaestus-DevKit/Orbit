import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatToolInputValidationError } from "./AgentLoop.js";

describe("AgentLoop tool input diagnostics", () => {
  it("condenses Zod issues into actionable field messages", () => {
    const schema = z.object({
      waitMs: z.number().int().max(30_000),
      taskIds: z.array(z.string()).min(1),
    });
    const result = schema.safeParse({ waitMs: 60_000, taskIds: [] });
    if (result.success) throw new Error("Expected invalid fixture");

    const message = formatToolInputValidationError(result.error);

    expect(message).toContain("waitMs:");
    expect(message).toContain("taskIds:");
    expect(message).not.toContain('"code"');
    expect(message.length).toBeLessThan(300);
  });
});
