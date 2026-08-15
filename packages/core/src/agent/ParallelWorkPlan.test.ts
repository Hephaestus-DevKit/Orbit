import { describe, expect, it } from "vitest";
import {
  ParallelWorkPlanSchema,
  parseParallelWorkPlan,
} from "./ParallelWorkPlan.js";

describe("parallel work plans", () => {
  it("parses fenced planner JSON and normalizes portable scopes", () => {
    const plan = parseParallelWorkPlan(`Plan follows:
\`\`\`json
{"summary":"Split UI and server work.","tasks":[{"id":"server","task":"Update API","scopes":["packages\\cli\\src\\runtime"]},{"id":"ui","task":"Update styles","scopes":["packages/cli/src/runtime/webui"]}]}
\`\`\``);

    // A parent and child scope overlap, so an unsafe parallel plan is refused.
    expect(plan).toBeUndefined();
  });

  it("accepts independent writer scopes", () => {
    expect(
      parseParallelWorkPlan(
        JSON.stringify({
          summary: "Split implementation and docs.",
          tasks: [
            { id: "runtime", task: "Implement runtime", scopes: ["src"] },
            { id: "docs", task: "Update docs", scopes: ["docs"] },
          ],
        }),
      ),
    ).toEqual({
      summary: "Split implementation and docs.",
      tasks: [
        { id: "runtime", task: "Implement runtime", scopes: ["src"] },
        { id: "docs", task: "Update docs", scopes: ["docs"] },
      ],
    });
  });

  it("rejects duplicate ids, workspace-wide writers, and malformed JSON", () => {
    expect(
      ParallelWorkPlanSchema.safeParse({
        summary: "unsafe",
        tasks: [
          { id: "same", task: "one", scopes: ["*"] },
          { id: "same", task: "two", scopes: ["docs"] },
        ],
      }).success,
    ).toBe(false);
    expect(parseParallelWorkPlan("not json")).toBeUndefined();
  });

  it("retains a single workspace-wide task for safe fallback", () => {
    expect(
      parseParallelWorkPlan(
        '{"summary":"Coupled change","tasks":[{"id":"implementation","task":"Implement everything together","scopes":["workspace"]}]}',
      ),
    ).toEqual({
      summary: "Coupled change",
      tasks: [
        {
          id: "implementation",
          task: "Implement everything together",
          scopes: ["*"],
        },
      ],
    });
  });
});
