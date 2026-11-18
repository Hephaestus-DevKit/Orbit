import { describe, expect, it } from "../../../../scripts/testing/support.mjs";
import { z } from "zod";
import { safeAgentLoopErrorMessage, formatToolInputValidationError } from "./AgentRunOutcome.js";
describe("Agent run failure presentation", () => {
  it("redacts named credentials and bounds noisy failures", () => {
    const message = safeAgentLoopErrorMessage(
      new Error("api_key=test-credential\n" + "x".repeat(5000)),
    );
    expect(message).not.toContain("test-credential");
    expect(message).not.toContain("\n");
    expect(message.length).toBeLessThanOrEqual(2000);
  });
  it("keeps schema failures actionable without dumping every issue", () => {
    const result = z
      .object({ a: z.string(), b: z.string(), c: z.string(), d: z.string() })
      .safeParse({});
    if (result.success) throw new Error("Expected invalid input");
    expect(formatToolInputValidationError(result.error)).toContain(
      "a: Invalid input: expected string, received undefined",
    );
    expect(formatToolInputValidationError(result.error)).toContain("+1 more");
  });
});
