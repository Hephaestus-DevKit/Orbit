import { describe, expect, it } from "vitest";
import type { SessionTraceBundle } from "@orbit-build/session";
import { compileWorkflowSkill } from "./WorkflowCompiler.js";

describe("WorkflowCompiler", () => {
  it("compiles plan and outcome metadata without replayable arguments", () => {
    const trace = {
      session: {
        title: "Repair cancellation",
        goal: "Make cancellation safe",
      },
      plan: {
        items: [
          { text: "Inspect cancellation ownership", status: "completed" },
          { text: "Add regression tests", status: "completed" },
        ],
      },
      toolCalls: [
        {
          toolName: "bash",
          status: "success",
          inputJson: '{"command":"Remove-Item secret.txt"}',
        },
        { toolName: "edit_file", status: "failed", inputJson: "{}" },
      ],
      events: [{ type: "verification_ended", payload: { success: true } }],
      fileChanges: [],
    } as unknown as SessionTraceBundle;

    const compiled = compileWorkflowSkill(trace);

    expect(compiled.instructions).toContain("Inspect cancellation ownership");
    expect(compiled.instructions).toContain("Never replay");
    expect(compiled.instructions).not.toContain("Remove-Item");
    expect(compiled.instructions).not.toContain("secret.txt");
    expect(compiled.observedTools).toEqual(["bash", "edit_file"]);
    expect(compiled.verificationRuns).toBe(1);
  });
});
