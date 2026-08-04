import { describe, expect, it } from "vitest";
import { summarizeWebUiAgentRuns } from "./WebUiAgentData.js";

describe("summarizeWebUiAgentRuns", () => {
  it("bounds records and redacts credentials", () => {
    expect(
      summarizeWebUiAgentRuns([
        {
          id: "run_safe",
          task: "Bearer secret-token",
          status: "running",
          budgetUsd: 2,
          costUsd: 0.25,
          updatedAt: "2026-07-25T00:00:00.000Z",
          agents: [
            {
              id: "agent_safe",
              role: "reviewer",
              task: "Inspect Bearer secret-token",
              status: "running",
              model: "model",
              sessionId: "sess_friendly-panda-123",
              budgetUsd: 0.5,
              costUsd: 0.1,
              access: { mode: "write", scopes: ["workspace"] },
              steering: {
                count: 2,
                lastAt: "2026-07-25T00:00:30.000Z",
              },
            },
            { id: "../escape", role: "invalid" },
          ],
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        id: "run_safe",
        task: "Bearer ***REDACTED***",
        agents: [
          expect.objectContaining({
            id: "agent_safe",
            task: "Inspect Bearer ***REDACTED***",
            access: "write",
            sessionId: "sess_friendly-panda-123",
            steeringCount: 2,
            lastSteeredAt: "2026-07-25T00:00:30.000Z",
          }),
        ],
      }),
    ]);
  });

  it("rejects invalid run identifiers and non-array input", () => {
    expect(summarizeWebUiAgentRuns({})).toEqual([]);
    expect(summarizeWebUiAgentRuns([{ id: "../escape", agents: [] }])).toEqual(
      [],
    );
  });
});
